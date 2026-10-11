/**
 * PROTOTYPE ONLY: provider-neutral Job Ranger snapshot transport contract.
 *
 * Issue #257. No runtime adoption, OAuth client, Drive API, data movement,
 * retention policy, or archive format decision is implemented here.
 *
 * Snapshot content remains opaque to the provider. The orchestrator is solely
 * responsible for validating the source archive, presenting its privacy scope,
 * and recording an actual per-operation user decision.
 */

export type SnapshotProviderId = "google-drive" | "onedrive";

/**
 * "connected_verified" requires an actual provider probe with time/provenance.
 * A token, browser popup or locally persisted account hint proves nothing.
 */
export type SyncConnection =
  | { phase: "not_connected" | "authorizing" | "reconnect_required"; detail: string; checkedAt: null }
  | { phase: "authorized_unverified"; detail: string; checkedAt: null }
  | { phase: "connected_verified"; detail: string; checkedAt: string; verification: "provider_probe" }
  | { phase: "temporarily_unavailable"; detail: string; checkedAt: string | null; lastVerifiedAt: string | null };

/**
 * Opaque to storage providers. #255 must decide whether to reuse an existing
 * .jobranger file byte-for-byte or create a separate minimized agent export.
 */
export interface SnapshotPayload {
  /** User-visible filename without path separators or directory segments. */
  fileName: string;
  /** Exact immutable bytes approved by the user. */
  bytes: Blob;
  sha256Hex: string;
  /** ISO 8601 instant from the manifest, NOT a provider-generated timestamp. */
  sourceCreatedAt: string;
  format: { id: string; version: number };
  /** The orchestrator has validated the source and its integrity on this build. */
  validated: true;
}

export interface SnapshotUploadApproval {
  kind: "explicit_share_snapshot";
  /** Unique transaction ID from the human-action orchestrator. */
  transactionId: string;
  confirmedAt: string;
  /** Consent is bound to specific bytes, not merely the word "backup". */
  approvedSha256Hex: string;
  approvedByteLength: number;
  /** Stable identifier of the human-readable disclosures shown to the user. */
  disclosureVersion: string;
  /** User-facing destination presented before approval. */
  destinationLabel: string;
}

export interface ApprovedSnapshotUpload {
  snapshot: SnapshotPayload;
  approval: SnapshotUploadApproval;
}

export type UploadOutcome =
  | {
      status: "accepted_unverified";
      remoteId: string;
      providerId: SnapshotProviderId;
      /** A successful HTTP upload response isn't a verified readable archive. */
      receivedAt: string;
    }
  | {
      status: "verified";
      remoteId: string;
      providerId: SnapshotProviderId;
      receivedAt: string;
      verifiedAt: string;
      observedSha256Hex: string;
    };

export interface RemoteSnapshot {
  providerId: SnapshotProviderId;
  remoteId: string;
  parentFolderId: string;
  name: string;
  byteLength: number | null;
  createdAt: string | null;
  sha256Hex: string | null;
  /** False if remote metadata lacks enough evidence to verify content. */
  verified: boolean;
}

export interface SnapshotListPage {
  items: readonly RemoteSnapshot[];
  nextPageToken: string | null;
  /** Scope remains the app-created / user-authorized Drive folder only. */
  folderId: string;
  checkedAt: string;
}

export interface SnapshotListQuery {
  limit: number;
  nextPageToken: string | null;
}

export interface ApprovedSnapshotPrune {
  /** Deletion MUST be based on a fresh provider-backed explicit preview. */
  preview: {
    folderId: string;
    selected: readonly RemoteSnapshot[];
    observedAt: string;
  };
  approval: {
    kind: "explicit_delete_these_snapshots";
    transactionId: string;
    confirmedAt: string;
    approvedFolderId: string;
    approvedRemoteIds: readonly string[];
  };
}

export interface PruneResult {
  removedRemoteIds: readonly string[];
  failedRemoteIds: readonly string[];
  /** A partial deletion cannot be mislabeled as total success. */
  completed: boolean;
}

export interface SignOutResult {
  /** False is never disguised as a successful local disconnect. */
  localCredentialCleared: boolean;
  /** Some runtimes may be offline or lack a live token to call revoke. */
  remoteRevocation: "confirmed" | "failed" | "not_attempted";
}

/**
 * A caller must invoke authenticate directly from a user activation. The
 * interface alone cannot prove an actual browser gesture or human intent.
 */
export interface SyncProvider {
  readonly providerId: SnapshotProviderId;
  authenticate(): Promise<SyncConnection>;
  /** Returns evidence-backed state, NOT a cached Boolean. */
  isAuthenticated(): Promise<SyncConnection>;
  signOut(): Promise<SignOutResult>;
  uploadArchive(request: ApprovedSnapshotUpload): Promise<UploadOutcome>;
  listSnapshots(query: SnapshotListQuery): Promise<SnapshotListPage>;
  pruneSnapshots(request: ApprovedSnapshotPrune): Promise<PruneResult>;
}

/**
 * A structural consent guard: catches mismatched bytes, stale/wrong consent,
 * missing destination disclosure, invalid names and malformed identifiers.
 * It cannot substitute for genuine UI consent, local archive validation,
 * remote provider authorization, or hash recomputation by the caller.
 */
export function assertApprovedSnapshotUpload(
  request: ApprovedSnapshotUpload,
  nowMs: number = Date.now(),
): void {
  const { snapshot, approval } = request;
  if (!snapshot.validated || !(snapshot.bytes instanceof Blob)) {
    throw new Error("A verified local snapshot is required before sharing.");
  }
  // #255 has not selected the archive format; do not force an extension here.
  if (snapshot.fileName.length < 3 || snapshot.fileName.length > 180 ||
      snapshot.fileName.trim() !== snapshot.fileName ||
      /[\\/\x00-\x1f]/.test(snapshot.fileName) ||
      snapshot.fileName === "." || snapshot.fileName === "..") {
    throw new Error("Unsafe or unsupported snapshot filename.");
  }
  if (!isSha256(snapshot.sha256Hex) ||
      !isIsoInstant(snapshot.sourceCreatedAt) ||
      !snapshot.format.id.trim() ||
      !Number.isInteger(snapshot.format.version) || snapshot.format.version < 1 ||
      snapshot.bytes.size < 1) {
    throw new Error("Invalid snapshot metadata.");
  }
  if (approval.kind !== "explicit_share_snapshot" ||
      !isSafeIdentifier(approval.transactionId) ||
      !isIsoInstant(approval.confirmedAt) ||
      !isRecentConsent(approval.confirmedAt, nowMs) ||
      approval.approvedSha256Hex !== snapshot.sha256Hex ||
      approval.approvedByteLength !== snapshot.bytes.size ||
      !isSafeIdentifier(approval.disclosureVersion) ||
      !approval.destinationLabel.trim()) {
    throw new Error("Sharing requires fresh approval of these exact archive bytes and destination.");
  }
}

export function assertApprovedSnapshotPrune(
  request: ApprovedSnapshotPrune,
  nowMs: number = Date.now(),
): void {
  const { preview, approval } = request;
  if (approval.kind !== "explicit_delete_these_snapshots" ||
      !isSafeIdentifier(approval.transactionId) ||
      !isSafeIdentifier(preview.folderId) ||
      approval.approvedFolderId !== preview.folderId ||
      !isIsoInstant(preview.observedAt) ||
      !isIsoInstant(approval.confirmedAt) ||
      !isRecentConsent(approval.confirmedAt, nowMs) ||
      !isRecentConsent(preview.observedAt, nowMs) ||
      Date.parse(preview.observedAt) > Date.parse(approval.confirmedAt) ||
      preview.selected.length < 1 ||
      preview.selected.length !== approval.approvedRemoteIds.length) {
    throw new Error("Explicit snapshot deletion approval is missing or mismatched.");
  }
  const ids = preview.selected.map((item) => item.remoteId);
  if (new Set(ids).size !== ids.length ||
      ids.some((id, index) =>
        !isSafeIdentifier(id) ||
        preview.selected[index].parentFolderId !== preview.folderId ||
        approval.approvedRemoteIds[index] !== id
      )) {
    throw new Error("Deletion is limited to explicitly selected snapshots in the reviewed folder.");
  }
}

export function assertSnapshotListQuery(query: SnapshotListQuery): void {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100 ||
      (query.nextPageToken !== null && (typeof query.nextPageToken !== "string" ||
       !query.nextPageToken || query.nextPageToken.length > 2048))) {
    throw new Error("Snapshot list request is outside the bounded provider contract.");
  }
}

/**
 * Prevent approving a transfer in one session and replaying it much later.
 * The UI must independently prove this approval came from a real user action.
 */
const MAX_APPROVAL_AGE_MS = 5 * 60_000;

function isRecentConsent(iso: string, nowMs: number): boolean {
  const atMs = Date.parse(iso);
  const ageMs = nowMs - atMs;
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_APPROVAL_AGE_MS;
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function isIsoInstant(value: string): boolean {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 19) === value.slice(0, 19);
}

function isSafeIdentifier(value: string): boolean {
  // Remote IDs are provider-defined opaque strings, not local paths.
  // An adapter must encode them before inserting them into any provider URL.
  return typeof value === "string" && value.length > 0 &&
    value.length <= 512 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
}
