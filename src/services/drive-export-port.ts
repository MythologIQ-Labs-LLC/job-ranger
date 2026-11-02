/**
 * Runtime-neutral port behind the "Save PDF to Google Drive" panel (#314).
 *
 * GoogleDriveResumeExport depends only on this interface:
 * - PWA: PwaDriveExportPort (src/pwa/drive/pwa-drive-port.ts) runs the shared
 *   DriveExportFlow in the page with the isolated OAuth helper and the IndexedDB journal;
 * - Windows app: ElectronDriveExportPort (below) forwards to the Electron main process,
 *   which runs the same flow with Desktop OAuth (PKCE loopback), the safeStorage-protected
 *   refresh token and the SQLite journal. No token ever reaches the renderer.
 */
import type { DriveAuthView } from "../pwa/drive/drive-auth-view";
import type {
  DriveExportOutcome, DriveExportReview, DriveReconcileResult,
} from "../shared/drive/drive-export-flow";
import type {
  DriveDesktopResult, DriveDesktopStatus, GoogleDriveDesktopApi,
} from "../shared/google-drive-desktop";

export interface DriveExportPortLabels {
  authorize: string;
  authorizing: string;
  forget: string;
  /** Present only where an in-progress sign-in can be cancelled from the app. */
  cancelAuthorization?: string;
  /** Extra, runtime-specific sentence under the panel introduction. */
  note?: string;
}

export interface DriveExportPort {
  readonly labels: DriveExportPortLabels;
  /** Emits the current view at once and on every change; null hides the panel. */
  subscribe(listener: (view: DriveAuthView | null) => void): () => void;
  /** Starts authorization synchronously inside the click (the PWA opens a popup). */
  authorize(): void;
  cancelAuthorization?(): void;
  /** Forgets (PWA) or disconnects and revokes (Windows) the Google authorization. */
  forget(): void;
  /** Periodic re-evaluation of expiry. */
  refresh(): void;
  prepare(artifactId: string, version: number): Promise<DriveExportReview>;
  discard(proposalId: string): void;
  confirm(proposalId: string): Promise<DriveExportOutcome>;
  reconcile(artifactId: string): Promise<DriveReconcileResult>;
  cancelPrepared(artifactId: string, operationId: string): Promise<string>;
  abandon(artifactId: string, operationId: string): Promise<string>;
  /** Releases volatile resources on unmount; the port may be subscribed again later. */
  release(): void;
}

type DriveBridge = GoogleDriveDesktopApi["drive"];

async function unwrap<T>(result: Promise<DriveDesktopResult<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw new Error(settled.message);
  return settled.value;
}

function viewOf(status: DriveDesktopStatus): DriveAuthView | null {
  if (!status.available) return null;
  return {
    phase: status.phase === "connected" ? "authorized_unverified" : status.phase,
    message: status.message,
    expiresAt: null,
  };
}

const AUTHORIZING: DriveAuthView = {
  phase: "authorizing",
  message: "Finish signing in to Google in your browser. Sojourner asks only for access to files it creates.",
  expiresAt: null,
};

/** Windows (Electron) implementation over the typed `drive:*` IPC channels. */
export class ElectronDriveExportPort implements DriveExportPort {
  readonly labels: DriveExportPortLabels = {
    authorize: "Connect Google Drive",
    authorizing: "Waiting for Google…",
    forget: "Disconnect Google Drive",
    cancelAuthorization: "Cancel sign-in",
    note: "Sign-in happens in your web browser. Sojourner asks only for access to files it creates (drive.file), and you can disconnect at any time.",
  };
  private view: DriveAuthView | null = null;
  private readonly listeners = new Set<(view: DriveAuthView | null) => void>();
  private flowId: string | null = null;

  constructor(private readonly bridge: DriveBridge | undefined =
    typeof window !== "undefined" ? window.electronAPI?.drive : undefined) {}

  private publish(view: DriveAuthView | null): void {
    this.view = view;
    for (const listener of this.listeners) listener(view);
  }

  private api(): DriveBridge {
    // Honest "not available here": the browser worker has no Drive desktop channels.
    if (!this.bridge) throw new Error("Saving to Google Drive this way is available only in the Windows app.");
    return this.bridge;
  }

  private async sync(message?: string): Promise<void> {
    try {
      const view = viewOf(await this.api().status());
      this.publish(view && message ? { ...view, message } : view);
    } catch {
      this.publish(null);
    }
  }

  subscribe(listener: (view: DriveAuthView | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.view);
    void this.sync();
    return () => { this.listeners.delete(listener); };
  }

  authorize(): void {
    if (this.view?.phase === "authorizing") return;
    const flowId = crypto.randomUUID();
    this.flowId = flowId;
    this.publish(AUTHORIZING);
    void (async () => {
      let message: string | undefined;
      try {
        const result = await this.api().connect(flowId);
        if (!result.ok) message = result.message;
      } catch (cause) {
        message = cause instanceof Error ? cause.message : "Google Drive could not be connected.";
      }
      if (this.flowId === flowId) this.flowId = null;
      await this.sync(message);
    })();
  }

  cancelAuthorization(): void {
    const flowId = this.flowId;
    if (!flowId) return;
    void this.api().cancelConnect(flowId).catch(() => undefined);
  }

  forget(): void {
    void (async () => {
      try {
        const result = await unwrap(this.api().disconnect());
        this.publish(viewOf(result.status));
      } catch (cause) {
        await this.sync(cause instanceof Error ? cause.message : undefined);
      }
    })();
  }

  refresh(): void {
    if (this.view && this.view.phase !== "authorizing") void this.sync();
  }

  private async act<T>(work: () => Promise<DriveDesktopResult<T>>): Promise<T> {
    try {
      return await unwrap(work());
    } finally {
      // A revoked or expired sign-in is reflected immediately.
      if (this.view?.phase !== "authorizing") void this.sync();
    }
  }

  prepare(artifactId: string, version: number): Promise<DriveExportReview> {
    return this.act(() => this.api().prepareExport(artifactId, version));
  }

  discard(proposalId: string): void {
    void this.bridge?.discardExport(proposalId).catch(() => undefined);
  }

  confirm(proposalId: string): Promise<DriveExportOutcome> {
    return this.act(() => this.api().confirmExport(proposalId));
  }

  reconcile(artifactId: string): Promise<DriveReconcileResult> {
    return this.act(() => this.api().reconcileExports(artifactId));
  }

  cancelPrepared(artifactId: string, operationId: string): Promise<string> {
    return this.act(() => this.api().cancelPreparedExport(artifactId, operationId));
  }

  abandon(artifactId: string, operationId: string): Promise<string> {
    return this.act(() => this.api().abandonExport(artifactId, operationId));
  }

  release(): void {
    // Main-process state (sign-in, journal) outlives the panel; nothing volatile here.
  }
}
