// Real-SQLite proof (inference Slice A): inference failures, stale proposals
// and unapproved acceptance leave canonical resume and evidence rows
// byte-identical, the deterministic resume still renders with the Truth Gate
// passing, and an approved rewrite writes only through the existing
// ResumeService.updateStatement. Network access is forbidden throughout.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { CareerEvidenceRepository } = require("../electron-runtime/electron/src/career-evidence-repository.cjs");
const { ResumeService } = require("../electron-runtime/electron/src/resume-service.cjs");
const { SqliteClient } = require("../electron-runtime/electron/src/sqlite.cjs");
const { createInferenceBroker } = require("../electron-runtime/electron/src/inference/broker.cjs");
const { createInferenceAdjudicator } = require("../electron-runtime/electron/src/inference/adjudicator.cjs");
const { createInferenceRegistry } = require("../electron-runtime/electron/src/inference/registry.cjs");
const { acceptRewrite } = require("../electron-runtime/electron/src/inference/acceptance.cjs");
const { createFakeProvider } = require("./support/inference-fake-provider.cjs");
const { nextRequestId, testHmac } = require("./support/inference-fixtures.cjs");
const { withNetworkDenied } = require("./support/inference-network-denial.cjs");

async function setup(tempDir) {
  const backend = new SojournerBackend({ dataDirectory: tempDir, schedulerEnabled: false,
    fetchImpl: async () => { throw new Error("Inference smoke test must not use the network"); } });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
  const evidenceRepository = new CareerEvidenceRepository(sqlite);
  const resumeService = new ResumeService({ dataDirectory: tempDir, databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath });
  await resumeService.initialize();
  return { sqlite, evidenceRepository, resumeService };
}

async function seedProjection({ evidenceRepository, resumeService }) {
  const now = new Date().toISOString();
  const authored = await evidenceRepository.createUserAuthoredEvidence({
    id: "evidence-inference-smoke", subjectType: "achievement", organization: "Synthetic Logistics", titleOrName: "Coordinator",
    startDate: "2022-01", endDate: null, statement: "Coordinated scheduling for regional field teams.", action: "Coordinated",
    context: null, skills: ["Scheduling"], methodsOrTools: [], scope: ["Regional field teams"], outcomes: [], metrics: [],
    verificationState: "user-authored", confidence: null, createdAt: now, updatedAt: now,
  });
  const detail = await resumeService.createProjection({ jobId: null, context: "private-sector", pageFormat: "letter", templateId: "ats-standard-v1",
    contact: { fullName: "Synthetic Example", email: "synthetic@example.org", phone: "", location: "Annapolis, MD", links: [] },
    selectedEvidenceIds: [authored.id] });
  return { evidenceId: authored.id, projectionId: detail.projection.id, statementId: detail.statements[0].id };
}

function readerFor({ evidenceRepository, resumeService }) {
  return {
    readStatements: async (projectionId) => (await resumeService.getProjectionDetail(projectionId)).statements,
    readEvidence: async (ids) => (await Promise.all(ids.map((id) => evidenceRepository.getEvidenceById(id)))).filter(Boolean),
  };
}

async function canonicalRows(sqlite) {
  const statements = await sqlite.queryAll("SELECT * FROM resume_statements ORDER BY id;");
  const evidence = await sqlite.queryAll("SELECT * FROM candidate_evidence ORDER BY id;");
  return JSON.stringify({ statements, evidence });
}

function brokerFor(ctx, behavior, timeoutMs = 50) {
  const reader = readerFor(ctx);
  const truthGate = (statements, evidence) => ctx.resumeService.evaluateTruth({}, statements, evidence);
  const registry = createInferenceRegistry();
  registry.register({ adapter: createFakeProvider(behavior), location: "in-process", modelId: "synthetic-fake-model", timeoutMs });
  const adjudicator = createInferenceAdjudicator({ reader, truthGate });
  return { reader, truthGate, broker: createInferenceBroker({ registry, adjudicator, reader, hmac: testHmac, newRequestId: nextRequestId }) };
}

async function failurePathsLeaveStateUntouched(ctx, ids) {
  const input = { task: "rewrite-resume-statement", providerId: "synthetic-fake",
    input: { projectionId: ids.projectionId, statementId: ids.statementId } };
  const before = await canonicalRows(ctx.sqlite);
  const expected = { "provider-error": "provider-error", hang: "timeout", "malformed-json": "invalid-response",
    "non-subset-evidence-id": "policy-violation", "unsupported-metric": "validation-failed" };
  for (const [behavior, code] of Object.entries(expected)) {
    const result = await brokerFor(ctx, behavior).broker.run(input);
    assert.equal(result.status, "failed", behavior);
    assert.equal(result.failure.code, code, behavior);
    assert.equal(await canonicalRows(ctx.sqlite), before, `${behavior} must not mutate canonical state`);
  }
  const { broker, reader, truthGate } = brokerFor(ctx, "valid");
  const reviewed = await broker.run(input);
  assert.equal(reviewed.status, "review-required");
  const refused = await acceptRewrite(reviewed, { userApproved: false },
    { reader, truthGate, hmac: testHmac, updateStatement: (id, update) => ctx.resumeService.updateStatement(id, update) });
  assert.equal(refused.status, "failed");
  assert.equal(await canonicalRows(ctx.sqlite), before, "unapproved acceptance must not write");
  return { reviewed, reader, truthGate };
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-inference-"));
  try {
    const ctx = await setup(tempDir);
    const ids = await seedProjection(ctx);
    const { value, attempts } = await withNetworkDenied(() => failurePathsLeaveStateUntouched(ctx, ids));
    assert.deepEqual(attempts, [], "inference paths must not touch the network");
    const { reviewed, reader, truthGate } = value;

    const rendered = await ctx.resumeService.prepareRender(ids.projectionId);
    assert.equal(rendered.truthGate.passed, true, "the deterministic resume still renders after inference failures");

    const update = (id, change) => ctx.resumeService.updateStatement(id, change);
    await ctx.evidenceRepository.reviewEvidence(ids.evidenceId, { action: "confirm" });
    const stale = await acceptRewrite(reviewed, { userApproved: true }, { reader, truthGate, hmac: testHmac, updateStatement: update });
    assert.equal(stale.status, "failed", "evidence changed after the request: the proposal is stale");
    assert.equal(stale.failure.code, "validation-failed");

    const fresh = await brokerFor(ctx, "valid").broker.run({ task: "rewrite-resume-statement", providerId: "synthetic-fake",
      input: { projectionId: ids.projectionId, statementId: ids.statementId } });
    const accepted = await acceptRewrite(fresh, { userApproved: true }, { reader, truthGate, hmac: testHmac, updateStatement: update });
    assert.equal(accepted.status, "accepted");
    const detail = await ctx.resumeService.getProjectionDetail(ids.projectionId);
    assert.equal(detail.statements[0].userEdited, true, "accepted wording is stored as a user edit by the existing path");
    assert.equal(detail.truthGate.passed, true);
    console.log("inference baseline sqlite smoke test passed");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
