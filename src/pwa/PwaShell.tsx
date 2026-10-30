import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { RuntimeBootState } from "./runtime/client";
import { STORAGE_FAILURE_EVENT } from "./runtime/client";
import { applyWaitingUpdate, UPDATE_FAILED_EVENT, UPDATE_READY_EVENT } from "./service-worker-registration";
import { repairAppShell } from "./shell-repair";
import { IS_DEMO_FLAVOR } from "../demo/flavor";
import type { BackupRestoreSelection } from "../shared/backup";

/**
 * Shown when the workspace could not be opened but a backup can still be restored. The worker
 * validates the selected backup and stages it; the damaged database is never read or written,
 * and the next start swaps the backup in before anything opens the workspace.
 */
function RestoreFromBackup() {
  const [selection, setSelection] = useState<BackupRestoreSelection | null>(null);
  const [staging, setStaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const api = (window as unknown as { electronAPI?: { backups: { selectRestore(): Promise<BackupRestoreSelection | null>; stageRestore(path: string): Promise<unknown> } } }).electronAPI;
  const firstRender = useRef(true);
  useEffect(() => {
    // The control the user pressed disappears; keep keyboard focus with the panel (not on first show).
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    (selection ? summary.current : chooseButton.current)?.focus();
  }, [selection]);
  if (!api) return null;
  // No busy state while the browser's file picker is open: some browsers never report a cancel.
  const choose = async () => {
    setError(null);
    try {
      setSelection(await api.backups.selectRestore());
    } catch (cause) {
      setSelection(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const restore = async () => {
    if (!selection) return;
    setStaging(true);
    setError(null);
    try {
      await api.backups.stageRestore(selection.bundlePath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStaging(false);
    }
  };
  return (
    <div className="space-y-3 border-t border-[var(--color-border)] pt-4" data-testid="pwa-recovery-restore">
      <h2 className="text-lg font-semibold">Restore from a backup</h2>
      <p className="text-sm leading-6">
        The workspace database stored in this browser is damaged. If you have a Sojourner backup (a <code>.jobranger</code> file),
        you can restore it here. Nothing changes until you confirm.
      </p>
      {!selection ? (
        <button ref={chooseButton} type="button" className="secondary-button" onClick={() => void choose()}>
          Choose a backup file
        </button>
      ) : (
        <div className="space-y-3">
          <p ref={summary} tabIndex={-1} className="text-sm leading-6" data-testid="pwa-recovery-selection">
            Backup created {new Date(selection.summary.createdAt).toLocaleString()} · {selection.summary.artifactFileCount} managed
            artifact{selection.summary.artifactFileCount === 1 ? "" : "s"}. It passed integrity checks.
          </p>
          {selection.warnings.map((warning, index) => (
            <p key={index} className="text-sm leading-6 text-[var(--color-text-secondary)]">{warning}</p>
          ))}
          <p className="text-sm font-semibold leading-6">
            Restoring permanently replaces the damaged workspace, including anything you changed after this backup was made.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="primary-button" disabled={staging} onClick={() => void restore()}>
              {staging ? "Restoring…" : "Replace this workspace with the backup and restart"}
            </button>
            <button type="button" className="secondary-button" disabled={staging} onClick={() => setSelection(null)}>
              Choose a different file
            </button>
          </div>
        </div>
      )}
      {error && (
        <p aria-live="polite" className="text-sm leading-6 text-[var(--color-danger)]" data-testid="pwa-recovery-error">{error}</p>
      )}
    </div>
  );
}

function BootScreen({ title, children, tone = "info" }: { title: string; children: ReactNode; tone?: "info" | "error" }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section
        className="panel panel-strong max-w-xl space-y-4 p-8"
        role={tone === "error" ? "alert" : "status"}
        aria-live="polite"
        data-testid="pwa-boot-screen"
      >
        <h1 className="text-2xl font-semibold">{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function PwaBootGate({ state, children }: { state: RuntimeBootState; children: ReactNode }) {
  if (state.status === "ready") return <>{children}</>;
  if (state.status === "starting") {
    return (
      <BootScreen title="Opening your local Sojourner workspace…">
        <p className="text-sm">Loading the local database stored in this browser.</p>
      </BootScreen>
    );
  }
  if (state.status === "waiting-for-lock" && IS_DEMO_FLAVOR) {
    return (
      <BootScreen title="The Sojourner demo is open in another tab or window">
        <p className="text-sm leading-6">
          Only one tab can use the demo workspace at a time. Close the other demo tab or window to continue here.
          Closing it discards that tab's demo changes: unless this tab is a copy of it, this tab then starts with fresh
          sample data.
        </p>
      </BootScreen>
    );
  }
  if (state.status === "waiting-for-lock") {
    return (
      <BootScreen title="Sojourner is open in another tab or window">
        <p className="text-sm leading-6">
          To protect your data, only one Sojourner tab can use this browser's local workspace at a time. Close the other
          Sojourner tab or window; this tab will continue automatically.
        </p>
      </BootScreen>
    );
  }
  if (state.code === "demo-workspace-refused") {
    return (
      <BootScreen title="The Sojourner demo cannot start on this site" tone="error">
        <p className="text-sm leading-6" data-testid="pwa-boot-error">{state.message}</p>
        <p className="text-sm leading-6">
          This browser already has a Sojourner workspace for this address that was not created by the demo, so the demo
          has not opened, changed or erased it. The demo must be served from its own address. If that workspace is
          yours, open the full Sojourner app at the address where you created it; if it is left over from an earlier
          demo, clear this site&apos;s data in your browser settings and reload.
        </p>
      </BootScreen>
    );
  }
  return (
    <BootScreen title="Sojourner could not open its local workspace" tone="error">
      <p className="text-sm leading-6" data-testid="pwa-boot-error">{state.message}</p>
      {state.code === "storage-unsupported" ? (
        <p className="text-sm leading-6">
          This browser does not provide the durable private storage Sojourner needs (for example, some private-browsing
          modes). Use a current version of Chrome, Edge, Firefox, or Safari in a normal window.
          Sojourner will not silently fall back to temporary storage that could lose your career data.
        </p>
      ) : IS_DEMO_FLAVOR ? (
        <p className="text-sm leading-6">
          The demo workspace could not be prepared. It only ever holds fictional sample data, which may have been
          replaced already. Reload to start the demo again.
        </p>
      ) : (
        <p className="text-sm leading-6">
          Your saved data has not been modified. Reload to try again. If the problem continues after an update, repair the
          app shell (this keeps your career data) and reload.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4" />
          Reload
        </button>
        <button type="button" className="secondary-button" onClick={() => void repairAppShell()}>
          Repair app shell
        </button>
      </div>
      {state.recoverableWithBackup && <RestoreFromBackup />}
    </BootScreen>
  );
}

export function PwaRuntimeBanners() {
  const [updateReady, setUpdateReady] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    const onReady = () => setUpdateReady(true);
    const onFailed = (event: Event) => setUpdateError(String((event as CustomEvent).detail ?? "Update failed."));
    const onStorage = (event: Event) => setStorageError(String((event as CustomEvent).detail ?? "Storage failed."));
    window.addEventListener(UPDATE_READY_EVENT, onReady);
    window.addEventListener(UPDATE_FAILED_EVENT, onFailed);
    window.addEventListener(STORAGE_FAILURE_EVENT, onStorage);
    return () => {
      window.removeEventListener(UPDATE_READY_EVENT, onReady);
      window.removeEventListener(UPDATE_FAILED_EVENT, onFailed);
      window.removeEventListener(STORAGE_FAILURE_EVENT, onStorage);
    };
  }, []);

  if (!updateReady && !updateError && !storageError) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 p-3" aria-live="polite">
      {storageError && (
        <div role="alert" data-testid="pwa-storage-error" className="panel panel-strong flex items-start gap-3 border border-red-300 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">A change could not be saved to browser storage.</p>
            <p>{storageError}</p>
          </div>
        </div>
      )}
      {updateReady && (
        <div data-testid="pwa-update-ready" className="panel panel-strong flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>A new version of Sojourner is ready. Your data stays in place.</span>
          <button type="button" className="primary-button" onClick={applyWaitingUpdate}>
            Reload to update
          </button>
        </div>
      )}
      {updateError && !updateReady && (
        <div data-testid="pwa-update-error" className="panel panel-muted p-3 text-xs text-[var(--color-text-secondary)]">
          Update check: {updateError} The current version keeps working.
        </div>
      )}
    </div>
  );
}
