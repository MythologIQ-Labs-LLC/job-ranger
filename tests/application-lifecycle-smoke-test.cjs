const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { ApplicationLifecycleBackend } = require('../electron-runtime/electron/src/application-lifecycle-backend.cjs');
const { SqliteClient, sql } = require('../electron-runtime/electron/src/sqlite.cjs');

const application = {
  id: 'application-lifecycle-test',
  jobId: 'job-lifecycle-test',
  title: 'Program Manager',
  companyName: 'Example Company',
  url: 'https://example.com/jobs/program-manager',
  status: 'applied',
  notes: '',
  createdAt: '2026-10-03T01:00:00.000Z',
  updatedAt: '2026-10-03T01:00:00.000Z',
};

async function open(tempDir) {
  const backend = new SojournerBackend({
    dataDirectory: tempDir,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error('application lifecycle smoke test must not use the network');
    },
  });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const career = new CareerBackend({
    dataDirectory: tempDir,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  await career.initialize();
  const lifecycle = new ApplicationLifecycleBackend(
    status.databasePath,
    status.sqliteBinaryPath,
  );
  await lifecycle.initialize();
  const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
  return { backend, career, lifecycle, sqlite };
}

async function seedSubmittedArtifact(sqlite) {
  const projectionId = 'projection-lifecycle-test';
  const artifactId = 'resume-artifact-lifecycle-test';
  const linkId = 'artifact-link-lifecycle-test';
  await sqlite.transaction([
    sql`
      INSERT INTO resume_projections (
        id, job_id, context, page_format, source_projection_id, status,
        sections_json, selected_evidence_ids_json, created_at, updated_at
      ) VALUES (
        ${projectionId}, ${application.jobId}, ${'private-sector'}, ${'letter'},
        ${null}, ${'finalized'}, ${JSON.stringify(['experience'])}, ${JSON.stringify([])},
        ${'2026-10-03T01:10:00.000Z'}, ${'2026-10-03T01:10:00.000Z'}
      );
    `,
    sql`
      INSERT INTO resume_artifacts (
        id, projection_id, version, format, managed_path, content_hash, page_count,
        truth_gate_result, parseability_result, relevance_review_result, created_at
      ) VALUES (
        ${artifactId}, ${projectionId}, ${3}, ${'pdf'}, ${'/tmp/submitted-v3.pdf'},
        ${'sha256-test'}, ${1}, ${null}, ${null}, ${null}, ${'2026-10-03T01:15:00.000Z'}
      );
    `,
    sql`
      INSERT INTO application_artifact_links (
        id, application_id, resume_artifact_id, purpose, recorded_at
      ) VALUES (
        ${linkId}, ${application.id}, ${artifactId}, ${'submitted'}, ${'2026-10-03T01:16:00.000Z'}
      );
    `,
  ]);
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-application-lifecycle-'));
  try {
    let runtime = await open(tempDir);
    await runtime.career.migrateLegacy({ profile: null, applications: [application] });
    await seedSubmittedArtifact(runtime.sqlite);

    const contact = await runtime.lifecycle.createContact(application.id, {
      name: 'Morgan Recruiter',
      role: 'Recruiter',
      email: 'morgan@example.com',
      phone: null,
      notes: 'Primary scheduling contact.',
    });
    assert.equal(contact.applicationId, application.id);

    await assert.rejects(
      () =>
        runtime.lifecycle.createEvent(application.id, {
          kind: 'follow-up',
          title: 'Impossible reminder',
          eventAt: '2026-10-10T15:00:00.000Z',
          reminderAt: '2026-10-10T16:00:00.000Z',
          notes: '',
        }),
      /Reminder time cannot be after the event time/,
    );

    const event = await runtime.lifecycle.createEvent(application.id, {
      kind: 'interview',
      title: 'Panel interview',
      eventAt: '2026-10-10T15:00:00.000Z',
      reminderAt: '2026-10-10T13:00:00.000Z',
      notes: 'Bring portfolio examples.',
    });
    assert.equal(event.completedAt, null);

    await assert.rejects(
      () => runtime.lifecycle.updateEvent(event.id, { reminderAt: '2026-10-10T17:00:00.000Z' }),
      /Reminder time cannot be after the event time/,
    );

    let detail = await runtime.lifecycle.getLifecycle(application.id);
    assert.equal(detail.contacts.length, 1);
    assert.equal(detail.events.length, 1);
    assert.equal(detail.events[0].reminderAt, '2026-10-10T13:00:00.000Z');
    assert.equal(detail.artifacts.length, 1);
    assert.equal(detail.artifacts[0].purpose, 'submitted');
    assert.equal(detail.artifacts[0].version, 3);
    assert.equal(detail.artifacts[0].managedPath, '/tmp/submitted-v3.pdf');

    await runtime.lifecycle.updateEvent(event.id, {
      completedAt: '2026-10-10T16:00:00.000Z',
    });
    detail = await runtime.lifecycle.getLifecycle(application.id);
    assert.equal(detail.events[0].completedAt, '2026-10-10T16:00:00.000Z');

    await runtime.backend.dispose();
    runtime = await open(tempDir);

    detail = await runtime.lifecycle.getLifecycle(application.id);
    assert.equal(detail.contacts[0].name, 'Morgan Recruiter', 'contact must survive restart');
    assert.equal(detail.events[0].title, 'Panel interview', 'event must survive restart');
    assert.equal(detail.events[0].completedAt, '2026-10-10T16:00:00.000Z');
    assert.equal(detail.artifacts[0].resumeArtifactId, 'resume-artifact-lifecycle-test');

    const migration = await runtime.sqlite.queryOne(sql`
      SELECT version, name FROM schema_migrations WHERE version = ${1001} LIMIT 1;
    `);
    assert.equal(migration?.name, 'application_lifecycle_foundation');

    await runtime.career.deleteApplication(application.id);
    await assert.rejects(
      () => runtime.lifecycle.getLifecycle(application.id),
      /not found/,
      'deleted applications must not retain a readable lifecycle',
    );
    const orphanContacts = await runtime.sqlite.queryAll(
      "SELECT id FROM application_contacts WHERE application_id = 'application-lifecycle-test';",
    );
    const orphanEvents = await runtime.sqlite.queryAll(
      "SELECT id FROM application_events WHERE application_id = 'application-lifecycle-test';",
    );
    const orphanLinks = await runtime.sqlite.queryAll(
      "SELECT id FROM application_artifact_links WHERE application_id = 'application-lifecycle-test';",
    );
    assert.equal(orphanContacts.length, 0, 'contacts must cascade with application deletion');
    assert.equal(orphanEvents.length, 0, 'events must cascade with application deletion');
    assert.equal(orphanLinks.length, 0, 'artifact links must cascade with application deletion');

    await runtime.backend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
