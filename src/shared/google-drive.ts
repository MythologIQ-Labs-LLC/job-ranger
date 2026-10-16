/**
 * User-approved export of generated career artifacts into the user's own
 * Google Drive (#314, desktop slice). Job Ranger requests only the
 * `drive.file` scope, so it can see nothing in Drive except files it created.
 *
 * Tokens never cross this contract: the renderer receives status, proposals,
 * receipts and journal records only.
 */

export const GOOGLE_DRIVE_DESTINATION_LABEL = "My Drive › Job Ranger";

export type DriveUnavailableReason =
  | "desktop-only"
  | "missing-client-config"
  | "invalid-client-config";

export type DriveCredentialStorage = "encrypted" | "session" | "none";

export interface DriveStatus {
  /** False when this runtime or build cannot use Google Drive at all. */
  configured: boolean;
  reason?: DriveUnavailableReason;
  connected: boolean;
  accountEmail?: string;
  /** encrypted: OS-protected file; session: memory only until Job Ranger quits. */
  credentialStorage: DriveCredentialStorage;
  /** A browser sign-in is waiting for the user. */
  connecting: boolean;
  /** Identifies the sign-in in progress, so a cancel cannot hit a later one. */
  connectFlowId?: string;
  /** True when this device cannot encrypt a stored credential. */
  encryptionUnavailable?: boolean;
  /**
   * A stored sign-in exists but could not be decrypted right now (for example
   * a locked keychain). It is kept; try again later or reconnect.
   */
  credentialUnavailable?: boolean;
  /** One-time notice from the call that returned this status (e.g. a grant that could not be revoked). */
  warning?: string;
}

export type DriveErrorCode =
  | "not_configured"
  | "not_connected"
  | "auth_cancelled"
  | "auth_failed"
  | "auth_in_progress"
  | "auth_expired"
  | "insufficient_scope"
  | "rate_limited"
  | "storage_quota"
  | "server"
  | "network"
  | "timeout"
  | "verification_failed"
  | "file_changed"
  | "export_in_progress"
  | "already_exported"
  | "account_mismatch"
  | "remote_trashed"
  | "reserved_id_rejected"
  | "remote_rejected"
  | "invalid_response"
  | "invalid_request";

export interface DriveErrorInfo {
  code: DriveErrorCode;
  message: string;
  /** The journal operation the error belongs to, when one was recorded. */
  operationId?: string;
  /** True when the same operation may be retried without creating a duplicate. */
  retryable: boolean;
}

export type DriveExportState =
  | "approved"
  | "uploading"
  | "verified"
  | "failed"
  | "unknown_remote_outcome"
  /** The person abandoned an unresolved attempt; the record is kept. */
  | "abandoned";

export interface DriveExportRecord {
  operationId: string;
  artifactId: string;
  contentSha256: string;
  fileName: string;
  sizeBytes: number;
  state: DriveExportState;
  driveFileId: string | null;
  webViewLink: string | null;
  errorCode: DriveErrorCode | null;
  errorMessage: string | null;
  /** Google account (Drive permission id) the export was approved for. */
  accountId: string | null;
  accountEmail: string | null;
  approvedAt: string;
  updatedAt: string;
}

export interface DriveExportProposal {
  artifactId: string;
  fileName: string;
  mimeType: "application/pdf";
  formatLabel: "PDF";
  artifactVersion: number;
  pageCount: number | null;
  /** The resume draft or target job this PDF was generated for. */
  generatedFor: string;
  sizeBytes: number;
  sha256: string;
  destination: string;
  /** Immutable Google account id (Drive permissionId) the proposal was made for; echo it on approval. */
  accountId: string;
  accountEmail: string | null;
  /** Earlier verified uploads of exactly this artifact to the connected account. */
  verifiedExports: DriveExportRecord[];
  /** Earlier uploads to the connected account whose Drive copy did not match the PDF. */
  mismatchedCopies: DriveExportRecord[];
  /** An earlier upload to the connected account that must be retried or abandoned first. */
  pendingExport: DriveExportRecord | null;
  /** Verified uploads or unresolved attempts made with another Google account. */
  otherAccountExports: DriveExportRecord[];
}

export interface DriveExportReceipt {
  operationId: string;
  artifactId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  driveFileId: string;
  /** Validated https://drive.google.com/ link, or null when Drive did not return one. */
  webViewLink: string | null;
  verifiedAt: string;
  destination: string;
  accountEmail: string | null;
}

export interface DriveApproveRequest {
  artifactId: string;
  expectedSha256: string;
  /**
   * The account id from the reviewed proposal. The main process refuses the
   * approval if the connected account changed since the review.
   */
  expectedAccountId?: string;
  /** Required when the connected account already has a verified or non-matching copy. */
  saveAnotherCopy?: boolean;
}

export type DriveResult<T> = { ok: true; value: T } | { ok: false; error: DriveErrorInfo };

export interface GoogleDriveDesktopApi {
  drive: {
    status: () => Promise<DriveStatus>;
    /** Starts a sign-in identified by flowId (a UUID chosen by the caller, used to cancel exactly it). */
    connect: (flowId: string) => Promise<DriveResult<DriveStatus>>;
    /** Cancels the sign-in identified by flowId; a stale id is refused. */
    cancelConnect: (flowId: string) => Promise<DriveResult<DriveStatus>>;
    disconnect: () => Promise<DriveResult<{ revoked: boolean; status: DriveStatus }>>;
    prepareExport: (artifactId: string) => Promise<DriveResult<DriveExportProposal>>;
    approveExport: (request: DriveApproveRequest) => Promise<DriveResult<DriveExportReceipt>>;
    retryExport: (operationId: string) => Promise<DriveResult<DriveExportReceipt>>;
    abandonExport: (operationId: string) => Promise<DriveResult<DriveExportRecord>>;
    listExports: (artifactId: string) => Promise<DriveExportRecord[]>;
  };
}

/** Status reported by runtimes that cannot use Google Drive (the web app). */
export const DRIVE_DESKTOP_ONLY_STATUS: DriveStatus = {
  configured: false,
  reason: "desktop-only",
  connected: false,
  credentialStorage: "none",
  connecting: false,
};
