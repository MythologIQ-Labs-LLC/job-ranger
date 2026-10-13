// Independent G3 fail-first trust-boundary tests, intentionally based on the
// independently PASS-reviewed G2 engine at ad2bf403. These are acceptance
// tests for future persistent storage, not evidence that G2 is security-failed.
// Expected status on G2: RED for the gaps below; Claude owns the code fixes.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AgentWorkspaceError, createAgentExport, reconcileWorkspace } from "../src/agent-workspace/index.ts";
import { makeBatch, makeOperation, makeSubmission } from "./support/agent-workspace-helpers.mjs";

const canonical = JSON.parse(readFileSync(
  new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url),
  "utf8",
));
const exported = await createAgentExport(canonical, {
  exportId: "ex_g3_trust_regressions",
  createdAt: "2026-10-13T16:30:00Z",
  build: "trust-tests",
  scopes: ["confirmed_evidence"],
  selectedJobIds: [],
  selectedResumeIds: [],
  selectedCoverLetterIds: [],
  schemaDocuments: [],
});
const source = {
  exportId: exported.receipt.export_id,
  manifestSha256: exported.manifestSha256,
};
const policy = { autoImportKinds: ["workspace_note_version"] };
const invoke = (submissions, ledger = null, receipts = [exported.receipt]) =>
  reconcileWorkspace({ receipts, canonical, policy, ledger, submissions });
const operation = (operation_id, body) => makeOperation({
  operation_id,
  record_id: "agent_trust_note_001",
  authored_at: "2026-10-15T09:00:00Z",
  kind: "workspace_note_version",
  payload: { title: "Agent research", body },
});
const submission = (batchId, op, opts = {}) =>
  makeSubmission(makeBatch({
    ...source, batchId, actorId: "agent_trust",
    createdAt: "2026-10-15T10:00:00Z",
    operations: [op], ...opts,
  }));
const batchOutcome = (result, batchId) =>
  result.report.batches.find(item => item.batch_id === batchId);

test("G3 #289: a later different-content operation ID contests previously imported remote work", async () => {
  const first = await invoke([
    submission("batch_trust_first", operation("op_trust_same_id", "First note")),
  ]);
  assert.equal(first.ledger.operations.op_trust_same_id.outcome, "imported_draft");

  // The first run could already have written the draft to the durable draft
  // namespace. A later remote file with the same ID must retroactively mark
  // that existing draft as contested, preserving BOTH versions for review.
  const second = await invoke([
    submission("batch_trust_second", operation("op_trust_same_id", "Different note")),
  ], first.ledger);
  assert.ok(second.quarantine.some(entry =>
    entry.operation_id === "op_trust_same_id" &&
    entry.reasons.includes("operation_id_conflict")));
  const persisted = second.ledger.operations.op_trust_same_id;
  // The exact final schema may choose a contested flag vs a dedicated
  // outcome, but the persisted state MUST change from an eligible import.
  assert.notEqual(persisted.outcome, "imported_draft",
    "Previously imported agent draft must be downgraded when its operation ID is contested");
  assert.ok(
    persisted.outcome === "contested_draft" || persisted.contested === true,
    "A durable explicit contested state is required, not silent deletion");
  assert.equal(canonical.applications[0].status, "interested");
});

test("G3 workspace binding: a correctly hashed batch from another workspace is refused", async () => {
  // G2 only checks export ID and manifest SHA; neither establishes a trusted
  // workspace identity. G3 requires a workspace anchor from trusted local
  // receipt/configuration, never the agent's remote JSON.
  const remote = submission("batch_trust_foreign_workspace",
    operation("op_foreign_workspace", "Off-workspace draft"),
    { workspaceId: "workspace_attacker_other" });
  const result = await invoke([remote]);
  const status = batchOutcome(result, "batch_trust_foreign_workspace");
  assert.equal(status.status, "rejected");
  assert.ok(status.reasons.includes("workspace_mismatch"),
    "Trusted workspace ID mismatch must have an explicit diagnostic");
  assert.ok(!result.drafts.some(item => item.operation_id === "op_foreign_workspace"));
});

test("G3 trusted receipt: reject malformed nested file descriptors before reconciliation", async () => {
  const forged = structuredClone(exported.receipt);
  // These data types are accepted by the shallow G2 receipt check but
  // unsuitable as trusted per-file byte-integrity metadata.
  forged.files = [{ path: "../../outside/private.json", sha256: "not-a-digest", bytes: -1 }];
  await assert.rejects(invoke([], null, [forged]), error =>
    error instanceof AgentWorkspaceError && error.code === "invalid_receipt");
});

test("G3 trusted receipt: reject malformed record revision types and unexpected approval keys", async () => {
  const forged = structuredClone(exported.receipt);
  forged.record_revisions["ev_confirmed_scheduling"] = { approved: true };
  forged.user_approved = true;
  await assert.rejects(invoke([], null, [forged]), error =>
    error instanceof AgentWorkspaceError && error.code === "invalid_receipt");
});

test("G3 regression control: identical operation ID and content on a later run is a no-op", async () => {
  const first = await invoke([
    submission("batch_trust_clean_first", operation("op_trust_clean_replay", "Stable note")),
  ]);
  const second = await invoke([
    submission("batch_trust_clean_second", operation("op_trust_clean_replay", "Stable note")),
  ], first.ledger);
  assert.equal(second.report.counts.already_reconciled, 1);
  assert.equal(second.drafts.length, 0);
  assert.equal(second.ledger.operations.op_trust_clean_replay.outcome, "imported_draft");
});
