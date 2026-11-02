// Windows Google Drive export build and runtime boundaries (#314).
// - The Desktop OAuth client comes only from the build environment (release-build.yml
//   repository variables), partial or malformed input fails the build, and the NSIS
//   package copies the generated file into resources.
// - The typed drive:* channels are identical in preload and main, and the PWA worker
//   registers none of them (the browser keeps its isolated helper flow).
// - The renderer never receives a token, and the Drive service never logs.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { googleClientConfigFromEnv, writeGoogleClientConfig } from "../scripts/write-google-oauth-client.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const id = "123456789012-abc123def.apps.googleusercontent.com";
const secret = "GOCSPX-not-a-real-secret";

// Build-time client configuration.
assert.equal(googleClientConfigFromEnv({}), null);
assert.throws(() => googleClientConfigFromEnv({ JOB_RANGER_REQUIRE_GOOGLE_DRIVE_CLIENT: "1" }), /no Google Desktop OAuth client/);
assert.throws(() => googleClientConfigFromEnv({ JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: id }), /partially configured/);
assert.throws(() => googleClientConfigFromEnv({ JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: secret }), /partially configured/);
assert.throws(() => googleClientConfigFromEnv({ JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: "abc", JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: secret }), /not a Google OAuth client id/);
assert.deepEqual(
  googleClientConfigFromEnv({ JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: ` ${id} `, JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: secret }),
  { clientId: id, clientSecret: secret },
);
const directory = mkdtempSync(path.join(os.tmpdir(), "sojourner-google-client-"));
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
const base = JSON.parse(read("electron-builder.json").replace(/^﻿/, ""));
assert.deepEqual(base.win.extraResources.find((entry) => entry.to === "google-oauth"), expected);
assert.ok(base.win.extraResources.some((entry) => entry.to === "sqlite3.exe"), "the bundled sqlite3.exe entry is unchanged");
assert.deepEqual(require("../electron-builder.windows.cjs").win.extraResources.find((entry) => entry.to === "google-oauth"),
  expected, "the signed NSIS build ships the client config");
const pkg = JSON.parse(read("package.json"));
for (const script of ["electron:build", "electron:build:win", "electron:pack"]) {
  assert.match(pkg.scripts[script], /node scripts\/write-google-oauth-client\.mjs && electron-builder/,
    `${script} generates the client config before packaging`);
}
assert.match(read(".gitignore"), /^\/build\/google-oauth\/$/m, "generated client config is never committed");
const release = read(".github/workflows/release-build.yml");
assert.match(release, /JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: \$\{\{ vars\.JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID \}\}/);
assert.match(release, /JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: \$\{\{ vars\.JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET \}\}/);

// Channels: preload == main == DRIVE_DESKTOP_CHANNELS; the PWA worker has none.
const contract = read("src/shared/google-drive-desktop.ts");
const declared = [...contract.matchAll(/"(drive:[a-z-]+)"/g)].map((match) => match[1]).sort();
assert.equal(new Set(declared).size, 10);
const channels = (source) => [...new Set([...source.matchAll(/"(drive:[a-z-]+)"/g)].map((match) => match[1]))].sort();
assert.deepEqual(channels(read("electron/src/preload.cts")), declared, "preload exposes exactly the contract");
assert.deepEqual(channels(read("electron/src/drive-ipc.cts")), declared, "main handles exactly the contract");
for (const file of readdirSync(path.join(root, "src", "pwa", "runtime"))) {
  assert.doesNotMatch(read(`src/pwa/runtime/${file}`), /drive:/, `the PWA worker must not register Drive desktop channels (${file})`);
}
assert.doesNotMatch(read("src/pwa/runtime/worker-main.ts"), /drive-ipc|google-desktop-auth|safeStorage/);

// Token custody: no token, verifier or secret field crosses IPC; the main-process Drive
// modules never log; Electron APIs stay in the IPC module.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(code(contract), /token|secret|verifier/i);
for (const name of ["DriveExportReview", "DriveJournalSummary", "DriveReconcileResult"]) {
  const declaration = code(read("src/shared/drive/drive-export-flow.ts")).match(new RegExp(`export interface ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(declaration, name);
  assert.doesNotMatch(declaration[0], /token|reserved/i, `${name} carries no token or reserved file id to the renderer`);
}
const driveSources = ["electron/src/drive-ipc.cts", ...readdirSync(path.join(root, "electron/src/drive")).map((file) => `electron/src/drive/${file}`)];
for (const file of driveSources) {
  assert.doesNotMatch(read(file), /console\.(log|info|warn|error|debug)/, `${file} must not log`);
}
for (const file of readdirSync(path.join(root, "electron/src/drive"))) {
  assert.doesNotMatch(read(`electron/src/drive/${file}`), /from "electron"/, `${file} receives Electron APIs by injection`);
}
assert.match(read("electron/src/drive/google-config.cts"), /export const GOOGLE_DRIVE_FILE_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/drive\.file";/);
assert.doesNotMatch(read("electron/src/drive/google-desktop-auth.cts"), /auth\/drive"|auth\/drive\.readonly|auth\/drive\.appdata/);

// The renderer port is only constructed for the Electron runtime and is honest elsewhere.
const component = read("src/components/GoogleDriveResumeExport.tsx");
assert.match(component, /if \(runtimeKind === "electron"\) return new ElectronDriveExportPort\(\);/);
assert.match(read("src/services/drive-export-port.ts"), /available only in the Windows app/);

console.log("Windows Google Drive build and boundary tests passed");
