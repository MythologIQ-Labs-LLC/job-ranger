// Runs INSIDE a checkout of a previously published release (the baseline) to
// produce data directories written by that release's own code. Invoked by
// scripts/verify-release-upgrade.mjs; not meant to be run directly.
//
// Usage: node generate-baseline-data.cjs <baselineRoot> <outputRoot>
//
// The baseline's own tests are the most faithful producer of baseline-written
// data, so they are executed unchanged; a preload hook (keep-temp-dirs.cjs)
// redirects their temporary data directories under <outputRoot> and keeps
// them instead of deleting them.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [baselineRoot, outputRoot] = process.argv.slice(2).map((value) => path.resolve(value));
if (!baselineRoot || !outputRoot) {
  throw new Error("Usage: generate-baseline-data.cjs <baselineRoot> <outputRoot>");
}

// Baseline smoke tests whose data covers the feature-owned tables
// (feature migrations 1001-1004) and resume artifacts. Tests missing from an
// older baseline are skipped and reported.
const FEATURE_SMOKE_TESTS = [
  "target-tracks-smoke-test",
  "evidence-extension-smoke-test",
  "application-lifecycle-smoke-test",
  "application-insights-smoke-test",
  "career-story-smoke-test",
  "application-materials-smoke-test",
  "interview-prep-smoke-test",
  "resume-lifecycle-smoke-test",
];

const runtime = (file) => path.join(baselineRoot, "electron-runtime", "electron", "src", file);
// The baseline's own database file name: LEGACY jobscout.sqlite3 for job-ranger-v* (and
// Sojourner before the rename), sojourner.sqlite3 for later baselines.
const LEGACY_DATABASE_FILE_NAME = "jobscout.sqlite3";
const DATABASE_FILE_NAMES = ["sojourner.sqlite3", LEGACY_DATABASE_FILE_NAME];
const databaseIn = (dataDirectory) =>
  DATABASE_FILE_NAMES.map((name) => path.join(dataDirectory, name)).find((file) => fs.existsSync(file)) ?? null;
const fixtures = [];
const skipped = [];

function run(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: baselineRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return result;
}

// 1. The baseline's packaged-runtime smoke: the release's own representative
//    Career Ops dataset (profile, tracks, evidence, employer, job snapshot,
//    requirements, application, backup).
const packageSmokeRoot = path.join(outputRoot, "package-smoke");
fs.mkdirSync(packageSmokeRoot, { recursive: true });
const smoke = run([runtime("package-smoke-cli.cjs")], {
  SOJOURNER_PACKAGE_SMOKE_USER_DATA: packageSmokeRoot,
  SOJOURNER_PACKAGE_SMOKE_VERSION: "baseline",
  // LEGACY: the variable names a job-ranger-v* baseline reads.
  JOB_RANGER_PACKAGE_SMOKE_USER_DATA: packageSmokeRoot,
  JOB_RANGER_PACKAGE_SMOKE_VERSION: "baseline",
});
if (smoke.status !== 0) {
  throw new Error(`Baseline package smoke failed:\n${smoke.stdout}\n${smoke.stderr}`);
}
fixtures.push({ name: "package-smoke", dataDirectory: path.join(packageSmokeRoot, "data") });

// 2. Baseline feature smokes, with their temporary data directories kept.
const hook = path.join(__dirname, "keep-temp-dirs.cjs");
for (const name of FEATURE_SMOKE_TESTS) {
  const testFile = path.join(baselineRoot, "tests", `${name}.cjs`);
  if (!fs.existsSync(testFile)) {
    skipped.push({ name, reason: "test not present in baseline" });
    continue;
  }
  const keepRoot = path.join(outputRoot, name);
  const result = run(["-r", hook, testFile], { SOJOURNER_KEEP_TEMP_ROOT: keepRoot });
  if (result.status !== 0) {
    throw new Error(`Baseline ${name} failed:\n${result.stdout}\n${result.stderr}`);
  }
  for (const entry of fs.existsSync(keepRoot) ? fs.readdirSync(keepRoot) : []) {
    const candidate = path.join(keepRoot, entry);
    for (const dataDirectory of [candidate, path.join(candidate, "data")]) {
      if (databaseIn(dataDirectory)) {
        fixtures.push({ name: `${name}/${entry}`, dataDirectory });
      }
    }
  }
}

// 3. Record whether the baseline itself can back up each directory. Some
//    baseline tests insert artifact rows with synthetic paths outside the data
//    root; the current release is only required to back up what the baseline
//    could.
const { BackupService } = require(runtime("backup-service.cjs"));
const { resolveSqliteBinary } = require(runtime("sqlite.cjs"));

(async () => {
  const sqliteBinaryPath = await resolveSqliteBinary();
  for (const fixture of fixtures) {
    const backupParent = path.join(outputRoot, ".baseline-backups", fixture.name.replace(/[\\/]/g, "_"));
    fs.mkdirSync(backupParent, { recursive: true });
    try {
      await new BackupService({
        dataDirectory: fixture.dataDirectory,
        userDataDirectory: path.dirname(fixture.dataDirectory),
        databasePath: databaseIn(fixture.dataDirectory),
        sqliteBinaryPath,
        appVersion: "baseline",
      }).createBackup(backupParent);
      fixture.baselineBackup = { ok: true };
    } catch (error) {
      fixture.baselineBackup = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  fs.rmSync(path.join(outputRoot, ".baseline-backups"), { recursive: true, force: true });

  // Feature-owned migrations (1000+) the baseline knows, found in its compiled
  // runtime (constants such as `*_MIGRATION_VERSION = 1001` or a registry
  // entry `version: 1001`), so coverage of baseline feature data can be
  // checked.
  const runtimeDirectory = path.dirname(runtime("backend.cjs"));
  const baselineFeatureMigrations = new Set();
  for (const file of fs.readdirSync(runtimeDirectory).filter((name) => name.endsWith(".cjs"))) {
    const source = fs.readFileSync(path.join(runtimeDirectory, file), "utf8");
    for (const match of source.matchAll(/(?:MIGRATION_VERSION\s*=|version:)\s*(1\d{3})\b/g)) {
      baselineFeatureMigrations.add(Number(match[1]));
    }
  }

  fs.writeFileSync(
    path.join(outputRoot, "baseline-fixtures.json"),
    `${JSON.stringify({ fixtures, skipped, baselineFeatureMigrations: [...baselineFeatureMigrations].sort() }, null, 2)}\n`,
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
