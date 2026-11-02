import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyDriveAccount, DriveAccountVerificationError } from "../src/pwa/drive/google-drive-account.ts";
const TOKEN = "PRIVATE_FAKE_TOKEN";
test("Drive-scope account check returns stable permission ID and display label without leaking token", async () => {
  let calls = 0;
  const result = await verifyDriveAccount(TOKEN, async (url, opts) => {
    calls++;
    assert.equal(String(url), "https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName,me)");
    assert.equal(opts.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(opts.redirect, "error");
    return new Response(JSON.stringify({ user: { permissionId: "perm_123", me: true,
      emailAddress: "test@example.com", displayName: "Test User" } }), { status: 200 });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { accountId: "perm_123", label: "test@example.com" });
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});
test("missing email falls back to truthful generic account label", async () => {
  const result = await verifyDriveAccount(TOKEN, async () => new Response(
    JSON.stringify({ user: { permissionId: "opaque_987", me: true } }), { status: 200 }));
  assert.deepEqual(result, { accountId: "opaque_987", label: "Verified Google Drive account" });
});
test("missing user identity, impersonating me, malformed ID and invalid token fail closed", async () => {
  for (const reply of [{}, { user: { permissionId: "perm", me: false } },
    { user: { permissionId: "https://bad/", me: true } }, { user: { me: true } }]) {
    await assert.rejects(verifyDriveAccount(TOKEN, async () => new Response(JSON.stringify(reply))), DriveAccountVerificationError);
  }
  await assert.rejects(verifyDriveAccount("token\r\nInjected: yes", async () => { throw Error("must not fetch"); }), DriveAccountVerificationError);
});
test("401 and network errors are actionable without inventing a connected state", async () => {
  await assert.rejects(verifyDriveAccount(TOKEN, async () => new Response("", { status: 401 })), /authorization expired/);
  await assert.rejects(verifyDriveAccount(TOKEN, async () => { throw new Error("raw secret diagnostic"); }), /temporarily unavailable/);
});
