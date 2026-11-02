import { useState } from "react";
import { Archive, FolderOpen, RotateCcw, ShieldCheck } from "lucide-react";
import type { BackupCreateResult, BackupRestoreSelection } from "../shared/backup";
import { getDesktopApi } from "../services/api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function BackupRestorePanel() {
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [created, setCreated] = useState<BackupCreateResult | null>(null);
  const [selection, setSelection] = useState<BackupRestoreSelection | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createBackup = async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await getDesktopApi().backups.create();
      if (result) {
        setCreated(result);
        setSelection(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backup creation failed.");
    } finally {
      setCreating(false);
    }
  };

  const selectRestore = async () => {
    setError(null);
    setCreated(null);
    try {
      const result = await getDesktopApi().backups.selectRestore();
      setSelection(result);
    } catch (cause) {
      setSelection(null);
      setError(cause instanceof Error ? cause.message : "Backup validation failed.");
    }
  };

  const restore = async () => {
    if (!selection) return;
    setRestoring(true);
    setError(null);
    try {
      await getDesktopApi().backups.stageRestore(selection.bundlePath);
    } catch (cause) {
      setRestoring(false);
      setError(cause instanceof Error ? cause.message : "Restore could not be staged.");
    }
  };

  return (
    <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]">
      <div>
        <div className="flex items-center gap-3">
          <Archive className="h-5 w-5 text-[var(--color-primary)]" />
          <h2 className="text-2xl font-semibold">Backup and restore</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          Create a portable <code>.jobranger</code> backup of Sojourner career data and managed artifacts. The same file restores into Sojourner, including installations previously branded Job Ranger, which is how you move data, for example from an earlier desktop installation into the web app. Restores are validated before the current data is replaced and require a restart (the web app reloads).
        </p>
      </div>

      <div className="panel panel-strong p-6 space-y-5">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void createBackup()}
            disabled={creating || restoring}
            className="primary-button disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4" />
            {creating ? "Creating backup..." : "Create backup"}
          </button>
          <button
            type="button"
            onClick={() => void selectRestore()}
            disabled={creating || restoring}
            className="secondary-button disabled:opacity-60"
          >
            <FolderOpen className="h-4 w-4" />
            Select backup to restore
          </button>
        </div>

        {created && (
          <div className="panel panel-muted p-4 text-sm text-[var(--color-text-secondary)]">
            <p className="font-semibold text-[var(--color-text-primary)]">Backup verified</p>
            <p className="mt-1 break-all" data-testid="backup-created-name">{created.archive?.fileName ?? created.summary.bundlePath}</p>
            {created.archive && (
              <p className="mt-1 break-all text-xs" data-testid="backup-created-sha256">SHA-256 {created.archive.sha256}</p>
            )}
            <p className="mt-2">
              {created.summary.artifactFileCount} managed artifact{created.summary.artifactFileCount === 1 ? "" : "s"} · {formatBytes(created.summary.totalBytes)}
            </p>
          </div>
        )}

        {selection && (
          <div className="rounded-2xl border border-[var(--color-border)] p-4">
            <p className="font-semibold text-[var(--color-text-primary)]">Validated backup</p>
            <dl className="mt-3 space-y-2 text-sm text-[var(--color-text-secondary)]">
              <div>
                <dt className="font-medium text-[var(--color-text-primary)]">Created</dt>
                <dd>{new Date(selection.summary.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-text-primary)]">Archive version</dt>
                <dd>{selection.summary.appVersion}</dd>
              </div>
              {selection.archive && (
                <div>
                  <dt className="font-medium text-[var(--color-text-primary)]">Exported from</dt>
                  <dd data-testid="restore-producer">
                    {selection.archive.producer.runtime === "web" ? "Sojourner web app" : "Legacy Job Ranger desktop app"} · build {selection.archive.producer.buildId}
                  </dd>
                </div>
              )}
              <div>
                <dt className="font-medium text-[var(--color-text-primary)]">Contents</dt>
                <dd>
                  {selection.summary.artifactFileCount} managed artifact{selection.summary.artifactFileCount === 1 ? "" : "s"} · {formatBytes(selection.summary.totalBytes)}
                </dd>
              </div>
            </dl>

            {selection.warnings.length > 0 && (
              <div className="mt-4 space-y-2 text-sm text-[var(--color-warning-text,var(--color-text-secondary))]">
                {selection.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}

            <div className="mt-5 rounded-xl bg-[var(--color-surface-muted)] p-3 text-sm leading-6 text-[var(--color-text-secondary)]">
              Restoring replaces the current local Sojourner database and managed artifacts in this installation with this verified backup. Sojourner will restart automatically after the restore is staged.
            </div>
            <button
              type="button"
              onClick={() => void restore()}
              disabled={restoring}
              className="danger-button mt-4 disabled:opacity-60"
            >
              <RotateCcw className="h-4 w-4" />
              {restoring ? "Preparing restart..." : "Restore and restart"}
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
