import assert from "node:assert/strict";
import { test } from "node:test";
import { IsolatedDriveAuthorization } from "../src/pwa/drive/isolated-drive-auth.ts";
import { DRIVE_HELPER_SCOPE } from "../src/pwa/drive/oauth-helper-response-contract.ts";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "../src/pwa/security/policy.ts";

test("isolated PWA mode does not load Google's script into the career workspace", () => {
  const helper = "https://auth.example.test";
  const isolated = buildContentSecurityPolicy({
    googleOAuthEnabled: true, isolatedGoogleOAuthOrigin: helper,
  });
  const directives = Object.fromEntries(
    isolated.split("; ").map(item => [item.split(" ")[0], item]),
  );
  assert.ok(directives["script-src"].includes("'self'"));
  assert.ok(!directives["script-src"].includes("accounts.google.com"));
  assert.ok(!directives["style-src"].includes("accounts.google.com"));
  assert.equal(directives["frame-src"], "frame-src 'none'");
  // Only the Drive API paths the app calls; no whole-host googleapis.com, no unused token-info origin.
  assert.ok(directives["connect-src"].includes("https://www.googleapis.com/drive/v3/"));
  assert.ok(directives["connect-src"].includes("https://www.googleapis.com/upload/drive/v3/"));
  assert.ok(!/https:\/\/www\.googleapis\.com(\s|;|$)/.test(directives["connect-src"]));
  assert.ok(!directives["connect-src"].includes("oauth2.googleapis.com"));
  assert.ok(!directives["connect-src"].includes("accounts.google.com"));
  assert.equal(directives["child-src"], "child-src 'self'");
  assert.equal(directives["trusted-types"], "trusted-types job-ranger-script-url");
  assert.equal(buildSecurityHeaders({
    googleOAuthEnabled: true, isolatedGoogleOAuthOrigin: helper,
  })["Cross-Origin-Opener-Policy"], "same-origin-allow-popups");
  const legacy = buildContentSecurityPolicy({ googleOAuthEnabled: true });
  assert.ok(legacy.includes("https://accounts.google.com/gsi/client"),
    "legacy behavior only persists when isolated mode is unconfigured");
});

test("isolated popup accepts one exact-source authorization and forgets session", async () => {
  const original = globalThis.window;
  const listeners = new Set();
  let opened = null;
  let closeCount = 0;
  const popup = { closed: false, close() { this.closed = true; closeCount++; } };
  globalThis.window = {
    location: { origin: "https://career.example.test" },
    open(url) { opened = url; return popup; },
    addEventListener(event, handler) { if (event === "message") listeners.add(handler); },
    removeEventListener(event, handler) { if (event === "message") listeners.delete(handler); },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 2; },
    clearInterval() {},
  };
  const views = [];
  try {
    const auth = new IsolatedDriveAuthorization("https://auth.example.test", v => views.push(v), () => 1000);
    auth.authorize();
    assert.equal(auth.snapshot().phase, "authorizing");
    assert.ok(opened.startsWith("https://auth.example.test/#nonce="));
    const nonce = new URL(opened).hash.slice("#nonce=".length);
    assert.match(nonce, /^[0-9a-f]{64}$/);
    const data = {
      version: 1, type: "sojourner.drive-oauth.response", nonce,
      scope: DRIVE_HELPER_SCOPE, accessToken: "one-use-token", expiresIn: 600,
    };
    const deliver = (origin, source, payload = data) =>
      [...listeners].forEach(fn => fn({ origin, source, data: payload }));
    deliver("https://auth.example.test.attacker", popup);
    deliver("https://auth.example.test", {}, data);
    deliver("https://auth.example.test", popup, { ...data, nonce: "b".repeat(64) });
    assert.equal(auth.snapshot().phase, "authorizing");
    deliver("https://auth.example.test", popup);
    assert.equal(auth.snapshot().phase, "authorized_unverified");
    assert.equal(closeCount, 1);
    assert.equal(listeners.size, 0);
    assert.equal(await auth.withTokenForUserAction(async token => token), "one-use-token");
    auth.forgetSession();
    await assert.rejects(auth.withTokenForUserAction(async token => token), /Authorize Google Drive/);
    auth.dispose();
    assert.ok(views.some(view => view.phase === "authorized_unverified"));
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});

test("isolated popup fails closed when same-origin, invalid origin or blocked", () => {
  const original = globalThis.window;
  let opens = 0;
  globalThis.window = {
    location: { origin: "https://career.example.test" },
    open() { opens++; return null; },
    addEventListener() {}, removeEventListener() {},
    setTimeout() { return 1; }, clearTimeout() {},
    setInterval() { return 2; }, clearInterval() {},
  };
  try {
    for (const helper of ["https://career.example.test", "http://auth.example.test",
                          "https://auth.example.test/path"]) {
      const auth = new IsolatedDriveAuthorization(helper);
      auth.authorize();
      assert.equal(auth.snapshot().phase, "action_needed");
      auth.dispose();
    }
    assert.equal(opens, 0, "invalid helpers never open a popup");
    const blocked = new IsolatedDriveAuthorization("https://auth.example.test");
    blocked.authorize();
    assert.equal(blocked.snapshot().phase, "action_needed");
    assert.equal(opens, 1);
    blocked.dispose();
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});
