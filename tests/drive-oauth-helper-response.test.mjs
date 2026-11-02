import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DriveHelperResponseGate, DRIVE_HELPER_PROTOCOL, DRIVE_HELPER_RESPONSE, DRIVE_HELPER_SCOPE,
} from "../src/pwa/drive/oauth-helper-response-contract.ts";

const origin = "https://auth.example.test";
const windowProxy = {};
const nonce = "a".repeat(48);
const token = "temporary-drive-access-token";
const reply = () => ({
  version: DRIVE_HELPER_PROTOCOL, type: DRIVE_HELPER_RESPONSE,
  nonce, scope: DRIVE_HELPER_SCOPE, accessToken: token, expiresIn: 600,
});
const message = (data = reply()) => ({ origin, source: windowProxy, data });

test("accepts a single exact-source, exact-origin, nonce-bound OAuth response", () => {
  const gate = new DriveHelperResponseGate(origin, windowProxy, nonce, 20_000, () => 10_000);
  assert.deepEqual(gate.accept(message()), { accessToken: token, expiresAt: 610_000 });
  assert.equal(gate.accept(message()), null, "replay must not return a token");
});

test("rejects forged source, origin, nonce, version, scope, token and lifetime", () => {
  const invalid = [
    { ...message(), source: {} },
    { ...message(), origin: "https://auth.example.test.evil" },
    { ...message(), origin: "https://AUTH.example.test" },
    message({ ...reply(), nonce: "b".repeat(48) }),
    message({ ...reply(), version: 2 }),
    message({ ...reply(), type: "upload" }),
    message({ ...reply(), scope: "https://www.googleapis.com/auth/drive" }),
    message({ ...reply(), accessToken: "bad\r\ntoken" }),
    message({ ...reply(), accessToken: "" }),
    message({ ...reply(), expiresIn: 7200 }),
    message({ ...reply(), expiresIn: 0 }),
    message({ ...reply(), expiresIn: "600" }),
    message(null),
  ];
  for (const value of invalid) {
    const gate = new DriveHelperResponseGate(origin, windowProxy, nonce, 20_000, () => 10_000);
    assert.equal(gate.accept(value), null);
    assert.deepEqual(gate.accept(message()), { accessToken: token, expiresAt: 610_000 },
      "a forged message must not consume a valid pending grant");
  }
});

test("expires and invalidates without exposing an access token", () => {
  let clock = 10_000;
  const expired = new DriveHelperResponseGate(origin, windowProxy, nonce, 11_000, () => clock);
  clock = 11_000;
  assert.equal(expired.accept(message()), null);
  const revoked = new DriveHelperResponseGate(origin, windowProxy, nonce, 20_000, () => 10_000);
  revoked.invalidate();
  assert.equal(revoked.accept(message()), null);
});

test("rejects non-HTTPS or ambiguous helper origins and weak nonce", () => {
  for (const invalidOrigin of [
    "http://auth.example.test", "https://auth.example.test/path",
    "https://auth.example.test/?token=1", "https://auth.example.test#fragment",
    "https://user@auth.example.test", "https://auth.example.test/",
  ]) {
    assert.throws(() => new DriveHelperResponseGate(
      invalidOrigin, windowProxy, nonce, 20_000, () => 10_000));
  }
  assert.throws(() => new DriveHelperResponseGate(origin, windowProxy, "guess", 20_000, () => 10_000));
});
