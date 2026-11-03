const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { CareerEvidenceRepository } = require("../electron-runtime/electron/src/career-evidence-repository.cjs");
const { ResumeService } = require("../electron-runtime/electron/src/resume-service.cjs");
const { ResumeTailoringService } = require("../electron-runtime/electron/src/resume-tailoring-service.cjs");
const { SqliteClient, sql } = require("../electron-runtime/electron/src/sqlite.cjs");

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-tailoring-"));

  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => {
        throw new Error("Tailoring smoke test must not use the network");
      },
    });
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
    const evidenceRepository = new CareerEvidenceRepository(sqlite);
    const resumeService = new ResumeService({
      dataDirectory: tempDir,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    const tailoringService = new ResumeTailoringService({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await resumeService.initialize();

    const now = new Date().toISOString();
    await sqlite.exec(sql`
      INSERT INTO companies (
        id, name, url, source_type, frequency_minutes, is_active,
        created_at, updated_at
      ) VALUES (
        ${42}, ${"Northstar Operations"}, ${"https://example.test/careers"},
        ${"generic-html"}, ${60}, ${true}, ${now}, ${now}
      );
    `);
    await sqlite.exec(sql`
      INSERT INTO jobs (
        id, company_id, source_job_id, source_type, title, location,
        employment_type, url, description_snippet, created_at, last_seen_at,
        is_active, is_new, matched_filter_count
      ) VALUES (
        ${4242}, ${42}, ${"role-4242"}, ${"generic-html"},
        ${"Operations Program Manager"}, ${"Annapolis, MD"}, ${"Full-time"},
        ${"https://example.test/careers/4242"},
        ${"Must coordinate delivery schedules across teams. Support stakeholder escalations and customer issues. PMP certification required."},
        ${now}, ${now}, ${true}, ${true}, ${0}
      );
    `);

    const sourceArtifact = await evidenceRepository.createSourceArtifact({
      id: "source-r4-smoke",
      kind: "resume",
      originalName: "synthetic-career-history.txt",
      mediaType: "text/plain",
      detectedFormat: "txt",
      contentHash: "d".repeat(64),
      managedPath: path.join(tempDir, "artifacts", "synthetic-career-history.txt"),
      byteSize: 512,
      importedAt: now,
      parserId: "sojourner-text",
      parserVersion: "1",
      extractionState: "extracted",
      warnings: [],
    });
    const snapshot = await evidenceRepository.createExtractionSnapshot({
      id: "snapshot-r4-smoke",
      sourceArtifactId: sourceArtifact.id,
      parserId: "sojourner-text",
      parserVersion: "1",
      rawText: [
        "Coordinated delivery schedules across teams.",
        "Resolved customer escalations across field operations.",
        "Organized internal volunteer events.",
      ].join("\n"),
      structuredPayload: null,
      warnings: [],
      createdAt: now,
    });

    async function createConfirmedEvidence(id, statement, sourceLocator) {
      const proposal = await evidenceRepository.createEvidenceProposal(
        {
          id,
          subjectType: "achievement",
          organization: "Northstar Operations",
          titleOrName: "Operations Coordinator",
          startDate: "2022-01",
          endDate: null,
          statement,
          action: statement.split(" ")[0],
          context: null,
          skills: [],
          methodsOrTools: [],
          scope: [],
          outcomes: [],
          metrics: [],
          verificationState: "imported",
          confidence: 0.95,
          createdAt: now,
          updatedAt: now,
        },
        {
          sourceArtifactId: sourceArtifact.id,
          extractionSnapshotId: snapshot.id,
          sourceLocator,
          sourceText: statement,
          relation: "extracted",
        },
      );
      return evidenceRepository.reviewEvidence(proposal.id, { action: "confirm" });
    }

    const direct = await createConfirmedEvidence(
      "evidence-r4-direct",
      "Coordinated delivery schedules across teams.",
      "line:1",
    );
    const transferable = await createConfirmedEvidence(
      "evidence-r4-transferable",
      "Resolved customer escalations across field operations.",
      "line:2",
    );
    const unrelated = await createConfirmedEvidence(
      "evidence-r4-unrelated",
      "Organized internal volunteer events.",
      "line:3",
    );

    const source = await resumeService.createProjection({
      jobId: null,
      context: "private-sector",
      pageFormat: "letter",
      templateId: "ats-standard-v1",
      contact: {
        fullName: "Taylor Example",
        email: "taylor@example.test",
        phone: "",
        location: "Annapolis, MD",
        links: [],
      },
      selectedEvidenceIds: [direct.id, unrelated.id],
    });

    const directStatement = source.statements.find((item) =>
      item.evidenceIds.includes(direct.id),
    );
    assert.ok(directStatement, "source projection should contain direct evidence");
    const editedText = "Across teams, coordinated delivery schedules.";
    await resumeService.updateStatement(directStatement.id, { text: editedText });

    const plan = await tailoringService.preview({
      sourceProjectionId: source.projection.id,
      jobId: "4242",
    });
    assert.equal(plan.sourceProjectionId, source.projection.id);
    assert.equal(plan.jobId, "4242");
    assert.ok(plan.suggestedEvidenceIds.includes(direct.id));
    assert.ok(plan.suggestedEvidenceIds.includes(transferable.id));
    assert.ok(plan.omittedSourceEvidenceIds.includes(unrelated.id));
    assert.ok(
      plan.gaps.some((gap) => gap.text.toLowerCase().includes("pmp")),
      "unsupported credential must remain an explicit gap",
    );

    const childProjection = await tailoringService.apply({
      sourceProjectionId: source.projection.id,
      jobId: "4242",
      selectedEvidenceIds: plan.suggestedEvidenceIds,
    });
    assert.equal(childProjection.sourceProjectionId, source.projection.id);
    assert.equal(childProjection.jobId, "4242");
    assert.ok(childProjection.selectedEvidenceIds.includes(direct.id));
    assert.ok(childProjection.selectedEvidenceIds.includes(transferable.id));
    assert.equal(childProjection.selectedEvidenceIds.includes(unrelated.id), false);

    const child = await resumeService.getProjectionDetail(childProjection.id);
    assert.equal(
      child.truthGate.passed,
      true,
      `tailored child Truth Gate issues: ${JSON.stringify(child.truthGate.issues)}`,
    );
    const childDirect = child.statements.find((item) => item.evidenceIds.includes(direct.id));
    const childTransferable = child.statements.find((item) =>
      item.evidenceIds.includes(transferable.id),
    );
    assert.equal(childDirect?.text, editedText, "retained user edit must carry into child draft");
    assert.equal(childDirect?.userEdited, true);
    assert.equal(childTransferable?.text, transferable.statement);
    assert.equal(childTransferable?.userEdited, false);

    const original = await resumeService.getProjectionDetail(source.projection.id);
    assert.deepEqual(
      original.projection.selectedEvidenceIds,
      [direct.id, unrelated.id],
      "tailoring must not mutate the source projection",
    );

    const reloaded = new ResumeService({
      dataDirectory: tempDir,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await reloaded.initialize();
    const persistedChild = await reloaded.getProjectionDetail(childProjection.id);
    assert.equal(persistedChild.projection.sourceProjectionId, source.projection.id);
    assert.equal(persistedChild.projection.jobId, "4242");

    await backend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
