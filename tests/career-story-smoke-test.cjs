const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { CareerStoryBackend } = require('../electron-runtime/electron/src/career-story-backend.cjs');
const { EvidenceExtensionBackend } = require('../electron-runtime/electron/src/evidence-extension-backend.cjs');
const { SqliteClient, sql } = require('../electron-runtime/electron/src/sqlite.cjs');

async function open(tempDir) {
  const backend = new SojournerBackend({
    dataDirectory: tempDir,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error('career story smoke test must not use the network');
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
  const stories = new CareerStoryBackend({
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  await stories.initialize();
  const extensions = new EvidenceExtensionBackend({
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
  return { backend, career, stories, extensions, sqlite };
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-career-story-'));
  try {
    let runtime = await open(tempDir);
    const first = await runtime.career.createUserEvidence({
      subjectType: 'achievement',
      statement: 'Built a cross-functional customer operating cadence.',
      titleOrName: 'Customer operating cadence',
      organization: 'Example Company',
      skills: ['Customer Success', 'Program Management'],
    });
    const second = await runtime.career.createUserEvidence({
      subjectType: 'achievement',
      statement: 'Reduced unresolved handoffs by clarifying ownership and escalation paths.',
      titleOrName: 'Escalation ownership',
      organization: 'Example Company',
      skills: ['Operations'],
    });

    const created = await runtime.stories.createStory({
      title: 'Stabilizing a customer program',
      tags: ['leadership', 'customer success'],
      situation: 'A strategic customer program had inconsistent handoffs.',
      challenge: 'Ownership was unclear across several teams.',
      action: 'Built an operating cadence and clarified escalation ownership.',
      result: 'The program gained a repeatable operating rhythm.',
      reflection: 'Clear ownership matters more than adding more meetings.',
      evidenceIds: [first.id, second.id],
    });
    assert.equal(created.evidence.length, 2);
    assert.equal(created.staleEvidenceIds.length, 0);

    const migration = await runtime.sqlite.queryOne(sql`
      SELECT version, name FROM schema_migrations WHERE version = ${1002} LIMIT 1;
    `);
    assert.equal(migration?.name, 'career_story_projections');

    await runtime.backend.dispose();
    runtime = await open(tempDir);
    let listed = await runtime.stories.listStories();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].title, 'Stabilizing a customer program');
    assert.deepEqual(
      listed[0].evidence.map((item) => item.evidenceId),
      [first.id, second.id],
      'evidence links must survive restart in explicit order',
    );

    const replacement = await runtime.extensions.supersedeEvidence(first.id, {
      subjectType: 'achievement',
      statement: 'Built and maintained a cross-functional customer operating cadence.',
    });

    listed = await runtime.stories.listStories();
    const staleStory = listed[0];
    assert.deepEqual(staleStory.staleEvidenceIds, [first.id]);
    const staleLink = staleStory.evidence.find((item) => item.evidenceId === first.id);
    assert.equal(staleLink?.stale, true);
    assert.deepEqual(staleLink?.replacementEvidenceIds, [replacement.id]);
    assert.ok(
      staleStory.evidence.some((item) => item.evidenceId === first.id),
      'story must preserve the original link until the user explicitly edits it',
    );
    assert.ok(
      staleStory.evidence.every((item) => item.evidenceId !== replacement.id),
      'replacement evidence must not be silently linked',
    );

    await assert.rejects(
      () => runtime.stories.createStory({
        title: 'Invalid stale story',
        tags: [],
        situation: '',
        challenge: '',
        action: '',
        result: '',
        reflection: '',
        evidenceIds: [first.id],
      }),
      /current user-confirmed or user-authored/i,
      'new stories cannot be saved against rejected/superseded evidence',
    );

    const repaired = await runtime.stories.updateStory(staleStory.id, {
      title: staleStory.title,
      tags: staleStory.tags,
      situation: staleStory.situation,
      challenge: staleStory.challenge,
      action: staleStory.action,
      result: staleStory.result,
      reflection: staleStory.reflection,
      evidenceIds: [replacement.id, second.id],
    });
    assert.equal(repaired.staleEvidenceIds.length, 0);
    assert.deepEqual(
      repaired.evidence.map((item) => item.evidenceId),
      [replacement.id, second.id],
    );

    await runtime.stories.deleteStory(repaired.id);
    assert.equal((await runtime.stories.listStories()).length, 0);
    const survivingEvidence = await runtime.sqlite.queryAll(sql`
      SELECT id FROM candidate_evidence WHERE id IN (${replacement.id}, ${second.id});
    `);
    assert.equal(survivingEvidence.length, 2, 'deleting a story must never delete Career Evidence');
    const orphanLinks = await runtime.sqlite.queryAll(
      "SELECT story_id FROM career_story_evidence_links;",
    );
    assert.equal(orphanLinks.length, 0, 'story evidence links must cascade with story deletion');

    await runtime.backend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
