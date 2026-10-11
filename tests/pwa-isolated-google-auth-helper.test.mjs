import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";

const helperSource = readFileSync(new URL("../auth-helper/helper.mjs", import.meta.url), "utf8");

async function harness({
  appOrigin = "http://localhost:4174",
  clientId = "123-example.apps.googleusercontent.com",
  googleScope = "https://www.googleapis.com/auth/drive.file",
} = {}) {
  const elements = Object.fromEntries(["status", "load", "authorize", "cancel"].map((name) => [
    "#" + name, {
      textContent: "", disabled: name !== "cancel", hidden: name === "authorize",
      handlers: {},
      addEventListener(type, callback) { this.handlers[type] = callback; },
      click() { this.handlers.click?.(); },
    },
  ]));
  const callbacks = {};
  const sent = [];
  const opener = { postMessage(data, origin) { sent.push({ data, origin }); } };
  const win = {
    opener,
    handlers: {},
    addEventListener(type, callback) { this.handlers[type] = callback; },
    google: { accounts: { oauth2: { initTokenClient(options) {
      callbacks.client = options;
      return { requestAccessToken() {
        callbacks.requested = true;
        options.callback({ access_token: "SIMULATED_TOKEN", scope: googleScope, expires_in: 3600 });
      } };
    } } } },
  };
  const context = createContext({
    window: win, location: { origin: "http://localhost:4175" }, URL, Date,
    document: {
      querySelector(key) { return elements[key]; },
      createElement() { throw Error("Mock must not load Google network JS"); },
      head: { appendChild() { throw Error("Unexpected external request"); } },
    },
    setInterval(fn) { callbacks.readyPoll = fn; return 1; }, clearInterval() {},
    setTimeout() { return 2; }, clearTimeout() {},
  });
  const app = new SourceTextModule(helperSource, { context });
  const cfg = new SyntheticModule(["GOOGLE_WEB_CLIENT_ID", "JOB_RANGER_APP_ORIGIN"], function() {
    this.setExport("GOOGLE_WEB_CLIENT_ID", clientId);
    this.setExport("JOB_RANGER_APP_ORIGIN", appOrigin);
  }, { context });
  await app.link(() => cfg);
  await app.evaluate();
  return {
    elements, callbacks, sent, win, opener,
    message(data, origin = appOrigin, source = opener) { win.handlers.message({ data, origin, source }); },
  };
}

function initialize(x) {
  x.message({
    protocol: "job-ranger:isolated-drive-auth-init", version: 1,
    requestingOrigin: "http://localhost:4174",
    scope: "https://www.googleapis.com/auth/drive.file",
    nonce: "0b".repeat(24),
  });
}

test("helper readiness and init require the exact configured sender origin and opener", async () => {
  const x = await harness();
  assert.equal(x.sent[0].origin, "http://localhost:4174");
  assert.equal(x.sent[0].data.protocol, "job-ranger:isolated-drive-auth-ready");
  x.message({
    protocol: "job-ranger:isolated-drive-auth-init", version: 1,
    requestingOrigin: "http://localhost:4174",
    scope: "https://www.googleapis.com/auth/drive.file",
    nonce: "0b".repeat(24),
  }, "https://evil.example");
  assert.equal(x.elements["#load"].disabled, true);
  initialize(x);
  assert.equal(x.elements["#load"].disabled, false);
  assert.equal(x.sent.at(-1).data.protocol, "job-ranger:isolated-drive-auth-initialized");
});

test("helper requests only drive.file directly from click and cannot issue uploads", async () => {
  const x = await harness(); initialize(x);
  x.elements["#load"].click();
  assert.equal(x.callbacks.client.scope, "https://www.googleapis.com/auth/drive.file");
  assert.equal(x.callbacks.client.include_granted_scopes, false);
  assert.equal(x.elements["#authorize"].disabled, false);
  x.elements["#authorize"].click();
  assert.equal(x.callbacks.requested, true);
  const event = x.sent.at(-1);
  assert.equal(event.origin, "http://localhost:4174");
  assert.equal(event.data.protocol, "job-ranger:isolated-drive-auth-result");
  assert.equal(event.data.kind, "authorized");
  assert.equal(event.data.token, "SIMULATED_TOKEN");
  assert.equal(JSON.stringify(x.elements).includes("SIMULATED_TOKEN"), false);
});

test("helper rejects a wider scope even when Google mock returns a token", async () => {
  const x = await harness({ googleScope: "https://www.googleapis.com/auth/drive" });
  initialize(x); x.elements["#load"].click(); x.elements["#authorize"].click();
  assert.equal(x.sent.at(-1).data.kind, "provider_error");
  assert.equal("token" in x.sent.at(-1).data, false);
});

test("helper cancellation sends no token and is terminal", async () => {
  const x = await harness(); initialize(x);
  x.elements["#cancel"].click();
  assert.equal(x.sent.at(-1).data.kind, "cancelled");
  x.elements["#load"].click();
  assert.equal("token" in x.sent.at(-1).data, false);
});
