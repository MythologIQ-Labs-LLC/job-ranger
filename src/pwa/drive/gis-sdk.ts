/** User-triggered, one-time loading of Google's published GIS token client. */
import type { GoogleOAuthTokenApi } from "./google-web-auth";
const SCRIPT = "https://accounts.google.com/gsi/client";
interface GoogleWindow {
  google?: { accounts?: { oauth2?: GoogleOAuthTokenApi } };
  trustedTypes?: {
    createPolicy(name: string, policy: { createScriptURL(url: string): string }): { createScriptURL(url: string): unknown };
  };
}
let loading: Promise<GoogleOAuthTokenApi> | null = null;
let policy: { createScriptURL(url: string): unknown } | null = null;
function trustedUrl(): string {
  const tt = (window as unknown as GoogleWindow).trustedTypes;
  if (!tt) return SCRIPT;
  policy ??= tt.createPolicy("job-ranger-google-gis", {
    createScriptURL(url) {
      if (url !== SCRIPT) throw new TypeError("Unapproved Google SDK script");
      return url;
    },
  });
  return policy.createScriptURL(SCRIPT) as string;
}
/** Call only after explicit "Load Google Drive" click; never on page boot. */
export function loadGoogleDriveSdk(): Promise<GoogleOAuthTokenApi> {
  if (loading) return loading;
  loading = new Promise<GoogleOAuthTokenApi>((resolve, reject) => {
    const existing = (window as unknown as GoogleWindow).google?.accounts?.oauth2;
    if (existing?.initTokenClient) return resolve(existing);
    const script = document.createElement("script");
    script.async = true;
    script.src = trustedUrl();
    script.onload = () => {
      const api = (window as unknown as GoogleWindow).google?.accounts?.oauth2;
      if (api?.initTokenClient) resolve(api);
      else { script.remove(); reject(new Error("Google authorization could not initialize.")); }
    };
    script.onerror = () => { script.remove(); reject(new Error("Google authorization could not load.")); };
    document.head.appendChild(script);
  }).catch((error: unknown) => { loading = null; throw error; });
  return loading;
}
