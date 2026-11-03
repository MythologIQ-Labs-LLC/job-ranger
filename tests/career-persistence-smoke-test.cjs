const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron/backend.cjs");
const { CareerBackend } = require("../electron/career-backend.cjs");
const { SqliteClient } = require("../electron/sqlite.cjs");
const {
  canEvidenceSupportFactualClaim,
  evaluateResumeStatementTruth,
} = require("../electron/career-contracts.cjs");

function createMockFetch() {
  return async (url) => {
    if (String(url).includes("boards-api.greenhouse.io/v1/boards/example/jobs")) {
      return new Response(
        JSON.stringify({
          jobs: [
            {
              id: 401,
              title: "Operations Coordinator",
              location: { name: "Baltimore, MD" },
              absolute_url: "https://boards.greenhouse.io/example/jobs/401",
              content: "<p>Coordinate schedules, vendors, and customer requests.</p>",
              updated_at: "2026-09-24T12:00:00.000Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    throw new Error(`Unexpected fetch URL in career persistence test: ${url}`);
  };
}

async function createCareerBackend(jobBackend, dataDirectory) {
  const status = await jobBackend.getSystemStatus(process.platform);
  const career = new CareerBackend({
    dataDirectory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  await career.initialize();
  return { career, status };
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-career-"));

  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      fetchImpl: createMockFetch(),
      schedulerEnabled: false,
    });
    await backend.initialize();

    const company = await backend.createCompany({
      name: "Example Employer",
      url: "https://boards.greenhouse.io/example",
      frequencyMinutes: 1440,
      isActive: true,
    });
    const scrape = await backend.runCompanyScrape(company.id);
    assert.equal(scrape.status, "success");

    const [job] = await backend.listJobs();
    assert.ok(job, "fixture job should exist");

    const { career, status } = await createCareerBackend(backend, tempDir);

    const artifactStats = await fs.stat(path.join(tempDir, "artifacts"));
    assert.equal(artifactStats.isDirectory(), true);
    assert.equal(career.getArtifactDirectory(), path.join(tempDir, "artifacts"));

    assert.equal(await career.getProfile(), null);

    const profile = await career.saveProfile({
      version: 2,
      fullName: "  Taylor Example  ",
      homeLocation: "  Annapolis, MD  ",
      radiusMiles: 24.6,
      minimumPay: 72555.6,
      payBasis: "annual",
      targetTitles: ["Operations Coordinator", " Operations Coordinator ", "Project Coordinator"],
      skills: ["Scheduling", "Vendor coordination"],
      certifications: [],
      sectors: ["Operations"],
      onCallPreference: "no",
      fullTimeOnly: true,
      updatedAt: null,
    });

    assert.equal(profile.fullName, "Taylor Example");
    assert.equal(profile.homeLocation, "Annapolis, MD");
    assert.equal(profile.radiusMiles, 25);
    assert.equal(profile.minimumPay, 72556);
    assert.deepEqual(profile.targetTitles, [
      "Operations Coordinator",
      "Project Coordinator",
    ]);
    assert.ok(profile.updatedAt);

    const application = await career.trackApplication(job.id);
    assert.equal(application.jobId, job.id);
    assert.equal(application.title, job.title);
    assert.equal(application.companyName, "Example Employer");
    assert.equal(application.status, "interested");

    const updated = await career.updateApplication(application.id, {
      status: "applied",
      notes: "Applied through the employer careers page.",
    });
    assert.equal(updated.status, "applied");
    assert.match(updated.notes, /Applied through/);

    await career.migrateLegacy({
      profile: {
        ...profile,
        fullName: "Legacy Should Not Replace Existing",
      },
      applications: [
        {
          id: "application-legacy-99",
          jobId: "legacy-99",
          title: "Legacy Saved Role",
          companyName: "Legacy Employer",
          url: "https://example.com/jobs/legacy-99",
          status: "interview",
          notes: "Preserved from renderer-local storage.",
          createdAt: "2026-09-01T12:00:00.000Z",
          updatedAt: "2026-09-20T12:00:00.000Z",
        },
      ],
    });

    const afterLegacyProfile = await career.getProfile();
    assert.equal(afterLegacyProfile?.fullName, "Taylor Example");
    assert.equal((await career.listApplications()).length, 2);

    // Re-running legacy migration must be idempotent.
    await career.migrateLegacy({
      profile: null,
      applications: [
        {
          id: "application-legacy-99",
          jobId: "legacy-99",
          title: "Legacy Saved Role",
          companyName: "Legacy Employer",
          url: "https://example.com/jobs/legacy-99",
          status: "interview",
          notes: "Preserved from renderer-local storage.",
          createdAt: "2026-09-01T12:00:00.000Z",
          updatedAt: "2026-09-20T12:00:00.000Z",
        },
      ],
    });
    assert.equal((await career.listApplications()).length, 2);

    const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
    const migrationRows = await sqlite.queryAll(
      "SELECT version, name FROM schema_migrations ORDER BY version ASC;",
    );
    const appliedMigrations = new Map(
      migrationRows.map((row) => [row.version, row.name]),
    );
    assert.equal(
      appliedMigrations.get(3),
      "career_intelligence_persistence",
      "career persistence migration must remain applied",
    );
    assert.equal(
      appliedMigrations.get(4),
      "career_evidence_contracts",
      "Career Evidence contract migration must remain applied",
    );

    const expectedTables = [
      "career_profile",
      "applications",
      "source_artifacts",
      "extraction_snapshots",
      "candidate_evidence",
      "evidence_source_links",
      "job_requirements",
      "requirement_evidence_maps",
      "resume_projections",
      "resume_statements",
      "resume_artifacts",
      "application_artifact_links",
    ];
    const tableRows = await sqlite.queryAll(
      "SELECT name FROM sqlite_master WHERE type = 'table';",
    );
    const tableNames = new Set(tableRows.map((row) => row.name));
    for (const table of expectedTables) {
      assert.equal(tableNames.has(table), true, `missing table ${table}`);
    }

    const confirmedEvidence = {
      id: "evidence-confirmed",
      verificationState: "user-confirmed",
    };
    const importedEvidence = {
      id: "evidence-imported",
      verificationState: "imported",
    };
    assert.equal(canEvidenceSupportFactualClaim(confirmedEvidence), true);
    assert.equal(canEvidenceSupportFactualClaim(importedEvidence), false);

    const supportedStatement = evaluateResumeStatementTruth(
      {
        generationMode: "deterministic",
        evidenceIds: [confirmedEvidence.id],
      },
      [confirmedEvidence, importedEvidence],
    );
    assert.equal(supportedStatement.supported, true);

    const unsupportedStatement = evaluateResumeStatementTruth(
      {
        generationMode: "assisted",
        evidenceIds: [importedEvidence.id, "missing-evidence"],
      },
      [confirmedEvidence, importedEvidence],
    );
    assert.equal(unsupportedStatement.supported, false);
    assert.deepEqual(unsupportedStatement.unconfirmedEvidenceIds, [
      importedEvidence.id,
    ]);
    assert.deepEqual(unsupportedStatement.missingEvidenceIds, [
      "missing-evidence",
    ]);

    await backend.dispose();

    const reloadedBackend = new SojournerBackend({
      dataDirectory: tempDir,
      fetchImpl: createMockFetch(),
      schedulerEnabled: false,
    });
    await reloadedBackend.initialize();
    const { career: reloadedCareer } = await createCareerBackend(
      reloadedBackend,
      tempDir,
    );

    const persistedProfile = await reloadedCareer.getProfile();
    const persistedApplications = await reloadedCareer.listApplications();
    assert.equal(persistedProfile?.fullName, "Taylor Example");
    assert.equal(persistedApplications.length, 2);
    assert.equal(
      persistedApplications.some((item) => item.status === "applied"),
      true,
    );

    await reloadedBackend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
