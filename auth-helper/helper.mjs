/** Static two-origin OAuth helper (#264). Must NOT share a web origin with the PWA. */
import { GOOGLE_WEB_CLIENT_ID, JOB_RANGER_APP_ORIGIN } from "./config.mjs";

const READY = "job-ranger:isolated-drive-auth-ready";
const INIT = "job-ranger:isolated-drive-auth-init";
const INITIALIZED = "job-ranger:isolated-drive-auth-initialized";
const RESULT = "job-ranger:isolated-drive-auth-result";
const VERSION = 1;
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";
const status = document.querySelector("#status");
const load = document.querySelector("#load");
const authorize = document.querySelector("#authorize");
const cancel = document.querySelector("#cancel");

let nonce = null;
let finished = false;
let client = null;
let initializedAt = 0;
let readyPoll = null;

const setStatus = (message) => { status.textContent = message; };
const isNonce = (value) => typeof value === "string" && /^[0-9a-f]{48}$/.test(value);
const clientConfigured = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(GOOGLE_WEB_CLIENT_ID);
let targetOrigin = null;
try {
  const origin = new URL(JOB_RANGER_APP_ORIGIN);
  const helper = new URL(location.origin);
  const local = (value) => ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname);
  const safeOrigin = (value) => value.protocol === "https:" || (value.protocol === "http:" && local(value));
  if (safeOrigin(helper) && safeOrigin(origin) &&
      origin.origin === JOB_RANGER_APP_ORIGIN && origin.origin !== location.origin) {
    targetOrigin = origin.origin;
  }
} catch { /* Unconfigured deployment intentionally cannot authorize. */ }

function finish(kind, payload = {}) {
  if (finished) return;
  finished = true;
  clearInterval(readyPoll);
  load.disabled = true;
  authorize.disabled = true;
  if (nonce && targetOrigin && window.opener) {
    // Exact targetOrigin, never *. No token in browser URL, storage or logs.
    window.opener.postMessage({
      protocol: RESULT, version: VERSION, nonce, requestingOrigin: targetOrigin,
      kind, ...payload,
    }, targetOrigin);
  }
  setStatus(kind === "authorized" ? "Google authorized this browser session. You can close this window." :
    "Authorization ended. Your local Job Ranger data is unchanged.");
}

window.addEventListener("message", (event) => {
  if (finished || nonce || !targetOrigin || !window.opener ||
      event.origin !== targetOrigin || event.source !== window.opener) return;
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      data.protocol !== INIT || data.version !== VERSION ||
      data.requestingOrigin !== targetOrigin || data.scope !== SCOPE ||
      !isNonce(data.nonce)) return;
  nonce = data.nonce;
  initializedAt = Date.now();
  clearInterval(readyPoll);
  if (!clientConfigured) {
    setStatus("Google Web OAuth is not configured for this separate origin.");
    finish("provider_error");
    return;
  }
  load.disabled = false;
  setStatus("Connection to Job Ranger confirmed. Load Google's authorization library to continue.");
  window.opener.postMessage({ protocol: INITIALIZED, version: VERSION, nonce }, targetOrigin);
});

function sendReady() {
  if (nonce || finished || !targetOrigin || !window.opener) return;
  window.opener.postMessage({ protocol: READY, version: VERSION }, targetOrigin);
}

if (!window.opener || !targetOrigin) {
  setStatus("Open this page from the approved Job Ranger application, not directly.");
  load.disabled = true;
  authorize.disabled = true;
} else {
  sendReady();
  readyPoll = setInterval(sendReady, 350);
  setTimeout(() => {
    if (!nonce && !finished) {
      clearInterval(readyPoll);
      setStatus("Job Ranger did not complete the secure connection. Close this window and retry.");
    }
  }, 60_000);
}

function trustedScriptUrl() {
  const trustedTypes = window.trustedTypes;
  if (!trustedTypes) return GOOGLE_SCRIPT;
  const policy = trustedTypes.createPolicy("job-ranger-auth-gis", {
    createScriptURL: (url) => {
      if (url !== GOOGLE_SCRIPT) throw new TypeError("Unapproved external JavaScript");
      return url;
    },
  });
  return policy.createScriptURL(GOOGLE_SCRIPT);
}

load.addEventListener("click", () => {
  if (!nonce || finished || client || Date.now() - initializedAt >= 180_000) return;
  load.disabled = true;
  setStatus("Loading Google's hosted authorization library…");
  const existing = window.google?.accounts?.oauth2;
  if (existing?.initTokenClient) { configure(existing); return; }
  try {
    const script = document.createElement("script");
    script.async = true;
    script.onload = () => {
      const gis = window.google?.accounts?.oauth2;
      if (!gis?.initTokenClient) finish("provider_error");
      else configure(gis);
    };
    script.onerror = () => finish("provider_error");
    // Trusted Types construction/DOM insertion can fail synchronously when
    // the host CSP or provider policy changes. Surface that failure promptly.
    script.src = trustedScriptUrl();
    document.head.appendChild(script);
  } catch {
    finish("provider_error");
  }
});

function configure(gis) {
  try {
    client = gis.initTokenClient({
      client_id: GOOGLE_WEB_CLIENT_ID,
      scope: SCOPE,
      include_granted_scopes: false,
      callback: (response) => {
        if (finished) return;
        if (response?.error) { finish(response.error === "access_denied" ? "denied" : "provider_error"); return; }
        const scopes = typeof response?.scope === "string" ? response.scope.trim().split(/\s+/) : [];
        const seconds = Number(response?.expires_in);
        if (scopes.length !== 1 || scopes[0] !== SCOPE ||
            typeof response?.access_token !== "string" || !response.access_token.trim() ||
            !Number.isFinite(seconds) || seconds <= 30 || seconds > 7200) {
          finish("provider_error");
          return;
        }
        finish("authorized", { token: response.access_token, scope: SCOPE, expiresInSeconds: seconds });
      },
      error_callback: (err) => finish(err?.type === "popup_closed" ? "cancelled" : "provider_error"),
    });
    authorize.hidden = false;
    authorize.disabled = false;
    setStatus("Google is ready. Choose Authorize Drive access to continue.");
  } catch { finish("provider_error"); }
}

authorize.addEventListener("click", () => {
  if (finished || !nonce || !client || Date.now() - initializedAt >= 180_000) {
    if (!finished) finish("provider_error");
    return;
  }
  authorize.disabled = true;
  setStatus("Complete Google's account selection and consent dialog…");
  // A direct click, with no promise/await before Google opens its OAuth popup.
  try { client.requestAccessToken(); } catch { finish("provider_error"); }
});

cancel.addEventListener("click", () => finish("cancelled"));
