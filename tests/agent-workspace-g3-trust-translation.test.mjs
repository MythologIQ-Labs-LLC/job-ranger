// Independent #290 G3 trust-boundary tests (audit/286-g3-trust-regressions @ b08594f),
// translated to the v2 API without weakening them. Run unchanged against G2 at ad2bf40 they
// are RED 4 / GREEN 1, as the issue predicted. Serialization changes, recorded here:
// - exports and reconciliation take the trusted local workspace ID (D13);
// - the durable contested state is the ledger entry's `contest` list (#289, D09), and every
//   conflicting version is returned in `contested` (preserved for review) rather than in the
//   rejected-operation quarantine.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AgentWorkspaceError, createAgentExport, operationEligibility, reconcileWorkspace } from "../src/agent-workspace/index.ts";
import { makeBatch, makeOperation, makeSubmission, WORKSPACE_ID } from "./support/agent-workspace-helpers.mjs";

const canonical = JSON.parse(readFileSync(new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url), "utf8"));
const exported = await createAgentExport(canonical, {
  exportId: "ex_g3_trust_regressions", workspaceId: WORKSPACE_ID, createdAt: "2026-10-13T16:30:00Z", build: "trust-tests",
  scopes: ["confirmed_evidence"], selectedJobIds: [], selectedResumeIds: [], selectedCoverLetterIds: [], schemaDocuments: [],
});
const source = { exportId: exported.receipt.export_id, manifestSha256: exported.manifestSha256 };
const policy = { autoImportKinds: ["workspace_note_version"] };
const invoke = (submissions, ledger = null, receipts = [exported.receipt]) => reconcileWorkspace({ workspaceId: WORKSPACE_ID, receipts, canonical, policy, ledger, submissions });
const operation = (operation_id, body) => makeOperation({ operation_id, record_id: "agent_trust_note_001", authored_at: "2026-10-15T09:00:00Z", kind: "workspace_note_version", payload: { title: "Agent research", body } });
const submission = (batchId, op, opts = {}) => makeSubmission(makeBatch({ ...source, batchId, actorId: "agent_trust", createdAt: "2026-10-15T10:00:00Z", operations: [op], ...opts }));
const batchOutcome = (result, batchId) => result.report.batches.find((item) => item.batch_id === batchId);

test("G3 #289: a later different-content operation ID contests previously imported remote work", async () => {
  const first = await invoke([submission("batch_trust_first", operation("op_trust_same_id", "First note"))]);
  assert.equal(first.ledger.operations.op_trust_same_id.outcome, "imported_draft");
  const second = await invoke([submission("batch_trust_second", operation("op_trust_same_id", "Different note"))], JSON.parse(JSON.stringify(first.ledger)));
  assert.ok(second.contested.some((entry) => entry.operation_id === "op_trust_same_id" && entry.reasons.includes("operation_id_conflict") && entry.operation.payload.body === "Different note"));
  const persisted = second.ledger.operations.op_trust_same_id;
  assert.ok(persisted.contest.includes("operation_id_conflict"), "a durable explicit contested state is required, not silent deletion");
  assert.equal(operationEligibility(second.ledger, "op_trust_same_id").eligible, false, "previously imported agent draft must be downgraded");
  assert.equal(persisted.variants.length, 2, "both versions are recorded");
  assert.ok(second.downgrades.some((d) => d.operation_id === "op_trust_same_id"));
  assert.equal(canonical.applications[0].status, "interested");
});

test("G3 workspace binding: a correctly hashed batch from another workspace is refused", async () => {
  const remote = submission("batch_trust_foreign_workspace", operation("op_foreign_workspace", "Off-workspace draft"), { workspaceId: "workspace_attacker_other" });
  const result = await invoke([remote]);
  const status = batchOutcome(result, "batch_trust_foreign_workspace");
  assert.equal(status.status, "rejected");
  assert.ok(status.reasons.includes("workspace_mismatch"));
  assert.ok(!result.drafts.some((item) => item.operation_id === "op_foreign_workspace"));
  // A receipt from another workspace is not a trust anchor here either.
  await assert.rejects(invoke([], null, [{ ...exported.receipt, workspace_id: "workspace_attacker_other" }]), (e) => e instanceof AgentWorkspaceError && e.code === "invalid_receipt");
});

test("G3 trusted receipt: reject malformed nested file descriptors before reconciliation", async () => {
  for (const files of [
    [{ path: "../../outside/private.json", sha256: "not-a-digest", bytes: -1 }],
    [{ path: "data/ok.json", sha256: "a".repeat(64), bytes: 10, media_type: "text/html" }],
    [{ path: "data/../escape.json", sha256: "a".repeat(64), bytes: 10 }],
    [],
  ]) {
    const forged = structuredClone(exported.receipt);
    forged.files = files;
    await assert.rejects(invoke([], null, [forged]), (error) => error instanceof AgentWorkspaceError && error.code === "invalid_receipt", JSON.stringify(files));
  }
});

test("G3 trusted receipt: reject malformed record revision types and unexpected approval keys", async () => {
  const forged = structuredClone(exported.receipt);
  forged.record_revisions.ev_confirmed_scheduling = { approved: true };
  forged.user_approved = true;
  await assert.rejects(invoke([], null, [forged]), (error) => error instanceof AgentWorkspaceError && error.code === "invalid_receipt");
  const onlyKey = structuredClone(exported.receipt);
  onlyKey.user_approved = true;
  await assert.rejects(invoke([], null, [onlyKey]), (error) => error.code === "invalid_receipt");
  const onlyRevision = structuredClone(exported.receipt);
  onlyRevision.record_revisions.ev_confirmed_scheduling = { approved: true };
  await assert.rejects(invoke([], null, [onlyRevision]), (error) => error.code === "invalid_receipt");
});

test("G3 regression control: identical operation ID and content on a later run is a no-op", async () => {
  const first = await invoke([submission("batch_trust_clean_first", operation("op_trust_clean_replay", "Stable note"))]);
  const second = await invoke([submission("batch_trust_clean_second", operation("op_trust_clean_replay", "Stable note"))], first.ledger);
  assert.equal(second.report.counts.already_reconciled, 1);
  assert.equal(second.drafts.length, 0);
  assert.equal(second.ledger.operations.op_trust_clean_replay.outcome, "imported_draft");
  assert.equal(operationEligibility(second.ledger, "op_trust_clean_replay").eligible, true);
});
