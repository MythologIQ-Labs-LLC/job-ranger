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
  const [selecting, setSelecting] = useState(false);
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
        // Exporting a safety copy must not discard an already validated restore
        // selection. No active workspace data is changed by creating a backup.
        setCreated(result);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backup creation failed.");
    } finally {
      setCreating(false);
    }
  };

  const selectRestore = async () => {
    if (creating || restoring || selecting) return;
    setSelecting(true);
    setError(null);
    try {
      const result = await getDesktopApi().backups.selectRestore();
      if (result) setSelection(result);
    } catch (cause) {
      setSelection(null);
      setError(cause instanceof Error ? cause.message : "Backup validation failed.");
    } finally {
      setSelecting(false);
    }
  };

  const restore = async () => {
    if (!selection || creating || selecting || restoring) return;
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
          Create a portable <code>.jobranger</code> backup of Job Ranger career data and managed artifacts. The same file restores into the Windows app or the web app. Restores are validated before the current data is replaced and require a restart (the web app reloads).
        </p>
        <div className="mt-4 space-y-2 text-sm leading-6 text-[var(--color-text-secondary)]" data-testid="origin-migration-guide">
          <p className="font-semibold text-[var(--color-text-primary)]">Move your workspace to a website or another browser</p>
          <p>
            Browser workspaces belong to the exact web address where they were created. A future
            hosted Job Ranger site, a localhost installation, and different browser profiles
            cannot read each other&apos;s saved data automatically.
          </p>
          <p>
            On the old installation, choose <strong>Create backup</strong> and keep the downloaded
            file. Open the new installation and choose <strong>Select backup to restore</strong>.
            Review its details before restoring. This <strong>replaces</strong> the destination
            workspace; it does not merge two career histories.
          </p>
          <p>
            <strong>Keep the file private:</strong> .jobranger archives contain an unencrypted
            database and managed documents. An integrity hash detects changes, but does not
            protect the contents from someone who obtains the file.
          </p>
        </div>
      </div>

      <div className="panel panel-strong p-6 space-y-5">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void createBackup()}
            disabled={creating || selecting || restoring}
            className="primary-button disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4" />
            {creating ? "Creating backup..." : "Create backup"}
          </button>
          <button
            type="button"
            onClick={() => void selectRestore()}
            disabled={creating || selecting || restoring}
            className="secondary-button disabled:opacity-60"
          >
            <FolderOpen className="h-4 w-4" />
            {selecting ? "Validating backup..." : "Select backup to restore"}
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
                <dt className="font-medium text-[var(--color-text-primary)]">Job Ranger version</dt>
                <dd>{selection.summary.appVersion}</dd>
              </div>
              {selection.archive && (
                <div>
                  <dt className="font-medium text-[var(--color-text-primary)]">Exported from</dt>
                  <dd data-testid="restore-producer">
                    {selection.archive.producer.runtime === "web" ? "Job Ranger web app" : "Job Ranger desktop app"} · build {selection.archive.producer.buildId}
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
              <strong>Restore replaces, never merges.</strong> The current local Job Ranger
              database and managed artifacts in this installation will be replaced with
              this verified backup. If this destination has information you want to keep,
              create and privately store its own .jobranger backup first. You can do that
              now without losing your selected restore file. Job Ranger will restart
              automatically after the restore is staged.
            </div>
            <button
              type="button"
              onClick={() => void restore()}
              disabled={creating || selecting || restoring}
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
