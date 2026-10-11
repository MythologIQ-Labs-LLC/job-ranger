import { useEffect, useRef, useState } from "react";
import { Cloud } from "lucide-react";
import {
  DriveWebAuthorization,
  type DriveAuthView,
  type GoogleOAuthTokenApi,
} from "../pwa/drive/google-web-auth";

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const CLIENT_ID = String(import.meta.env.VITE_JOB_RANGER_GOOGLE_WEB_CLIENT_ID ?? "").trim();

interface GoogleWindow {
  google?: { accounts?: { oauth2?: GoogleOAuthTokenApi } };
  trustedTypes?: {
    createPolicy(name: string, policy: { createScriptURL(url: string): string }): {
      createScriptURL(url: string): unknown;
    };
  };
}

let sdkPromise: Promise<GoogleOAuthTokenApi> | null = null;
let googlePolicy: { createScriptURL(url: string): unknown } | null = null;

function trustedGoogleSdkUrl(): string {
  const factory = (window as unknown as GoogleWindow).trustedTypes;
  if (!factory) return GIS_SCRIPT_URL;
  googlePolicy ??= factory.createPolicy("job-ranger-google-gis", {
    createScriptURL(url) {
      if (url !== GIS_SCRIPT_URL) throw new TypeError("Unapproved external script");
      return url;
    },
  });
  return googlePolicy.createScriptURL(GIS_SCRIPT_URL) as string;
}

/**
 * Only invoked by "Load Google authorization", an explicit third-party network
 * action. It NEVER opens Google's OAuth popup: the next button click does that
 * synchronously, preserving the browser's user-gesture requirement.
 */
function loadGoogleSdk(): Promise<GoogleOAuthTokenApi> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<GoogleOAuthTokenApi>((resolve, reject) => {
    const google = (window as unknown as GoogleWindow).google?.accounts?.oauth2;
    if (google?.initTokenClient) return resolve(google);
    const script = document.createElement("script");
    script.async = true;
    script.dataset.jobRangerGoogleGis = "true";
    script.onload = () => {
      const api = (window as unknown as GoogleWindow).google?.accounts?.oauth2;
      if (!api?.initTokenClient) {
        script.remove();
        reject(new Error("Google authorization could not initialize."));
      } else {
        resolve(api);
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("Google authorization could not load. Check your connection or browser settings."));
    };
    // Trusted Types permits only this exact vendor URL, and only the opt-in
    // build's CSP allows the remote script, frame and network endpoints.
    script.src = trustedGoogleSdkUrl();
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}

const INITIAL_VIEW: DriveAuthView = {
  phase: "not_connected",
  message: "No Google authorization in this browser session.",
  expiresAt: null,
};

export function GoogleDriveAuthPanel() {
  const [view, setView] = useState<DriveAuthView>(INITIAL_VIEW);
  const [sdk, setSdk] = useState<GoogleOAuthTokenApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const session = useRef<DriveWebAuthorization | null>(null);

  useEffect(() => {
    // Keep the visible state truthful even if an access token expires while
    // Settings remains open. No token renewal occurs in the background.
    const refresh = window.setInterval(() => session.current?.snapshot(), 10_000);
    return () => {
      window.clearInterval(refresh);
      session.current?.dispose();
      session.current = null;
    };
  }, []);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const api = await loadGoogleSdk();
      setSdk(api);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Google authorization is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  const authorize = () => {
    if (!sdk) return;
    // Do not await anything before requestAccessToken: browser popup gesture.
    session.current ??= new DriveWebAuthorization(CLIENT_ID, setView);
    session.current.authorize(sdk);
  };

  const forget = () => {
    session.current?.forgetSession();
    if (!session.current) setView(INITIAL_VIEW);
  };

  return (
    <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]" data-testid="pwa-drive-auth-proof">
      <div>
        <div className="flex items-center gap-3">
          <Cloud className="h-5 w-5 text-[var(--color-primary)]" />
          <h2 className="text-2xl font-semibold">Google Drive authorization</h2>
        </div>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Optional, browser-only Drive connection research. Your Career Ops data remains on this device.
          Manual backup and restore work without Google.
        </p>
      </div>
      <div className="panel panel-strong space-y-4 p-6 text-sm">
        {!CLIENT_ID ? (
          <p className="text-[var(--color-text-secondary)]" data-testid="pwa-drive-auth-unconfigured">
            Cloud snapshots are not enabled in this build. Portable .jobranger export remains available below.
          </p>
        ) : (
          <>
            <p className="text-[var(--color-text-secondary)]">
              Authorization test only. You can approve app-created Drive files through Google's popup,
              but uploading, listing and restoring archives are not implemented in this step.
              No files are transferred by authorizing.
            </p>
            <p role="status" data-testid="pwa-drive-auth-status" className="text-[var(--color-text-secondary)]">
              {view.message}
            </p>
            {loadError && <p role="alert">{loadError}</p>}
            <div className="flex flex-wrap gap-3">
              {!sdk ? (
                <button type="button" className="secondary-button" disabled={loading}
                  onClick={() => void load()} data-testid="pwa-drive-load-gis">
                  {loading ? "Loading Google…" : "Load Google authorization"}
                </button>
              ) : (
                <button type="button" className="secondary-button"
                  disabled={view.phase === "authorizing"}
                  onClick={authorize} data-testid="pwa-drive-authorize">
                  {view.phase === "authorizing" ? "Waiting for Google…" : "Authorize Drive access"}
                </button>
              )}
              {sdk && view.phase !== "not_connected" && (
                <button type="button" className="secondary-button" onClick={forget}
                  data-testid="pwa-drive-forget">
                  {view.phase === "authorizing" ? "Cancel locally" : "Forget browser session"}
                </button>
              )}
            </div>
            <p className="text-[var(--color-text-secondary)]">
              Loading Google's authorization library contacts Google. Authorizing requests only
              <code> drive.file</code>. Forgetting this session clears the local token but does not
              revoke permission at Google. To revoke there, use{" "}
              <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">
                your Google account connections
              </a>.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
