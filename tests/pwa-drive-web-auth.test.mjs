import assert from "node:assert/strict";
import { test } from "node:test";
import { DriveWebAuthorization, DRIVE_FILE_SCOPE } from "../src/pwa/drive/google-web-auth.ts";

const CLIENT = "123456789-example.apps.googleusercontent.com";

function harness() {
  let currentTime = 100_000;
  let options;
  let requested = 0;
  let requestedScopes = [];
  const events = [];
  const google = {
    initTokenClient(next) {
      options = next;
      requestedScopes.push(next.scope);
      return { requestAccessToken() { requested += 1; } };
    },
  };
  const session = new DriveWebAuthorization(CLIENT, (state) => events.push(state), () => currentTime);
  return {
    google, session, events,
    get options() { return options; },
    get requested() { return requested; },
    get scopes() { return requestedScopes; },
    tick(milliseconds) { currentTime += milliseconds; },
    grant(other = {}) {
      options.callback({ access_token: "SENSITIVE_TEST_TOKEN", scope: DRIVE_FILE_SCOPE, expires_in: 3600, ...other });
    },
  };
}

test("initial state is non-connected; no Google request occurs without an explicit call", () => {
  const x = harness();
  assert.equal(x.session.snapshot().phase, "not_connected");
  assert.equal(x.requested, 0);
  x.session.dispose();
});

test("scope is exactly drive.file, and popup begins synchronously", () => {
  const x = harness();
  x.session.authorize(x.google);
  assert.equal(x.requested, 1);
  assert.deepEqual(x.scopes, [DRIVE_FILE_SCOPE]);
  assert.equal(x.session.snapshot().phase, "authorizing");
  x.session.dispose();
});

test("authorization is not proof of file upload; token never enters display snapshot", async () => {
  const x = harness();
  x.session.authorize(x.google);
  x.grant();
  assert.equal(x.session.snapshot().phase, "authorized_unverified");
  assert.match(x.session.snapshot().message, /No files were uploaded/);
  assert.equal(JSON.stringify(x.events).includes("SENSITIVE_TEST_TOKEN"), false);
  let observed = "";
  await x.session.withTokenForUserAction(async (token) => { observed = token; });
  assert.equal(observed, "SENSITIVE_TEST_TOKEN");
  x.session.dispose();
});

test("missing and additional scopes are refused; no token is supplied to callers", async () => {
  for (const scopes of ["", "https://www.googleapis.com/auth/drive", DRIVE_FILE_SCOPE + " openid"]) {
    const x = harness();
    x.session.authorize(x.google);
    x.grant({ scope: scopes });
    assert.equal(x.session.snapshot().phase, "action_needed");
    await assert.rejects(x.session.withTokenForUserAction(async () => {}), /Authorize Google Drive/);
    x.session.dispose();
  }
});

test("denial, popup close and popup blockers are distinct without token leakage", () => {
  const cases = [
    [(o) => o.callback({ error: "access_denied" }), /denied/],
    [(o) => o.error_callback({ type: "popup_closed" }), /cancelled/],
    [(o) => o.error_callback({ type: "popup_failed_to_open" }), /blocked/],
  ];
  for (const [fail, message] of cases) {
    const x = harness();
    x.session.authorize(x.google);
    fail(x.options);
    assert.equal(x.session.snapshot().phase, "action_needed");
    assert.match(x.session.snapshot().message, message);
    x.session.dispose();
  }
});

test("invalid client never triggers a popup", () => {
  let invoked = false;
  const x = new DriveWebAuthorization("bad-client", () => {});
  x.authorize({ initTokenClient() { invoked = true; throw Error("should not run"); } });
  assert.equal(invoked, false);
  assert.equal(x.snapshot().phase, "action_needed");
  x.dispose();
});

test("invalid response token and expiration are rejected", () => {
  for (const bad of [
    { access_token: "" },
    { expires_in: "not-a-number" },
    { expires_in: 20 },
  ]) {
    const x = harness();
    x.session.authorize(x.google);
    x.grant(bad);
    assert.equal(x.session.snapshot().phase, "action_needed");
    x.session.dispose();
  }
});

test("expiry clears the only token copy and requires deliberate reauthorization", async () => {
  const x = harness();
  x.session.authorize(x.google);
  x.grant({ expires_in: 60 });
  x.tick(31_000);
  assert.equal(x.session.snapshot().phase, "action_needed");
  await assert.rejects(x.session.withTokenForUserAction(async () => {}), /Authorize Google Drive/);
  x.session.dispose();
});

test("cancel/forget invalidates late OAuth callbacks", async () => {
  const x = harness();
  x.session.authorize(x.google);
  const oldCallback = x.options.callback;
  x.session.forgetSession();
  oldCallback({ access_token: "SENSITIVE_TEST_TOKEN", scope: DRIVE_FILE_SCOPE, expires_in: 3600 });
  assert.equal(x.session.snapshot().phase, "action_needed");
  await assert.rejects(x.session.withTokenForUserAction(async () => {}), /Authorize Google Drive/);
  x.session.dispose();
});

test("new request invalidates prior callbacks, and dispose ignores late success", () => {
  const x = harness();
  x.session.authorize(x.google);
  const oldCallback = x.options.callback;
  x.options.error_callback({ type: "popup_closed" });
  x.session.authorize(x.google);
  oldCallback({ access_token: "SENSITIVE_TEST_TOKEN", scope: DRIVE_FILE_SCOPE, expires_in: 3600 });
  assert.equal(x.session.snapshot().phase, "authorizing");
  x.session.dispose();
  x.options.callback({ access_token: "SENSITIVE_TEST_TOKEN", scope: DRIVE_FILE_SCOPE, expires_in: 3600 });
  assert.notEqual(x.session.snapshot().phase, "authorized_unverified");
});

test("duplicate clicks never spawn multiple concurrent Google popups", () => {
  const x = harness();
  x.session.authorize(x.google);
  x.session.authorize(x.google);
  assert.equal(x.requested, 1);
  x.session.dispose();
});
