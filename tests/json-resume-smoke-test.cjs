const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { JsonResumeAdapter } = require('../electron-runtime/electron/src/json-resume-adapter.cjs');

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-json-resume-'));
  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => { throw new Error('JSON Resume smoke test must not use the network'); },
    });
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    const career = new CareerBackend({
      dataDirectory: tempDir,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await career.initialize();
    await career.saveProfile({
      version: 2,
      fullName: 'Existing Profile Name',
      homeLocation: 'Baltimore, MD',
      radiusMiles: 30,
      minimumPay: null,
      payBasis: 'annual',
      targetTitles: [],
      skills: [],
      certifications: [],
      sectors: [],
      onCallPreference: 'either',
      fullTimeOnly: false,
    });

    const sourcePath = path.join(tempDir, 'incoming-resume.json');
    await fs.writeFile(sourcePath, JSON.stringify({
      basics: { name: 'Imported Name', location: { city: 'Annapolis', region: 'MD' } },
      work: [{
        name: 'Harbor Health',
        position: 'Registered Nurse',
        startDate: '2022-01',
        endDate: '2026-09',
        summary: 'Provided acute-care nursing support.',
        highlights: ['Coordinated discharge planning with multidisciplinary teams.'],
      }],
      education: [{ institution: 'State University', area: 'Nursing', studyType: 'BSN', endDate: '2021' }],
      skills: [{ name: 'Clinical care', keywords: ['patient assessment', 'care coordination'] }],
      certificates: [{ name: 'Registered Nurse', issuer: 'Maryland Board of Nursing', date: '2022-01' }],
      projects: [{ name: 'Quality Improvement', description: 'Reduced discharge handoff errors.', highlights: ['Standardized discharge checklist.'] }],
      volunteer: [{ organization: 'Community Clinic', position: 'Volunteer' }],
    }, null, 2));

    const adapter = new JsonResumeAdapter({
      dataDirectory: tempDir,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    const imported = await adapter.importFile(sourcePath);
    assert.equal(imported.duplicate, false);
    assert.equal(imported.profileNameProposal, 'Imported Name');
    assert.ok(imported.proposedEvidence.length >= 6);
    assert.ok(imported.proposedEvidence.every((item) => item.verificationState === 'imported'));
    assert.ok(imported.warnings.some((warning) => /volunteer/i.test(warning)));

    const profileAfterImport = await career.getProfile();
    assert.equal(profileAfterImport.fullName, 'Existing Profile Name', 'import must not overwrite Career Profile');

    const duplicate = await adapter.importFile(sourcePath);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.artifact.id, imported.artifact.id);

    const role = imported.proposedEvidence.find((item) => item.subjectType === 'role');
    const skill = imported.proposedEvidence.find((item) => item.subjectType === 'skill');
    const credential = imported.proposedEvidence.find((item) => item.subjectType === 'credential');
    const project = imported.proposedEvidence.find((item) => item.subjectType === 'project');
    assert.ok(role && skill && credential && project);
    for (const item of [role, skill, credential, project]) {
      await career.reviewEvidence(item.id, { action: 'confirm' });
    }

    await career.createUserEvidence({
      subjectType: 'other',
      statement: 'Prefers a compressed workweek when available.',
    });

    const exportPath = path.join(tempDir, 'outgoing-resume.json');
    const exported = await adapter.exportFile(exportPath);
    assert.equal(exported.exportedEvidenceCount, 4);
    assert.equal(exported.omittedEvidenceCount, 1, 'non-standard current evidence should be explicitly omitted');
    assert.ok(exported.warnings.some((warning) => /omitted/i.test(warning)));

    const document = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    assert.equal(document.basics.name, 'Existing Profile Name');
    assert.equal(document.work.length, 1);
    assert.equal(document.work[0].position, 'Registered Nurse');
    assert.equal(document.skills.length, 1);
    assert.equal(document.certificates[0].name, 'Registered Nurse');
    assert.equal(document.projects[0].name, 'Quality Improvement');
    assert.equal(document.meta.canonical, 'https://jsonresume.org/schema/');
    assert.equal(document.meta.version, undefined, 'adapter must not claim a JSON Resume schema version it does not own');

    const pending = (await career.listEvidence()).filter(
      (item) => item.evidence.verificationState === 'imported',
    );
    assert.ok(pending.length > 0, 'unconfirmed imported evidence should remain candidate evidence');

    await backend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
