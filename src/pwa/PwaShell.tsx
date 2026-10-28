import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { RuntimeBootState } from "./runtime/client";
import { STORAGE_FAILURE_EVENT } from "./runtime/client";
import { applyWaitingUpdate, UPDATE_FAILED_EVENT, UPDATE_READY_EVENT } from "./service-worker-registration";
import { repairAppShell } from "./shell-repair";
import { IS_DEMO_FLAVOR } from "../demo/flavor";

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
