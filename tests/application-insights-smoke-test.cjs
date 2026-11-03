const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { ApplicationLifecycleBackend } = require('../electron-runtime/electron/src/application-lifecycle-backend.cjs');
const { ApplicationInsightsBackend } = require('../electron-runtime/electron/src/application-insights-backend.cjs');
const { SqliteClient, sql } = require('../electron-runtime/electron/src/sqlite.cjs');

const now = '2026-10-03T18:30:00.000Z';

const constraints = {
  geography: { locations: [], radiusMiles: null, strength: 'preferred' },
  workModes: { values: [], strength: 'preferred' },
  employmentArrangements: { values: ['full-time'], strength: 'preferred' },
  schedules: { values: [], strength: 'preferred' },
  compensation: { floor: null, target: null, basis: 'annual', floorStrength: 'preferred' },
  onCall: { value: 'either', strength: 'preferred' },
  industries: { values: [], strength: 'preferred' },
};

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-insights-'));
  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => { throw new Error('application insights smoke test must not use the network'); },
    });
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
    const career = new CareerBackend({
      dataDirectory: tempDir,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await career.initialize();

    const track = await career.createTargetTrack({
      name: 'Platform roles',
      relation: 'target',
      roleTitles: ['Platform Engineer'],
      seniority: null,
      direction: null,
      constraints,
      isActive: true,
    });

    await sqlite.exec(sql`
      INSERT INTO companies (
        id, name, url, source_type, source_identifier, frequency_minutes, is_active,
        last_run_at, last_run_status, last_error_message, consecutive_failures,
        circuit_open_until, created_at, updated_at
      ) VALUES
        (${8100}, ${'Structured Employer'}, ${'https://one.example/jobs'}, ${'greenhouse'}, ${'one'}, ${1440}, ${1}, ${null}, ${'idle'}, ${null}, ${0}, ${null}, ${now}, ${now}),
        (${8101}, ${'Portal Employer'}, ${'https://two.example/jobs'}, ${'workday'}, ${'two'}, ${1440}, ${1}, ${null}, ${'idle'}, ${null}, ${0}, ${null}, ${now}, ${now}),
        (${8102}, ${'Generic Employer'}, ${'https://three.example/jobs'}, ${'generic-html'}, ${null}, ${1440}, ${1}, ${null}, ${'idle'}, ${null}, ${0}, ${null}, ${now}, ${now});
    `);
    await sqlite.exec(sql`
      INSERT INTO jobs (
        id, company_id, source_job_id, source_type, title, location, employment_type,
        url, description_snippet, salary_min, salary_max, salary_currency, salary_text,
        post_date, created_at, last_seen_at, is_active, is_new, matched_filter_count
      ) VALUES
        (${8110}, ${8100}, ${'job-one'}, ${'greenhouse'}, ${'Platform Engineer'}, ${'Remote'}, ${'Full-time'}, ${'https://one.example/jobs/1'}, ${'Python required. TypeScript APIs required.'}, ${null}, ${null}, ${null}, ${null}, ${null}, ${now}, ${now}, ${1}, ${1}, ${0}),
        (${8111}, ${8101}, ${'job-two'}, ${'workday'}, ${'Systems Engineer'}, ${'Remote'}, ${'Full-time'}, ${'https://two.example/jobs/2'}, ${'Python required.'}, ${null}, ${null}, ${null}, ${null}, ${null}, ${now}, ${now}, ${1}, ${1}, ${0}),
        (${8112}, ${8102}, ${'job-three'}, ${'generic-html'}, ${'Integration Engineer'}, ${'Remote'}, ${'Contract'}, ${'https://three.example/jobs/3'}, ${'Python required.'}, ${null}, ${null}, ${null}, ${null}, ${null}, ${now}, ${now}, ${1}, ${1}, ${0});
    `);

    await career.migrateLegacy({
      profile: null,
      applications: [
        { id: 'app-one', jobId: '8110', title: 'Platform Engineer', companyName: 'Structured Employer', url: 'https://one.example/jobs/1', status: 'interview', notes: '', createdAt: now, updatedAt: now },
        { id: 'app-two', jobId: '8111', title: 'Systems Engineer', companyName: 'Portal Employer', url: 'https://two.example/jobs/2', status: 'rejected', notes: '', createdAt: now, updatedAt: now },
        { id: 'app-three', jobId: '8112', title: 'Integration Engineer', companyName: 'Generic Employer', url: 'https://three.example/jobs/3', status: 'applied', notes: '', createdAt: now, updatedAt: now },
      ],
    });

    const evidence = await career.createUserEvidence({
      subjectType: 'achievement',
      statement: 'Built production TypeScript APIs.',
      skills: ['TypeScript', 'APIs'],
    });

    await sqlite.exec(sql`
      INSERT INTO job_requirements (id, job_id, kind, text, normalized_term, importance, source_text, created_at) VALUES
        (${'req-python-1'}, ${'8110'}, ${'must-have'}, ${'Python required'}, ${'Python'}, ${1}, ${'Python required'}, ${now}),
        (${'req-api-1'}, ${'8110'}, ${'must-have'}, ${'TypeScript APIs required'}, ${'TypeScript APIs'}, ${1}, ${'TypeScript APIs required'}, ${now}),
        (${'req-python-2'}, ${'8111'}, ${'must-have'}, ${'Python required'}, ${'Python'}, ${1}, ${'Python required'}, ${now}),
        (${'req-python-3'}, ${'8112'}, ${'must-have'}, ${'Python required'}, ${'Python'}, ${1}, ${'Python required'}, ${now});
    `);
    await sqlite.exec(sql`
      INSERT INTO requirement_evidence_maps (
        id, job_requirement_id, evidence_id, classification, explanation,
        created_by, user_confirmed, created_at, updated_at
      ) VALUES (
        ${'map-api-1'}, ${'req-api-1'}, ${evidence.id}, ${'direct'}, ${'Confirmed matching API evidence'},
        ${'deterministic'}, ${0}, ${now}, ${now}
      );
    `);

    const lifecycle = new ApplicationLifecycleBackend(status.databasePath, status.sqliteBinaryPath);
    await lifecycle.initialize();
    await lifecycle.createEvent('app-one', {
      kind: 'interview',
      title: 'Technical interview',
      eventAt: '2026-10-04T15:00:00.000Z',
      reminderAt: null,
      notes: '',
    });

    const insights = new ApplicationInsightsBackend(status.databasePath, status.sqliteBinaryPath);
    await insights.initialize();
    const assigned = await insights.setTargetTrack('app-one', track.id);
    assert.equal(assigned.targetTrackId, track.id);
    assert.equal(assigned.targetTrackName, 'Platform roles');

    const offer = await insights.saveOffer('app-one', {
      status: 'active',
      basePay: 145000,
      payBasis: 'annual',
      currency: 'USD',
      bonusNotes: '10% target',
      negotiationNotes: 'Clarify remote policy.',
    });
    assert.equal(offer.basePay, 145000);
    assert.equal(offer.negotiationNotes, 'Clarify remote policy.');

    const snapshot = await insights.getSearchLearning();
    assert.equal(snapshot.totals.tracked, 3);
    assert.equal(snapshot.totals.interviews, 1);
    assert.equal(snapshot.totals.offers, 1, 'structured offer state should count as observed offer activity');
    assert.equal(snapshot.totals.applied, 1, 'applied count is intentionally current status, not reconstructed history');

    const pythonGap = snapshot.repeatedGaps.find((gap) => gap.label.toLowerCase() === 'python');
    assert.ok(pythonGap, 'repeated unsupported Python requirement should be surfaced');
    assert.equal(pythonGap.applicationCount, 3);
    assert.equal(
      snapshot.repeatedGaps.some((gap) => /typescript apis/i.test(gap.label)),
      false,
      'directly supported requirement must not be reported as a gap',
    );
    assert.ok(snapshot.strategySignals.some((signal) => signal.kind === 'recurring-gap'));
    assert.ok(snapshot.strategySignals.every((signal) => /not proof of causation/i.test(signal.caveat)));

    const trackGroup = snapshot.outcomeGroups.find(
      (group) => group.dimension === 'target-track' && group.key === track.id,
    );
    assert.ok(trackGroup);
    assert.equal(trackGroup.tracked, 1);
    assert.ok(
      snapshot.outcomeGroups.some(
        (group) => group.dimension === 'target-track' && group.key === 'unassigned' && group.tracked === 2,
      ),
      'applications without explicit track assignment must remain visibly unassigned',
    );
    assert.ok(snapshot.outcomeGroups.some((group) => group.dimension === 'source-class' && group.label === 'Structured ATS'));
    assert.ok(snapshot.outcomeGroups.some((group) => group.dimension === 'opportunity-category' && group.label === 'Contract'));

    const restarted = new ApplicationInsightsBackend(status.databasePath, status.sqliteBinaryPath);
    await restarted.initialize();
    const detailAfterRestart = await restarted.getApplicationDetail('app-one');
    assert.equal(detailAfterRestart.searchContext.targetTrackId, track.id);
    assert.equal(detailAfterRestart.offer?.basePay, 145000);

    await career.deleteApplication('app-one');
    const remainingOffer = await sqlite.queryOne("SELECT application_id FROM application_offers WHERE application_id = 'app-one';");
    const remainingContext = await sqlite.queryOne("SELECT application_id FROM application_search_context WHERE application_id = 'app-one';");
    assert.equal(remainingOffer, null, 'offer state should cascade with the application');
    assert.equal(remainingContext, null, 'search context should cascade with the application');

    await backend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
