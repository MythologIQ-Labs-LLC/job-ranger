import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  BackupArchiveRecord,
  BackupCreateResult,
  JobRangerArchiveProducer,
  BackupFileRecord,
  BackupManagedPathRecord,
  BackupMigrationRecord,
  BackupRestoreSelection,
  BackupSummary,
  JobRangerBackupManifest,
} from "../../src/shared/backup.js";
import {
  JOB_RANGER_BACKUP_FORMAT,
  JOB_RANGER_BACKUP_VERSION,
} from "../../src/shared/backup.js";
import { sql, SqliteClient } from "./sqlite.cjs";
import { describeNulText, describeRepairFailures, findNulText, repairNulText } from "./nul-text.cjs";
import { migrations as coreMigrations } from "./migrations.cjs";
import { FEATURE_MIGRATIONS } from "./feature-migrations.cjs";
import {
  BACKUP_MANIFEST_FILE as ARCHIVE_BACKUP_MANIFEST_FILE,
  extractArchiveToBundle,
  isArchiveFileName,
  packBackupBundle,
} from "./portable-archive.cjs";

const BACKUP_MANIFEST_FILE = "manifest.json";
const BACKUP_DATABASE_FILE = "jobscout.sqlite3";
const PENDING_RESTORE_FILE = "pending-restore.json";
const STAGED_RESTORE_STATE_FILE = ".job-ranger-restore-state.json";
const ARCHIVE_WORK_PREFIX = ".job-ranger-archive-work-";
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_FILES = 100_000;

interface BackupServiceOptions {
  dataDirectory: string;
  userDataDirectory: string;
  databasePath: string;
  sqliteBinaryPath: string;
  appVersion: string;
  /** Open the source database read-only (historical installation import). */
  readOnlySource?: boolean;
}

type ManagedPathRow = {
  id: string;
  managed_path: string;
  content_hash: string;
};

type MigrationRow = {
  version: number;
  name: string;
};

type IntegrityRow = {
  integrity_check: string;
};

type PendingRestoreMarker = {
  format: "job-ranger-pending-restore";
  version: 1;
  stageDirectory: string;
  createdAt: string;
};

type StagedRestoreState = {
  format: "job-ranger-staged-restore";
  version: 1;
  databaseSha256: string;
  artifactFiles: BackupFileRecord[];
};

function knownMigrationNames(): Map<number, string> {
  return new Map<number, string>([
    ...coreMigrations.map((migration): [number, string] => [migration.version, migration.name]),
    ...Object.values(FEATURE_MIGRATIONS).map((migration): [number, string] => [migration.version, migration.name]),
  ]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function normalizeRelativePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Backup contains an empty or invalid relative path");
  }
  const normalized = value.replace(/\\/g, "/");
  if (
    path.posix.isAbsolute(normalized) ||
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Backup contains an unsafe relative path: ${value}`);
  }
  return normalized;
}

function resolveInside(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split("/"));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (relative === "") return resolved;
    throw new Error(`Backup path escapes its bundle root: ${relativePath}`);
  }
  return resolved;
}

function relativeToDataRoot(dataDirectory: string, managedPath: string): string {
  const root = path.resolve(dataDirectory);
  const target = path.resolve(managedPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Managed artifact is outside the Job Ranger data directory: ${managedPath}`);
  }
  const portable = relative.split(path.sep).join("/");
  const normalized = normalizeRelativePath(portable);
  if (normalized !== "artifacts" && !normalized.startsWith("artifacts/")) {
    throw new Error(`Managed artifact is outside the portable artifacts tree: ${managedPath}`);
  }
  return normalized;
}

async function hashFile(filePath: string): Promise<{ bytes: number; sha256: string }> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Backup expects a regular file: ${filePath}`);
  }
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const buffer: Uint8Array =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    bytes += buffer.byteLength;
    hash.update(buffer);
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function copyVerifiedFile(
  source: string,
  destination: string,
  expectedSha256?: string,
): Promise<BackupFileRecord> {
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Managed backup source must be a regular file: ${source}`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  const hashed = await hashFile(destination);
  if (expectedSha256 && hashed.sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`Managed artifact changed while the backup was being created: ${source}`);
  }
  return {
    path: "",
    bytes: hashed.bytes,
    sha256: hashed.sha256,
  };
}

function parseBackupFile(value: unknown): BackupFileRecord {
  if (!isObject(value)) throw new Error("Backup file record is invalid");
  const relativePath = normalizeRelativePath(value.path);
  if (!Number.isInteger(value.bytes) || (value.bytes as number) < 0 || !isSha256(value.sha256)) {
    throw new Error(`Backup file record is invalid: ${relativePath}`);
  }
  return {
    path: relativePath,
    bytes: value.bytes as number,
    sha256: value.sha256,
  };
}

function parseMigration(value: unknown): BackupMigrationRecord {
  if (
    !isObject(value) ||
    !Number.isInteger(value.version) ||
    (value.version as number) < 1 ||
    typeof value.name !== "string" ||
    !value.name.trim()
  ) {
    throw new Error("Backup migration record is invalid");
  }
  return { version: value.version as number, name: value.name.trim() };
}

function parseManagedPath(value: unknown): BackupManagedPathRecord {
  if (
    !isObject(value) ||
    (value.table !== "source_artifacts" && value.table !== "resume_artifacts") ||
    typeof value.id !== "string" ||
    !value.id.trim()
  ) {
    throw new Error("Backup managed-path record is invalid");
  }
  const relativePath = normalizeRelativePath(value.relativePath);
  if (relativePath !== "artifacts" && !relativePath.startsWith("artifacts/")) {
    throw new Error(`Managed backup path is outside artifacts/: ${relativePath}`);
  }
  return {
    table: value.table,
    id: value.id.trim(),
    relativePath,
  };
}

function parseManifest(value: unknown): JobRangerBackupManifest {
  if (!isObject(value)) throw new Error("Backup manifest is invalid");
  if (value.format !== JOB_RANGER_BACKUP_FORMAT || value.version !== JOB_RANGER_BACKUP_VERSION) {
    throw new Error("This backup format is not supported by this version of Job Ranger");
  }
  if (
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.appVersion !== "string"
  ) {
    throw new Error("Backup manifest metadata is invalid");
  }
  if (!Array.isArray(value.artifactFiles) || value.artifactFiles.length > MAX_BACKUP_FILES) {
    throw new Error("Backup artifact file list is invalid or too large");
  }
  if (!Array.isArray(value.migrations) || !Array.isArray(value.managedPaths)) {
    throw new Error("Backup manifest migration or managed-path metadata is invalid");
  }

  const database = parseBackupFile(value.database);
  if (database.path !== BACKUP_DATABASE_FILE) {
    throw new Error("Backup database path is invalid");
  }
  const artifactFiles = value.artifactFiles.map(parseBackupFile);
  const migrations = value.migrations.map(parseMigration);
  const managedPaths = value.managedPaths.map(parseManagedPath);

  const filePaths = new Set<string>();
  for (const file of artifactFiles) {
    if (file.path !== "artifacts" && !file.path.startsWith("artifacts/")) {
      throw new Error(`Backup artifact is outside artifacts/: ${file.path}`);
    }
    if (filePaths.has(file.path)) throw new Error(`Backup repeats artifact file ${file.path}`);
    filePaths.add(file.path);
  }
  const migrationVersions = new Set<number>();
  for (const migration of migrations) {
    if (migrationVersions.has(migration.version)) {
      throw new Error(`Backup repeats migration version ${migration.version}`);
    }
    migrationVersions.add(migration.version);
  }
  const managedKeys = new Set<string>();
  for (const managed of managedPaths) {
    const key = `${managed.table}:${managed.id}`;
    if (managedKeys.has(key)) throw new Error(`Backup repeats managed-path record ${key}`);
    managedKeys.add(key);
    if (!filePaths.has(managed.relativePath)) {
      throw new Error(`Backup managed path is missing its file: ${managed.relativePath}`);
    }
  }

  return {
    format: JOB_RANGER_BACKUP_FORMAT,
    version: JOB_RANGER_BACKUP_VERSION,
    createdAt: value.createdAt,
    appVersion: value.appVersion,
    database,
    artifactFiles,
    migrations,
    managedPaths,
  };
}

function backupSummary(bundlePath: string, manifest: JobRangerBackupManifest): BackupSummary {
  return {
    bundlePath,
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    artifactFileCount: manifest.artifactFiles.length,
    totalBytes:
      manifest.database.bytes + manifest.artifactFiles.reduce((total, file) => total + file.bytes, 0),
  };
}

async function readJsonFile(filePath: string, maxBytes = MAX_MANIFEST_BYTES): Promise<unknown> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new Error(`Backup metadata file is invalid: ${filePath}`);
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function timestampSlug(value = new Date()): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

async function verifyFileRecord(root: string, record: BackupFileRecord): Promise<void> {
  const filePath = resolveInside(root, record.path);
  const hashed = await hashFile(filePath);
  if (hashed.bytes !== record.bytes || hashed.sha256.toLowerCase() !== record.sha256.toLowerCase()) {
    throw new Error(`Backup file failed integrity verification: ${record.path}`);
  }
}

async function verifyStagedRestore(root: string): Promise<void> {
  const state = parseStagedState(await readJsonFile(path.join(root, STAGED_RESTORE_STATE_FILE)));
  const stagedHash = await hashFile(path.join(root, BACKUP_DATABASE_FILE));
  if (stagedHash.sha256.toLowerCase() !== state.databaseSha256.toLowerCase()) {
    throw new Error("Pending restore database changed after validation");
  }
  for (const file of state.artifactFiles) {
    await verifyFileRecord(root, file);
  }
}

function parsePendingMarker(value: unknown): PendingRestoreMarker {
  if (
    !isObject(value) ||
    value.format !== "job-ranger-pending-restore" ||
    value.version !== 1 ||
    typeof value.stageDirectory !== "string" ||
    !/^\.job-ranger-restore-stage-[a-z0-9-]+$/i.test(value.stageDirectory) ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("Pending restore marker is invalid");
  }
  return {
    format: "job-ranger-pending-restore",
    version: 1,
    stageDirectory: value.stageDirectory,
    createdAt: value.createdAt,
  };
}

function parseStagedState(value: unknown): StagedRestoreState {
  if (
    !isObject(value) ||
    value.format !== "job-ranger-staged-restore" ||
    value.version !== 1 ||
    !isSha256(value.databaseSha256) ||
    !Array.isArray(value.artifactFiles) ||
    value.artifactFiles.length > MAX_BACKUP_FILES
  ) {
    throw new Error("Staged restore state is invalid");
  }
  return {
    format: "job-ranger-staged-restore",
    version: 1,
    databaseSha256: value.databaseSha256,
    artifactFiles: value.artifactFiles.map(parseBackupFile),
  };
}

export class BackupService {
  private readonly liveSqlite: SqliteClient;

  constructor(private readonly options: BackupServiceOptions) {
    this.liveSqlite = new SqliteClient(options.databasePath, options.sqliteBinaryPath, {
      readOnly: options.readOnlySource === true,
    });
  }

  async createBackup(destinationParent: string): Promise<BackupCreateResult> {
    const destinationStat = await fs.lstat(destinationParent);
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
      throw new Error("Backup destination must be a normal local directory");
    }

    const finalName = `job-ranger-backup-${timestampSlug()}.jobranger-backup`;
    const finalPath = path.join(destinationParent, finalName);
    const temporaryPath = path.join(
      destinationParent,
      `.job-ranger-backup-temp-${randomUUID()}`,
    );
    await fs.mkdir(temporaryPath, { recursive: false });

    try {
      const databasePath = path.join(temporaryPath, BACKUP_DATABASE_FILE);
      await this.liveSqlite.exec(sql`VACUUM INTO ${databasePath};`);
      const snapshotSqlite = new SqliteClient(databasePath, this.options.sqliteBinaryPath);

      const migrations = await snapshotSqlite.queryAll<MigrationRow>(
        "SELECT version, name FROM schema_migrations ORDER BY version ASC;",
      );
      const sourceRows = await snapshotSqlite.queryAll<ManagedPathRow>(
        "SELECT id, managed_path, content_hash FROM source_artifacts ORDER BY id ASC;",
      );
      const resumeRows = await snapshotSqlite.queryAll<ManagedPathRow>(
        "SELECT id, managed_path, content_hash FROM resume_artifacts ORDER BY id ASC;",
      );

      const managedPaths: BackupManagedPathRecord[] = [];
      const artifactFilesByPath = new Map<string, BackupFileRecord>();
      const copyManagedRows = async (
        table: BackupManagedPathRecord["table"],
        rows: ManagedPathRow[],
      ) => {
        for (const row of rows) {
          const relativePath = relativeToDataRoot(this.options.dataDirectory, row.managed_path);
          const existing = artifactFilesByPath.get(relativePath);
          if (!existing) {
            const destination = resolveInside(temporaryPath, relativePath);
            const copied = await copyVerifiedFile(row.managed_path, destination, row.content_hash);
            artifactFilesByPath.set(relativePath, { ...copied, path: relativePath });
          } else if (existing.sha256.toLowerCase() !== row.content_hash.toLowerCase()) {
            throw new Error(`Two database records disagree about managed artifact ${relativePath}`);
          }
          managedPaths.push({ table, id: row.id, relativePath });
        }
      };

      await copyManagedRows("source_artifacts", sourceRows);
      await copyManagedRows("resume_artifacts", resumeRows);

      const databaseHash = await hashFile(databasePath);
      const manifest: JobRangerBackupManifest = {
        format: JOB_RANGER_BACKUP_FORMAT,
        version: JOB_RANGER_BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        appVersion: this.options.appVersion,
        database: {
          path: BACKUP_DATABASE_FILE,
          bytes: databaseHash.bytes,
          sha256: databaseHash.sha256,
        },
        artifactFiles: Array.from(artifactFilesByPath.values()).sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
        migrations,
        managedPaths: managedPaths.sort((a, b) =>
          `${a.table}:${a.id}`.localeCompare(`${b.table}:${b.id}`),
        ),
      };
      await fs.writeFile(
        path.join(temporaryPath, BACKUP_MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      await fs.rename(temporaryPath, finalPath);
      return { manifest, summary: backupSummary(finalPath, manifest) };
    } catch (error) {
      await fs.rm(temporaryPath, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Creates a validated backup bundle in a private work directory and packs it
   * into a single portable `.jobranger` archive at `archivePath`.
   */
  async createArchive(
    archivePath: string,
    producer: JobRangerArchiveProducer,
  ): Promise<BackupCreateResult> {
    if (!isArchiveFileName(archivePath)) {
      archivePath = `${archivePath}.jobranger`;
      // The save dialog only confirmed overwriting the name the user typed.
      if (await pathExists(archivePath)) {
        throw new Error(
          `${path.basename(archivePath)} already exists. Choose a different backup name.`,
        );
      }
    }
    const workDirectory = path.join(
      this.options.userDataDirectory,
      `${ARCHIVE_WORK_PREFIX}${randomUUID()}`,
    );
    await fs.mkdir(workDirectory, { recursive: true });
    try {
      const created = await this.createBackup(workDirectory);
      await this.validateBackup(created.summary.bundlePath);
      const packed = await packBackupBundle({
        bundleDirectory: created.summary.bundlePath,
        archivePath,
        producer,
        createdAt: created.manifest.createdAt,
      });
      const archive: BackupArchiveRecord = {
        path: archivePath,
        fileName: path.basename(archivePath),
        bytes: packed.bytes,
        sha256: packed.sha256,
      };
      return {
        manifest: created.manifest,
        summary: { ...created.summary, bundlePath: archivePath },
        archive,
      };
    } finally {
      await fs.rm(workDirectory, { recursive: true, force: true });
    }
  }

  /**
   * Accepts either a `.jobranger` archive or the `manifest.json` inside a
   * legacy directory bundle (v1.2.0 and earlier backups) and returns a fully
   * validated restore selection.
   */
  async validateRestoreSource(selectedPath: string): Promise<BackupRestoreSelection> {
    if (path.basename(selectedPath).toLowerCase() === ARCHIVE_BACKUP_MANIFEST_FILE) {
      return this.validateBackup(path.dirname(selectedPath));
    }
    const stat = await fs.lstat(selectedPath);
    if (stat.isDirectory()) return this.validateBackup(selectedPath);
    await this.removeArchiveWorkDirectories();
    const extracted = path.join(
      this.options.userDataDirectory,
      `${ARCHIVE_WORK_PREFIX}${randomUUID()}`,
    );
    try {
      const archive = await extractArchiveToBundle(selectedPath, extracted);
      const selection = await this.validateBackup(extracted);
      if (archive.producer.runtime !== "electron" || archive.producer.appVersion !== this.options.appVersion) {
        selection.warnings.push(
          `This archive was exported by the Job Ranger ${archive.producer.runtime === "web" ? "web app" : "desktop app"} ${archive.producer.appVersion} (${archive.producer.channel}).`,
        );
      }
      return { ...selection, archive };
    } catch (error) {
      await fs.rm(extracted, { recursive: true, force: true });
      throw error;
    }
  }

  /** Removes extracted-archive work directories left by earlier sessions. */
  async removeArchiveWorkDirectories(): Promise<void> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.options.userDataDirectory);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(ARCHIVE_WORK_PREFIX)) {
        await fs.rm(path.join(this.options.userDataDirectory, name), {
          recursive: true,
          force: true,
        });
      }
    }
  }

  async validateBackup(bundlePath: string): Promise<BackupRestoreSelection> {
    const bundleStat = await fs.lstat(bundlePath);
    if (!bundleStat.isDirectory() || bundleStat.isSymbolicLink()) {
      throw new Error("Select a Job Ranger backup directory");
    }
    const manifest = parseManifest(
      await readJsonFile(path.join(bundlePath, BACKUP_MANIFEST_FILE)),
    );
    await verifyFileRecord(bundlePath, manifest.database);
    for (const file of manifest.artifactFiles) {
      await verifyFileRecord(bundlePath, file);
    }

    const backupDatabasePath = resolveInside(bundlePath, manifest.database.path);
    const backupSqlite = new SqliteClient(backupDatabasePath, this.options.sqliteBinaryPath);
    const integrity = await backupSqlite.queryOne<IntegrityRow>("PRAGMA integrity_check;");
    if (!integrity || integrity.integrity_check !== "ok") {
      throw new Error("Backup database failed SQLite integrity verification");
    }

    const databaseMigrations = await backupSqlite.queryAll<MigrationRow>(
      "SELECT version, name FROM schema_migrations ORDER BY version ASC;",
    );
    const manifestMigrations = new Map(manifest.migrations.map((item) => [item.version, item.name]));
    for (const migration of databaseMigrations) {
      if (manifestMigrations.get(migration.version) !== migration.name) {
        throw new Error(`Backup migration metadata does not match database version ${migration.version}`);
      }
    }
    if (databaseMigrations.length !== manifest.migrations.length) {
      throw new Error("Backup migration metadata is incomplete");
    }

    // Compare against every migration this build knows (core + feature
    // modules), not only those the live database happens to have applied yet.
    const liveMigrationMap = knownMigrationNames();
    for (const migration of manifest.migrations) {
      const knownName = liveMigrationMap.get(migration.version);
      if (!knownName || knownName !== migration.name) {
        throw new Error(
          `Backup uses database migration ${migration.version} (${migration.name}) that this Job Ranger installation does not recognize`,
        );
      }
    }

    const sourceRows = await backupSqlite.queryAll<ManagedPathRow>(
      "SELECT id, managed_path, content_hash FROM source_artifacts ORDER BY id ASC;",
    );
    const resumeRows = await backupSqlite.queryAll<ManagedPathRow>(
      "SELECT id, managed_path, content_hash FROM resume_artifacts ORDER BY id ASC;",
    );
    const expectedManaged = new Map(
      manifest.managedPaths.map((item) => [`${item.table}:${item.id}`, item]),
    );
    const fileByPath = new Map(manifest.artifactFiles.map((item) => [item.path, item]));
    const validateManagedRows = (
      table: BackupManagedPathRecord["table"],
      rows: ManagedPathRow[],
    ) => {
      for (const row of rows) {
        const managed = expectedManaged.get(`${table}:${row.id}`);
        if (!managed) throw new Error(`Backup is missing managed-path metadata for ${table}:${row.id}`);
        const file = fileByPath.get(managed.relativePath);
        if (!file || file.sha256.toLowerCase() !== row.content_hash.toLowerCase()) {
          throw new Error(`Backup artifact metadata does not match ${table}:${row.id}`);
        }
      }
    };
    validateManagedRows("source_artifacts", sourceRows);
    validateManagedRows("resume_artifacts", resumeRows);
    if (sourceRows.length + resumeRows.length !== manifest.managedPaths.length) {
      throw new Error("Backup contains managed-path metadata for records not present in its database");
    }

    const warnings: string[] = [];
    const nulText = await findNulText(backupSqlite);
    if (nulText.length > 0) {
      warnings.push(
        `Some text in this backup contains NUL characters (U+0000), which Job Ranger shows as \uFFFD; it will be restored that way: ${describeNulText(nulText)}.`,
      );
    }
    if (manifest.appVersion !== this.options.appVersion) {
      warnings.push(
        `This backup was created by Job Ranger ${manifest.appVersion}; the database migrations are compatible with ${this.options.appVersion}, but the restored data will be upgraded on startup if needed.`,
      );
    }
    return {
      bundlePath,
      manifest,
      summary: backupSummary(bundlePath, manifest),
      warnings,
    };
  }

  async stageRestore(bundlePath: string): Promise<BackupRestoreSelection> {
    const selection = await this.validateBackup(bundlePath);
    const markerPath = path.join(this.options.userDataDirectory, PENDING_RESTORE_FILE);
    if (await pathExists(markerPath)) {
      throw new Error("A Job Ranger restore is already pending restart");
    }

    const stageDirectoryName = `.job-ranger-restore-stage-${randomUUID()}`;
    const stagePath = path.join(this.options.userDataDirectory, stageDirectoryName);
    await fs.mkdir(stagePath, { recursive: false });
    try {
      const stagedDatabasePath = path.join(stagePath, BACKUP_DATABASE_FILE);
      await copyVerifiedFile(
        resolveInside(bundlePath, selection.manifest.database.path),
        stagedDatabasePath,
        selection.manifest.database.sha256,
      );
      for (const file of selection.manifest.artifactFiles) {
        const copied = await copyVerifiedFile(
          resolveInside(bundlePath, file.path),
          resolveInside(stagePath, file.path),
          file.sha256,
        );
        if (copied.bytes !== file.bytes) {
          throw new Error(`Backup artifact size changed while staging: ${file.path}`);
        }
      }

      const stagedSqlite = new SqliteClient(stagedDatabasePath, this.options.sqliteBinaryPath);
      const rebaseStatements = selection.manifest.managedPaths.map((managed) => {
        const targetPath = resolveInside(this.options.dataDirectory, managed.relativePath);
        return managed.table === "source_artifacts"
          ? sql`UPDATE source_artifacts SET managed_path = ${targetPath} WHERE id = ${managed.id};`
          : sql`UPDATE resume_artifacts SET managed_path = ${targetPath} WHERE id = ${managed.id};`;
      });
      await stagedSqlite.transaction(rebaseStatements);
      // Text holding NUL (for example from the web app) is restored with NUL as U+FFFD, as the
      // app now stores it everywhere; the desktop engine would otherwise read it back cut off at
      // the NUL (#297). validateBackup already listed these values as a warning.
      const unrepaired = await repairNulText(stagedSqlite, await findNulText(stagedSqlite));
      if (unrepaired.length > 0) {
        throw new Error(
          `This backup contains text with NUL characters (U+0000) that could not be stored as \uFFFD: ${describeRepairFailures(unrepaired)}. Nothing was restored.`,
        );
      }
      const integrity = await stagedSqlite.queryOne<IntegrityRow>("PRAGMA integrity_check;");
      if (!integrity || integrity.integrity_check !== "ok") {
        throw new Error("Staged restore database failed integrity verification after path rebasing");
      }

      const stagedHash = await hashFile(stagedDatabasePath);
      const state: StagedRestoreState = {
        format: "job-ranger-staged-restore",
        version: 1,
        databaseSha256: stagedHash.sha256,
        artifactFiles: selection.manifest.artifactFiles,
      };
      await fs.writeFile(
        path.join(stagePath, STAGED_RESTORE_STATE_FILE),
        `${JSON.stringify(state, null, 2)}\n`,
        "utf8",
      );

      const marker: PendingRestoreMarker = {
        format: "job-ranger-pending-restore",
        version: 1,
        stageDirectory: stageDirectoryName,
        createdAt: new Date().toISOString(),
      };
      const temporaryMarker = `${markerPath}.tmp-${randomUUID()}`;
      await fs.writeFile(temporaryMarker, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
      await fs.rename(temporaryMarker, markerPath);
      if (
        path.basename(bundlePath).startsWith(ARCHIVE_WORK_PREFIX) &&
        path.resolve(path.dirname(bundlePath)) === path.resolve(this.options.userDataDirectory)
      ) {
        await fs.rm(bundlePath, { recursive: true, force: true });
      }
      return selection;
    } catch (error) {
      await fs.rm(stagePath, { recursive: true, force: true });
      throw error;
    }
  }
}

export async function applyPendingRestore(options: {
  userDataDirectory: string;
  dataDirectory: string;
}): Promise<boolean> {
  const markerPath = path.join(options.userDataDirectory, PENDING_RESTORE_FILE);
  if (!(await pathExists(markerPath))) return false;

  const marker = parsePendingMarker(await readJsonFile(markerPath));
  const stagePath = path.join(options.userDataDirectory, marker.stageDirectory);
  const expectedStageParent = path.resolve(options.userDataDirectory);
  if (path.dirname(path.resolve(stagePath)) !== expectedStageParent) {
    throw new Error("Pending restore stage is outside the Job Ranger user-data directory");
  }
  try {
    await verifyStagedRestore(stagePath);
  } catch (stageError) {
    // Runtimes without an atomic directory rename (the web runtime's OPFS
    // adapter copies, then deletes) can be interrupted after the staged data
    // was fully copied into place but before the stage copy was removed. The
    // live directory then still carries the staged-state file; if it verifies
    // completely, the swap already happened and only cleanup remains.
    if (await verifyStagedRestore(options.dataDirectory).then(() => true, () => false)) {
      await fs.rm(markerPath, { force: true });
      await fs.rm(stagePath, { recursive: true, force: true });
      await fs.rm(path.join(options.dataDirectory, STAGED_RESTORE_STATE_FILE), { force: true });
      return true;
    }
    throw stageError;
  }

  const rollbackPath = path.join(
    options.userDataDirectory,
    `.job-ranger-restore-rollback-${randomUUID()}`,
  );
  const liveExists = await pathExists(options.dataDirectory);
  if (liveExists) await fs.rename(options.dataDirectory, rollbackPath);

  try {
    await fs.rename(stagePath, options.dataDirectory);
  } catch (error) {
    if (liveExists && (await pathExists(rollbackPath))) {
      await fs.rename(rollbackPath, options.dataDirectory);
    }
    throw error;
  }

  try {
    await fs.rm(markerPath, { force: true });
  } catch (error) {
    await fs.rename(options.dataDirectory, stagePath);
    if (liveExists && (await pathExists(rollbackPath))) {
      await fs.rename(rollbackPath, options.dataDirectory);
    }
    throw error;
  }

  await fs.rm(path.join(options.dataDirectory, STAGED_RESTORE_STATE_FILE), { force: true });
  if (liveExists) await fs.rm(rollbackPath, { recursive: true, force: true });
  return true;
}
