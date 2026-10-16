import { useCallback, useEffect, useState } from "react";
import { HardDrive, MonitorSmartphone, ShieldCheck } from "lucide-react";
import type { RuntimeInfo } from "../shared/runtime";
import type { LegacyInstallStatus } from "../shared/legacy-install";
import { getDesktopApi } from "../services/api";
import { repairAppShell } from "../pwa/shell-repair";
import { IS_DEMO_FLAVOR } from "../demo/flavor";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const channelLabels: Record<RuntimeInfo["channel"], string> = {
  development: "Development build",
  "direct-download": "Direct download (advanced/test channel)",
  "microsoft-store": "Microsoft Store",
  web: "Web app (local-first)",
};

export function RuntimePanel() {
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [legacy, setLegacy] = useState<LegacyInstallStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const api = getDesktopApi();
    const next = await api.getRuntimeInfo();
    setInfo(next);
    if (next.channel === "microsoft-store") setLegacy(await api.legacyInstall.detect());
  }, []);

  useEffect(() => {
    void refresh().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : "Runtime details are unavailable."),
    );
  }, [refresh]);

  const requestPersistence = async () => {
    setMessage(null);
    try {
      const granted = await navigator.storage?.persist?.();
      setMessage(
        granted
          ? "This browser granted persistent storage for Job Ranger."
          : "The browser did not grant persistent storage. Installing Job Ranger as an app (or bookmarking and using it regularly) often allows it. Keep exporting backups.",
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Persistent storage request failed.");
    }
  };

  const importLegacy = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await getDesktopApi().legacyInstall.stageImport();
      setMessage("Import staged. Job Ranger is restarting…");
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "The import could not be staged.");
    }
  };

  if (!info) {
    return message ? <p className="text-sm text-[var(--color-text-secondary)]">{message}</p> : null;
  }

  const web = info.kind === "web";
  return (
    <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]" data-testid="runtime-panel">
      <div>
        <div className="flex items-center gap-3">
          <MonitorSmartphone className="h-5 w-5 text-[var(--color-primary)]" />
          <h2 className="text-2xl font-semibold">This installation</h2>
        </div>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Job Ranger keeps your career data on this device. Different installations (the web app at another address, or an
          earlier desktop installation) keep separate data; move data between them with a portable <code>.jobranger</code> backup.
        </p>
      </div>
      <div className="panel panel-strong space-y-4 p-6 text-sm text-[var(--color-text-secondary)]">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--color-text-primary)]">Channel</dt>
            <dd data-testid="runtime-channel">{channelLabels[info.channel]}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--color-text-primary)]">Version / build</dt>
            <dd className="break-all" data-testid="runtime-build">
              {info.appVersion} · {info.buildId}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold text-[var(--color-text-primary)]">Data location</dt>
            <dd className="break-all">{info.storage.location}</dd>
          </div>
          {web && (
            <>
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">Persistent storage</dt>
                <dd data-testid="runtime-persisted">
                  {info.storage.persisted === true ? "Granted" : info.storage.persisted === false ? "Not granted" : "Unknown"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">Storage used</dt>
                <dd>
                  {formatBytes(info.storage.usageBytes)} of {formatBytes(info.storage.quotaBytes)} available to this site
                </dd>
              </div>
            </>
          )}
        </dl>

        {info.storage.warnings.map((warning) => (
          <p key={warning} className="rounded-xl bg-[var(--color-surface-muted,var(--color-panel-muted))] p-3 leading-6">
            {warning}
          </p>
        ))}

        {web && (
          <div className="space-y-2">
            <p className="leading-6">
              Web app limits: career sites that need a full browser window (for example Workday or iCIMS pages), scheduled
              checks while Job Ranger is closed, system tray, and desktop notifications are available only in the Windows
              app. Supported job-board APIs (Greenhouse, Lever, Ashby, SmartRecruiters) are read directly from this browser
              without sending your career data anywhere.
            </p>
            <button
              type="button"
              className="secondary-button"
              data-testid="repair-app-shell"
              onClick={() => void repairAppShell()}
            >
              Repair app shell (keeps your data)
            </button>
            {info.storage.persisted !== true && !IS_DEMO_FLAVOR && (
              <button type="button" className="secondary-button" onClick={() => void requestPersistence()}>
                <HardDrive className="h-4 w-4" />
                Request persistent storage
              </button>
            )}
          </div>
        )}

        {legacy?.applicable && (
          <div className="rounded-2xl border border-[var(--color-border)] p-4" data-testid="legacy-install-panel">
            <p className="font-semibold text-[var(--color-text-primary)]">Data from a previous desktop installation</p>
            {legacy.found ? (
              <>
                <p className="mt-2 leading-6">
                  Job Ranger found data from a direct-download installation (last changed{" "}
                  {legacy.lastModified ? new Date(legacy.lastModified).toLocaleString() : "unknown"}). Importing copies it into
                  this Microsoft Store installation and replaces the Store app's current data. The original installation
                  and its data are left untouched.
                </p>
                <button type="button" className="secondary-button mt-3" disabled={busy} onClick={() => void importLegacy()}>
                  <ShieldCheck className="h-4 w-4" />
                  {busy ? "Importing…" : "Import desktop data and restart"}
                </button>
              </>
            ) : (
              <p className="mt-2 leading-6">
                No direct-download installation data was found. To move data from another computer or the web app, restore a
                <code> .jobranger</code> backup below.
              </p>
            )}
          </div>
        )}

        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
