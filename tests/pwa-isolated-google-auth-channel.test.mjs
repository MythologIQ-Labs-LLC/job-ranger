import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ISOLATED_DRIVE_AUTH_PROTOCOL,
  ISOLATED_DRIVE_AUTH_VERSION,
  ISOLATED_DRIVE_SCOPE,
  IsolatedDriveAuthReceiver,
  assertIsolatedAuthOrigin,
  makeIsolatedAuthAttempt,
  newIsolatedAuthNonce,
} from "../src/pwa/drive/isolated-auth-channel.ts";

const TIME = 70_000;
const APP = "http://localhost:4174";
const AUTH = "http://localhost:4175";
const NONCE = "0b".repeat(24);
const popup = Object.freeze({ name: "authorized-popup" });

function fixture() {
  const attempt = makeIsolatedAuthAttempt({
    appOrigin: APP,
    helperOrigin: AUTH,
    popup: { identity: popup },
    nonce: NONCE,
    openedAt: TIME,
  });
  let now = TIME + 1_000;
  const receiver = new IsolatedDriveAuthReceiver(attempt, () => now);
  const validMessage = {
    protocol: ISOLATED_DRIVE_AUTH_PROTOCOL,
    version: ISOLATED_DRIVE_AUTH_VERSION,
    nonce: NONCE,
    requestingOrigin: APP,
    kind: "authorized",
    token: "fake_TEST_TOKEN_not_a_live_secret",
    scope: ISOLATED_DRIVE_SCOPE,
    expiresInSeconds: 3600,
  };
  return {
    attempt, receiver,
    event: { origin: AUTH, source: popup, data: validMessage },
    at(newNow) { now = newNow; },
  };
}

test("origin syntax rejects untrusted HTTP, paths, URLs with credentials, and same-origin helper", () => {
  for (const origin of [
    "http://remote.example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://auth.example.com/helper",
    "https://auth.example.com/?redirect=https://evil.example",
    "https://user:pw@auth.example.com",
    "http://localhost:4175/path",
  ]) {
    assert.throws(() => assertIsolatedAuthOrigin(origin));
  }
  assert.equal(assertIsolatedAuthOrigin(AUTH), AUTH);
  assert.equal(assertIsolatedAuthOrigin("https://auth.example.com"), "https://auth.example.com");
  assert.throws(() => makeIsolatedAuthAttempt({
    appOrigin: APP, helperOrigin: APP,
    popup: { identity: popup }, nonce: NONCE, openedAt: TIME,
  }), /isolated/i);
});

test("cryptographically sourced nonce encodes 192 bits in lowercase hex", () => {
  const source = { getRandomValues(bytes) { bytes.forEach((_, i) => { bytes[i] = i; }); return bytes; } };
  const nonce = newIsolatedAuthNonce(source);
  assert.match(nonce, /^[0-9a-f]{48}$/);
  assert.equal(nonce, Array.from({ length: 24 }, (_, i) => i.toString(16).padStart(2, "0")).join(""));
});

test("valid exact source, origin, scope and nonce yields one ephemeral, unverified token", () => {
  const x = fixture();
  const result = x.receiver.take(x.event);
  assert.equal(result?.status, "authorized_unverified");
  assert.equal(result?.token, "fake_TEST_TOKEN_not_a_live_secret");
  assert.equal(result?.expiresAt, TIME + 1000 + 3600_000 - 30_000);
  assert.equal(x.receiver.finished, true);
  assert.equal(x.receiver.take(x.event), null, "replayed event is ignored");
});

test("wrong origin, source or both are ignored without destroying real pending attempt", () => {
  const x = fixture();
  assert.equal(x.receiver.take({ ...x.event, origin: "https://evil.example" }), null);
  assert.equal(x.receiver.take({ ...x.event, origin: "http://localhost:4175.evil.example" }), null);
  assert.equal(x.receiver.take({ ...x.event, source: { spoofed: true } }), null);
  assert.equal(x.receiver.finished, false);
  assert.equal(x.receiver.take(x.event)?.status, "authorized_unverified");
});

test("message from correct window with wrong nonce, protocol or requesting origin fails closed", () => {
  const mutators = [
    (d) => ({ ...d, nonce: "ff".repeat(24) }),
    (d) => ({ ...d, nonce: undefined }),
    (d) => ({ ...d, protocol: "job-ranger:upload-now" }),
    (d) => ({ ...d, version: 2 }),
    (d) => ({ ...d, requestingOrigin: "http://localhost:4176" }),
    (d) => ({ ...d, requestingOrigin: undefined }),
  ];
  for (const mutate of mutators) {
    const x = fixture();
    const result = x.receiver.take({ ...x.event, data: mutate(x.event.data) });
    assert.deepEqual(result, { status: "action_needed", reason: "invalid_message" });
    assert.equal(x.receiver.take(x.event), null);
  }
});

test("valid window cannot silently ask for archive upload or broad Google Drive scopes", () => {
  const x = fixture();
  const command = { ...x.event.data, kind: "upload_archive" };
  assert.deepEqual(x.receiver.take({ ...x.event, data: command }), {
    status: "action_needed", reason: "invalid_message",
  });
  for (const scope of [
    "https://www.googleapis.com/auth/drive",
    ISOLATED_DRIVE_SCOPE + " openid",
    "",
    null,
  ]) {
    const y = fixture();
    const response = y.receiver.take({ ...y.event, data: { ...y.event.data, scope } });
    assert.deepEqual(response, { status: "action_needed", reason: "invalid_message" });
  }
});

test("malformed/expired token lifetimes cannot produce connection success", () => {
  for (const expiresInSeconds of [0, 20, -10, 86400, Infinity, NaN, "3600", null]) {
    const x = fixture();
    assert.deepEqual(
      x.receiver.take({ ...x.event, data: { ...x.event.data, expiresInSeconds } }),
      { status: "action_needed", reason: "invalid_message" },
    );
  }
  const y = fixture();
  assert.deepEqual(y.receiver.take({ ...y.event, data: { ...y.event.data, token: "" } }), {
    status: "action_needed", reason: "invalid_message",
  });
});

test("trusted error signals return controlled errors, never a raw Google message or token", () => {
  for (const kind of ["denied", "cancelled", "provider_error"]) {
    const x = fixture();
    const value = x.receiver.take({ ...x.event, data: { ...x.event.data, kind, googleError: "token_fake" } });
    assert.deepEqual(value, { status: "action_needed", reason: kind });
    assert.equal(JSON.stringify(value).includes("token_fake"), false);
  }
});

test("closed/cancelled attempts do not resurrect after delayed success", () => {
  const x = fixture();
  x.receiver.cancel();
  assert.equal(x.receiver.finished, true);
  assert.equal(x.receiver.take(x.event), null);
});

test("timeout consumes the attempt before granting any token", () => {
  const x = fixture();
  x.at(TIME + 3 * 60_000);
  assert.deepEqual(x.receiver.take(x.event), { status: "action_needed", reason: "timeout" });
  assert.equal(x.receiver.take(x.event), null);
});

test("missing exact popup/nonce rejects initialization", () => {
  const base = {
    appOrigin: APP,
    helperOrigin: AUTH,
    popup: { identity: popup },
    nonce: NONCE,
    openedAt: TIME,
  };
  for (const field of ["nonce", "popup", "openedAt"]) {
    const next = { ...base, [field]: null };
    assert.throws(() => makeIsolatedAuthAttempt(next));
  }
});
