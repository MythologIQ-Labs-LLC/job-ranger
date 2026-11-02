// The packaged app is named Sojourner, but its data root must stay where
// Job Ranger v1.2.0 put it, so an in-place NSIS upgrade keeps the user's data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const distribution = require("../electron-runtime/electron/src/distribution.cjs");

const appData = path.join("C:", "Users", "a", "AppData", "Roaming");
const pin = (channel, hasUserDataDirSwitch = false) =>
  distribution.resolvePinnedUserDataDirectory({ channel, appDataDirectory: appData, hasUserDataDirSwitch });

// Packaged direct-download (NSIS) builds: the folder Job Ranger v1.2.0 really used
// (%APPDATA%\job-ranger, observed on a real v1.2.0 install), not <appData>/Sojourner.
assert.equal(distribution.LEGACY_DIRECT_USER_DATA_FOLDER, "job-ranger");
assert.equal(pin("direct-download"), path.join(appData, "job-ranger"));

// Store builds keep their isolated data root.
assert.equal(pin("microsoft-store"), path.join(appData, "Job Ranger Store"));
assert.notEqual(pin("microsoft-store"), pin("direct-download"));

// Development and E2E runs keep Electron's default.
assert.equal(pin("development"), null);

// An explicit --user-data-dir always wins.
for (const channel of ["direct-download", "microsoft-store", "development"]) {
  assert.equal(pin(channel, true), null, `${channel} honours --user-data-dir`);
}

// The channel feeding the pin: only a packaged non-Store build is direct-download.
assert.equal(distribution.detectDistributionChannel({ windowsStore: undefined, isPackaged: true, env: {} }), "direct-download");
assert.equal(distribution.detectDistributionChannel({ windowsStore: true, isPackaged: true, env: {} }), "microsoft-store");
assert.equal(distribution.detectDistributionChannel({ windowsStore: undefined, isPackaged: false, env: {} }), "development");

// Electron derives the default userData folder from the packaged package.json, so the
// metadata that produced %APPDATA%\job-ranger must not drift: name stays "job-ranger" and
// no productName is introduced there or through electron-builder extraMetadata.
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
assert.equal(pkg.name, "job-ranger", "package.json name keys the historical data folder");
assert.equal(pkg.productName, undefined, "a package.json productName would move Electron's default data folder");

// The rename is real (the pin would be pointless otherwise) and the NSIS upgrade identity is unchanged.
const builder = JSON.parse(fs.readFileSync(path.join(repoRoot, "electron-builder.json"), "utf8").replace(/^﻿/, ""));
assert.equal(builder.extraMetadata?.productName, undefined, "extraMetadata must not inject a productName");
assert.equal(builder.extraMetadata?.name, undefined, "extraMetadata must not rename the packaged app");
assert.equal(builder.productName, "Sojourner");
assert.equal(builder.appId, "com.jobranger.app", "appId keys the NSIS in-place upgrade from Job Ranger");
assert.equal(builder.nsis.deleteAppDataOnUninstall, false);

// main.cts applies the pin before anything reads userData.
const main = fs.readFileSync(path.join(repoRoot, "electron", "src", "main.cts"), "utf8");
const pinAt = main.indexOf("app.setPath(\"userData\", pinnedUserDataDirectory)");
assert.ok(pinAt > 0, "main.cts applies resolvePinnedUserDataDirectory");
assert.ok(pinAt < main.indexOf("getPath(\"userData\")"), "the pin precedes every userData read");
assert.ok(pinAt < main.indexOf("app.whenReady") || main.indexOf("app.whenReady") === -1, "the pin precedes app ready");

console.log("User-data pin tests passed");
