// #264 / #356 B2: a PWA build can enable Google Drive only through the isolated OAuth helper.
// A client ID without a helper origin must fail the build instead of loading Google's script on
// the Career Ops origin, and the demo flavor never gets Google access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveDriveBuildConfig } from "../src/pwa/build/drive-build-config.ts";

const CLIENT = "1234567890-abc.apps.googleusercontent.com";
const HELPER = "https://auth.example.org";

test("a client ID without the isolated helper origin fails the build", () => {
  assert.throws(() => resolveDriveBuildConfig({ flavor: "standard", clientId: CLIENT }), /isolated OAuth helper/);
  assert.throws(() => resolveDriveBuildConfig({ flavor: "standard", clientId: CLIENT, helperOrigin: "  " }), /isolated OAuth helper/);
});

test("with the helper origin, Drive is enabled only in isolated mode", () => {
  const config = resolveDriveBuildConfig({ flavor: "standard", clientId: CLIENT, helperOrigin: HELPER });
  assert.equal(config.driveSecurity.googleOAuthEnabled, true);
  assert.equal(config.driveSecurity.isolatedGoogleOAuthOrigin, HELPER);
  assert.equal(config.googleOAuthHelperOrigin, HELPER);
});

test("no Google configuration leaves Drive off", () => {
  const config = resolveDriveBuildConfig({ flavor: "standard" });
  assert.deepEqual(config.driveSecurity, { googleOAuthEnabled: false, isolatedGoogleOAuthOrigin: undefined });
  assert.equal(config.googleWebClientId, "");
});

test("the demo flavor never gets Google access, even fully configured", () => {
  for (const input of [{ clientId: CLIENT, helperOrigin: HELPER }, { clientId: CLIENT }, { helperOrigin: HELPER }]) {
    const config = resolveDriveBuildConfig({ flavor: "demo", ...input });
    assert.deepEqual(config, { googleWebClientId: "", googleOAuthHelperOrigin: "", driveSecurity: { googleOAuthEnabled: false, isolatedGoogleOAuthOrigin: undefined } });
  }
});

test("malformed client IDs and helper origins are refused", () => {
  assert.throws(() => resolveDriveBuildConfig({ flavor: "standard", clientId: "not-a-client", helperOrigin: HELPER }), /client ID format/);
  for (const origin of ["http://auth.example.org", "https://auth.example.org/path", "https://auth.example.org/?q=1", "https://user@auth.example.org", "https://auth.example.org/"]) {
    assert.throws(() => resolveDriveBuildConfig({ flavor: "standard", clientId: CLIENT, helperOrigin: origin }), /exact HTTPS origin/, origin);
  }
});

test("vite.pwa.config.ts takes its Drive settings from resolveDriveBuildConfig", () => {
  const source = readFileSync(new URL("../vite.pwa.config.ts", import.meta.url), "utf8");
  assert.match(source, /resolveDriveBuildConfig\(/);
  assert.doesNotMatch(source, /const googleWebClientId = flavor === "demo"/, "the old inline fallback must be gone");
});
