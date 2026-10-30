/**
 * Standalone, separate-origin Google GIS token helper (#264).
 * Do not bundle or serve this code from Sojourner's Career Ops origin.
 * config.mjs is generated with exact, reviewed public origins and client ID.
 */
import { APP_ORIGIN, GOOGLE_WEB_CLIENT_ID } from "./config.mjs";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TYPE = "sojourner.drive-oauth.response";
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
const grant = document.getElementById("grant");
const status = document.getElementById("status");
const gisScript = document.getElementById("gis");
let completed = false;

function report(message) {
  status.textContent = message;
}
function isExactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value &&
      url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

const fragment = new URLSearchParams(location.hash.slice(1));
const nonce = fragment.get("nonce");
history.replaceState(null, "", location.pathname + location.search);

if (!isExactHttpsOrigin(APP_ORIGIN) ||
    APP_ORIGIN === location.origin ||
    !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(GOOGLE_WEB_CLIENT_ID) ||
    !nonce || !NONCE.test(nonce) || fragment.size !== 1 || !window.opener) {
  report("Authorization is not configured for this browser window. Close it and try again.");
} else {
  const enable = () => {
    if (window.google?.accounts?.oauth2?.initTokenClient) {
      grant.disabled = false;
      report("Select Continue with Google to open Google's account and consent dialog.");
    } else {
      report("Google authorization could not load. Close this window and retry.");
    }
  };
  gisScript.addEventListener("load", enable, { once: true });
  gisScript.addEventListener("error", () => {
    report("Google authorization is unavailable. No document was uploaded.");
  }, { once: true });
  if (window.google?.accounts?.oauth2?.initTokenClient) enable();

  grant.addEventListener("click", () => {
    if (completed || !window.google?.accounts?.oauth2?.initTokenClient) return;
    // Keep requestAccessToken synchronous inside this user-click handler.
    grant.disabled = true;
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_WEB_CLIENT_ID,
        scope: SCOPE,
        include_granted_scopes: false,
        callback(response) {
          if (completed) return;
          const scopes = typeof response.scope === "string"
            ? response.scope.trim().split(/\s+/).filter(Boolean) : [];
          const lifetime = Number(response.expires_in);
          if (response.error || scopes.length !== 1 || scopes[0] !== SCOPE ||
              typeof response.access_token !== "string" || !response.access_token.trim() ||
              response.access_token.length > 8192 || /[\r\n]/.test(response.access_token) ||
              !Number.isFinite(lifetime) || lifetime <= 30 || lifetime > 3600) {
            report("Google did not grant the expected Drive-only authorization. No upload occurred.");
            grant.disabled = false;
            return;
          }
          if (!window.opener || window.opener.closed) {
            report("The Sojourner window was closed. Authorization was not delivered.");
            return;
          }
          completed = true;
          try {
            window.opener.postMessage({
              version: 1, type: TYPE, nonce, scope: SCOPE,
              accessToken: response.access_token, expiresIn: lifetime,
            }, APP_ORIGIN);
            report("Authorization returned to Sojourner. You may close this window.");
          } catch {
            report("Authorization could not be delivered. Close this window and retry.");
          }
        },
        error_callback() {
          if (completed) return;
          report("Google authorization was cancelled or blocked. No upload occurred.");
          grant.disabled = false;
        },
      });
      client.requestAccessToken();
      report("Complete the authorization in Google's popup.");
    } catch {
      grant.disabled = false;
      report("Google authorization could not start. Close this window and retry.");
    }
  });
}
