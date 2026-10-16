// Demo-flavor workspace seeding through the real shared core (electron/src/demo-seed.cts).
// Runs on the desktop sqlite3 engine (npm test) and on the PWA's SQLite WASM engine
// (tests/run-wasm-engine-parity.mjs), the engine the demo flavor actually uses.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const runtime = path.join(__dirname, "..", "electron-runtime");
const { JobScoutBackend } = require(path.join(runtime, "electron/src/backend.cjs"));
const { CareerBackend } = require(path.join(runtime, "electron/src/career-backend.cjs"));
const { RequirementBackend } = require(path.join(runtime, "electron/src/requirement-backend.cjs"));
const seed = require(path.join(runtime, "electron/src/demo-seed.cjs"));

const CAPTURED_AT = new Date("2026-10-15T12:00:00.000Z");
// Years later: relative dates keep the same story (still-active credential, same coverage).
const LATER = new Date("2031-03-01T08:30:00.000Z");

/** Any network attempt fails the test: the demo never fetches anything. */
const networkCalls = [];
async function deniedFetch(url) {
  networkCalls.push(String(url));
  throw new Error(`Demo seeding must not touch the network: ${url}`);
}

async function openWorkspace(directory) {
  const backend = new JobScoutBackend({ dataDirectory: directory, fetchImpl: deniedFetch, schedulerEnabled: false });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const careerBackend = new CareerBackend({
    dataDirectory: directory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  await careerBackend.initialize();
  const requirementBackend = new RequirementBackend({
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  return {
    backend,
    careerBackend,
    requirementBackend,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  };
}

/** Everything a visitor sees, minus random ids and wall-clock timestamps. */
async function stableProjection(workspace) {
  const profile = await workspace.careerBackend.getProfile();
  const tracks = await workspace.careerBackend.listTargetTracks();
  const evidence = await workspace.careerBackend.listEvidence();
  const companies = await workspace.backend.listCompanies();
  const jobs = await workspace.backend.listJobs();
  const applications = await workspace.careerBackend.listApplications();
  const coverage = [];
  for (const job of [...jobs].sort((a, b) => a.sourceJobId.localeCompare(b.sourceJobId))) {
    const result = await workspace.requirementBackend.getJobEvidenceCoverage(job.id);
    coverage.push({
      job: job.sourceJobId,
      items: result.items.map((item) => [item.requirement.kind, item.requirement.text, item.mapping.classification]),
    });
  }
  return {
    profile: { ...profile, updatedAt: null },
    tracks: tracks.map((track) => ({ name: track.name, relation: track.relation, isActive: track.isActive, constraints: track.constraints })),
    evidence: evidence
      .map((item) => [item.evidence.subjectType, item.evidence.titleOrName, item.evidence.statement, item.evidence.verificationState])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    companies: companies.map((company) => [company.name, company.url, company.sourceType, company.sourceIdentifier, company.isActive]),
    jobs: jobs
      .map((job) => [job.sourceJobId, job.title, job.location, job.url, job.salaryMin, job.salaryMax, job.salaryText, job.postDate, job.lastSeenAt, job.sourceCompleteness])
      .sort((a, b) => a[0].localeCompare(b[0])),
    applications: applications.map((application) => [application.title, application.companyName, application.url, application.status, application.notes]),
    coverage,
  };
}

async function run() {
  const { isDemoListing } = await import(pathToFileURL(path.join(runtime, "src/shared/demo-listing.js")).href);
  const { buildOpportunityAssessment } = await import(pathToFileURL(path.join(runtime, "src/shared/opportunity-assessment.js")).href);
  const first = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-demo-seed-a-"));
  const second = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-demo-seed-b-"));
  const third = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-demo-seed-c-"));
  try {
    const workspace = await openWorkspace(first);
    const started = Date.now();
    const result = await seed.seedDemoWorkspace({ ...workspace, now: CAPTURED_AT });
    const elapsedMs = Date.now() - started;
    assert.equal(result.status, "seeded");
    assert.equal(result.profileName, "Morgan Rivera");

    const profile = await workspace.careerBackend.getProfile();
    assert.equal(profile.fullName, "Morgan Rivera");
    assert.equal(profile.homeLocation, "Baltimore, MD");

    // Exactly one Target Track (the profile-derived track is configured, not duplicated).
    const tracks = await workspace.careerBackend.listTargetTracks();
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].name, "Practice operations");
    assert.equal(tracks[0].isActive, true);
    assert.equal(tracks[0].id, result.targetTrackId);

    const evidence = await workspace.careerBackend.listEvidence();
    assert.equal(evidence.length, 4);
    assert.ok(evidence.every((item) => item.evidence.verificationState === "user-authored"), "seeded evidence is confirmed (user-authored)");

    // The fictional employer is not a monitorable source and never reaches the network.
    const companies = await workspace.backend.listCompanies();
    assert.equal(companies.length, 1);
    const [company] = companies;
    assert.equal(company.name, "Harbor Health");
    assert.ok(isDemoListing(company.url), company.url);
    assert.equal(company.sourceType, "unsupported");
    assert.equal(company.sourceIdentifier, null);
    assert.equal(company.isActive, false);
    const scan = await workspace.backend.runCompanyScrape(company.id);
    assert.equal(scan.status, "unsupported");
    assert.deepEqual(networkCalls, []);

    const jobs = await workspace.backend.listJobs();
    assert.equal(jobs.length, 3);
    for (const job of jobs) {
      assert.ok(isDemoListing(job.url), `demo listing URL: ${job.url}`);
      assert.match(job.location, /^[A-Z][A-Za-z .'-]+, [A-Z]{2}$/, `City, ST location: ${job.location}`);
      assert.equal(job.sourceCompleteness, "full");
      assert.ok(job.currentSourceSnapshotId, "listing text preserved as a source snapshot");
    }
    // Newest first in Find Jobs: the primary listing, then the others a minute apart.
    assert.deepEqual(
      [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((job) => [job.sourceJobId, job.createdAt]),
      [
        ["demo-practice-operations-coordinator", "2026-10-15T12:00:00.000Z"],
        ["demo-patient-access-representative", "2026-10-15T11:59:00.000Z"],
        ["demo-clinic-operations-coordinator", "2026-10-15T11:58:00.000Z"],
      ],
    );
    const byId = Object.fromEntries(jobs.map((job) => [job.sourceJobId, job]));
    const primary = byId["demo-practice-operations-coordinator"];
    assert.equal(primary.salaryMin, 56000);
    assert.equal(primary.salaryMax, 66000);
    assert.match(primary.salaryText, /year/i);
    const hourly = byId["demo-patient-access-representative"];
    assert.equal(hourly.salaryMin, 21.5);
    assert.equal(hourly.salaryMax, 25);
    assert.match(hourly.salaryText, /hour/i);

    // Real requirement extraction: the primary listing shows supported and unsupported requirements.
    const primaryCoverage = await workspace.requirementBackend.getJobEvidenceCoverage(primary.id);
    assert.ok(primaryCoverage.supportedCount > 0, "some requirements are supported by confirmed evidence");
    assert.ok(primaryCoverage.gapCount > 0, "some requirements are unsupported");
    const epic = primaryCoverage.items.find((item) => /Epic EHR/.test(item.requirement.text));
    assert.ok(epic, "Epic EHR requirement extracted");
    assert.equal(epic.mapping.classification, "gap");
    const scheduling = primaryCoverage.items.find((item) => /patient scheduling/i.test(item.requirement.text));
    assert.ok(scheduling && scheduling.evidence, "patient scheduling is backed by Career Evidence");
    const assessment = buildOpportunityAssessment(primary, tracks[0], primaryCoverage);
    assert.equal(assessment.evidenceCoverage.status, "partial");
    for (const coverage of result.coverage) assert.ok(coverage.requirements > 0, `requirements extracted for ${coverage.title}`);

    const applications = await workspace.careerBackend.listApplications();
    assert.equal(applications.length, 1);
    assert.equal(applications[0].title, "Clinic Operations Coordinator");
    assert.equal(applications[0].status, "applied");
    assert.ok(isDemoListing(applications[0].url));
    assert.equal(applications[0].notes, seed.DEMO_APPLICATION_NOTES);

    // Idempotent-safe: a second call writes nothing.
    const again = await seed.seedDemoWorkspace({ ...workspace, now: CAPTURED_AT });
    assert.equal(again.status, "already-seeded");
    assert.equal((await workspace.backend.listJobs()).length, 3);
    assert.equal((await workspace.careerBackend.listEvidence()).length, 4);
    assert.equal((await workspace.careerBackend.listTargetTracks()).length, 1);
    assert.equal((await workspace.careerBackend.listApplications()).length, 1);

    // Deterministic: an independent workspace seeded at the same moment is identical.
    const other = await openWorkspace(second);
    await seed.seedDemoWorkspace({ ...other, now: CAPTURED_AT });
    assert.deepEqual(await stableProjection(other), await stableProjection(workspace));

    // Stable over time: seeded years later, the dates move with the clock but the
    // credential is still active and the assessment results are identical.
    const later = await openWorkspace(third);
    await seed.seedDemoWorkspace({ ...later, now: LATER });
    const [nowView, laterView] = [await stableProjection(workspace), await stableProjection(later)];
    assert.deepEqual(laterView.coverage, nowView.coverage);
    assert.deepEqual(laterView.evidence, nowView.evidence);
    assert.deepEqual(laterView.tracks, nowView.tracks);
    assert.deepEqual(laterView.applications, nowView.applications);
    assert.deepEqual(laterView.jobs.map((job) => job.slice(0, 7)), nowView.jobs.map((job) => job.slice(0, 7)));
    for (const [view, at] of [[nowView, CAPTURED_AT], [laterView, LATER]]) {
      for (const job of view.jobs) {
        const posted = Date.parse(job[7]);
        assert.ok(posted < at.getTime() && at.getTime() - posted <= 15 * 86_400_000, `posted within two weeks of seeding: ${job[7]}`);
      }
    }
    for (const [workspaceAt, at] of [[workspace, CAPTURED_AT], [later, LATER]]) {
      const credential = (await workspaceAt.careerBackend.listEvidence()).find((item) => item.evidence.subjectType === "credential");
      assert.ok(Date.parse(credential.evidence.credential.expirationDate) > at.getTime(), "credential still active when seeded");
      assert.ok(Date.parse(`${credential.evidence.startDate}-01`) < at.getTime(), "credential obtained before seeding");
    }
    await later.backend.dispose();
    assert.deepEqual(networkCalls, []);

    await workspace.backend.dispose();
    await other.backend.dispose();
    console.log(`Demo seed smoke test passed (seeded in ${elapsedMs} ms, primary coverage ${primaryCoverage.supportedCount} supported / ${primaryCoverage.gapCount} gaps).`);
  } finally {
    await fs.rm(first, { recursive: true, force: true });
    await fs.rm(second, { recursive: true, force: true });
    await fs.rm(third, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
