import type {
  DriveErrorCode,
  DriveExportRecord,
  DriveExportState,
} from "../../../src/shared/google-drive.js";
import { FEATURE_MIGRATIONS } from "../feature-migrations.cjs";
import { sql, type SqliteClient } from "../sqlite.cjs";

/**
 * Write-once journal of user-approved Drive exports. A row is inserted with a
 * fresh operation id before any network call, so a retry after a crash or an
 * ambiguous failure can find the remote file by that id instead of uploading
 * again. Tokens are never stored here.
 */
const DRIVE_EXPORT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS drive_exports (
    operation_id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('approved', 'uploading', 'verified', 'failed', 'unknown_remote_outcome')),
    drive_file_id TEXT,
    web_view_link TEXT,
    error_code TEXT,
    error_message TEXT,
    approved_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_drive_exports_artifact
    ON drive_exports(artifact_id, approved_at DESC);
`;

interface DriveExportRow {
  operation_id: string;
  artifact_id: string;
  content_sha256: string;
  file_name: string;
  size_bytes: number;
  state: DriveExportState;
  drive_file_id: string | null;
  web_view_link: string | null;
  error_code: DriveErrorCode | null;
  error_message: string | null;
  approved_at: string;
  updated_at: string;
}

function mapRow(row: DriveExportRow): DriveExportRecord {
  return {
    operationId: row.operation_id,
    artifactId: row.artifact_id,
    contentSha256: row.content_sha256,
    fileName: row.file_name,
    sizeBytes: Number(row.size_bytes),
    state: row.state,
    driveFileId: row.drive_file_id,
    webViewLink: row.web_view_link,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    approvedAt: row.approved_at,
    updatedAt: row.updated_at,
  };
}

export interface DriveExportUpdate {
  state: DriveExportState;
  driveFileId?: string | null;
  webViewLink?: string | null;
  errorCode?: DriveErrorCode | null;
  errorMessage?: string | null;
}

export class DriveExportJournal {
  constructor(private readonly sqlite: SqliteClient) {}

  async initialize(): Promise<void> {
    const migration = FEATURE_MIGRATIONS.googleDriveExports;
    await this.sqlite.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
    );
    const existing = await this.sqlite.queryOne<{ version: number }>(sql`
      SELECT version FROM schema_migrations WHERE version = ${migration.version} LIMIT 1;
    `);
    if (existing) return;
    await this.sqlite.transaction([
      DRIVE_EXPORT_SCHEMA,
      sql`INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (${migration.version}, ${migration.name}, ${new Date().toISOString()});`,
    ]);
  }

  async insertApproved(input: {
    operationId: string;
    artifactId: string;
    contentSha256: string;
    fileName: string;
    sizeBytes: number;
  }): Promise<DriveExportRecord> {
    const now = new Date().toISOString();
    await this.sqlite.exec(sql`
      INSERT INTO drive_exports (
        operation_id, artifact_id, content_sha256, file_name, size_bytes,
        state, approved_at, updated_at
      ) VALUES (
        ${input.operationId}, ${input.artifactId}, ${input.contentSha256},
        ${input.fileName}, ${input.sizeBytes}, ${"approved"}, ${now}, ${now}
      );
    `);
    const created = await this.get(input.operationId);
    if (!created) throw new Error("Drive export journal entry was not recorded.");
    return created;
  }

  async update(operationId: string, update: DriveExportUpdate): Promise<DriveExportRecord> {
    await this.sqlite.exec(sql`
      UPDATE drive_exports SET
        state = ${update.state},
        drive_file_id = COALESCE(${update.driveFileId ?? null}, drive_file_id),
        web_view_link = COALESCE(${update.webViewLink ?? null}, web_view_link),
        error_code = ${update.errorCode ?? null},
        error_message = ${update.errorMessage ?? null},
        updated_at = ${new Date().toISOString()}
      WHERE operation_id = ${operationId};
    `);
    const updated = await this.get(operationId);
    if (!updated) throw new Error("Drive export journal entry is missing.");
    return updated;
  }

  async get(operationId: string): Promise<DriveExportRecord | null> {
    const row = await this.sqlite.queryOne<DriveExportRow>(sql`
      SELECT * FROM drive_exports WHERE operation_id = ${operationId} LIMIT 1;
    `);
    return row ? mapRow(row) : null;
  }

  async listForArtifact(artifactId: string): Promise<DriveExportRecord[]> {
    const rows = await this.sqlite.queryAll<DriveExportRow>(sql`
      SELECT * FROM drive_exports WHERE artifact_id = ${artifactId}
      ORDER BY approved_at DESC, operation_id ASC;
    `);
    return rows.map(mapRow);
  }
}
