const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { EvidenceExtensionBackend } = require('../electron-runtime/electron/src/evidence-extension-backend.cjs');
const { InterviewPrepBackend } = require('../electron-runtime/electron/src/interview-prep-backend.cjs');
const { SqliteClient, sql } = require('../electron-runtime/electron/src/sqlite.cjs');

const now = '2026-10-03T02:10:00.000Z';
const jobId = '7101';
const applicationId = 'application-interview-prep';

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-interview-prep-'));
  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => { throw new Error('interview prep smoke test must not use the network'); },
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
    const extensions = new EvidenceExtensionBackend({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });

    await sqlite.transaction([
      sql`
        INSERT INTO companies (
          id, name, url, source_type, source_identifier, frequency_minutes, is_active,
          last_run_at, last_run_status, last_error_message, consecutive_failures,
          circuit_open_until, created_at, updated_at
        ) VALUES (
          ${7100}, ${'Interview Prep Employer'}, ${'https://example.com/careers'},
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
          ${7101}, ${7100}, ${'interview-prep-job'}, ${'generic-html'},
          ${'AI Product Engineer'}, ${'Remote'}, ${'Full-time'},
          ${'https://example.com/jobs/ai-product-engineer'},
          ${'Must have built production TypeScript services and APIs. Must have designed AI workflow orchestration for customer-facing products. Python preferred.'},
          ${null}, ${null}, ${null}, ${null}, ${null}, ${now}, ${now}, ${1}, ${1}, ${0}
        );
      `,
    ]);

    await career.migrateLegacy({
      profile: null,
      applications: [{
        id: applicationId,
        jobId,
        title: 'AI Product Engineer',
        companyName: 'Interview Prep Employer',
        url: 'https://example.com/jobs/ai-product-engineer',
        status: 'interview',
        notes: '',
        createdAt: now,
        updatedAt: now,
      }],
    });

    const submittedEvidence = await career.createUserEvidence({
      subjectType: 'achievement',
      statement: 'Built production TypeScript services and APIs.',
      titleOrName: 'TypeScript platform delivery',
      organization: 'Example Labs',
      skills: ['TypeScript', 'APIs'],
    });
    const additionalEvidence = await career.createUserEvidence({
      subjectType: 'achievement',
      statement: 'Designed AI workflow orchestration for customer-facing products.',
      titleOrName: 'AI workflow orchestration',
      organization: 'Example Labs',
      skills: ['AI workflows', 'orchestration'],
    });

    const projectionId = 'resume-projection-interview-prep';
    const artifactId = 'resume-artifact-interview-prep';
    const submittedStatement = {
      id: 'resume-statement-interview-prep',
      projectionId,
      section: 'Experience',
      order: 0,
      text: submittedEvidence.statement,
      evidenceIds: [submittedEvidence.id],
      generationMode: 'deterministic',
      userEdited: false,
    };
    const snapshot = {
      projection: {
        id: projectionId,
        jobId,
        context: 'private-sector',
        pageFormat: 'letter',
        sourceProjectionId: null,
        status: 'finalized',
        sections: ['Experience'],
        selectedEvidenceIds: [submittedEvidence.id],
        templateId: 'ats-standard-v1',
        contact: {
          fullName: 'Taylor Example',
          email: 'taylor@example.com',
          phone: '',
          location: 'Annapolis, MD',
          links: [],
        },
        createdAt: now,
        updatedAt: now,
      },
      statements: [submittedStatement],
    };

    await sqlite.transaction([
      sql`
        INSERT INTO resume_projections (
          id, job_id, context, page_format, source_projection_id, status,
          sections_json, selected_evidence_ids_json, created_at, updated_at
        ) VALUES (
          ${projectionId}, ${jobId}, ${'private-sector'}, ${'letter'}, ${null}, ${'finalized'},
          ${JSON.stringify(['Experience'])}, ${JSON.stringify([submittedEvidence.id])}, ${now}, ${now}
        );
      `,
      sql`
        INSERT INTO resume_artifacts (
          id, projection_id, version, format, managed_path, content_hash, page_count,
          truth_gate_result, parseability_result, relevance_review_result, created_at
        ) VALUES (
          ${artifactId}, ${projectionId}, ${1}, ${'pdf'}, ${'/tmp/submitted-interview-prep.pdf'},
          ${'sha256-interview-prep'}, ${1}, ${null}, ${null}, ${null}, ${now}
        );
      `,
      sql`
        INSERT INTO resume_artifact_snapshots (artifact_id, projection_snapshot_json)
        VALUES (${artifactId}, ${JSON.stringify(snapshot)});
      `,
      sql`
        INSERT INTO application_artifact_links (
          id, application_id, resume_artifact_id, purpose, recorded_at
        ) VALUES (
          ${'application-artifact-interview-prep'}, ${applicationId}, ${artifactId},
          ${'submitted'}, ${now}
        );
      `,
    ]);

    const correctedEvidence = await extensions.supersedeEvidence(submittedEvidence.id, {
      subjectType: 'achievement',
      statement: 'Built and maintained production TypeScript services and APIs.',
    });

    const prepBackend = new InterviewPrepBackend({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    const prep = await prepBackend.get(applicationId);

    assert.equal(prep.application.title, 'AI Product Engineer');
    assert.equal(prep.submittedResume?.artifactId, artifactId);
    assert.equal(prep.submittedResume?.version, 1);

    const changedSubmittedSupport = prep.requirements.find(
      (item) => item.evidenceId === correctedEvidence.id,
    );
    assert.ok(
      changedSubmittedSupport,
      'current successor evidence should support the requirement after the submitted evidence is superseded',
    );
    assert.equal(changedSubmittedSupport.evidenceWasSubmitted, false);
    assert.equal(changedSubmittedSupport.submissionRelation, 'superseded');
    assert.equal(changedSubmittedSupport.evidenceStatement, correctedEvidence.statement);
    assert.deepEqual(changedSubmittedSupport.submittedStatementTexts, [submittedEvidence.statement]);
    assert.match(changedSubmittedSupport.preparationPrompt, /earlier evidence-linked claim/i);
    assert.match(changedSubmittedSupport.preparationPrompt, /current confirmed record has since changed/i);
    assert.ok(
      prep.suggestedQuestions.some((question) => /claim changed since you submitted/i.test(question)),
      'changed submitted evidence should add an explicit correction-preparation question',
    );

    const extraSupport = prep.requirements.find(
      (item) => item.evidenceId === additionalEvidence.id,
    );
    assert.ok(extraSupport, 'confirmed non-submitted evidence should remain available for preparation');
    assert.equal(extraSupport.evidenceWasSubmitted, false);
    assert.equal(extraSupport.submissionRelation, 'none');
    assert.equal(extraSupport.submittedStatementTexts.length, 0);
    assert.match(extraSupport.preparationPrompt, /not in the submitted resume|not on the submitted resume/i);
    assert.match(extraSupport.preparationPrompt, /additional context/i);

    assert.ok(
      prep.requirements.some((item) => item.classification === 'gap' || item.classification === 'ambiguous'),
      'unsupported or uncertain requirements should remain visible for honest gap preparation',
    );
    assert.ok(prep.suggestedQuestions.length >= 3);

    await sqlite.exec(sql`
      DELETE FROM application_artifact_links WHERE application_id = ${applicationId};
    `);
    const withoutArtifact = await prepBackend.get(applicationId);
    assert.equal(withoutArtifact.submittedResume, null);
    assert.ok(
      withoutArtifact.warnings.some((warning) => /No exact submitted resume/i.test(warning)),
      'missing submitted artifact must be visible instead of guessed',
    );

    await sqlite.exec(sql`DELETE FROM jobs WHERE id = ${7101};`);
    const withoutJob = await prepBackend.get(applicationId);
    assert.equal(withoutJob.job, null);
    assert.equal(withoutJob.requirements.length, 0);
    assert.ok(
      withoutJob.warnings.some((warning) => /original tracked job record is no longer available/i.test(warning)),
      'missing job context must be explicit',
    );

    await backend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
