import type {
  StorageProviderKind, StorageRecordKind, StorageRecordStatus,
} from "../../../src/shared/storage-locations.js";
import { FEATURE_MIGRATIONS } from "../feature-migrations.cjs";
import { sql, type SqliteClient } from "../sqlite.cjs";

/**
 * SQLite record of every backup and document copy Sojourner made at a storage location
 * (#249, migration 1011). Rows move pending -> uploaded -> verified, or to failed; a
 * verified automatic backup that retention removed becomes deleted. Every update is a
 * compare-and-swap on the expected status, so a crash mid-upload leaves the row pending
 * or uploaded (never verified) and startup recovery re-checks it. No token, e-mail
 * address or file content is stored here.
 */
export const STORAGE_RECORDS_TABLE = "storage_location_records";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ${STORAGE_RECORDS_TABLE} (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider IN ('local', 'google', 'onedrive')),
    location_key TEXT NOT NULL,
    location_label TEXT NOT NULL,
    remote_id TEXT,
    remote_path TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    kind TEXT NOT NULL CHECK (kind IN ('automatic', 'manual', 'document')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'uploaded', 'verified', 'failed', 'deleted')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_storage_location_records_location
    ON ${STORAGE_RECORDS_TABLE}(provider, location_key, kind, status, created_at);
`;

const TRANSITIONS: Record<StorageRecordStatus, readonly StorageRecordStatus[]> = {
  pending: ["uploaded", "verified", "failed"],
  uploaded: ["verified", "failed"],
  verified: ["deleted"],
  failed: ["deleted"],
  deleted: [],
};

export function canTransition(from: StorageRecordStatus, to: StorageRecordStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface StorageRecord {
  id: string;
  provider: StorageProviderKind;
  locationKey: string;
  locationLabel: string;
  remoteId: string | null;
  remotePath: string;
  name: string;
  size: number;
  sha256: string;
  kind: StorageRecordKind;
  status: StorageRecordStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string; provider: StorageProviderKind; location_key: string; location_label: string; remote_id: string | null;
  remote_path: string; name: string; size: number; sha256: string; kind: StorageRecordKind;
  status: StorageRecordStatus; error: string | null; created_at: string; updated_at: string;
}

function fromRow(row: Row): StorageRecord {
  return {
    id: row.id, provider: row.provider, locationKey: row.location_key, locationLabel: row.location_label,
    remoteId: row.remote_id, remotePath: row.remote_path, name: row.name, size: Number(row.size), sha256: row.sha256,
    kind: row.kind, status: row.status, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Wraps record writes so the workspace change monitor can tell them from workspace edits. */
export type WriteObserver = <T>(write: () => Promise<T>) => Promise<T>;

export class StorageRecords {
  private ready: Promise<void> | null = null;

  constructor(
    private readonly db: SqliteClient,
    private readonly observeWrite: WriteObserver = (write) => write(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Applies migration 1011 once; the table statement is idempotent on every open. */
  initialize(): Promise<void> {
    this.ready ??= this.migrate().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async migrate(): Promise<void> {
    const migration = FEATURE_MIGRATIONS.storageLocationRecords;
    await this.observeWrite(() => this.db.transaction([
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
      SCHEMA,
      sql`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
          VALUES (${migration.version}, ${migration.name}, ${this.now().toISOString()});`,
    ]));
  }

  async insertPending(record: Omit<StorageRecord, "status" | "error" | "createdAt" | "updatedAt" | "remoteId"> &
    { remoteId?: string | null }): Promise<StorageRecord> {
    await this.initialize();
    const at = this.now().toISOString();
    await this.observeWrite(() => this.db.transaction([`INSERT INTO ${STORAGE_RECORDS_TABLE} ` + sql`
      (id, provider, location_key, location_label, remote_id, remote_path, name, size, sha256, kind, status, error, created_at, updated_at)
      VALUES (${record.id}, ${record.provider}, ${record.locationKey}, ${record.locationLabel}, ${record.remoteId ?? null},
        ${record.remotePath}, ${record.name}, ${record.size}, ${record.sha256}, ${record.kind}, 'pending', NULL, ${at}, ${at});`]));
    return { ...record, remoteId: record.remoteId ?? null, status: "pending", error: null, createdAt: at, updatedAt: at };
  }

  /** Journals the remote reference (reserved id or path) while still pending. */
  async setRemote(id: string, remoteId: string | null, remotePath: string): Promise<boolean> {
    await this.initialize();
    const at = this.now().toISOString();
    const row = await this.observeWrite(() => this.db.queryOne<{ changed: number }>(
      `UPDATE ${STORAGE_RECORDS_TABLE} ` + sql`SET remote_id = ${remoteId}, remote_path = ${remotePath}, updated_at = ${at}
       WHERE id = ${id} AND status IN ('pending', 'uploaded'); SELECT changes() AS changed;`));
    return Number(row?.changed ?? 0) === 1;
  }

  /** Compare-and-swap status transition; refuses transitions the state machine forbids. */
  async transition(id: string, from: StorageRecordStatus, to: StorageRecordStatus,
    patch: { remoteId?: string | null; error?: string | null } = {}): Promise<boolean> {
    if (!canTransition(from, to)) throw new Error(`Invalid storage record transition ${from} -> ${to}.`);
    await this.initialize();
    const at = this.now().toISOString();
    const remote = patch.remoteId !== undefined ? sql`, remote_id = ${patch.remoteId}` : "";
    const error = patch.error !== undefined ? sql`, error = ${patch.error === null ? null : patch.error.slice(0, 500)}` : "";
    const row = await this.observeWrite(() => this.db.queryOne<{ changed: number }>(
      `UPDATE ${STORAGE_RECORDS_TABLE} ` + sql`SET status = ${to}, updated_at = ${at}` + remote + error +
      sql` WHERE id = ${id} AND status = ${from}; SELECT changes() AS changed;`));
    return Number(row?.changed ?? 0) === 1;
  }

  async get(id: string): Promise<StorageRecord | null> {
    await this.initialize();
    const row = await this.db.queryOne<Row>(`SELECT * FROM ${STORAGE_RECORDS_TABLE} ` + sql`WHERE id = ${id} LIMIT 1;`);
    return row ? fromRow(row) : null;
  }

  async unresolved(): Promise<StorageRecord[]> {
    await this.initialize();
    const rows = await this.db.queryAll<Row>(`SELECT * FROM ${STORAGE_RECORDS_TABLE} ` +
      "WHERE status IN ('pending', 'uploaded') ORDER BY created_at ASC, id ASC;");
    return rows.map(fromRow);
  }

  /** Verified automatic backups at one location, newest first. */
  async verifiedAutomatic(provider: StorageProviderKind, locationKey: string): Promise<StorageRecord[]> {
    await this.initialize();
    const rows = await this.db.queryAll<Row>(`SELECT * FROM ${STORAGE_RECORDS_TABLE} ` +
      sql`WHERE provider = ${provider} AND location_key = ${locationKey} AND kind = 'automatic' AND status = 'verified'` +
      " ORDER BY created_at DESC, id DESC;");
    return rows.map(fromRow);
  }

  async forLocation(provider: StorageProviderKind, locationKey: string): Promise<StorageRecord[]> {
    await this.initialize();
    const rows = await this.db.queryAll<Row>(`SELECT * FROM ${STORAGE_RECORDS_TABLE} ` +
      sql`WHERE provider = ${provider} AND location_key = ${locationKey}` + " ORDER BY created_at DESC, id DESC;");
    return rows.map(fromRow);
  }

  async history(limit = 200): Promise<StorageRecord[]> {
    await this.initialize();
    const rows = await this.db.queryAll<Row>(`SELECT * FROM ${STORAGE_RECORDS_TABLE} ` +
      `ORDER BY created_at DESC, id DESC LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))};`);
    return rows.map(fromRow);
  }

  async latestVerified(provider: StorageProviderKind, locationKey: string): Promise<StorageRecord | null> {
    await this.initialize();
    const row = await this.db.queryOne<Row>(`SELECT * FROM ${STORAGE_RECORDS_TABLE} ` +
      sql`WHERE provider = ${provider} AND location_key = ${locationKey} AND kind IN ('automatic', 'manual') AND status = 'verified'` +
      " ORDER BY created_at DESC, id DESC LIMIT 1;");
    return row ? fromRow(row) : null;
  }
}

/**
 * Restoring a backup replaces the live database with the backup's, which carries an
 * older copy of this table. The records describe files at storage locations, not the
 * workspace, so the live records are carried into the staged database before it is
 * verified (BackupService.stageRestore); otherwise retention would lose track of newer
 * automatic backups.
 */
export function carryOverStatements(liveDatabasePath: string): string {
  const migration = FEATURE_MIGRATIONS.storageLocationRecords;
  return [
    sql`ATTACH DATABASE ${liveDatabasePath} AS live_storage;`,
    "BEGIN IMMEDIATE;",
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
    SCHEMA.replace(/\n\s*/g, " "),
    sql`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (${migration.version}, ${migration.name}, ${new Date().toISOString()});`,
    `DELETE FROM main.${STORAGE_RECORDS_TABLE};`,
    `INSERT INTO main.${STORAGE_RECORDS_TABLE} SELECT id, provider, location_key, location_label, remote_id, remote_path, name, size, sha256, kind, status, error, created_at, updated_at FROM live_storage.${STORAGE_RECORDS_TABLE};`,
    "COMMIT;",
    "DETACH DATABASE live_storage;",
  ].join("\n");
}
