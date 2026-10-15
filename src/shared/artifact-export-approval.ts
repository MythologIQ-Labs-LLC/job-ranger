/**
 * Device-local artifact export approval and receipt guards (#314).
 * No network, OAuth, filesystem, or user gesture authority is implemented here.
 * A trusted UI controller must mint and consume approval IDs after a real click.
 */
export type ExportStatus = "prepared" | "uploading" | "accepted_unverified" |
  "verified" | "unknown_remote_outcome" | "verification_failed" | "failed" | "cancelled";

export interface ExportProposal {
  proposalId: string;
  artifactId: string;
  artifactRevision: string;
  fileName: string;
  mimeType: string;
  bytesSha256: string;
  byteLength: number;
  providerId: "google-drive";
  accountId: string;
  approvedDestinationId: string;
  destinationLabel: string;
  expiresAt: string;
}
export interface HumanExportApproval {
  kind: "explicit_export_artifact";
  approvalId: string;
  proposalId: string;
  confirmedAt: string;
  approvedDigest: string;
  approvedAccountId: string;
  approvedDestinationId: string;
}
export interface ExportReceipt {
  operationId: string;
  proposalId: string;
  status: ExportStatus;
  bytesSha256: string;
  remoteId: string | null;
  verifiedSha256: string | null;
}

const identifier = (value: string): boolean =>
  typeof value === "string" && value.length > 0 && value.length <= 160 &&
  /^[A-Za-z0-9_:-]+$/.test(value);
const digest = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);
const instant = (value: string): number => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
};
const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
});

export function validateExportProposal(proposal: ExportProposal, nowMs: number): void {
  if (!identifier(proposal.proposalId) || !identifier(proposal.artifactId) ||
      !identifier(proposal.artifactRevision) || proposal.providerId !== "google-drive" ||
      !identifier(proposal.accountId) || !identifier(proposal.approvedDestinationId) ||
      !proposal.destinationLabel || proposal.destinationLabel.trim() !== proposal.destinationLabel ||
      proposal.destinationLabel.length > 180 ||
      !digest(proposal.bytesSha256) || !Number.isSafeInteger(proposal.byteLength) ||
      proposal.byteLength < 1 || proposal.byteLength > 50 * 1024 * 1024) {
    throw new Error("Invalid or unbound artifact export proposal.");
  }
  const name = proposal.fileName;
  if (typeof name !== "string" || name.length < 3 || name.length > 180 ||
      name.trim() !== name || name === "." || name === ".." ||
      /[\\/\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name)) {
    throw new Error("Unsafe export filename.");
  }
  const extensions = MIME_EXTENSIONS[proposal.mimeType];
  if (!extensions || !extensions.some(ext => name.toLowerCase().endsWith(ext))) {
    throw new Error("Unsupported artifact format or mismatched extension.");
  }
  const deadline = instant(proposal.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(deadline) ||
      deadline <= nowMs || deadline > nowMs + 5 * 60_000) {
    throw new Error("Expired or excessively long-lived export proposal.");
  }
}

export async function validateApprovedArtifactExport(
  proposal: ExportProposal, approval: HumanExportApproval, bytes: Blob,
  nowMs: number, sha256: (bytes: Blob) => Promise<string>,
): Promise<void> {
  validateExportProposal(proposal, nowMs);
  const confirmed = instant(approval.confirmedAt);
  if (approval.kind !== "explicit_export_artifact" ||
      !identifier(approval.approvalId) ||
      approval.proposalId !== proposal.proposalId ||
      approval.approvedDigest !== proposal.bytesSha256 ||
      approval.approvedAccountId !== proposal.accountId ||
      approval.approvedDestinationId !== proposal.approvedDestinationId ||
      !Number.isFinite(confirmed) || confirmed > nowMs + 10_000 ||
      nowMs - confirmed > 2 * 60_000 ||
      !(bytes instanceof Blob) || bytes.size !== proposal.byteLength) {
    throw new Error("Export requires fresh approval of exact bytes, account and destination.");
  }
  const actual = await sha256(bytes);
  if (!digest(actual) || actual !== proposal.bytesSha256) {
    throw new Error("Artifact bytes changed after approval.");
  }
}

/** One operation may never be retried automatically after an ambiguous remote outcome. */
const transitions: Readonly<Record<ExportStatus, readonly ExportStatus[]>> = {
  prepared: ["uploading", "cancelled"],
  uploading: ["accepted_unverified", "unknown_remote_outcome", "failed"],
  accepted_unverified: ["verified", "verification_failed", "unknown_remote_outcome"],
  verified: [],
  unknown_remote_outcome: ["accepted_unverified", "verified", "verification_failed"],
  verification_failed: ["verified"],
  failed: [],
  cancelled: [],
};
export function advanceExportReceipt(
  receipt: ExportReceipt, next: ExportStatus,
  remoteId: string | null = null, verifiedSha256: string | null = null,
): ExportReceipt {
  if (!transitions[receipt.status].includes(next)) {
    throw new Error("Invalid export transition; retry requires reconciliation or new consent.");
  }
  const resolvedId = remoteId ?? receipt.remoteId;
  if ((next === "accepted_unverified" || next === "verified" || next === "verification_failed") &&
      !identifier(resolvedId ?? "")) {
    throw new Error("Remote acknowledgement requires a validated file ID.");
  }
  if (next === "verified" && (!digest(verifiedSha256 ?? "") ||
      verifiedSha256 !== receipt.bytesSha256)) {
    throw new Error("Provider readback digest does not match approved bytes.");
  }
  if (remoteId && receipt.remoteId && receipt.remoteId !== remoteId) {
    throw new Error("Remote file identity cannot change within an operation.");
  }
  return { ...receipt, status: next, remoteId: resolvedId,
    verifiedSha256: next === "verified" ? verifiedSha256 : receipt.verifiedSha256 };
}

/**
 * Volatile anti-double-submit guard only. The host must persist an operation
 * before contacting Drive and hydrate durable receipts after restart.
 */
export class ExportApprovalLedger {
  private readonly used = new Set<string>();
  consume(approval: HumanExportApproval): void {
    if (!identifier(approval.approvalId) || this.used.has(approval.approvalId)) {
      throw new Error("Export approval already consumed or malformed.");
    }
    this.used.add(approval.approvalId);
  }
}
