// Windows storage locations (#249): build and runtime boundaries.
// - The Microsoft public client id comes only from the build environment (release-build.yml
//   repository variable), is never hard-coded, and the NSIS package copies it into resources.
// - The storage-location:* channels are identical in the contract, preload and main, and the
//   PWA worker registers none of them; the Settings section renders only in Electron.
// - No token crosses IPC, the storage modules never log, take Electron APIs by injection and
//   request exactly the owner-approved scopes.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { microsoftClientConfigFromEnv, writeMicrosoftClientConfig } from "../scripts/write-microsoft-oauth-client.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const id = "6aea1e3a-0000-4000-8000-000000000002";

// Build-time client configuration (public client: an id, no secret).
assert.equal(microsoftClientConfigFromEnv({}), null);
assert.throws(() => microsoftClientConfigFromEnv({ JOB_RANGER_REQUIRE_MICROSOFT_CLIENT: "1" }), /no Microsoft client id/);
assert.throws(() => microsoftClientConfigFromEnv({ JOB_RANGER_MICROSOFT_CLIENT_ID: "not-a-guid" }), /not a Microsoft application/);
assert.deepEqual(microsoftClientConfigFromEnv({ JOB_RANGER_MICROSOFT_CLIENT_ID: ` ${id.toUpperCase()} ` }), { clientId: id });
const directory = mkdtempSync(path.join(os.tmpdir(), "sojourner-microsoft-client-"));
try {
  const target = writeMicrosoftClientConfig(directory, { JOB_RANGER_MICROSOFT_CLIENT_ID: id });
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { clientId: id });
  writeFileSync(path.join(directory, "other.txt"), "kept");
  assert.equal(writeMicrosoftClientConfig(directory, {}), null);
  assert.deepEqual(readdirSync(directory), ["other.txt"], "an unconfigured build removes a stale file");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
const expected = { from: "build/microsoft-oauth", to: "microsoft-oauth", filter: ["microsoft-client.json"] };
const base = JSON.parse(read("electron-builder.json").replace(/^﻿/, ""));
assert.deepEqual(base.win.extraResources.find((entry) => entry.to === "microsoft-oauth"), expected);
assert.deepEqual(require("../electron-builder.windows.cjs").win.extraResources.find((entry) => entry.to === "microsoft-oauth"),
  expected, "the signed NSIS build ships the Microsoft client config");
const pkg = JSON.parse(read("package.json"));
for (const script of ["electron:build", "electron:build:win", "electron:pack"]) {
  assert.match(pkg.scripts[script], /node scripts\/write-microsoft-oauth-client\.mjs && node scripts\/write-google-oauth-client\.mjs && electron-builder/,
    `${script} generates the Microsoft client config before packaging`);
}
assert.match(read(".gitignore"), /^\/build\/microsoft-oauth\/$/m);
assert.match(read(".github/workflows/release-build.yml"), /JOB_RANGER_MICROSOFT_CLIENT_ID: \$\{\{ vars\.JOB_RANGER_MICROSOFT_CLIENT_ID \}\}/);
// The registration's id lives only in the repository variable, never in source.
const sourceFiles = (dir) => readdirSync(path.join(root, dir), { recursive: true }).filter((file) => /\.(cts|ts|tsx|mjs|cjs|json|yml)$/.test(file));
for (const dir of ["electron/src", "src", "scripts", ".github"]) {
  for (const file of sourceFiles(dir)) {
    assert.doesNotMatch(read(path.join(dir, file)), /6aea1e3a-5ba8-4815-afb7-bca7692d7858/i, `${dir}/${file} must not hard-code the Microsoft client id`);
  }
}

// Channels: contract == preload == main; the PWA worker has none.
const contract = read("src/shared/storage-locations.ts");
const channels = (source) => [...new Set([...source.matchAll(/"(storage-location:[a-z-]+)"/g)].map((match) => match[1]))].sort();
const declared = channels(contract);
assert.equal(declared.length, 12);
assert.deepEqual(channels(read("electron/src/preload.cts")), declared, "preload exposes exactly the contract");
assert.deepEqual(channels(read("electron/src/storage-ipc.cts")), declared, "main handles exactly the contract");
for (const file of readdirSync(path.join(root, "src", "pwa"), { recursive: true }).filter((name) => /\.(ts|tsx|js)$/.test(name))) {
  assert.doesNotMatch(read(`src/pwa/${file}`), /storage-location:|storage-ipc|microsoft-auth/, `the PWA must not register storage location channels (${file})`);
}
const panel = read("src/components/StorageLocationPanel.tsx");
assert.match(panel, /runtime\?\.kind === "electron"/, "the Settings section renders only in the Electron runtime");
assert.match(read("src/pages/Settings.tsx"), /<BackupRestorePanel \/>/, "the PWA keeps its local backup UI");

// Token custody, logging and Electron injection.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(code(contract), /token|secret|verifier/i, "no token, secret or verifier field crosses IPC");
const storageSources = ["electron/src/storage-ipc.cts", ...readdirSync(path.join(root, "electron/src/storage")).map((file) => `electron/src/storage/${file}`)];
for (const file of storageSources) assert.doesNotMatch(read(file), /console\.(log|info|warn|error|debug)/, `${file} must not log`);
for (const file of readdirSync(path.join(root, "electron/src/storage"))) {
  assert.doesNotMatch(read(`electron/src/storage/${file}`), /from "electron"/, `${file} receives Electron APIs by injection`);
}
const config = read("electron/src/storage/microsoft-config.cts");
assert.match(config, /export const MICROSOFT_SCOPES = \["Files\.ReadWrite\.AppFolder", "offline_access"\] as const;/);
assert.match(config, /https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize/);
assert.doesNotMatch(code(read("electron/src/storage/microsoft-auth.cts")), /client_secret|Files\.ReadWrite\.All|Files\.Read\b|User\.Read|openid|Sites\./);
assert.doesNotMatch(code(read("electron/src/storage/google-storage-provider.cts")), /auth\/drive"|drive\.readonly|drive\.appdata/);
// The working database is never placed at a location: only archives and documents are uploaded.
assert.doesNotMatch(code(read("electron/src/storage/storage-service.cts")), /databasePath|jobscout\.sqlite3/);

console.log("Windows storage location build and boundary tests passed");
