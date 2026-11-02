const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { JobScoutBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { CareerBackend } = require("../electron-runtime/electron/src/career-backend.cjs");
const { CareerRepository } = require("../electron-runtime/electron/src/career-repository.cjs");
const { SqliteClient } = require("../electron-runtime/electron/src/sqlite.cjs");

const record = {
  id: "application-status-interleaving",
  jobId: "status-race-job",
  title: "Customer Experience Specialist",
  companyName: "Fixture Org",
  url: "https://example.org/status-race",
  status: "interested",
  notes: "",
  createdAt: "2026-10-09T18:00:00.000Z",
  updatedAt: "2026-10-09T18:00:00.000Z",
};

/**
 * Deterministically insert an unrelated field update after a stale SELECT
 * and before the writer's UPDATE. The real SQLite client is used for both.
 * This is an orchestrated interleaving, not a fake in-memory persistence stub.
 */
async function runScenario(databasePath, sqliteBinaryPath, attemptedPatch, interveningPatch, expected) {
  const writerSqlite = new SqliteClient(databasePath, sqliteBinaryPath);
  const concurrentRepo = new CareerRepository(new SqliteClient(databasePath, sqliteBinaryPath));
  const originalQueryOne = writerSqlite.queryOne.bind(writerSqlite);
  let intervened = false;
  writerSqlite.queryOne = async (statement) => {
    if (!intervened && String(statement).includes("UPDATE applications") &&
        String(statement).includes("RETURNING")) {
      intervened = true;
      await concurrentRepo.updateApplication(record.id, interveningPatch);
    }
    return originalQueryOne(statement);
  };

  const writerRepo = new CareerRepository(writerSqlite);
  await writerRepo.updateApplication(record.id, attemptedPatch);
  assert.equal(intervened, true, "test must inject a write between read and write");
  const final = await concurrentRepo.getApplicationById(record.id);
  assert.equal(final.status, expected.status, "status must retain the latest independent change");
  assert.equal(final.notes, expected.notes, "notes must retain the latest independent change");
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-status-race-"));
  try {
    const backend = new JobScoutBackend({
      dataDirectory: tempDir, schedulerEnabled: false,
      fetchImpl: async () => { throw new Error("Status race test must stay offline"); },
    });
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    const career = new CareerBackend({
      dataDirectory: tempDir, databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await career.initialize();
    await career.migrateLegacy({ profile: null, applications: [record] });

    await runScenario(status.databasePath, status.sqliteBinaryPath,
      { status: "applied" }, { notes: "Latest interview notes" },
      { status: "applied", notes: "Latest interview notes" });

    await runScenario(status.databasePath, status.sqliteBinaryPath,
      { notes: "Revised interview notes" }, { status: "interview" },
      { status: "interview", notes: "Revised interview notes" });

    await assert.rejects(
      () => career.updateApplication("missing-status-app", { status: "offer" }),
      /not found|Failed to update/i,
    );
    console.log("Application status/notes interleaving contract passed.");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
