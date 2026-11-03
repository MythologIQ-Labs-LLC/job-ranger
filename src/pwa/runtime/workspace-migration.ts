/**
 * One-time move of a browser workspace created by a build released as "Job Ranger"
 * (OPFS root LEGACY_USER_DATA_DIRECTORY) to the Sojourner root (USER_DATA_DIRECTORY).
 *
 * The runtime worker calls migrateLegacyWorkspace under its exclusive Web Locks (the
 * current and the legacy lock, so no legacy tab can write meanwhile) and BEFORE the
 * SQLite engine opens the workspace. Standard flavor only: the demo never migrates.
 *
 * Rules (no user may lose data):
 * - nothing happens when the new root already holds a workspace, or the legacy root holds none;
 * - otherwise the new root is claimed with an in-progress marker FIRST, the whole legacy tree
 *   (database, managed artifacts, pending-restore staging, rollback folders, settings) is copied,
 *   the database file is given its new name, and the copy is verified (the same files with equal
 *   sizes); then the copied database's managed-artifact paths are rebased from the legacy data
 *   directory to the new one (as a backup restore does) and it must pass `PRAGMA integrity_check`;
 * - only then is the marker removed, which is the switch: from now on the new root is used;
 * - on any failure only the new (partial) copy is removed and this session runs from the legacy
 *   root; a start that finds the marker (an interrupted copy) discards that partial copy and retries;
 * - the legacy tree is never moved, changed or deleted here (a later version may clean it up).
 *
 * Pure functions over an injected file system, so every branch is unit tested in Node
 * (tests/pwa-workspace-migration.test.mjs). Only erasable TypeScript syntax is used.
 */

export interface MigrationFs {
  readdir(target: string): Promise<string[]>;
  stat(target: string): Promise<{ size: number; isFile(): boolean; isDirectory(): boolean }>;
  copyFile(source: string, destination: string): Promise<void>;
  mkdir(target: string, options: { recursive: true }): Promise<unknown>;
  rm(target: string, options: { recursive: true; force: true }): Promise<void>;
  writeFile(target: string, data: Uint8Array): Promise<void>;
}

/** Written first and removed last: a new root holding it is an unfinished copy, never a workspace. */
export const MIGRATION_IN_PROGRESS_FILE = ".sojourner-migration-in-progress.json";
/** Left in the new root after a completed copy, so a later version knows the legacy tree may be cleaned up. */
export const MIGRATION_RECORD_FILE = ".sojourner-migrated-from-legacy.json";

export interface WorkspaceMigrationOptions {
  /** The Sojourner root, e.g. "/sojourner". */
  userDataDirectory: string;
  /** The legacy root, e.g. "/job-ranger". Read only. */
  legacyUserDataDirectory: string;
  /** Data directory name inside both roots ("data"). */
  dataDirectoryName: string;
  databaseFileName: string;
  legacyDatabaseFileName: string;
  /**
   * Rewrites the copied database's managed-artifact paths that point into `fromDataDirectory` so
   * they point into `toDataDirectory`; throws if any still points into the legacy directory.
   */
  rebaseDatabase(path: string, fromDataDirectory: string, toDataDirectory: string): Promise<void>;
  /** Throws unless the database at this path opens and passes `PRAGMA integrity_check`. */
  verifyDatabase(path: string): Promise<void>;
  now(): number;
}

export type WorkspaceMigrationOutcome =
  | { action: "none"; reason: "workspace-present" | "no-legacy-workspace" }
  | { action: "migrated"; files: number; bytes: number }
  | { action: "failed"; error: unknown; cleanedUp: boolean };

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/\/+$/, "")}/${name}`;
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : null;
}

async function exists(fs: MigrationFs, target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

interface TreeFile {
  /** Path relative to the root, "/"-separated. */
  relative: string;
  size: number;
}

/** Every file below `directory` (a missing directory has none). */
async function listFiles(fs: MigrationFs, directory: string, prefix = ""): Promise<TreeFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return [];
    throw error;
  }
  const files: TreeFile[] = [];
  for (const name of names) {
    const path = joinPath(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const info = await fs.stat(path);
    if (info.isDirectory()) files.push(...(await listFiles(fs, path, relative)));
    else files.push({ relative, size: info.size });
  }
  return files;
}

/**
 * Where a legacy file goes in the new root: the database file (and any file named after it,
 * such as a journal) takes the new database file name; everything else keeps its path.
 */
export function migratedRelativePath(relative: string, options: Pick<WorkspaceMigrationOptions, "dataDirectoryName" | "databaseFileName" | "legacyDatabaseFileName">): string {
  const legacyDatabase = `${options.dataDirectoryName}/${options.legacyDatabaseFileName}`;
  if (relative === legacyDatabase || relative.startsWith(legacyDatabase)) {
    return `${options.dataDirectoryName}/${options.databaseFileName}${relative.slice(legacyDatabase.length)}`;
  }
  return relative;
}

/** True when the new root holds a finished workspace (any file, and no in-progress marker). */
export async function hasWorkspace(fs: MigrationFs, userDataDirectory: string): Promise<boolean> {
  if (await exists(fs, joinPath(userDataDirectory, MIGRATION_IN_PROGRESS_FILE))) return false;
  return (await listFiles(fs, userDataDirectory)).length > 0;
}

export async function migrateLegacyWorkspace(fs: MigrationFs, options: WorkspaceMigrationOptions): Promise<WorkspaceMigrationOutcome> {
  const root = options.userDataDirectory;
  const legacy = options.legacyUserDataDirectory;
  const marker = joinPath(root, MIGRATION_IN_PROGRESS_FILE);
  const interrupted = await exists(fs, marker);
  if (!interrupted && (await listFiles(fs, root)).length > 0) return { action: "none", reason: "workspace-present" };

  const legacyFiles = await listFiles(fs, legacy);
  if (legacyFiles.length === 0) {
    // An interrupted copy whose source is gone holds nothing worth keeping.
    if (interrupted) await fs.rm(root, { recursive: true, force: true });
    return { action: "none", reason: "no-legacy-workspace" };
  }

  try {
    // Discard an interrupted copy, then claim the new root before writing anything else into it.
    if (interrupted) await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    const startedAt = new Date(options.now()).toISOString();
    await fs.writeFile(marker, encodeJson({ schemaVersion: 1, from: legacy, startedAt }));

    let bytes = 0;
    for (const file of legacyFiles) {
      const target = joinPath(root, migratedRelativePath(file.relative, options));
      await fs.mkdir(parentOf(target), { recursive: true });
      await fs.copyFile(joinPath(legacy, file.relative), target);
      bytes += file.size;
    }

    // Verify: exactly the legacy files (renamed where needed), each with its size.
    const expected = new Map(legacyFiles.map((file) => [migratedRelativePath(file.relative, options), file.size]));
    const copied = (await listFiles(fs, root)).filter((file) => file.relative !== MIGRATION_IN_PROGRESS_FILE);
    if (copied.length !== expected.size) throw new Error(`Copied ${copied.length} of ${expected.size} workspace files.`);
    for (const file of copied) {
      if (expected.get(file.relative) !== file.size) throw new Error(`The copy of ${file.relative} does not match the original.`);
    }
    const database = `${options.dataDirectoryName}/${options.databaseFileName}`;
    if (expected.has(database)) {
      const copiedDatabase = joinPath(root, database);
      await options.rebaseDatabase(copiedDatabase, joinPath(legacy, options.dataDirectoryName), joinPath(root, options.dataDirectoryName));
      await options.verifyDatabase(copiedDatabase);
    }

    await fs.writeFile(
      joinPath(root, MIGRATION_RECORD_FILE),
      encodeJson({ schemaVersion: 1, from: legacy, startedAt, completedAt: new Date(options.now()).toISOString(), files: legacyFiles.length, bytes }),
    );
    // The switch: without the marker the new root is the workspace from now on.
    await fs.rm(marker, { recursive: true, force: true });
    return { action: "migrated", files: legacyFiles.length, bytes };
  } catch (error) {
    let cleanedUp = true;
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch {
      // The marker (written first) still identifies whatever is left as a partial copy.
      cleanedUp = false;
    }
    return { action: "failed", error, cleanedUp };
  }
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}
