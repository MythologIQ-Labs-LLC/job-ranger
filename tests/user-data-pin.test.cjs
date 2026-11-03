// Packaged builds pin their data root to %APPDATA%\Sojourner (Store: "Sojourner Store").
// Data written before the rename lives in the LEGACY folders (%APPDATA%\job-ranger, as
// Job Ranger v1.2.0 left it, and "Job Ranger Store"); main.cts copies it across through
// legacy-migration.cts (tests/legacy-migration.test.cjs) before anything reads userData.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const distribution = require("../electron-runtime/electron/src/distribution.cjs");

const appData = path.join("C:", "Users", "a", "AppData", "Roaming");
const pin = (channel, hasUserDataDirSwitch = false) =>
  distribution.resolvePinnedUserDataDirectory({ channel, appDataDirectory: appData, hasUserDataDirSwitch });

assert.equal(distribution.DIRECT_USER_DATA_FOLDER, "Sojourner");
assert.equal(distribution.STORE_USER_DATA_FOLDER, "Sojourner Store");
// LEGACY folders (observed on a real Job Ranger v1.2.0 install): only migration reads them.
assert.equal(distribution.LEGACY_DIRECT_USER_DATA_FOLDER, "job-ranger");
assert.equal(distribution.LEGACY_STORE_USER_DATA_FOLDER, "Job Ranger Store");

assert.deepEqual(pin("direct-download"), {
  target: path.join(appData, "Sojourner"),
  legacy: path.join(appData, "job-ranger"),
});
assert.deepEqual(pin("microsoft-store"), {
  target: path.join(appData, "Sojourner Store"),
  legacy: path.join(appData, "Job Ranger Store"),
});
assert.notEqual(pin("microsoft-store").target, pin("direct-download").target);

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
assert.equal(
  distribution.detectDistributionChannel({ windowsStore: undefined, isPackaged: false, env: { SOJOURNER_DISTRIBUTION_CHANNEL_OVERRIDE: "microsoft-store" } }),
  "microsoft-store",
);

// Package identity: renamed, with the data root pinned independently of it.
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
assert.equal(pkg.name, "sojourner");
assert.equal(pkg.productName, undefined, "the pin, not package metadata, names the data folder");
const builder = JSON.parse(fs.readFileSync(path.join(repoRoot, "electron-builder.json"), "utf8").replace(/^﻿/, ""));
assert.equal(builder.extraMetadata?.productName, undefined, "extraMetadata must not inject a productName");
assert.equal(builder.extraMetadata?.name, undefined, "extraMetadata must not rename the packaged app");
assert.equal(builder.productName, "Sojourner");
assert.equal(builder.appId, "com.mythologiq.sojourner");
assert.equal(builder.nsis.deleteAppDataOnUninstall, false);

// main.cts migrates and applies the pin before anything reads userData or the app is ready.
const main = fs.readFileSync(path.join(repoRoot, "electron", "src", "main.cts"), "utf8");
const migrateAt = main.indexOf("migrateLegacyUserData(");
const pinAt = main.indexOf('app.setPath("userData", userDataMigration.userDataDirectory)');
assert.ok(migrateAt > 0, "main.cts runs the legacy data-folder migration");
assert.ok(pinAt > migrateAt, "main.cts applies the folder the migration chose");
assert.ok(pinAt < main.indexOf('getPath("userData")'), "the pin precedes every userData read");
assert.ok(pinAt < main.indexOf("new SojournerBackend("), "the pin precedes opening the database");
assert.ok(pinAt < main.indexOf("app.whenReady"), "the pin precedes app ready");
// One running app per data folder, taken after the folder is final (so it is the migrated one).
const lockAt = main.indexOf("app.requestSingleInstanceLock()");
assert.ok(lockAt > pinAt && lockAt < main.indexOf("app.whenReady"), "the single-instance lock follows the pin and precedes ready");
assert.match(main, /app\.on\("second-instance"/);
// A start that is still waiting for another start's migration opens no data at all.
assert.match(main, /userDataMigration\.kind === "busy"\) \{[\s\S]*?dialog\.showErrorBox\([\s\S]*?app\.exit\(1\);\s*\} else \{\s*app\.setPath\("userData", userDataMigration\.userDataDirectory\);/);
assert.match(main, /app\.whenReady\(\)\.then\(async \(\) => \{\s+if \(!hasInstanceLock\) return;/);

console.log("User-data pin tests passed");
