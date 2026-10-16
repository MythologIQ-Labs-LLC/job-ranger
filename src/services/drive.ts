import { useCallback, useEffect, useState } from "react";
import type { DriveErrorInfo, DriveStatus } from "../shared/google-drive";
import { getDesktopApi, hasDesktopApi } from "./api";

export function useDriveStatus(): { status: DriveStatus | null; refresh: () => Promise<DriveStatus | null> } {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const refresh = useCallback(async () => {
    if (!hasDesktopApi() || !getDesktopApi().drive) return null;
    try {
      const next = await getDesktopApi().drive.status();
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, refresh };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortSha256(sha256: string): string {
  return `${sha256.slice(0, 12)}…${sha256.slice(-4)}`;
}

export const UNCONFIGURED_DRIVE_MESSAGE =
  "This build has no Google Drive client configured, so saving to Google Drive is unavailable. Manual download still works.";

export function unavailableMessage(status: DriveStatus): string {
  if (status.reason === "desktop-only") return "Saving to Google Drive is available in the desktop app only.";
  if (status.reason === "invalid-client-config") {
    return "This build's Google Drive client configuration is invalid, so saving to Google Drive is unavailable. Manual download still works.";
  }
  return UNCONFIGURED_DRIVE_MESSAGE;
}

export function needsReconnect(error: DriveErrorInfo): boolean {
  return error.code === "auth_expired" || error.code === "not_connected" || error.code === "insufficient_scope";
}
