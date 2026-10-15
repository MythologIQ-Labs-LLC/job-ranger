const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { JobScoutBackend } = require('../electron/backend.cjs');
const { CareerBackend } = require('../electron/career-backend.cjs');
const { RequirementBackend } = require('../electron-runtime/electron/src/requirement-backend.cjs');
const { RequirementRepository } = require('../electron-runtime/electron/src/requirement-repository.cjs');
const { SqliteClient } = require('../electron/sqlite.cjs');

function createMockFetch() {
  return async (url) => {
    if (String(url).includes('boards-api.greenhouse.io/v1/boards/evidence/jobs')) {
      return new Response(
        JSON.stringify({
          jobs: [
            {
              id: 6201,
              title: 'Administrative Coordinator',
              location: { name: 'Annapolis, MD' },
              absolute_url: 'https://boards.greenhouse.io/evidence/jobs/6201',
              content: [
                '<p>Must coordinate vendor schedules and maintain office records.</p>',
                '<p>Scheduling experience required. Project management certification preferred.</p>',
              ].join(''),
              updated_at: '2026-09-25T12:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected fetch URL in requirement coverage test: ${url}`);
  };
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-ranger-requirements-'));

  try {
    const jobs = new JobScoutBackend({
      dataDirectory: tempDir,
      fetchImpl: createMockFetch(),
      schedulerEnabled: false,
    });
    await jobs.initialize();

    const company = await jobs.createCompany({
      name: 'Evidence Employer',
      url: 'https://boards.greenhouse.io/evidence',
      frequencyMinutes: 1440,
      isActive: true,
    });
    const scrape = await jobs.runCompanyScrape(company.id);
    assert.equal(scrape.status, 'success');

    const [job] = await jobs.listJobs();
    assert.ok(job, 'fixture job should exist');

    const status = await jobs.getSystemStatus(process.platform);
    const career = new CareerBackend({
      dataDirectory: tempDir,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await career.initialize();

    const imported = await career.importPastedText({
      label: 'Administrative resume',
      text: [
        '# Professional Experience',
        '- Coordinated vendor schedules and maintained administrative records for a regional office.',
        '# Skills',
        '- Scheduling',
      ].join('\n'),
    });
    assert.ok(imported.proposedEvidence.length > 0, 'resume text should produce evidence proposals');

    const support = imported.proposedEvidence.find((item) =>
      item.statement.toLowerCase().includes('vendor schedules'),
    ) ?? imported.proposedEvidence[0];
    await career.reviewEvidence(support.id, { action: 'confirm' });

    const requirements = new RequirementBackend({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    const coverage = await requirements.getJobEvidenceCoverage(job.id);

    assert.ok(coverage.totalCount > 0, 'job text should normalize durable requirements');
    assert.ok(
      coverage.items.some((item) => item.requirement.sourceText.length > 0),
      'every requirement should retain source listing text',
    );
    assert.ok(
      coverage.items.some((item) =>
        item.mapping.classification === 'direct' ||
        item.mapping.classification === 'transferable',
      ),
      'confirmed Career Evidence should support at least one requirement',
    );
    assert.ok(
      coverage.items
        .filter((item) => item.mapping.classification === 'gap')
        .every((item) => item.mapping.evidenceId === null),
      'gaps must not point at fabricated support',
    );

    const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
    const storedRequirements = await sqlite.queryAll(
      `SELECT id, job_id, source_text FROM job_requirements WHERE job_id = '${job.id}' ORDER BY id;`,
    );
    const storedMappings = await sqlite.queryAll(
      `SELECT classification, evidence_id, user_confirmed FROM requirement_evidence_maps WHERE job_requirement_id IN (SELECT id FROM job_requirements WHERE job_id = '${job.id}');`,
    );
    assert.equal(storedRequirements.length, coverage.totalCount);
    assert.equal(storedMappings.length, coverage.totalCount);
    assert.ok(storedRequirements.every((row) => row.source_text));

    // The Resume page loads coverage while a tailoring preview recomputes it for
    // the same job. Each recompute rewrites rows with deterministic ids, so the
    // rewrite must be one transaction: a separate delete followed by per-row
    // inserts let overlapping callers fail with UNIQUE or FOREIGN KEY errors.
    const recorded = [];
    const recordingRepository = new RequirementRepository({
      exec: async (statement) => { recorded.push({ kind: 'exec', statement }); },
      transaction: async (statements) => { recorded.push({ kind: 'transaction', statements }); },
      queryAll: async () => [],
      queryOne: async () => null,
    });
    await recordingRepository.replaceCoverage(coverage, null);
    assert.deepEqual(recorded.map((call) => call.kind), ['transaction']);
    assert.equal(recorded[0].statements.length, 2 + coverage.totalCount * 2);
    assert.match(recorded[0].statements[0], /DELETE FROM requirement_evidence_maps/);
    assert.match(recorded[0].statements[1], /DELETE FROM job_requirements/);

    const overlapping = await Promise.allSettled(
      Array.from({ length: 4 }, () => requirements.getJobEvidenceCoverage(job.id)),
    );
    assert.deepEqual(
      overlapping.filter((result) => result.status === 'rejected').map((result) => result.reason.message),
      [],
      'overlapping coverage recomputes for one job must all succeed',
    );
    const storedCoverage = async () => ({
      requirements: (await sqlite.queryAll(
        `SELECT id FROM job_requirements WHERE job_id = '${job.id}' ORDER BY id;`,
      )).map((row) => row.id),
      mappings: (await sqlite.queryAll(
        `SELECT m.id FROM requirement_evidence_maps m JOIN job_requirements r ON r.id = m.job_requirement_id WHERE r.job_id = '${job.id}' ORDER BY m.id;`,
      )).map((row) => row.id),
      orphans: (await sqlite.queryOne(
        'SELECT COUNT(*) AS n FROM requirement_evidence_maps WHERE job_requirement_id NOT IN (SELECT id FROM job_requirements);',
      )).n,
    });
    const expectedCoverage = {
      requirements: coverage.items.map((item) => item.requirement.id).sort(),
      mappings: coverage.items.map((item) => item.mapping.id).sort(),
      orphans: 0,
    };
    // Content-derived ids stay stable across recomputes, with exactly one copy and no orphans.
    assert.deepEqual(await storedCoverage(), expectedCoverage);

    // A replacement that fails part-way rolls back completely: the deletes and the
    // earlier inserts of the failed attempt must not persist.
    const repository = new RequirementRepository(sqlite);
    const duplicateLast = { ...coverage, items: [...coverage.items, coverage.items[coverage.items.length - 1]] };
    await assert.rejects(repository.replaceCoverage(duplicateLast, null), /UNIQUE constraint failed/);
    assert.deepEqual(await storedCoverage(), expectedCoverage, 'a failed replacement must leave the previous coverage intact');

    // Requirement text taken from listings can carry control characters; they must
    // round-trip exactly through the transaction on every engine.
    const tricky = 'Line one\r\nline\u001atwo\u0000three\tfour\u007f';
    const [first, ...rest] = coverage.items;
    await repository.replaceCoverage({
      ...coverage,
      items: [{ ...first, requirement: { ...first.requirement, sourceText: tricky } }, ...rest],
    }, null);
    const storedText = await sqlite.queryOne(
      `SELECT hex(source_text) AS h FROM job_requirements WHERE id = '${first.requirement.id}';`,
    );
    assert.equal(storedText.h, Buffer.from(tricky).toString('hex').toUpperCase());
    await requirements.getJobEvidenceCoverage(job.id);
    assert.deepEqual(await storedCoverage(), expectedCoverage);

    const restarted = new RequirementBackend({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    const afterRestart = await restarted.getJobEvidenceCoverage(job.id);
    assert.equal(afterRestart.totalCount, coverage.totalCount);

    await jobs.dispose();
    console.log('requirement coverage smoke test passed');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
