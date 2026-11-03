const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { CareerBackend } = require("../electron-runtime/electron/src/career-backend.cjs");
const { RequirementBackend } = require("../electron-runtime/electron/src/requirement-backend.cjs");
const { runPackagedSmoke } = require("../electron-runtime/electron/src/package-smoke.cjs");

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-package-smoke-test-"));
  const userDataDirectory = path.join(root, "user-data");
  const dataDirectory = path.join(userDataDirectory, "data");
  const reportPath = path.join(root, "package-smoke-report.json");
  await fs.mkdir(userDataDirectory, { recursive: true });

  const backend = new SojournerBackend({
    dataDirectory,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error("package-smoke regression must not use the network");
    },
  });

  try {
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    const careerBackend = new CareerBackend({
      dataDirectory,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await careerBackend.initialize();
    const requirementBackend = new RequirementBackend({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });

    const report = await runPackagedSmoke({
      backend,
      careerBackend,
      requirementBackend,
      userDataDirectory,
      dataDirectory,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
      appVersion: "1.2.0-test",
      platform: process.platform,
      reportPath,
    });

    assert.equal(report.status, "passed");
    assert.equal(report.scenario, "healthcare-operations");
    assert.equal(report.checks.profileSaved, true);
    assert.equal(report.checks.targetTrackCreated, true);
    assert.equal(report.checks.userEvidenceCreated, true);
    assert.equal(report.checks.pastedEvidenceImported, true);
    assert.equal(report.checks.companyAdded, true);
    assert.equal(report.checks.filterAdded, true);
    assert.equal(report.checks.syntheticJobPersisted, true);
    assert.equal(report.checks.sourceSnapshotPersisted, true);
    assert.ok(report.checks.requirementsExtracted > 0);
    assert.equal(report.checks.applicationTracked, true);
    assert.equal(report.checks.jsonResumeExported, true);
    assert.equal(report.checks.backupValidated, true);
    assert.ok(report.checks.backupArtifactFiles > 0);

    const persisted = JSON.parse(await fs.readFile(reportPath, "utf8"));
    assert.deepEqual(persisted, report);

    const exported = JSON.parse(
      await fs.readFile(path.join(userDataDirectory, "package-smoke-json-resume.json"), "utf8"),
    );
    assert.equal(exported.basics.name, "Morgan Rivera");
    assert.ok(exported.work.some((item) => item.position === "Patient Services Coordinator"));
  } finally {
    await backend.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log("Packaged smoke harness regression passed!");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
