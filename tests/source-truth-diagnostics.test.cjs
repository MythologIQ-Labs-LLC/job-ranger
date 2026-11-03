const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { RequirementBackend } = require("../electron-runtime/electron/src/requirement-backend.cjs");
const { SqliteClient } = require("../electron-runtime/electron/src/sqlite.cjs");

async function clearScrapeGuard(sqlite, companyId) {
  const numericId = Number(companyId);
  assert.equal(Number.isInteger(numericId), true, "test company ID must be numeric");
  await sqlite.exec(`
    UPDATE companies
    SET last_run_at = NULL, last_run_status = 'idle', circuit_open_until = NULL
    WHERE id = ${numericId};
  `);
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-source-trust-"));
  let greenhouseContent = `<p>${"Coordinate vendor schedules, customer requests, inventory records, service calendars, dispatch notes, purchase orders, supplier escalations, site access, shift handoffs, maintenance windows, and customer communications. ".repeat(2)}</p><p>Must maintain OSHA 30 certification and support weekend rotations.</p>`;

  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("boards-api.greenhouse.io/v1/boards/acme/jobs")) {
      return new Response(JSON.stringify({ jobs: [{ id: 1, title: "Operations Coordinator", location: { name: "Baltimore" }, absolute_url: "https://boards.greenhouse.io/acme/jobs/1", content: greenhouseContent, updated_at: "2026-10-04T12:00:00.000Z" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (value.includes("boards-api.greenhouse.io/v1/boards/empty/jobs")) {
      return new Response(JSON.stringify({ jobs: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (value === "https://www.oracle.com/careers/") {
      return new Response("<html><body><h1>Careers</h1></body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }
    throw new Error(`Unexpected URL: ${value}`);
  };

  try {
    const backend = new SojournerBackend({ dataDirectory: tempDir, fetchImpl, schedulerEnabled: false });
    await backend.initialize();

    const company = await backend.createCompany({ name: "Acme", url: "https://boards.greenhouse.io/acme", frequencyMinutes: 1440, isActive: true });
    const firstRun = await backend.runCompanyScrape(company.id);
    assert.equal(firstRun.status, "success");
    assert.equal(firstRun.diagnosticCode, "success-with-results");

    let jobs = await backend.listJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].sourceCompleteness, "full");
    assert.ok(jobs[0].currentSourceSnapshotId);
    assert.equal(
      jobs[0].descriptionSnippet.includes("OSHA 30 certification"),
      false,
      "fixture must place the requirement beyond the legacy 220-character snippet",
    );

    const status = await backend.getSystemStatus(process.platform);
    const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
    let snapshots = await sqlite.queryAll("SELECT * FROM job_source_snapshots;");
    assert.equal(snapshots.length, 1);
    assert.match(snapshots[0].content_text, /OSHA 30 certification/);
    assert.equal(snapshots[0].content_hash.length, 64);

    const requirements = new RequirementBackend({ databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath });
    await requirements.getJobEvidenceCoverage(jobs[0].id);
    const linked = await sqlite.queryAll("SELECT text, source_snapshot_id FROM job_requirements WHERE job_id = '1';");
    assert.ok(linked.some((row) => /OSHA 30 certification/.test(row.text)));
    assert.ok(linked.every((row) => row.source_snapshot_id === jobs[0].currentSourceSnapshotId));

    // The production cooldown is unrelated to snapshot semantics. Reset only the
    // test company's guard state so this fixture can exercise repeated retrievals.
    await clearScrapeGuard(sqlite, company.id);
    const unchangedRun = await backend.runCompanyScrape(company.id);
    assert.equal(unchangedRun.status, "success");
    snapshots = await sqlite.queryAll("SELECT * FROM job_source_snapshots;");
    assert.equal(snapshots.length, 1, "unchanged source text should not create duplicate snapshots");

    greenhouseContent = `<p>Coordinate vendor schedules.</p><p>Must maintain OSHA 30 certification.</p><p>Must hold a valid driver's license.</p>`;
    await clearScrapeGuard(sqlite, company.id);
    const changedRun = await backend.runCompanyScrape(company.id);
    assert.equal(changedRun.status, "success");
    jobs = await backend.listJobs();
    snapshots = await sqlite.queryAll("SELECT * FROM job_source_snapshots;");
    assert.equal(snapshots.length, 2, "changed source text must create a new immutable snapshot");
    const currentSnapshot = snapshots.find((snapshot) => snapshot.id === jobs[0].currentSourceSnapshotId);
    assert.ok(currentSnapshot, "job must point at one of its preserved source snapshots");
    assert.match(currentSnapshot.content_text, /valid driver's license/);

    const empty = await backend.createCompany({ name: "Empty", url: "https://boards.greenhouse.io/empty", frequencyMinutes: 1440, isActive: true });
    const emptyRun = await backend.runCompanyScrape(empty.id);
    assert.equal(emptyRun.status, "success");
    assert.equal(emptyRun.diagnosticCode, "success-empty");
    assert.match(emptyRun.diagnosticMessage ?? "", /zero jobs/i);

    const oracle = await backend.createCompany({ name: "Oracle", url: "https://www.oracle.com/careers/", frequencyMinutes: 1440, isActive: true });
    const oracleRun = await backend.runCompanyScrape(oracle.id);
    assert.equal(oracleRun.status, "failure");
    assert.equal(oracleRun.diagnosticCode, "extraction-failed");
    const companies = await backend.listCompanies();
    const oracleState = companies.find((item) => item.id === oracle.id);
    assert.match(oracleState?.lastErrorMessage ?? "", /could not reliably extract/i);

    await backend.dispose();
    console.log("Source truth and diagnostics regressions passed!");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
