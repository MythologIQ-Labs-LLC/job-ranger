// Opens baseline-written data directories with the CURRENT build and verifies
// the upgrade contract (RELEASE_READINESS §3). Invoked by
// scripts/verify-release-upgrade.mjs after `npm run desktop:compile`.
//
// Usage: node check-current-release.cjs <outputRoot>
//
// For every fixture listed in <outputRoot>/baseline-fixtures.json:
// - every table that existed before is unchanged after the current build opens
//   the data (settings compare by key/value: startup re-saves timestamps);
// - every migration the current build knows is applied;
// - the read paths for profile, tracks, evidence, sources, applications,
//   lifecycle, materials, insights, stories, and resume projections work;
// - if the baseline could back the directory up, the current build can back
//   it up, stage-restore it into a fresh data root, and read back the same
//   counts there.

const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { outputLines } = require("./sqlite-output.cjs");

const runtimeDir = path.join(__dirname, "..", "..", "electron-runtime", "electron", "src");
const load = (file) => require(path.join(runtimeDir, file));
const { JobScoutBackend } = load("backend.cjs");
const { CareerBackend } = load("career-backend.cjs");
const { ApplicationLifecycleBackend } = load("application-lifecycle-backend.cjs");
const { CareerStoryBackend } = load("career-story-backend.cjs");
const { PersonalBrandBackend } = load("personal-brand-backend.cjs");
const { ApplicationMaterialsBackend } = load("application-materials-backend.cjs");
const { ApplicationInsightsBackend } = load("application-insights-backend.cjs");
const { ResumeService } = load("resume-service.cjs");
const { DriveExportJournal } = load("drive/drive-export-journal.cjs");
const { BackupService, applyPendingRestore } = load("backup-service.cjs");
const { migrations } = load("migrations.cjs");
const { FEATURE_MIGRATION_VERSIONS } = load("feature-migrations.cjs");
const { resolveSqliteBinary, SqliteClient } = load("sqlite.cjs");

const outputRoot = path.resolve(process.argv[2] ?? "");

function sqliteQuery(sqliteBinaryPath, databasePath, query) {
  return execFileSync(sqliteBinaryPath, [databasePath, query], { encoding: "utf8" });
}

function fingerprint(sqliteBinaryPath, databasePath) {
  const tables = outputLines(
    sqliteQuery(sqliteBinaryPath, databasePath, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"),
  );
  const result = {};
  for (const table of tables) {
    const columns = table === "settings" ? "key, value_json" : "*";
    const rows = sqliteQuery(sqliteBinaryPath, databasePath, `SELECT ${columns} FROM "${table}" ORDER BY 1;`);
    result[table] = createHash("sha256").update(rows).digest("hex");
  }
  return result;
}

async function openCurrent(dataDirectory) {
  const backend = new JobScoutBackend({
    dataDirectory,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error("Release upgrade verification must not use the network");
    },
  });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const options = { databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath };
  const career = new CareerBackend({ dataDirectory, ...options });
  await career.initialize();
  const lifecycle = new ApplicationLifecycleBackend(options.databasePath, options.sqliteBinaryPath);
  await lifecycle.initialize();
  const stories = new CareerStoryBackend(options);
  await stories.initialize();
  const personalBrand = new PersonalBrandBackend(options);
  await personalBrand.initialize();
  const materials = new ApplicationMaterialsBackend(options);
  await materials.initialize();
  const insights = new ApplicationInsightsBackend(options.databasePath, options.sqliteBinaryPath);
  await insights.initialize();
  const resume = new ResumeService({ dataDirectory, ...options });
  await resume.initialize();
  // Desktop-only Drive export journal (#314); opening it applies migration 1010.
  await new DriveExportJournal(new SqliteClient(options.databasePath, options.sqliteBinaryPath)).initialize();

  const applications = await career.listApplications();
  for (const application of applications) {
    await lifecycle.getLifecycle(application.id);
    await materials.list(application.id);
    await insights.getApplicationDetail(application.id);
  }
  await insights.getSearchLearning();
  const projections = await resume.listProjections();
  for (const projection of projections) await resume.getProjectionDetail(projection.id);

  const counts = {
    profile: (await career.getProfile()) ? 1 : 0,
    targetTracks: (await career.listTargetTracks()).length,
    evidence: (await career.listEvidence()).length,
    sourceArtifacts: (await career.listSourceArtifacts()).length,
    applications: applications.length,
    careerStories: (await stories.listStories()).length,
    personalBrandDrafts: (await personalBrand.listDrafts()).length,
    personalBrandPublications: (await personalBrand.listPublications()).length,
    personalBrandCareerOutcomes: (await personalBrand.listCareerOutcomes()).length,
    resumeProjections: projections.length,
    companies: (await backend.listCompanies()).length,
  };
  return { backend, status, counts };
}

async function verifyFixture(fixture, sqliteBinaryPath) {
  const databasePath = path.join(fixture.dataDirectory, "jobscout.sqlite3");
  const appliedVersions = () =>
    outputLines(sqliteQuery(sqliteBinaryPath, databasePath, "SELECT version FROM schema_migrations;"))
      .map(Number)
      .sort((a, b) => a - b);
  const baselineMigrations = appliedVersions();
  const before = fingerprint(sqliteBinaryPath, databasePath);
  const opened = await openCurrent(fixture.dataDirectory);
  const after = fingerprint(sqliteBinaryPath, databasePath);

  const changed = Object.keys(before).filter(
    (table) => table !== "schema_migrations" && before[table] !== after[table],
  );
  if (changed.length > 0) {
    throw new Error(`Baseline data changed when opened by the current build: ${changed.join(", ")}`);
  }

  const applied = new Set(appliedVersions());
  const expected = [...migrations.map((migration) => migration.version), ...FEATURE_MIGRATION_VERSIONS];
  const missing = expected.filter((version) => !applied.has(version));
  if (missing.length > 0) {
    throw new Error(`Migrations not applied after upgrade: ${missing.join(", ")}`);
  }

  let backup = { checked: false, reason: fixture.baselineBackup?.reason ?? "baseline could not back up" };
  if (fixture.baselineBackup?.ok) {
    const userDataDirectory = path.dirname(fixture.dataDirectory);
    const backupParent = path.join(userDataDirectory, "current-backups");
    await fs.mkdir(backupParent, { recursive: true });
    const service = new BackupService({
      dataDirectory: fixture.dataDirectory,
      userDataDirectory,
      databasePath,
      sqliteBinaryPath,
      appVersion: "release-upgrade-check",
    });
    const created = await service.createBackup(backupParent);
    await service.validateBackup(created.summary.bundlePath);

    const targetUserData = path.join(outputRoot, ".restored", fixture.name.replace(/[\\/]/g, "_"));
    await fs.rm(targetUserData, { recursive: true, force: true });
    const targetData = path.join(targetUserData, "data");
    const target = await openCurrent(targetData);
    await new BackupService({
      dataDirectory: targetData,
      userDataDirectory: targetUserData,
      databasePath: target.status.databasePath,
      sqliteBinaryPath,
      appVersion: "release-upgrade-check",
    }).stageRestore(created.summary.bundlePath);
    await target.backend.dispose();
    if (!(await applyPendingRestore({ userDataDirectory: targetUserData, dataDirectory: targetData }))) {
      throw new Error("Staged restore was not applied");
    }
    const restored = await openCurrent(targetData);
    await restored.backend.dispose();
    if (JSON.stringify(restored.counts) !== JSON.stringify(opened.counts)) {
      throw new Error(
        `Restored data differs: ${JSON.stringify(restored.counts)} vs ${JSON.stringify(opened.counts)}`,
      );
    }
    backup = { checked: true };
  }

  await opened.backend.dispose();
  return { counts: opened.counts, baselineMigrations, migrations: [...applied].sort((a, b) => a - b), backup };
}

(async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(outputRoot, "baseline-fixtures.json"), "utf8"));
  const sqliteBinaryPath = await resolveSqliteBinary();
  const results = [];
  for (const fixture of manifest.fixtures) {
    try {
      results.push({ name: fixture.name, status: "passed", ...(await verifyFixture(fixture, sqliteBinaryPath)) });
    } catch (error) {
      results.push({ name: fixture.name, status: "failed", error: error instanceof Error ? error.stack : String(error) });
    }
  }

  const failures = results.filter((result) => result.status === "failed");
  const backedUp = results.filter((result) => result.backup?.checked).length;
  if (!results.some((result) => result.name === "package-smoke" && result.backup?.checked)) {
    failures.push({ name: "package-smoke", error: "the representative package-smoke dataset was not backed up and restored" });
  }
  // Coverage: the baseline must itself have written every feature-owned table
  // it knows about, so upgrades of real feature data are exercised. Feature
  // migrations newer than the baseline are legitimately absent from it.
  const baselineWritten = new Set(results.flatMap((result) => result.baselineMigrations ?? []));
  const baselineKnown = new Set(manifest.baselineFeatureMigrations ?? []);
  for (const version of baselineKnown) {
    if (!baselineWritten.has(version)) {
      failures.push({ name: "coverage", error: `no baseline fixture wrote feature migration ${version}` });
    }
  }

  const report = { status: failures.length ? "failed" : "passed", results, skipped: manifest.skipped, failures };
  await fs.writeFile(path.join(outputRoot, "release-upgrade-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const result of results) {
    const backupNote = result.backup?.checked ? "backup+restore ok" : `backup not checked (${result.backup?.reason ?? "n/a"})`;
    console.log(`${result.status === "passed" ? "ok  " : "FAIL"} ${result.name}${result.counts ? ` ${JSON.stringify(result.counts)}` : ""}; ${backupNote}`);
    if (result.error) console.log(result.error);
  }
  console.log(`${results.length} baseline data directories checked; ${backedUp} backed up and restored.`);
  if (failures.length) {
    for (const failure of failures.filter((item) => !results.includes(item))) console.log(`FAIL ${failure.name}: ${failure.error}`);
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
