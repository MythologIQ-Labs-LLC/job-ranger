import {
  checkJournalTransition, upgradeJournalRecord, validateJournalRecord,
  type ExportJournalRecord,
} from "../../../src/shared/artifact-export-journal.js";
import type { ExportStatus } from "../../../src/shared/artifact-export-approval.js";
import type { DriveExportJournal } from "../../../src/shared/drive/drive-export-flow.js";
import { FEATURE_MIGRATIONS } from "../feature-migrations.cjs";
import { sql, type SqliteClient } from "../sqlite.cjs";

/**
 * SQLite store of the Windows Drive export journal (#314, migration 1010).
 *
 * It is a DurableExportJournalStore for the SHARED state machine: every row is the
 * shared ExportJournalRecord (schema v2), validated with validateJournalRecord on write
 * and upgradeJournalRecord on read, and every update is a compare-and-swap that runs
 * checkJournalTransition before an UPDATE conditioned on the exact stored row, so no
 * runtime can apply a transition the PWA journal would refuse. No token, e-mail address
 * or document bytes are stored here.
 */
export const DRIVE_EXPORT_JOURNAL_TABLE = "google_drive_export_journal";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ${DRIVE_EXPORT_JOURNAL_TABLE} (
    operation_id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('prepared', 'uploading', 'accepted_unverified', 'verified',
      'unknown_remote_outcome', 'verification_failed', 'failed', 'cancelled', 'abandoned')),
    updated_at TEXT NOT NULL,
    record_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_google_drive_export_journal_artifact
    ON ${DRIVE_EXPORT_JOURNAL_TABLE}(account_id, artifact_id, status);
`;

const UNRESOLVED: readonly ExportStatus[] = [
  "prepared", "uploading", "accepted_unverified", "unknown_remote_outcome", "verification_failed",
];

interface Row {
  record_json: string;
}

function parse(row: Row): ExportJournalRecord {
  let stored: unknown;
  try {
    stored = JSON.parse(row.record_json);
  } catch {
    throw new Error("Invalid durable export journal record.");
  }
  return upgradeJournalRecord(stored);
}

/** Canonical serialization, so the compare-and-swap can match the exact stored row. */
function serialize(record: ExportJournalRecord): string {
  return JSON.stringify({
    schemaVersion: record.schemaVersion, operationId: record.operationId, approvalId: record.approvalId,
    accountId: record.accountId, destinationId: record.destinationId, artifactId: record.artifactId,
    artifactRevision: record.artifactRevision, bytesSha256: record.bytesSha256, fileName: record.fileName,
    mimeType: record.mimeType, status: record.status, reservedFileId: record.reservedFileId,
    remoteId: record.remoteId, verifiedSha256: record.verifiedSha256, resolution: record.resolution,
    updatedAt: record.updatedAt,
  });
}

export class SqliteDriveExportJournal implements DriveExportJournal {
  private ready: Promise<void> | null = null;

  constructor(private readonly db: SqliteClient) {}

  /** Applies migration 1010 once; the table statement is idempotent on every open. */
  initialize(): Promise<void> {
    this.ready ??= this.migrate().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async migrate(): Promise<void> {
    const migration = FEATURE_MIGRATIONS.googleDriveExportJournal;
    await this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
    await this.db.transaction([
      SCHEMA,
      sql`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
          VALUES (${migration.version}, ${migration.name}, ${new Date().toISOString()});`,
    ]);
  }

  async insertIfAbsent(record: ExportJournalRecord): Promise<boolean> {
    validateJournalRecord(record);
    await this.initialize();
    const changed = await this.db.queryOne<{ changed: number }>(`INSERT OR IGNORE INTO ${DRIVE_EXPORT_JOURNAL_TABLE}` + sql`
        (operation_id, approval_id, account_id, artifact_id, status, updated_at, record_json)
      VALUES (${record.operationId}, ${record.approvalId}, ${record.accountId}, ${record.artifactId},
        ${record.status}, ${record.updatedAt}, ${serialize(record)});
      SELECT changes() AS changed;`);
    return Number(changed?.changed ?? 0) === 1;
  }

  async compareAndSwap(operationId: string, expected: ExportStatus, next: ExportJournalRecord): Promise<boolean> {
    await this.initialize();
    const row = await this.db.queryOne<Row>(`SELECT record_json FROM ${DRIVE_EXPORT_JOURNAL_TABLE} ` +
      sql`WHERE operation_id = ${operationId} LIMIT 1;`);
    if (!row) return false;
    const current = parse(row);
    if (current.status !== expected || next.operationId !== operationId) return false;
    // The single shared transition rule, enforced before the write ...
    checkJournalTransition(current, next);
    // ... which applies only if the row is still exactly the one that was checked.
    const changed = await this.db.queryOne<{ changed: number }>(`UPDATE ${DRIVE_EXPORT_JOURNAL_TABLE} ` + sql`
      SET status = ${next.status}, updated_at = ${next.updatedAt}, record_json = ${serialize(next)}
      WHERE operation_id = ${operationId} AND status = ${expected} AND record_json = ${row.record_json};
      SELECT changes() AS changed;`);
    return Number(changed?.changed ?? 0) === 1;
  }

  async findOperation(operationId: string): Promise<ExportJournalRecord | null> {
    await this.initialize();
    const row = await this.db.queryOne<Row>(`SELECT record_json FROM ${DRIVE_EXPORT_JOURNAL_TABLE} ` +
      sql`WHERE operation_id = ${operationId} LIMIT 1;`);
    return row ? parse(row) : null;
  }

  async findApproval(approvalId: string): Promise<ExportJournalRecord | null> {
    await this.initialize();
    const row = await this.db.queryOne<Row>(`SELECT record_json FROM ${DRIVE_EXPORT_JOURNAL_TABLE} ` +
      sql`WHERE approval_id = ${approvalId} LIMIT 1;`);
    return row ? parse(row) : null;
  }

  async unresolvedForArtifact(accountId: string, artifactId: string): Promise<ExportJournalRecord[]> {
    await this.initialize();
    const statuses = UNRESOLVED.map((status) => sql`${status}`).join(", ");
    const rows = await this.db.queryAll<Row>(`SELECT record_json FROM ${DRIVE_EXPORT_JOURNAL_TABLE} ` +
      sql`WHERE account_id = ${accountId} AND artifact_id = ${artifactId}` +
      ` AND status IN (${statuses}) ORDER BY updated_at ASC, operation_id ASC;`);
    return rows.map(parse).filter((record) => record.accountId === accountId && record.artifactId === artifactId);
  }

  /** Every row, for tests and diagnostics. Contains no secrets. */
  async listAll(): Promise<ExportJournalRecord[]> {
    await this.initialize();
    const rows = await this.db.queryAll<Row>(
      `SELECT record_json FROM ${DRIVE_EXPORT_JOURNAL_TABLE} ORDER BY updated_at ASC, operation_id ASC;`);
    return rows.map(parse);
  }
}
