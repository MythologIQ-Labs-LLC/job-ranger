/**
 * Windows (Electron) Google Drive export IPC contract (#314).
 *
 * Electron-only: the main process holds the Desktop OAuth client, the refresh token
 * (Windows safeStorage) and the access token (memory). No token, authorization code, PKCE
 * verifier or client secret ever crosses this boundary; the renderer only sees display
 * state, review data, journal summaries and the upload outcome (with the created file's
 * Drive link). The PWA worker registers none of these channels: in the browser the Drive
 * export uses the isolated helper (src/pwa/drive).
 */
import type {
  DriveExportOutcome, DriveExportReview, DriveReconcileResult,
} from "./drive/drive-export-flow.js";

export type DriveCredentialStorage = "encrypted" | "session" | "none";

export interface DriveDesktopStatus {
  /** False when this build has no Google Desktop OAuth client: the UI is hidden. */
  available: boolean;
  phase: "not_connected" | "authorizing" | "connected" | "action_needed";
  /** Verified account e-mail (or a generic label); null when not connected. */
  accountLabel: string | null;
  /** Where the refresh token lives: Windows-encrypted file, memory only, or nowhere. */
  credentialStorage: DriveCredentialStorage;
  message: string;
}

export type DriveDesktopResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface DriveDisconnectResult {
  /** Google confirmed the revocation; the local sign-in is deleted either way. */
  revoked: boolean;
  status: DriveDesktopStatus;
}

export interface GoogleDriveDesktopApi {
  drive: {
    status: () => Promise<DriveDesktopStatus>;
    /** Opens the system browser and waits for the loopback redirect; `flowId` is a UUID. */
    connect: (flowId: string) => Promise<DriveDesktopResult<DriveDesktopStatus>>;
    cancelConnect: (flowId: string) => Promise<DriveDesktopResult<DriveDesktopStatus>>;
    disconnect: () => Promise<DriveDesktopResult<DriveDisconnectResult>>;
    prepareExport: (artifactId: string, version: number) => Promise<DriveDesktopResult<DriveExportReview>>;
    discardExport: (proposalId: string) => Promise<DriveDesktopResult<null>>;
    confirmExport: (proposalId: string) => Promise<DriveDesktopResult<DriveExportOutcome>>;
    reconcileExports: (artifactId: string) => Promise<DriveDesktopResult<DriveReconcileResult>>;
    cancelPreparedExport: (artifactId: string, operationId: string) => Promise<DriveDesktopResult<string>>;
    abandonExport: (artifactId: string, operationId: string) => Promise<DriveDesktopResult<string>>;
  };
}

export const DRIVE_DESKTOP_CHANNELS = [
  "drive:status", "drive:connect", "drive:cancel-connect", "drive:disconnect",
  "drive:prepare-export", "drive:discard-export", "drive:confirm-export",
  "drive:reconcile-exports", "drive:cancel-prepared-export", "drive:abandon-export",
] as const;
