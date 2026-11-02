/**
 * Runtime identity and capability contract shared by the Electron (Windows
 * native / Microsoft Store) runtime and the local-first web/PWA runtime.
 *
 * Capabilities describe the *environment*, never product truth: Career
 * Evidence authority, the Truth Gate, and user-approval rules are identical in
 * every runtime. A capability that is `false` must be surfaced honestly in the
 * UI instead of silently degrading the workflow.
 */
export type RuntimeKind = "electron" | "web";

export type RuntimeDistributionChannel =
  | "development"
  | "direct-download"
  | "microsoft-store"
  | "web";

export interface RuntimeCapabilities {
  /** Career sites that need a full hidden browser window to render. */
  browserRenderedSources: boolean;
  /** Connection-level DNS pinning for acquisition (Electron main process). */
  dnsPinnedAcquisition: boolean;
  /** Scheduled source monitoring that keeps running while the window is hidden. */
  backgroundMonitoring: boolean;
  /** Operating-system tray/notifications integration. */
  systemTray: boolean;
  /** Managed files can be revealed in the OS file manager (otherwise: download). */
  revealInFileManager: boolean;
  /** The application itself installs updates (false for Store and web channels). */
  appManagedUpdates: boolean;
}

export interface RuntimeStorageStatus {
  /** Human-readable description of where Sojourner data lives. */
  location: string;
  engine: string;
  /** Browser persistent-storage grant; `null` when the concept does not apply. */
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
  warnings: string[];
}

export interface RuntimeInfo {
  kind: RuntimeKind;
  channel: RuntimeDistributionChannel;
  appVersion: string;
  buildId: string;
  platform: string;
  capabilities: RuntimeCapabilities;
  storage: RuntimeStorageStatus;
}

export interface RuntimeDesktopApi {
  getRuntimeInfo: () => Promise<RuntimeInfo>;
}

export const ELECTRON_CAPABILITIES: RuntimeCapabilities = {
  browserRenderedSources: true,
  dnsPinnedAcquisition: true,
  backgroundMonitoring: true,
  systemTray: true,
  revealInFileManager: true,
  appManagedUpdates: false,
};

export const WEB_CAPABILITIES: RuntimeCapabilities = {
  browserRenderedSources: false,
  dnsPinnedAcquisition: false,
  backgroundMonitoring: false,
  systemTray: false,
  revealInFileManager: false,
  appManagedUpdates: false,
};

/**
 * Source types whose public job-board APIs the web runtime can read directly
 * (credential-less CORS GETs to origins in the CSP connect-src allowlist).
 * Other runnable source types need the Electron hidden-browser/HTML path.
 */
export const WEB_RUNNABLE_SOURCE_TYPES = ["greenhouse", "lever", "ashby", "smartrecruiters"] as const;

export function isRunnableInRuntime(kind: RuntimeKind | undefined, sourceType: string): boolean {
  if (kind !== "web") return true;
  return (WEB_RUNNABLE_SOURCE_TYPES as readonly string[]).includes(sourceType);
}
