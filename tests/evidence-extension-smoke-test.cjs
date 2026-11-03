const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { EvidenceExtensionBackend } = require('../electron-runtime/electron/src/evidence-extension-backend.cjs');
const {
  buildJobEvidenceCoverage,
  extractJobRequirements,
} = require('../electron-runtime/electron/src/requirement-mapper.cjs');

async function open(tempDir) {
  const backend = new SojournerBackend({
    dataDirectory: tempDir,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error('evidence extension smoke test must not use the network');
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
  const extensions = new EvidenceExtensionBackend({
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  return { backend, career, extensions };
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-evidence-extension-'));
  try {
    let runtime = await open(tempDir);
    const original = await runtime.career.createUserEvidence({
      subjectType: 'project',
      statement: 'Built TypeScript APIs for a public deployment tool.',
      organization: 'Open Source Community',
      titleOrName: 'Deployment tool',
      skills: ['TypeScript', 'APIs'],
    });

    const references = await runtime.extensions.setReferences(original.id, [
      { kind: 'url', label: 'Repository', value: 'https://example.com/deployment-tool' },
      { kind: 'local', label: 'Demo notes', value: 'Portfolio/deployment-demo.md' },
    ]);
    assert.equal(references.length, 2);
    assert.equal(references[0].evidenceId, original.id);

    const replacement = await runtime.extensions.supersedeEvidence(original.id, {
      subjectType: 'project',
      statement: 'Built and maintained TypeScript APIs for a public deployment tool.',
    });
    assert.notEqual(replacement.id, original.id);
    assert.equal(replacement.verificationState, 'user-authored');

    const listed = await runtime.career.listEvidence();
    const retired = listed.find(({ evidence }) => evidence.id === original.id)?.evidence;
    assert.equal(retired?.verificationState, 'rejected', 'superseded predecessor must be non-authoritative');

    const metadata = await runtime.extensions.listMetadata();
    const oldMetadata = metadata.find((entry) => entry.evidenceId === original.id);
    const newMetadata = metadata.find((entry) => entry.evidenceId === replacement.id);
    assert.equal(newMetadata?.references.length, 2, 'references should follow the replacement fact');
    assert.ok(
      oldMetadata?.lineage.some(
        (entry) =>
          entry.predecessorEvidenceId === original.id &&
          entry.successorEvidenceId === replacement.id &&
          entry.relation === 'supersedes',
      ),
      'predecessor must retain explicit supersede lineage',
    );
    assert.ok(
      newMetadata?.lineage.some((entry) => entry.predecessorEvidenceId === original.id),
      'successor must expose the same lineage edge',
    );

    const job = {
      id: 'replacement-job',
      title: 'Platform Engineer',
      descriptionSnippet: 'Must build and maintain TypeScript APIs.',
      location: 'Remote',
      employmentType: 'Full-time',
    };
    const requirements = extractJobRequirements(job, '2026-10-03T00:00:00.000Z');
    const allEvidence = listed.map(({ evidence }) => evidence);
    const coverage = buildJobEvidenceCoverage(
      job.id,
      requirements,
      allEvidence,
      '2026-10-03T00:00:00.000Z',
    );
    assert.ok(
      coverage.items.some((item) => item.evidence?.id === replacement.id),
      'current replacement should participate in deterministic matching',
    );
    assert.ok(
      coverage.items.every((item) => item.evidence?.id !== original.id),
      'retired predecessor must not continue supporting requirements',
    );

    await runtime.backend.dispose();
    runtime = await open(tempDir);
    const afterRestart = await runtime.extensions.listMetadata();
    const persistedReplacement = afterRestart.find((entry) => entry.evidenceId === replacement.id);
    assert.equal(persistedReplacement?.references.length, 2, 'references must survive restart');
    assert.ok(
      persistedReplacement?.lineage.some((entry) => entry.predecessorEvidenceId === original.id),
      'lineage must survive restart',
    );
    await runtime.backend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
