// Agent workspace (#286): one targeted assertion per integrity rule (independent review of e36349f).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AgentWorkspaceError, createAgentExport, reconcileWorkspace } from "../src/agent-workspace/index.ts";
import { makeBatch, makeOperation, makeSubmission, bytesOf, sha256 } from "./support/agent-workspace-helpers.mjs";

const snapshot = JSON.parse(readFileSync(new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url), "utf8"));
const exported = await createAgentExport(snapshot, { exportId: "ex_rules_day0", createdAt: "2026-10-13T16:30:00Z", build: "rules", scopes: ["confirmed_evidence"], selectedJobIds: [], selectedResumeIds: [], selectedCoverLetterIds: [], schemaDocuments: [] });
const receipts = [exported.receipt];
const src = { exportId: "ex_rules_day0", manifestSha256: exported.manifestSha256 };
const policy = { autoImportKinds: ["workspace_note_version", "follow_up_plan"] };
let n = 0;
const note = (fields = {}) => makeOperation({ operation_id: `op_rule_${(n += 1)}`, record_id: `agent_rule_${n}`, authored_at: "2026-10-20T09:00:00Z", kind: "workspace_note_version", payload: { title: "Note", body: `Body ${n}` }, ...fields });
const batch = (id, ops, extra = {}) => makeBatch({ ...src, batchId: id, actorId: "agent_rules", createdAt: "2026-10-20T10:00:00Z", operations: ops, ...extra });
const reconcile = (submissions, ledger = null) => reconcileWorkspace({ receipts, canonical: snapshot, policy, ledger, submissions });
const op = (result, id) => result.report.operations.find((o) => o.operation_id === id);
const batchOf = (result, id) => result.report.batches.find((b) => b.batch_id === id);
const quarantined = (result, id) => result.quarantine.find((q) => q.operation_id === id);

// Rejected operations are preserved in quarantine and flagged on their batch.
{
  const shadow = note({ record_id: "ev_confirmed_scheduling" });
  const based = note({ base_revision: "rev_abcdef" });
  const r = await reconcile([makeSubmission(batch("batch_rules_shadow", [shadow, based]))]);
  assert.equal(op(r, shadow.operation_id).outcome, "rejected");
  assert.ok(op(r, shadow.operation_id).flags.includes("record_id_shadows_canonical"));
  assert.ok(op(r, based.operation_id).flags.includes("base_revision_not_applicable"));
  assert.deepEqual(JSON.parse(JSON.stringify(quarantined(r, shadow.operation_id).operation.payload)), shadow.payload, "rejected content is preserved");
  assert.ok(quarantined(r, based.operation_id));
  assert.ok(batchOf(r, "batch_rules_shadow").warnings.includes("operations_rejected"));
}

// A record cannot change kind; both conflicting writes are kept in quarantine.
{
  const a = note({ record_id: "agent_shared_rule" });
  const b = makeOperation({ operation_id: "op_rule_followup", record_id: "agent_shared_rule", authored_at: "2026-10-20T09:00:00Z", kind: "follow_up_plan", payload: { label: "x", description: "y", due_at: null } });
  const r = await reconcile([makeSubmission(batch("batch_rules_kind_a", [a])), makeSubmission(batch("batch_rules_kind_b", [b]))]);
  for (const id of [a.operation_id, b.operation_id]) {
    assert.ok(op(r, id).flags.includes("record_kind_conflict"));
    assert.ok(quarantined(r, id));
  }
}

// Receipt binding: a known export ID with another manifest digest is rejected.
{
  const r = await reconcile([makeSubmission(batch("batch_rules_digest", [note()], { manifestSha256: "f".repeat(64) }))]);
  assert.ok(batchOf(r, "batch_rules_digest").reasons.includes("source_manifest_mismatch"));
}

// Discovery location must match the batch's own actor claim and batch ID.
{
  const s = makeSubmission(batch("batch_rules_loc", [note()]));
  s.location = "workspace/agents/agent_other/batches/batch_rules_loc.json";
  const r = await reconcile([s]);
  assert.ok(batchOf(r, "batch_rules_loc").reasons.includes("location_mismatch"));
}

// Commit markers: missing marker and a marker bound to other bytes are incomplete.
{
  const r1 = await reconcile([makeSubmission(batch("batch_rules_nomarker", [note()]), { withCommit: false })]);
  assert.equal(batchOf(r1, "batch_rules_nomarker").status, "incomplete");
  assert.ok(batchOf(r1, "batch_rules_nomarker").reasons.includes("commit_marker_missing"));
  const r2 = await reconcile([makeSubmission(batch("batch_rules_badsha", [note()]), { commitOverrides: { batch_sha256: "0".repeat(64) } })]);
  assert.ok(batchOf(r2, "batch_rules_badsha").reasons.includes("commit_marker_mismatch"));
}

// A batch ID recorded in the ledger cannot later name different bytes.
{
  const first = batch("batch_rules_reuse", [note()]);
  const r1 = await reconcile([makeSubmission(first)]);
  const r2 = await reconcile([makeSubmission(batch("batch_rules_reuse", [note()]))], r1.ledger);
  assert.equal(batchOf(r2, "batch_rules_reuse").status, "rejected");
  assert.ok(batchOf(r2, "batch_rules_reuse").reasons.includes("batch_id_conflict"));
  assert.ok(r2.quarantine.some((q) => q.kind === "batch" && q.batch_id === "batch_rules_reuse"));
}

// A predecessor must belong to the same record.
{
  const root = note();
  const child = note({ previous_operation_id: root.operation_id });
  const r = await reconcile([makeSubmission(batch("batch_rules_predrec", [root, child]))]);
  assert.ok(op(r, child.operation_id).flags.includes("predecessor_record_mismatch"));
  assert.ok(quarantined(r, child.operation_id));
}

// Status claims for unknown applications are flagged and still only staged.
{
  const claim = makeOperation({ operation_id: "op_rule_claim", record_id: "agent_rule_claim", authored_at: "2026-10-20T09:00:00Z", kind: "application_status_claim", payload: { application_id: "app_does_not_exist", claimed_status: "offered", reported_context: "x" } });
  const r = await reconcile([makeSubmission(batch("batch_rules_claim", [claim]))]);
  assert.equal(op(r, "op_rule_claim").outcome, "staged_for_review");
  assert.ok(op(r, "op_rule_claim").flags.includes("unknown_application"));
}

// Predecessor cycles (including self-cycles) are rejected explicitly, not left pending forever.
{
  const a = note({ record_id: "agent_cycle", operation_id: "op_cycle_a", previous_operation_id: "op_cycle_b" });
  const b = note({ record_id: "agent_cycle", operation_id: "op_cycle_b", previous_operation_id: "op_cycle_a" });
  const self = note({ record_id: "agent_self", operation_id: "op_cycle_self", previous_operation_id: "op_cycle_self" });
  const r = await reconcile([makeSubmission(batch("batch_rules_cycle", [a, b, self]))]);
  for (const id of ["op_cycle_a", "op_cycle_b", "op_cycle_self"]) {
    assert.equal(op(r, id).outcome, "rejected", id);
    assert.ok(op(r, id).flags.includes("predecessor_cycle"), id);
    assert.ok(quarantined(r, id));
  }
}

// A very long revision chain is evaluated without recursion limits, in bounded time.
{
  const ops = Array.from({ length: 10_000 }, (_, i) => makeOperation({
    operation_id: `op_chain_${String(i).padStart(5, "0")}`,
    record_id: "agent_chain",
    previous_operation_id: i === 9_999 ? null : `op_chain_${String(i + 1).padStart(5, "0")}`,
    authored_at: "2026-10-20T09:00:00Z",
    kind: "workspace_note_version",
    payload: { title: "Chain", body: `v${i}` },
  }));
  const submissions = Array.from({ length: 100 }, (_, i) => makeSubmission(batch(`batch_chain_${String(i).padStart(3, "0")}`, ops.slice(i * 100, i * 100 + 100))));
  const started = Date.now();
  const r = await reconcile(submissions);
  const elapsed = Date.now() - started;
  assert.equal(r.report.counts.imported_draft, 10_000);
  assert.deepEqual(r.report.records.agent_chain.heads, ["op_chain_00000"]);
  assert.equal(r.history[0].operation_id, "op_chain_09999");
  assert.ok(elapsed < 15_000, `10,000-link chain took ${elapsed} ms`);
}

// Local ledgers and receipts are validated before use.
for (const ledger of [{}, { format: "jr-agent-reconcile-ledger", schema_version: 1, operations: null, batches: {} }, { format: "jr-agent-reconcile-ledger", schema_version: 1, operations: { op_x: null }, batches: {} }]) {
  await assert.rejects(reconcile([], ledger), (e) => e instanceof AgentWorkspaceError && e.code === "invalid_ledger");
}
const forgedLedger = { format: "jr-agent-reconcile-ledger", schema_version: 1, operations: { op_x_1: { content_sha256: "a".repeat(64), outcome: "confirmed", batch_id: "batch_x", record_id: "agent_x_1", kind: "workspace_note_version", previous_operation_id: null } }, batches: {} };
await assert.rejects(reconcile([], forgedLedger), (e) => e.code === "invalid_ledger");
await assert.rejects(reconcileWorkspace({ receipts: [{ ...exported.receipt, manifest_sha256: "nope" }], canonical: snapshot, policy, ledger: null, submissions: [] }), (e) => e.code === "invalid_receipt");
void bytesOf; void sha256;

console.log("agent-workspace reconcile rule tests passed");
