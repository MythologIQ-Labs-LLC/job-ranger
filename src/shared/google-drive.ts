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
  /** True when this device cannot encrypt a stored credential. */
  encryptionUnavailable?: boolean;
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
  | "unknown_remote_outcome";

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
  accountEmail: string | null;
  /** Earlier verified uploads of exactly this artifact. */
  verifiedExports: DriveExportRecord[];
  /** An earlier upload whose outcome must be resolved with Retry first. */
  pendingExport: DriveExportRecord | null;
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
}

export interface DriveApproveRequest {
  artifactId: string;
  expectedSha256: string;
  /** Required when the artifact already has a verified Drive copy. */
  saveAnotherCopy?: boolean;
}

export type DriveResult<T> = { ok: true; value: T } | { ok: false; error: DriveErrorInfo };

export interface GoogleDriveDesktopApi {
  drive: {
    status: () => Promise<DriveStatus>;
    connect: () => Promise<DriveResult<DriveStatus>>;
    cancelConnect: () => Promise<DriveStatus>;
    disconnect: () => Promise<DriveResult<{ revoked: boolean; status: DriveStatus }>>;
    prepareExport: (artifactId: string) => Promise<DriveResult<DriveExportProposal>>;
    approveExport: (request: DriveApproveRequest) => Promise<DriveResult<DriveExportReceipt>>;
    retryExport: (operationId: string) => Promise<DriveResult<DriveExportReceipt>>;
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
