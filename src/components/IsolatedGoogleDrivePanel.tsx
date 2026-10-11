import { useEffect, useRef, useState } from "react";
import { Cloud } from "lucide-react";
import { IsolatedDriveAuthPopup, type IsolatedDriveAuthView } from "../pwa/drive/isolated-auth-popup";

declare const __JOB_RANGER_ISOLATED_DRIVE_AUTH_ORIGIN__: string | undefined;

const AUTH_ORIGIN =
  typeof __JOB_RANGER_ISOLATED_DRIVE_AUTH_ORIGIN__ === "string"
    ? __JOB_RANGER_ISOLATED_DRIVE_AUTH_ORIGIN__
    : "";

const INITIAL_VIEW: IsolatedDriveAuthView = {
  phase: "not_connected",
  message: "No Google Drive authorization in this browser session.",
  expiresAt: null,
};

/**
 * Research-only PWA UI. Does not make Drive API calls or transfer archives.
 * No UI prop/state ever contains the OAuth bearer token. Ordinary builds do
 * not set the helper origin and therefore do not expose this panel.
 */
export function IsolatedGoogleDrivePanel() {
  const [view, setView] = useState<IsolatedDriveAuthView>(INITIAL_VIEW);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<IsolatedDriveAuthPopup | null>(null);

  useEffect(() => {
    if (!AUTH_ORIGIN) return;
    // Demote expired grants without refreshing Google credentials.
    const interval = window.setInterval(() => session.current?.snapshot(), 10_000);
    return () => {
      window.clearInterval(interval);
      session.current?.dispose();
      session.current = null;
    };
  }, []);

  // There is intentionally no Google feature in the default release.
  if (!AUTH_ORIGIN) return null;

  const connect = () => {
    setError(null);
    try {
      session.current ??= new IsolatedDriveAuthPopup(AUTH_ORIGIN, setView);
      // Must remain synchronous in the actual click callback.
      session.current.connectFromUserClick();
    } catch {
      setError("The separate authorization window could not start. Check this build's approved helper origin.");
    }
  };

  const forget = () => session.current?.forgetSession();

  return (
    <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]" data-testid="isolated-drive-auth-panel">
      <div>
        <div className="flex items-center gap-3">
          <Cloud className="h-5 w-5 text-[var(--color-primary)]" />
          <h2 className="text-2xl font-semibold">Google Drive authorization test</h2>
        </div>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Optional experimental connection. Google authorization runs in a separate web origin rather than alongside
          your private Career Ops data.
        </p>
      </div>
      <div className="panel panel-strong space-y-4 p-6 text-sm text-[var(--color-text-secondary)]">
        <p>
          This tests account authorization only. Drive snapshots, cloud upload, restoration, and background sync
          are not available in this build. Your career data stays here unless you separately export it.
        </p>
        <p role="status" data-testid="isolated-drive-auth-status">{view.message}</p>
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="secondary-button" disabled={view.phase === "authorizing"}
            onClick={connect} data-testid="isolated-drive-connect">
            {view.phase === "authorizing" ? "Authorization window open…" : "Open Google Drive authorization"}
          </button>
          {view.phase !== "not_connected" && (
            <button type="button" className="secondary-button" onClick={forget}
              data-testid="isolated-drive-forget">
              {view.phase === "authorizing" ? "Cancel authorization" : "Forget browser session"}
            </button>
          )}
        </div>
        <p>
          A separate page will ask you to load Google's library and approve access to files created or opened
          by Job Ranger. Nothing is uploaded by connecting. Forgetting this session clears the local token
          but does not revoke Google's stored account grant.
        </p>
        <p>
          Review or revoke Google permissions in{" "}
          <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">
            your Google account connections
          </a>.
        </p>
      </div>
    </section>
  );
}
