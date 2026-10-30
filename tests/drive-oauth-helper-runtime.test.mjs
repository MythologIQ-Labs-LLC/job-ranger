import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperDir = path.join(root, "build", "drive-oauth-helper");
const helperUrl = pathToFileURL(path.join(helperDir, "helper.mjs")).href;
const nonce = "a".repeat(64);
const original = () => Object.fromEntries(
  ["window", "document", "location", "history"].map(key => [key, globalThis[key]]),
);
function restore(before) {
  for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}
function buildHelper() {
  const env = {
    ...process.env,
    SOJOURNER_DRIVE_APP_ORIGIN: "https://career.example.test",
    SOJOURNER_DRIVE_HELPER_ORIGIN: "https://auth.example.test",
    SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_ID: "test-id.apps.googleusercontent.com",
  };
  delete env.SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_SECRET;
  execFileSync(process.execPath, [path.join(root, "scripts/build-drive-oauth-helper.mjs")],
    { cwd: root, env, stdio: "pipe" });
}
function fakePage(hash, openerAvailable = true) {
  const events = [];
  let sent = null;
  let clientOptions = null;
  let requests = 0;
  let scriptAppendCount = 0;
  const buttonHandlers = new Map();
  const grant = {
    disabled: true,
    addEventListener(type, listener) { buttonHandlers.set(type, listener); },
  };
  const status = { textContent: "" };
  const pageLocation = {
    origin: "https://auth.example.test", pathname: "/", search: "", hash,
  };
  globalThis.location = pageLocation;
  globalThis.history = {
    replaceState(_state, _title, url) {
      assert.equal(url, "/");
      pageLocation.hash = "";
      events.push("nonce-scrub");
    },
  };
  const popupOpener = {
    closed: false,
    postMessage(payload, destination) {
      sent = { payload, destination };
    },
  };
  const googleApi = {
    accounts: { oauth2: { initTokenClient(options) {
      clientOptions = options;
      return {
        requestAccessToken() {
          requests++;
          options.callback({
            access_token: "temporary-test-token",
            scope: "https://www.googleapis.com/auth/drive.file",
            expires_in: 600,
          });
        },
      };
    } } },
  };
  globalThis.window = {
    opener: openerAvailable ? popupOpener : null,
    google: undefined,
    trustedTypes: {
      createPolicy(name, policy) {
        assert.equal(name, "sojourner-google-gis");
        return {
          createScriptURL(url) {
            return { trusted: true, url: policy.createScriptURL(url) };
          },
        };
      },
    },
  };
  globalThis.document = {
    getElementById(id) {
      return id === "grant" ? grant : id === "status" ? status : null;
    },
    createElement(type) {
      assert.equal(type, "script");
      const listeners = new Map();
      return {
        addEventListener(name, callback) { listeners.set(name, callback); },
        set src(value) {
          assert.deepEqual(value, {
            trusted: true, url: "https://accounts.google.com/gsi/client",
          });
        },
        listeners,
      };
    },
    head: {
      appendChild(script) {
        assert.equal(pageLocation.hash, "", "Google must never see the nonce fragment");
        events.push("script-append");
        scriptAppendCount++;
        globalThis.window.google = googleApi;
        script.listeners.get("load")();
      },
    },
  };
  return {
    grant, status, events, buttonHandlers,
    get sent() { return sent; },
    get clientOptions() { return clientOptions; },
    get requests() { return requests; },
    get scriptAppendCount() { return scriptAppendCount; },
  };
}

test("real helper module scrubs nonce before GIS and grants only after second click", async () => {
  buildHelper();
  const saved = original();
  const page = fakePage("#nonce=" + nonce);
  try {
    await import(helperUrl + "?valid=1");
    assert.deepEqual(page.events, ["nonce-scrub", "script-append"]);
    assert.equal(page.grant.disabled, false);
    assert.equal(page.sent, null, "page load must not grant access or post tokens");
    assert.equal(page.requests, 0, "Google token request must require the user's click");
    page.buttonHandlers.get("click")();
    assert.equal(page.requests, 1);
    assert.equal(page.clientOptions.scope, "https://www.googleapis.com/auth/drive.file");
    assert.equal(page.clientOptions.include_granted_scopes, false);
    assert.equal(page.sent.destination, "https://career.example.test");
    assert.deepEqual(page.sent.payload, {
      version: 1, type: "sojourner.drive-oauth.response",
      nonce, scope: "https://www.googleapis.com/auth/drive.file",
      accessToken: "temporary-test-token", expiresIn: 600,
    });
    page.buttonHandlers.get("click")();
    assert.equal(page.requests, 1, "successful grant is single use");
  } finally {
    restore(saved);
  }
});

test("invalid or unpaired helper never loads Google or returns a token", async () => {
  buildHelper();
  for (const [suffix, hash, opener] of [
    ["badnonce", "#nonce=short", true],
    ["no-opener", "#nonce=" + nonce, false],
  ]) {
    const saved = original();
    const page = fakePage(hash, opener);
    try {
      await import(helperUrl + "?invalid=" + suffix);
      assert.deepEqual(page.events, ["nonce-scrub"]);
      assert.equal(page.scriptAppendCount, 0);
      assert.equal(page.grant.disabled, true);
      assert.equal(page.sent, null);
    } finally {
      restore(saved);
    }
  }
});
