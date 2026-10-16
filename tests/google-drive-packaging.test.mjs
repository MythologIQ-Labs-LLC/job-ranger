// Packaging hook for the Google Drive Desktop OAuth client (#314): values come
// only from the environment, partial or malformed input fails the build, and
// every desktop package config copies the generated file into resources.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { googleClientConfigFromEnv, writeGoogleClientConfig } from "../scripts/write-google-oauth-client.mjs";

const require = createRequire(import.meta.url);
const id = "123456789012-abc123def.apps.googleusercontent.com";
const secret = "GOCSPX-not-a-real-secret";

assert.equal(googleClientConfigFromEnv({}), null);
assert.throws(() => googleClientConfigFromEnv({ JOB_RANGER_REQUIRE_GOOGLE_DRIVE_CLIENT: "1" }), /no Google Desktop OAuth client/);
assert.throws(() => googleClientConfigFromEnv({ JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: id }), /partially configured/);
assert.throws(() => googleClientConfigFromEnv({ JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: secret }), /partially configured/);
assert.throws(() => googleClientConfigFromEnv({ JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: "abc", JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: secret }), /not a Google OAuth client id/);
assert.deepEqual(
  googleClientConfigFromEnv({ JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: ` ${id} `, JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: secret }),
  { clientId: id, clientSecret: secret },
);

const directory = mkdtempSync(path.join(os.tmpdir(), "job-ranger-google-client-"));
try {
  const target = writeGoogleClientConfig(directory, { JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: id, JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: secret });
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { clientId: id, clientSecret: secret });
  // Running unconfigured afterwards removes the stale file instead of shipping it.
  writeFileSync(path.join(directory, "other.txt"), "kept");
  assert.equal(writeGoogleClientConfig(directory, {}), null);
  assert.deepEqual(readdirSync(directory), ["other.txt"]);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const expected = { from: "build/google-oauth", to: "google-oauth", filter: ["google-desktop-client.json"] };
const base = JSON.parse(readFileSync(new URL("../electron-builder.json", import.meta.url), "utf8").replace(/^﻿/, ""));
assert.deepEqual(base.win.extraResources.find((entry) => entry.to === "google-oauth"), expected);
assert.deepEqual(base.mac.extraResources.find((entry) => entry.to === "google-oauth"), expected);
assert.ok(base.win.extraResources.some((entry) => entry.to === "sqlite3.exe"), "the bundled sqlite3.exe entry is unchanged");
const nsis = require("../electron-builder.windows.cjs");
assert.deepEqual(nsis.win.extraResources.find((entry) => entry.to === "google-oauth"), expected, "the NSIS build ships the client config");

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
for (const script of ["electron:build", "electron:build:win", "electron:build:mac", "electron:pack", "electron:build:store"]) {
  assert.match(pkg.scripts[script], /node scripts\/write-google-oauth-client\.mjs && /, `${script} generates the client config before packaging`);
}
const ignored = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
assert.match(ignored, /^\/build\/google-oauth\/$/m, "generated client config is never committed");

console.log("Google Drive packaging hook tests passed");
