import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CloudUpload, FileText, FolderOpen, HardDrive, History, RotateCcw, ShieldCheck } from "lucide-react";
import { getDesktopApi, hasDesktopApi } from "../services/api";
import { useRuntimeInfo } from "../services/runtime";
import type { BackupRestoreSelection } from "../shared/backup";
import {
  MAX_STORAGE_RETENTION, MIN_STORAGE_RETENTION,
  type StorageHistoryEntry, type StorageLocationItem, type StorageLocationListing, type StorageLocationStatus,
  type StorageProviderKind, type StorageResult,
} from "../shared/storage-locations";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function formatDate(value: string | null): string {
  if (!value) return "unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown date" : date.toLocaleString();
}

const KIND_LABEL = { automatic: "Automatic backup", manual: "Manual backup", document: "Document" } as const;
const STATUS_LABEL = {
  pending: "not finished", uploaded: "uploaded, not verified", verified: "verified", failed: "failed", deleted: "removed by retention",
  replaced: "replaced since Sojourner saved it, not verified",
} as const;

function unwrap<T>(result: StorageResult<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

/**
 * Settings > Storage location (Windows app only, #249). The PWA keeps its own local
 * backup UI; this section renders only in the Electron runtime, where the main process
 * owns every sign-in and file transfer.
 */
export function StorageLocationPanel() {
  const runtime = useRuntimeInfo();
  const electron = runtime?.kind === "electron" && hasDesktopApi();
  const [status, setStatus] = useState<StorageLocationStatus | null>(null);
  const [choice, setChoice] = useState<StorageProviderKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retention, setRetention] = useState("");
  const [listing, setListing] = useState<StorageLocationListing | null>(null);
  const [history, setHistory] = useState<StorageHistoryEntry[] | null>(null);
  const [restore, setRestore] = useState<{ item: StorageLocationItem; selection: BackupRestoreSelection } | null>(null);
  const [restarting, setRestarting] = useState(false);
  const connectFlow = useRef<{ provider: "google" | "onedrive"; id: string } | null>(null);
  const confirmHeading = useRef<HTMLHeadingElement | null>(null);
  const restoreTrigger = useRef<HTMLButtonElement | null>(null);
  const headingId = useId();
  const retentionId = useId();

  const refresh = useCallback(async () => {
    try {
      const next = await getDesktopApi().storageLocations.status();
      setStatus(next);
      setChoice((current) => current ?? next.selected);
      setRetention((current) => current || String(next.retention));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!electron) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [electron, refresh]);

  useEffect(() => {
    if (restore) confirmHeading.current?.focus();
  }, [restore]);

  if (!electron || !status?.available) return null;
  const api = getDesktopApi().storageLocations;

  const run = async <T,>(work: () => Promise<T>, success?: (value: T) => string | null) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const value = await work();
      const text = success?.(value) ?? null;
      if (text) setNotice(text);
      await refresh();
      return value;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The storage location request failed.");
      await refresh();
      return null;
    } finally {
      setBusy(false);
    }
  };

  const providers = status.providers;
  const current = providers.find((item) => item.provider === choice) ?? null;
  const selectedLabel = providers.find((item) => item.provider === status.selected)?.locationDescription ?? null;

  const choose = (provider: StorageProviderKind) => {
    setChoice(provider);
    setListing(null);
    setRestore(null);
    const target = providers.find((item) => item.provider === provider);
    if (!target?.configured) return;
    if (provider === "local" || target.connected) {
      void run(async () => unwrap(await api.select(provider)),
        () => `New backups and documents now go to ${target.locationDescription ?? target.label}. Earlier copies stay where they are.`);
    }
  };

  const connect = (provider: "google" | "onedrive") => {
    const id = crypto.randomUUID();
    connectFlow.current = { provider, id };
    void run(async () => unwrap(await api.connect(provider, id)), () => {
      connectFlow.current = null;
      return `${provider === "google" ? "Google Drive" : "OneDrive"} is connected and is now your storage location.`;
    }).finally(() => {
      connectFlow.current = null;
    });
    // Status shows "finish signing in" while the browser is open.
    window.setTimeout(() => void refresh(), 300);
  };

  const cancelConnect = () => {
    const flow = connectFlow.current;
    if (!flow) return;
    void api.cancelConnect(flow.provider, flow.id).then(() => refresh());
  };

  const disconnect = (provider: "google" | "onedrive") => {
    void run(async () => unwrap(await api.disconnect(provider)), (value) => value.message);
    setListing(null);
  };

  const backUpNow = () => {
    void run(async () => unwrap(await api.backUpNow()), (value) =>
      `Backup ${value.name} (${formatBytes(value.size)}) was saved and verified.`);
  };

  const saveRetention = () => {
    const count = Number(retention);
    void run(async () => unwrap(await api.setRetention(count)),
      () => `Sojourner keeps the newest ${count} automatic backups at each location.`);
  };

  const loadListing = () => {
    void run(async () => {
      const value = unwrap(await api.list());
      setListing(value);
      return value;
    }, (value) => `${value.backups.length} backup${value.backups.length === 1 ? "" : "s"} and ${value.documents.length} document${value.documents.length === 1 ? "" : "s"} found at ${value.locationDescription}.`);
  };

  const loadHistory = () => {
    void run(async () => {
      const value = unwrap(await api.history());
      setHistory(value);
      return value;
    });
  };

  const prepareRestore = (item: StorageLocationItem, trigger: HTMLButtonElement) => {
    restoreTrigger.current = trigger;
    void run(async () => {
      const selection = unwrap(await api.prepareRestore(item.itemId));
      setRestore({ item, selection });
      return selection;
    });
  };

  const cancelRestore = () => {
    setRestore(null);
    restoreTrigger.current?.focus();
  };

  const confirmRestore = async () => {
    if (!restore) return;
    setRestarting(true);
    setError(null);
    try {
      await getDesktopApi().backups.stageRestore(restore.selection.bundlePath);
      setNotice("The restore is staged. Sojourner is restarting.");
    } catch (cause) {
      setRestarting(false);
      setError(cause instanceof Error ? cause.message : "The restore could not be staged.");
    }
  };

  const openDocument = (item: StorageLocationItem) => {
    void run(async () => unwrap(await api.openDocument(item.itemId)),
      (value) => (value.savedTo ? `Saved ${item.name} to ${value.savedTo}.` : null));
  };

  const backup = status.backup;
  const statusLine = backup.running
    ? "A backup is running now."
    : backup.lastSuccessAt
      ? `Last successful backup ${formatDate(backup.lastSuccessAt)} (${backup.lastSuccessName ?? "backup"}).`
      : "No backup has been saved to a storage location yet.";

  return (
    <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]" aria-labelledby={headingId} data-testid="storage-location">
      <div>
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5 text-[var(--color-primary)]" aria-hidden="true" />
          <h2 id={headingId} className="text-2xl font-semibold">Storage location</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          Sojourner saves a full backup of your workspace (a <code>.sojourner</code> file) to this location a few minutes after you make changes and when you quit, and copies resume PDFs and other documents there when you export them. Your working data always stays on this computer; the location holds copies you can restore. Nothing else leaves your device.
        </p>
      </div>

      <div className="panel panel-strong p-6 space-y-5">
        <fieldset className="space-y-3">
          <legend className="font-semibold text-[var(--color-text-primary)]">Where Sojourner keeps backups and documents</legend>
          {providers.map((provider) => {
            const hintId = `${headingId}-${provider.provider}-hint`;
            return (
              <label key={provider.provider} className={`flex items-start gap-3 ${provider.configured ? "cursor-pointer" : "opacity-60"}`}>
                <input
                  type="radio"
                  name={`${headingId}-provider`}
                  value={provider.provider}
                  checked={choice === provider.provider}
                  disabled={!provider.configured || busy || restarting}
                  aria-describedby={hintId}
                  onChange={() => choose(provider.provider)}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium">{provider.label}{status.selected === provider.provider ? " (current)" : ""}</span>
                  <span id={hintId} className="block text-xs text-[var(--color-text-secondary)]">
                    {provider.configured ? provider.message : provider.unavailableReason}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {current?.provider === "local" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm break-all text-[var(--color-text-secondary)]" data-testid="storage-local-folder">{current.locationDescription}</p>
            <button type="button" className="secondary-button disabled:opacity-60" disabled={busy || restarting}
              onClick={() => void run(async () => unwrap(await api.chooseLocalFolder()),
                (value) => (value ? "New backups and documents now go to the folder you chose." : null))}>
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              Choose folder
            </button>
          </div>
        )}

        {current && current.provider !== "local" && current.configured && (
          <div className="flex flex-wrap items-center gap-3">
            {current.connecting ? (
              <button type="button" className="secondary-button" onClick={cancelConnect}>Cancel sign-in</button>
            ) : current.connected ? (
              <button type="button" className="secondary-button disabled:opacity-60" disabled={busy || restarting}
                onClick={() => disconnect(current.provider as "google" | "onedrive")}>
                Disconnect {current.label}
              </button>
            ) : (
              <button type="button" className="primary-button disabled:opacity-60" disabled={busy || restarting}
                onClick={() => connect(current.provider as "google" | "onedrive")}>
                <CloudUpload className="h-4 w-4" aria-hidden="true" />
                Connect {current.label}
              </button>
            )}
            {current.credentialStorage === "session" && (
              <p className="text-xs text-[var(--color-warning,var(--color-text-secondary))]">
                Session only: Windows encryption is unavailable, so this sign-in ends when Sojourner closes.
              </p>
            )}
          </div>
        )}

        <div role="status" aria-live="polite" aria-label="Storage location backup status" className="rounded-xl bg-[var(--color-surface-muted)] p-3 text-sm leading-6 text-[var(--color-text-secondary)]" data-testid="storage-backup-status">
          <p>{status.selected ? `Location: ${selectedLabel ?? "not available"}.` : "No storage location is selected, so automatic backups are off."}</p>
          <p>{statusLine}</p>
          {backup.pendingChanges && status.selected && <p>Changes since the last backup will be backed up {backup.nextAttemptAt ? `around ${formatDate(backup.nextAttemptAt)}` : "soon"}.</p>}
          {backup.lastError && <p className="text-red-700">Last backup failed{backup.lastErrorAt ? ` (${formatDate(backup.lastErrorAt)})` : ""}: {backup.lastError}</p>}
          {backup.documentError && <p className="text-red-700">{backup.documentError}</p>}
          {backup.warning && <p>{backup.warning}</p>}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <button type="button" className="primary-button disabled:opacity-60" disabled={busy || restarting || !status.selected} onClick={backUpNow}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {backup.running ? "Backing up..." : "Back up now"}
          </button>
          <div>
            <label htmlFor={retentionId} className="block text-xs font-medium">Automatic backups to keep</label>
            <input id={retentionId} type="number" min={MIN_STORAGE_RETENTION} max={MAX_STORAGE_RETENTION} value={retention}
              onChange={(event) => setRetention(event.target.value)} className="mt-1 w-24 rounded border border-[var(--color-border)] px-2 py-1" />
          </div>
          <button type="button" className="secondary-button disabled:opacity-60" disabled={busy || Number(retention) === status.retention} onClick={saveRetention}>
            Save retention
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Only older automatic backups that Sojourner created are removed. Manual backups, documents and files Sojourner did not create are never deleted.
        </p>

        <div className="flex flex-wrap gap-3">
          <button type="button" className="secondary-button disabled:opacity-60" disabled={busy || restarting || !status.selected} onClick={loadListing}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Restore from this location
          </button>
          <button type="button" className="secondary-button disabled:opacity-60" disabled={busy} onClick={loadHistory}>
            <History className="h-4 w-4" aria-hidden="true" />
            Show backup history
          </button>
        </div>

        {listing && !restore && (
          <div className="space-y-4" data-testid="storage-listing">
            <div>
              <h3 className="font-semibold">Backups at {listing.locationDescription}</h3>
              {listing.backups.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">No backups here yet.</p> : (
                <ul className="mt-2 space-y-2">
                  {listing.backups.map((item) => (
                    <li key={item.itemId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] p-3 text-sm">
                      <span>
                        <span className="block font-medium break-all">{item.name}</span>
                        <span className="block text-xs text-[var(--color-text-secondary)]">
                          {formatDate(item.createdAt)} · {formatBytes(item.size)} · {item.kind ? `${KIND_LABEL[item.kind]}, ${STATUS_LABEL[item.status ?? "verified"]}` : "Created elsewhere"}
                        </span>
                      </span>
                      <button type="button" className="secondary-button disabled:opacity-60" disabled={busy || !item.restorable}
                        aria-label={`Restore ${item.name}`} onClick={(event) => prepareRestore(item, event.currentTarget)}>
                        Restore...
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="font-semibold">Documents</h3>
              {listing.documents.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">No documents here yet.</p> : (
                <ul className="mt-2 space-y-2">
                  {listing.documents.map((item) => (
                    <li key={item.itemId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] p-3 text-sm">
                      <span>
                        <span className="block font-medium break-all">{item.name}</span>
                        <span className="block text-xs text-[var(--color-text-secondary)]">
                          {formatDate(item.createdAt)} · {formatBytes(item.size)}{item.openable ? "" : ` · ${item.status ? STATUS_LABEL[item.status] : "not copied by Sojourner"}`}
                        </span>
                      </span>
                      <button type="button" className="secondary-button disabled:opacity-60" disabled={busy || !item.openable}
                        title={item.openable ? undefined : "Only PDF and JSON documents Sojourner copied here and verified can be opened."}
                        aria-label={`${listing.provider === "local" ? "Open" : "Download"} ${item.name}`} onClick={() => openDocument(item)}>
                        <FileText className="h-4 w-4" aria-hidden="true" />
                        {listing.provider === "local" ? "Open" : "Download"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {listing.truncated && <p className="text-xs text-[var(--color-text-secondary)]">The location holds more files than Sojourner lists here.</p>}
          </div>
        )}

        {restore && (
          <div className="rounded-2xl border border-[var(--color-border)] p-4" role="region" aria-labelledby={`${headingId}-confirm`} data-testid="storage-restore-confirm">
            <h3 id={`${headingId}-confirm`} ref={confirmHeading} tabIndex={-1} className="font-semibold">Restore {restore.item.name}?</h3>
            <dl className="mt-3 space-y-1 text-sm text-[var(--color-text-secondary)]">
              <div><dt className="inline font-medium">Created: </dt><dd className="inline">{formatDate(restore.selection.summary.createdAt)}</dd></div>
              <div><dt className="inline font-medium">Contents: </dt><dd className="inline">{restore.selection.summary.artifactFileCount} managed file{restore.selection.summary.artifactFileCount === 1 ? "" : "s"} · {formatBytes(restore.selection.summary.totalBytes)}</dd></div>
            </dl>
            {restore.selection.warnings.map((warning) => <p key={warning} className="mt-2 text-sm">{warning}</p>)}
            <p className="mt-3 rounded-xl bg-[var(--color-surface-muted)] p-3 text-sm leading-6 text-[var(--color-text-secondary)]">
              This backup passed Sojourner's integrity checks. Restoring replaces your current workspace on this computer with it after Sojourner restarts. The copies at the storage location are not changed.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className="danger-button disabled:opacity-60" disabled={restarting} onClick={() => void confirmRestore()}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {restarting ? "Preparing restart..." : "Restore and restart"}
              </button>
              <button type="button" className="secondary-button" disabled={restarting} onClick={cancelRestore}>Cancel</button>
            </div>
          </div>
        )}

        {history && (
          <div data-testid="storage-history">
            <h3 className="font-semibold">Backup and document history</h3>
            {history.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Nothing has been copied to a storage location yet.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {history.map((entry) => (
                  <li key={entry.id} className="break-all">
                    {formatDate(entry.createdAt)} · {KIND_LABEL[entry.kind]} · {entry.name} · {formatBytes(entry.size)} · {STATUS_LABEL[entry.status]} · {entry.locationLabel}{entry.current ? " (current location)" : ""}{entry.error ? ` · ${entry.error}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {notice && <p role="status" aria-live="polite" className="text-sm text-[var(--color-text-secondary)]" data-testid="storage-notice">{notice}</p>}
        {error && <div role="alert" className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800" data-testid="storage-error">{error}</div>}
      </div>
    </section>
  );
}
