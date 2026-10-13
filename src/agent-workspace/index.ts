// Agent-first Drive interchange core (#285/#286): local, deterministic, provider-free.
export { AgentWorkspaceError, decodeStrictUtf8, parseStrictJson, type Diagnostic } from "./strict-json.ts";
export { canonicalJson, canonicalJsonBytes, sha256Hex } from "./canonical.ts";
export {
  AGENT_OWNED_KINDS,
  ATTACHMENT_TYPES,
  BATCH_SCHEMA_VERSION,
  batchAttachmentRefs,
  CLAIM_STATUS_MAPPING,
  CONSEQUENTIAL_KINDS,
  LIMITS,
  MANIFEST_SCHEMA_VERSION,
  WORKSPACE_ID_PATTERN,
  type AttachmentRef,
  type Operation,
  type OperationBatch,
  type OperationKind,
  parseCommitMarker,
  parseExportManifest,
  parseOperationBatch,
  validateExportManifest,
} from "./schema.ts";
export { createAgentExport } from "./exporter.ts";
export { verifyExportPacket } from "./verify-export.ts";
export {
  CONTEST_REASONS,
  emptyLedger,
  migrateLedgerV1,
  operationEligibility,
  reconcileWorkspace,
  validateLedger,
  validateReceipt,
  type ContestReason,
  type LedgerEntry,
  type Outcome,
  type ReconcileLedger,
  type ReconcilePolicy,
  type ReconcileResult,
  type Submission,
} from "./reconcile.ts";
export { classifyCitation, evidenceRevision, EVIDENCE_REVISION_PREFIX } from "./revisions.ts";
export type { AgentExportResult, CanonicalSnapshot, ExportReceipt, ExportRequest, ExportScope } from "./types.ts";
export { gatherCanonicalSnapshot, type SnapshotReader } from "./snapshot.ts";
