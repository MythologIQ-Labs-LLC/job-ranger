import type { DriveErrorCode, DriveErrorInfo } from "../../../src/shared/google-drive.js";

/**
 * Codes for which retrying the same operation is meaningful and safe. A
 * verification failure is not: a non-matching copy already exists in Drive.
 */
const RETRYABLE: ReadonlySet<DriveErrorCode> = new Set<DriveErrorCode>([
  "rate_limited",
  "storage_quota",
  "server",
  "network",
  "timeout",
  "invalid_response",
]);

/**
 * A classified Google Drive failure. Messages are written for the person
 * using Job Ranger and never include tokens, codes or request bodies.
 */
export class DriveError extends Error {
  readonly code: DriveErrorCode;
  readonly httpStatus: number | null;
  operationId?: string;

  constructor(code: DriveErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "DriveError";
    this.code = code;
    this.httpStatus = httpStatus;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

export function toDriveError(error: unknown): DriveError {
  if (error instanceof DriveError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new DriveError("invalid_request", message);
}

export function driveErrorInfo(error: unknown): DriveErrorInfo {
  const driveError = toDriveError(error);
  return {
    code: driveError.code,
    message: driveError.message,
    retryable: driveError.retryable && Boolean(driveError.operationId),
    ...(driveError.operationId ? { operationId: driveError.operationId } : {}),
  };
}

interface GoogleErrorBody {
  error?:
    | string
    | {
        code?: number;
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string }>;
        details?: Array<{ reason?: string }>;
      };
  error_description?: string;
}

function reasonsOf(body: GoogleErrorBody | null): string[] {
  const error = body?.error;
  if (!error || typeof error === "string") return typeof error === "string" ? [error] : [];
  return [
    ...(error.errors ?? []).map((item) => item.reason ?? ""),
    ...(error.details ?? []).map((item) => item.reason ?? ""),
    error.status ?? "",
  ].filter(Boolean);
}

/** Classifies a non-2xx Google API response into an actionable DriveError. */
export function classifyGoogleResponse(status: number, body: GoogleErrorBody | null): DriveError {
  const reasons = reasonsOf(body);
  const has = (...names: string[]) => reasons.some((reason) => names.includes(reason));
  if (has("invalid_client", "unauthorized_client")) {
    return new DriveError("not_configured", "Google rejected this build's OAuth client configuration. See the Google Drive setup guide.", status);
  }
  if (status === 401 || has("invalid_grant")) {
    return new DriveError("auth_expired", "Google no longer accepts Job Ranger's access. Reconnect Google Drive in Settings.", status);
  }
  if (status === 429 || has("rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED")) {
    return new DriveError("rate_limited", "Google Drive is limiting requests right now. Wait a minute, then retry.", status);
  }
  if (has("storageQuotaExceeded", "quotaExceeded")) {
    return new DriveError("storage_quota", "Your Google Drive storage is full. Free up space in Drive, then retry.", status);
  }
  if (status === 403 && has("insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientScopes")) {
    return new DriveError("insufficient_scope", "Job Ranger does not have permission to create files in your Drive. Reconnect and allow access to files Job Ranger creates.", status);
  }
  if (status >= 500) {
    return new DriveError("server", "Google Drive had a temporary problem. Retry in a moment.", status);
  }
  return new DriveError("remote_rejected", `Google Drive rejected the request (HTTP ${status}).`, status);
}

/** True when a failed upload POST may still have created a file in Drive. */
export function isAmbiguousUploadFailure(error: DriveError): boolean {
  return error.code === "network" || error.code === "timeout" || error.code === "server" || error.code === "invalid_response";
}
