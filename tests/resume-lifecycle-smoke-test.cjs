const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { CareerEvidenceRepository } = require("../electron-runtime/electron/src/career-evidence-repository.cjs");
const { ResumeRepository } = require("../electron-runtime/electron/src/resume-repository.cjs");
const { ResumeService } = require("../electron-runtime/electron/src/resume-service.cjs");
const { SqliteClient, sql } = require("../electron-runtime/electron/src/sqlite.cjs");

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-resume-"));

  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => {
        throw new Error("Resume lifecycle smoke test must not use the network");
      },
    });
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
    const evidenceRepository = new CareerEvidenceRepository(sqlite);
    const resumeRepository = new ResumeRepository(sqlite);
    const resumeService = new ResumeService({
      dataDirectory: tempDir,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await resumeService.initialize();

    const migrations = await sqlite.queryAll(
      "SELECT version, name FROM schema_migrations ORDER BY version ASC;",
    );
    assert.equal(
      migrations.some(
        (row) => row.version === 5 && row.name === "resume_lifecycle_metadata",
      ),
      true,
      "R3 resume lifecycle migration must be applied",
    );

    const now = new Date().toISOString();
    const source = await evidenceRepository.createSourceArtifact({
      id: "source-r3-smoke",
      kind: "resume",
      originalName: "synthetic-resume.txt",
      mediaType: "text/plain",
      detectedFormat: "txt",
      contentHash: "a".repeat(64),
      managedPath: path.join(tempDir, "artifacts", "synthetic-resume.txt"),
      byteSize: 128,
      importedAt: now,
      parserId: "sojourner-text",
      parserVersion: "1",
      extractionState: "extracted",
      warnings: [],
    });
    const snapshot = await evidenceRepository.createExtractionSnapshot({
      id: "snapshot-r3-smoke",
      sourceArtifactId: source.id,
      parserId: "sojourner-text",
      parserVersion: "1",
      rawText: "Coordinated scheduling for regional field teams.",
      structuredPayload: null,
      warnings: [],
      createdAt: now,
    });
    const imported = await evidenceRepository.createEvidenceProposal(
      {
        id: "evidence-r3-smoke",
        subjectType: "achievement",
        organization: "Northstar Distribution",
        titleOrName: "Operations Coordinator",
        startDate: "2022-01",
        endDate: null,
        statement: "Coordinated scheduling for regional field teams.",
        action: "Coordinated",
        context: "Regional field teams",
        skills: ["Scheduling"],
        methodsOrTools: [],
        scope: ["Regional field teams"],
        outcomes: [],
        metrics: [],
        verificationState: "imported",
        confidence: 0.95,
        createdAt: now,
        updatedAt: now,
      },
      {
        sourceArtifactId: source.id,
        extractionSnapshotId: snapshot.id,
        sourceLocator: "line:1",
        sourceText: "Coordinated scheduling for regional field teams.",
        relation: "extracted",
      },
    );

    const createInput = {
      jobId: null,
      context: "private-sector",
      pageFormat: "letter",
      templateId: "ats-standard-v1",
      contact: {
        fullName: "Taylor Example",
        email: "taylor@example.com",
        phone: "",
        location: "Annapolis, MD",
        links: ["https://example.com/portfolio"],
      },
      selectedEvidenceIds: [imported.id],
    };

    await assert.rejects(
      () => resumeService.createProjection(createInput),
      /Only user-confirmed or user-authored Career Evidence/,
      "unconfirmed imported evidence must never enter a deterministic resume",
    );

    const confirmed = await evidenceRepository.reviewEvidence(imported.id, {
      action: "confirm",
    });
    assert.equal(confirmed.verificationState, "user-confirmed");

    const detail = await resumeService.createProjection(createInput);
    assert.equal(detail.truthGate.passed, true);
    assert.equal(detail.projection.status, "draft");
    assert.equal(detail.projection.templateId, "ats-standard-v1");
    assert.deepEqual(detail.projection.selectedEvidenceIds, [confirmed.id]);
    assert.equal(detail.statements.length, 1);
    assert.equal(detail.statements[0].text, confirmed.statement);
    assert.deepEqual(detail.statements[0].evidenceIds, [confirmed.id]);

    const prepared = await resumeService.prepareRender(detail.projection.id);
    assert.equal(prepared.truthGate.passed, true);
    assert.match(prepared.html, /Taylor Example/);
    assert.match(prepared.html, /Coordinated scheduling for regional field teams/);
    assert.doesNotMatch(prepared.html, /display\s*:\s*none/i);

    const statementId = detail.statements[0].id;
    await resumeService.updateStatement(statementId, {
      text: "Coordinated scheduling for regional field teams and operated a quantum reactor.",
    });
    const unsafe = await resumeService.getProjectionDetail(detail.projection.id);
    assert.equal(unsafe.truthGate.passed, false);
    assert.equal(
      unsafe.truthGate.issues.some((issue) => issue.code === "unsupported-edit"),
      true,
      "unsupported factual edits must fail the Truth Gate",
    );
    await assert.rejects(
      () => resumeService.prepareRender(detail.projection.id),
      /Truth Gate failed/,
    );

    await resumeService.updateStatement(statementId, { text: confirmed.statement });
    const restored = await resumeService.getProjectionDetail(detail.projection.id);
    assert.equal(restored.truthGate.passed, true);

    await sqlite.exec(sql`
      INSERT INTO applications (
        id, job_id, title, company_name, url, status, notes, created_at, updated_at
      ) VALUES (
        ${"application-r3-smoke"}, ${"job-r3-smoke"}, ${"Operations Coordinator"},
        ${"Northstar Distribution"}, ${"https://example.com/jobs/r3"},
        ${"applied"}, ${""}, ${now}, ${now}
      );
    `);

    const baseSnapshot = {
      projection: restored.projection,
      statements: restored.statements,
    };
    const artifact1 = await resumeRepository.createArtifact({
      id: "artifact-r3-v1",
      projectionId: restored.projection.id,
      version: 1,
      format: "pdf",
      managedPath: path.join(tempDir, "artifacts", "resumes", "v1.pdf"),
      contentHash: "b".repeat(64),
      pageCount: 1,
      truthGateResult: JSON.stringify(restored.truthGate),
      parseabilityResult: JSON.stringify({ passed: true }),
      relevanceReviewResult: null,
      projectionSnapshot: baseSnapshot,
      createdAt: now,
    });

    const changedStatement = {
      ...restored.statements[0],
      text: "Coordinated scheduling for regional field teams using confirmed scheduling practices.",
    };
    const artifact2 = await resumeRepository.createArtifact({
      id: "artifact-r3-v2",
      projectionId: restored.projection.id,
      version: 2,
      format: "pdf",
      managedPath: path.join(tempDir, "artifacts", "resumes", "v2.pdf"),
      contentHash: "c".repeat(64),
      pageCount: 1,
      truthGateResult: JSON.stringify(restored.truthGate),
      parseabilityResult: JSON.stringify({ passed: true }),
      relevanceReviewResult: null,
      projectionSnapshot: {
        projection: restored.projection,
        statements: [changedStatement],
      },
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });

    const diff = await resumeService.compareArtifacts(artifact1.id, artifact2.id);
    assert.deepEqual(diff.removedStatements, [restored.statements[0].text]);
    assert.deepEqual(diff.addedStatements, [changedStatement.text]);

    await resumeRepository.linkArtifactToApplication(
      "application-r3-smoke",
      artifact2.id,
      "submitted",
    );
    const link = await sqlite.queryOne(sql`
      SELECT application_id, resume_artifact_id, purpose
      FROM application_artifact_links
      WHERE application_id = ${"application-r3-smoke"}
      LIMIT 1;
    `);
    assert.deepEqual(link, {
      application_id: "application-r3-smoke",
      resume_artifact_id: artifact2.id,
      purpose: "submitted",
    });

    const reloaded = new ResumeService({
      dataDirectory: tempDir,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await reloaded.initialize();
    const persisted = await reloaded.getProjectionDetail(restored.projection.id);
    assert.equal(persisted.projection.id, restored.projection.id);
    assert.equal(persisted.truthGate.passed, true);
    assert.equal(persisted.artifacts.length, 2);
    assert.deepEqual(
      persisted.artifacts.map((artifact) => artifact.version),
      [2, 1],
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
