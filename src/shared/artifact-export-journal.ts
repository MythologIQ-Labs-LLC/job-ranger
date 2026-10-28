/**
 * Proposed durable Drive artifact-export journal (#314).
 * Offline domain-only code: the host must supply durable atomic storage.
 * No OAuth, Drive API call, upload, or persistence backend is introduced.
 */
import { advanceExportReceipt } from "./artifact-export-approval.js";
import type { ExportReceipt, ExportStatus } from "./artifact-export-approval.js";

export type RecoveryDecision =
  | { action: "no_upload"; reason: string }
  | { action: "reconcile_remote"; remoteId: string | null; reason: string }
  | { action: "complete"; remoteId: string; reason: string };

export interface ExportJournalRecord {
  schemaVersion: 1;
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
  remoteId: string | null;
  verifiedSha256: string | null;
  updatedAt: string;
}

/** Implemented by platform storage with atomic/transactional writes.
 * Reads must return committed state after application restart.
 * The implementation MUST reject conflicting operation/approval IDs.
 */
export interface DurableExportJournalStore {
  insertIfAbsent(record: ExportJournalRecord): Promise<boolean>;
  compareAndSwap(operationId: string, expected: ExportStatus, next: ExportJournalRecord): Promise<boolean>;
  findOperation(operationId: string): Promise<ExportJournalRecord | null>;
  findApproval(approvalId: string): Promise<ExportJournalRecord | null>;
}

function boundedId(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_:-]{1,160}$/.test(value);
}
function digest(value: string): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
const states: ReadonlySet<string> = new Set<ExportStatus>([
  "prepared", "uploading", "accepted_unverified", "verified", "unknown_remote_outcome",
  "verification_failed", "failed", "cancelled",
]);

export function validateJournalRecord(record: ExportJournalRecord): void {
  if (record.schemaVersion !== 1 || !boundedId(record.operationId) ||
      !boundedId(record.approvalId) || !boundedId(record.accountId) ||
      !boundedId(record.destinationId) || !boundedId(record.artifactId) ||
      !boundedId(record.artifactRevision) || !digest(record.bytesSha256) ||
      !states.has(record.status) ||
      typeof record.fileName !== "string" || record.fileName.length < 3 ||
      record.fileName.length > 180 || /[\\/\x00-\x1f\x7f]/.test(record.fileName) ||
      typeof record.mimeType !== "string" || record.mimeType.length > 120 ||
      !Number.isFinite(Date.parse(record.updatedAt)) ||
      new Date(record.updatedAt).toISOString() !== record.updatedAt ||
      (record.remoteId !== null && !boundedId(record.remoteId)) ||
      (record.verifiedSha256 !== null && !digest(record.verifiedSha256))) {
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
}

export function recoveryDecision(record: ExportJournalRecord): RecoveryDecision {
  validateJournalRecord(record);
  switch (record.status) {
    case "verified":
      return { action: "complete", remoteId: record.remoteId!, reason: "Verified previously; do not upload again." };
    case "prepared":
    case "cancelled":
    case "failed":
      return { action: "no_upload", reason: "No automatic retry; user action is required." };
    case "uploading":
    case "accepted_unverified":
    case "unknown_remote_outcome":
    case "verification_failed":
      return { action: "reconcile_remote", remoteId: record.remoteId,
        reason: "An upload might already exist. Read provider state before any new POST." };
  }
}

/**
 * Called before transferring bytes. A failed insert must never initiate upload.
 * Storage must commit atomically, survive restart, and enforce unique approvalId.
 */
export async function reserveExport(
  store: DurableExportJournalStore, record: ExportJournalRecord,
): Promise<void> {
  validateJournalRecord(record);
  if (record.status !== "prepared" || record.remoteId || record.verifiedSha256) {
    throw new Error("Only a fresh prepared export can be reserved.");
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
    receipt.status, receipt.remoteId, receipt.verifiedSha256,
  );
  const next: ExportJournalRecord = {
    ...current, status: checked.status, remoteId: checked.remoteId,
    verifiedSha256: checked.verifiedSha256, updatedAt: nextTimestamp,
  };
  validateJournalRecord(next);
  if (Date.parse(nextTimestamp) < Date.parse(current.updatedAt) ||
      !await store.compareAndSwap(current.operationId, current.status, next)) {
    throw new Error("Concurrent export update or non-monotonic journal timestamp.");
  }
  return next;
}
