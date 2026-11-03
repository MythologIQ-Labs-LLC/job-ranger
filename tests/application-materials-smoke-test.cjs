const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { EvidenceExtensionBackend } = require('../electron-runtime/electron/src/evidence-extension-backend.cjs');
const { ApplicationMaterialsBackend } = require('../electron-runtime/electron/src/application-materials-backend.cjs');
const { SqliteClient, sql } = require('../electron-runtime/electron/src/sqlite.cjs');

const now = '2026-10-03T03:20:00.000Z';
const applicationId = 'application-materials-smoke';

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-materials-'));
  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => { throw new Error('application material smoke test must not use the network'); },
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

    await sqlite.transaction([
      sql`
        INSERT INTO companies (
          id, name, url, source_type, source_identifier, frequency_minutes, is_active,
          last_run_at, last_run_status, last_error_message, consecutive_failures,
          circuit_open_until, created_at, updated_at
        ) VALUES (
          ${7300}, ${'Application Materials Employer'}, ${'https://example.com/careers'},
          ${'generic-html'}, ${null}, ${1440}, ${1}, ${null}, ${'idle'}, ${null},
          ${0}, ${null}, ${now}, ${now}
        );
      `,
      sql`
        INSERT INTO jobs (
          id, company_id, source_job_id, source_type, title, location, employment_type,
          url, description_snippet, salary_min, salary_max, salary_currency, salary_text,
          post_date, created_at, last_seen_at, is_active, is_new, matched_filter_count
        ) VALUES (
          ${7301}, ${7300}, ${'materials-job'}, ${'generic-html'},
          ${'Platform Engineer'}, ${'Remote'}, ${'Full-time'},
          ${'https://example.com/jobs/platform-engineer'},
          ${'Must have built production TypeScript services and APIs. Kubernetes experience preferred. Python required.'},
          ${null}, ${null}, ${null}, ${null}, ${null}, ${now}, ${now}, ${1}, ${1}, ${0}
        );
      `,
    ]);

    await career.saveProfile({
      version: 2,
      fullName: 'Taylor Example',
      homeLocation: '',
      radiusMiles: null,
      minimumPay: null,
      payBasis: 'annual',
      targetTitles: [],
      skills: [],
      certifications: [],
      sectors: [],
      onCallPreference: 'either',
      fullTimeOnly: false,
    });

    await career.migrateLegacy({
      profile: null,
      applications: [{
        id: applicationId,
        jobId: '7301',
        title: 'Platform Engineer',
        companyName: 'Application Materials Employer',
        url: 'https://example.com/jobs/platform-engineer',
        status: 'interested',
        notes: '',
        createdAt: now,
        updatedAt: now,
      }],
    });

    const submittedEvidence = await career.createUserEvidence({
      subjectType: 'achievement',
      statement: 'Built production TypeScript services and APIs for customer-facing systems.',
      titleOrName: 'Platform delivery',
      organization: 'Example Labs',
      skills: ['TypeScript', 'APIs'],
    });
    await career.createUserEvidence({
      subjectType: 'skill',
      statement: 'Operated Kubernetes workloads in production environments.',
      titleOrName: 'Kubernetes',
      organization: 'Example Labs',
      skills: ['Kubernetes'],
    });

    const materials = new ApplicationMaterialsBackend({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await materials.initialize();

    const first = await materials.createCoverLetter(applicationId);
    assert.equal(first.projection.kind, 'cover-letter');
    assert.equal(first.projection.version, 1);
    assert.ok(first.projection.selectedEvidenceIds.includes(submittedEvidence.id));
    assert.ok(
      first.projection.sections.some(
        (section) =>
          section.evidenceIds.includes(submittedEvidence.id) &&
          section.evidenceUpdatedAtById[submittedEvidence.id] === submittedEvidence.updatedAt &&
          /TypeScript services and APIs/.test(section.text),
      ),
      'factual cover-letter paragraph should snapshot and link confirmed evidence',
    );
    assert.ok(
      first.warnings.some((warning) => /unsupported or ambiguous/i.test(warning)),
      'known job gaps must remain visible instead of being claimed away',
    );

    const second = await materials.createCoverLetter(applicationId);
    assert.equal(second.projection.version, 2, 'new drafts should preserve version history');

    await career.reviewEvidence(submittedEvidence.id, {
      action: 'edit',
      statement: 'Built production TypeScript APIs for internal systems.',
      subjectType: 'achievement',
    });
    const afterEdit = await materials.list(applicationId);
    assert.ok(
      afterEdit.every((item) => item.staleEvidenceIds.includes(submittedEvidence.id)),
      'historical materials must become stale after an in-place factual evidence edit',
    );

    const extensions = new EvidenceExtensionBackend({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await extensions.supersedeEvidence(submittedEvidence.id, {
      subjectType: 'achievement',
      statement: 'Built and maintained production TypeScript APIs for internal systems.',
    });

    const afterCorrection = await materials.list(applicationId);
    const firstAfterCorrection = afterCorrection.find((item) => item.version === 1);
    assert.ok(firstAfterCorrection);
    assert.ok(
      firstAfterCorrection.staleEvidenceIds.includes(submittedEvidence.id),
      'old material must remain visibly stale when supporting evidence is superseded',
    );

    const restarted = new ApplicationMaterialsBackend({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await restarted.initialize();
    const afterRestart = await restarted.list(applicationId);
    assert.equal(afterRestart.length, 2, 'material versions must persist across restart');
    assert.ok(afterRestart.some((item) => item.staleEvidenceIds.includes(submittedEvidence.id)));

    await career.deleteApplication(applicationId);
    const remaining = await sqlite.queryOne(
      "SELECT COUNT(*) AS count FROM application_materials;",
    );
    assert.equal(remaining?.count, 0, 'application deletion should cascade prepared materials');

    await backend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
