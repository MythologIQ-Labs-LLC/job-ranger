/**
 * Durable Drive artifact-export journal (#314).
 * Offline domain-only code: the host must supply durable atomic storage.
 * No OAuth, Drive API call, upload, or persistence backend is introduced.
 *
 * Schema v2 adds the Drive file ID reserved with files.generateIds BEFORE an
 * operation may enter "uploading". A strongly consistent files.get of that ID
 * later proves whether the create landed (200) or not (404), so a crash before
 * POST, or a request that failed before sending bytes, cannot block an artifact
 * forever. v1 rows (no reserved ID) remain readable via upgradeJournalRecord.
 */
import { advanceExportReceipt } from "./artifact-export-approval.js";
import type { ExportReceipt, ExportResolution, ExportStatus } from "./artifact-export-approval.js";

export type RecoveryDecision =
  | { action: "no_upload"; reason: string }
  | { action: "reconcile_remote"; remoteId: string | null; reservedFileId: string | null; reason: string }
  | { action: "complete"; remoteId: string; reason: string };

export const EXPORT_JOURNAL_SCHEMA_VERSION = 2;

export interface ExportJournalRecord {
  schemaVersion: 2;
  operationId: string;
  approvalId: string;
  accountId: string;
  destinationId: string;
  artifactId: string;
  artifactRevision: string;
  bytesSha256: string;
  fileName: string;
  mimeType: string;
  status: ExportStatus;
  /** Drive file ID reserved before upload; immutable once journaled. null only for upgraded v1 rows. */
  reservedFileId: string | null;
  remoteId: string | null;
  verifiedSha256: string | null;
  /** Evidence for a failed/abandoned terminal state; null otherwise. */
  resolution: ExportResolution | null;
  updatedAt: string;
}

/** Implemented by platform storage with atomic/transactional writes.
 * Reads must return committed state after application restart.
 * The implementation MUST reject conflicting operation/approval IDs, and MUST
 * enforce checkJournalTransition inside the same atomic compare-and-swap.
 */
export interface DurableExportJournalStore {
  insertIfAbsent(record: ExportJournalRecord): Promise<boolean>;
  compareAndSwap(operationId: string, expected: ExportStatus, next: ExportJournalRecord): Promise<boolean>;
  findOperation(operationId: string): Promise<ExportJournalRecord | null>;
  findApproval(approvalId: string): Promise<ExportJournalRecord | null>;
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_:-]{1,160}$/.test(value);
}
function driveId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
const states: ReadonlySet<string> = new Set<ExportStatus>([
  "prepared", "uploading", "accepted_unverified", "verified", "unknown_remote_outcome",
  "verification_failed", "failed", "cancelled", "abandoned",
]);
const resolutions: ReadonlySet<string> = new Set<ExportResolution>([
  "provider_rejected", "reserved_id_absent", "user_abandoned",
]);

export function validateJournalRecord(record: ExportJournalRecord): void {
  if (!record || typeof record !== "object" ||
      record.schemaVersion !== EXPORT_JOURNAL_SCHEMA_VERSION || !boundedId(record.operationId) ||
      !boundedId(record.approvalId) || !boundedId(record.accountId) ||
      !boundedId(record.destinationId) || !boundedId(record.artifactId) ||
      !boundedId(record.artifactRevision) || !digest(record.bytesSha256) ||
      !states.has(record.status) ||
      typeof record.fileName !== "string" || record.fileName.length < 3 ||
      record.fileName.length > 180 || /[\\/\x00-\x1f\x7f]/.test(record.fileName) ||
      typeof record.mimeType !== "string" || record.mimeType.length > 120 ||
      typeof record.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(record.updatedAt)) ||
      new Date(record.updatedAt).toISOString() !== record.updatedAt ||
      (record.reservedFileId !== null && !driveId(record.reservedFileId)) ||
      (record.remoteId !== null && !boundedId(record.remoteId)) ||
      (record.verifiedSha256 !== null && !digest(record.verifiedSha256)) ||
      (record.resolution !== null && !resolutions.has(record.resolution))) {
    throw new Error("Invalid durable export journal record.");
  }
  if (record.status !== "verified" && record.verifiedSha256 !== null) {
    throw new Error("Only a verified export may retain a verified readback digest.");
  }
  if (record.status === "verified" &&
      (!record.remoteId || record.verifiedSha256 !== record.bytesSha256)) {
    throw new Error("Verified journal entry requires matching remote readback.");
  }
  if ((record.status === "accepted_unverified" || record.status === "verification_failed") &&
      !record.remoteId) {
    throw new Error("Acknowledged export requires remote file identity.");
  }
  if (record.reservedFileId && record.remoteId && record.remoteId !== record.reservedFileId) {
    throw new Error("A remote file must carry the operation's reserved Drive file ID.");
  }
  if ((record.status === "failed") !==
      (record.resolution === "provider_rejected" || record.resolution === "reserved_id_absent") ||
      (record.status === "abandoned") !== (record.resolution === "user_abandoned")) {
    throw new Error("Terminal export state and its recorded resolution disagree.");
  }
  if (record.resolution === "reserved_id_absent" && !record.reservedFileId) {
    throw new Error("Only a reserved Drive file ID can prove that no file was created.");
  }
}

/**
 * Reads any stored journal row: v2 rows are validated as-is; v1 rows (written before
 * file-ID reservation) are upgraded with reservedFileId = null. In v1 the only way to
 * reach "failed" was a definitive provider rejection, which is recorded as such.
 * Anything else fails closed.
 */
export function upgradeJournalRecord(stored: unknown): ExportJournalRecord {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error("Invalid durable export journal record.");
  }
  const raw = stored as Record<string, unknown>;
  let record: ExportJournalRecord;
  if (raw.schemaVersion === 1) {
    if ("reservedFileId" in raw || "resolution" in raw) {
      throw new Error("Invalid durable export journal record.");
    }
    record = {
      ...(raw as unknown as Omit<ExportJournalRecord, "schemaVersion" | "reservedFileId" | "resolution">),
      schemaVersion: 2, reservedFileId: null,
      resolution: raw.status === "failed" ? "provider_rejected" : null,
    };
  } else {
    record = { ...(raw as unknown as ExportJournalRecord) };
  }
  validateJournalRecord(record);
  return record;
}

/**
 * A fresh approval ID is not sufficient to protect against duplicate uploads.
 * Block a new POST for the same verified Drive account and saved artifact
 * while an earlier operation could still have created a remote file.
 * The guard deliberately spans revisions, and survives page reloads via the journal.
 */
export function blocksFreshArtifactExport(
  record: ExportJournalRecord, accountId: string, artifactId: string,
): boolean {
  validateJournalRecord(record);
  return record.accountId === accountId && record.artifactId === artifactId &&
    (record.status === "prepared" ||
     record.status === "uploading" ||
     record.status === "accepted_unverified" ||
     record.status === "unknown_remote_outcome" ||
     record.status === "verification_failed");
}

export function recoveryDecision(record: ExportJournalRecord): RecoveryDecision {
  validateJournalRecord(record);
  switch (record.status) {
    case "verified":
      return { action: "complete", remoteId: record.remoteId!, reason: "Verified previously; do not upload again." };
    case "prepared":
    case "cancelled":
    case "failed":
    case "abandoned":
      return { action: "no_upload", reason: "No automatic retry; user action is required." };
    case "uploading":
    case "accepted_unverified":
    case "unknown_remote_outcome":
    case "verification_failed":
      return { action: "reconcile_remote", remoteId: record.remoteId,
        reservedFileId: record.reservedFileId,
        reason: record.reservedFileId
          ? "Read the reserved Drive file ID before any new POST."
          : "An upload might already exist. Read provider state before any new POST." };
  }
}

/**
 * The single transition rule shared by advanceDurableExport and every storage
 * compare-and-swap. Throws when `next` is not a legal successor of `previous`.
 */
export function checkJournalTransition(previous: ExportJournalRecord, next: ExportJournalRecord): void {
  validateJournalRecord(previous);
  validateJournalRecord(next);
  if (previous.operationId !== next.operationId || previous.approvalId !== next.approvalId ||
      previous.accountId !== next.accountId || previous.destinationId !== next.destinationId ||
      previous.artifactId !== next.artifactId || previous.artifactRevision !== next.artifactRevision ||
      previous.bytesSha256 !== next.bytesSha256 || previous.fileName !== next.fileName ||
      previous.mimeType !== next.mimeType || previous.reservedFileId !== next.reservedFileId) {
    throw new Error("Export journal identity mismatch.");
  }
  if (previous.status === "prepared" && next.status === "uploading" && !previous.reservedFileId) {
    throw new Error("Reserve and journal a Drive file ID before any upload.");
  }
  if (Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) {
    throw new Error("Non-monotonic journal timestamp.");
  }
  const checked = advanceExportReceipt({
    operationId: previous.operationId, proposalId: previous.approvalId,
    status: previous.status, bytesSha256: previous.bytesSha256,
    remoteId: previous.remoteId, verifiedSha256: previous.verifiedSha256,
  }, next.status, next.remoteId, next.verifiedSha256, next.resolution);
  if (checked.remoteId !== next.remoteId || checked.verifiedSha256 !== next.verifiedSha256) {
    throw new Error("Export journal remote identity mismatch.");
  }
}

/**
 * Called before transferring bytes. A failed insert must never initiate upload.
 * Storage must commit atomically, survive restart, and enforce unique approvalId.
 * The Drive file ID must already be reserved (files.generateIds) so the later
 * create is idempotent and its outcome is provable with files.get.
 */
export async function reserveExport(
  store: DurableExportJournalStore, record: ExportJournalRecord,
): Promise<void> {
  validateJournalRecord(record);
  if (record.status !== "prepared" || record.remoteId || record.verifiedSha256 ||
      !record.reservedFileId || record.resolution !== null) {
    throw new Error("Only a fresh prepared export with a reserved Drive file ID can be reserved.");
  }
  const used = await store.findApproval(record.approvalId);
  if (used) throw new Error("User approval is already associated with an export.");
  if (!await store.insertIfAbsent(record)) {
    throw new Error("Export operation or approval was already reserved.");
  }
}

export async function advanceDurableExport(
  store: DurableExportJournalStore, current: ExportJournalRecord,
  receipt: ExportReceipt, nextTimestamp: string,
): Promise<ExportJournalRecord> {
  validateJournalRecord(current);
  if (current.operationId !== receipt.operationId ||
      current.bytesSha256 !== receipt.bytesSha256 ||
      current.status === receipt.status ||
      (current.remoteId !== null && receipt.remoteId !== current.remoteId)) {
    throw new Error("Export journal identity or expected state mismatch.");
  }
  const checked = advanceExportReceipt(
    { operationId: current.operationId, proposalId: receipt.proposalId,
      status: current.status, bytesSha256: current.bytesSha256,
      remoteId: current.remoteId, verifiedSha256: current.verifiedSha256 },
    receipt.status, receipt.remoteId, receipt.verifiedSha256, receipt.resolution ?? null,
  );
  const next: ExportJournalRecord = {
    ...current, status: checked.status, remoteId: checked.remoteId,
    verifiedSha256: checked.verifiedSha256, resolution: checked.resolution ?? null,
    updatedAt: nextTimestamp,
  };
  if (Date.parse(nextTimestamp) < Date.parse(current.updatedAt)) {
    throw new Error("Concurrent export update or non-monotonic journal timestamp.");
  }
  checkJournalTransition(current, next);
  if (!await store.compareAndSwap(current.operationId, current.status, next)) {
    throw new Error("Concurrent export update or non-monotonic journal timestamp.");
  }
  return next;
}
