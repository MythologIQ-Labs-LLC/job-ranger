import { useState } from "react";
import { Cloud, LogIn, LogOut, X } from "lucide-react";
import { getDesktopApi } from "../services/api";
import { unavailableMessage, useDriveStatus } from "../services/drive";

/** Settings: connect, cancel and disconnect the person's own Google Drive (#314, desktop only). */
export function GoogleDrivePanel() {
  const { status, refresh } = useDriveStatus();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!status || status.reason === "desktop-only") return null;

  const connect = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const pending = getDesktopApi().drive.connect();
    // The connect call stays open while the browser sign-in runs; poll so Cancel appears meanwhile.
    const timer = window.setInterval(() => void refresh(), 300);
    const result = await pending.finally(() => window.clearInterval(timer));
    setBusy(false);
    if (result.ok) setMessage("Google Drive connected.");
    else setError(result.error.message);
    await refresh();
  };

  const cancel = async () => {
    await getDesktopApi().drive.cancelConnect();
    await refresh();
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await getDesktopApi().drive.disconnect();
    setBusy(false);
    if (result.ok) {
      setMessage(
        result.value.revoked
          ? "Google Drive disconnected. Job Ranger revoked its access and deleted the stored sign-in."
          : "Google Drive disconnected and the stored sign-in was deleted. Google could not be reached to revoke access; you can remove Job Ranger at myaccount.google.com/permissions.",
      );
    } else {
      setError(result.error.message);
    }
    await refresh();
  };

  return (
    <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]" aria-labelledby="google-drive-heading">
      <div>
        <div className="flex items-center gap-3">
          <Cloud className="h-5 w-5 text-[var(--color-primary)]" aria-hidden="true" />
          <h2 id="google-drive-heading" className="text-2xl font-semibold">Google Drive</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          Save verified resume PDFs into your own Google Drive, one approved file at a time. Job Ranger can only see files it creates in your Drive (drive.file). Nothing uploads until you approve a specific file, and your local copy always stays.
        </p>
      </div>

      <div className="panel panel-strong space-y-4 p-6">
        {!status.configured ? (
          <p className="text-sm text-[var(--color-text-secondary)]" data-testid="drive-not-configured">
            {unavailableMessage(status)}
          </p>
        ) : status.connecting ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-secondary)]" role="status">
              Waiting for you to finish signing in to Google in your browser…
            </p>
            <button type="button" className="secondary-button" onClick={() => void cancel()}>
              <X className="h-4 w-4" aria-hidden="true" /> Cancel sign-in
            </button>
          </div>
        ) : status.connected ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-primary)]" data-testid="drive-account">
              Connected{status.accountEmail ? <> as <strong>{status.accountEmail}</strong></> : null}
            </p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {status.credentialStorage === "session"
                ? "This device cannot encrypt the Google sign-in, so it is kept only until Job Ranger quits. You will need to connect again next time."
                : "The Google sign-in is stored on this device, encrypted by your operating system. It is never included in backups."}
            </p>
            <button type="button" className="secondary-button disabled:opacity-60" disabled={busy} onClick={() => void disconnect()}>
              <LogOut className="h-4 w-4" aria-hidden="true" /> Disconnect Google Drive
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Connecting opens Google sign-in in your browser. Job Ranger asks only for access to files it creates.
              {status.encryptionUnavailable ? " This device cannot encrypt the sign-in, so it will last only until Job Ranger quits." : ""}
            </p>
            <button type="button" className="primary-button disabled:opacity-60" disabled={busy} onClick={() => void connect()}>
              <LogIn className="h-4 w-4" aria-hidden="true" /> Connect Google Drive
            </button>
          </div>
        )}
        {message && <p className="text-sm text-[var(--color-success)]" role="status">{message}</p>}
        {error && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
      </div>
    </section>
  );
}
