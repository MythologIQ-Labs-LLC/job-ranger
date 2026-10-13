// Agent workspace (#286): one targeted assertion per integrity rule (independent review of e36349f).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AgentWorkspaceError, createAgentExport, migrateLedgerV1, operationEligibility, reconcileWorkspace, validateLedger } from "../src/agent-workspace/index.ts";
import { attachmentRef, makeBatch, makeOperation, makeSubmission, bytesOf, sha256, WORKSPACE_ID } from "./support/agent-workspace-helpers.mjs";

const snapshot = JSON.parse(readFileSync(new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url), "utf8"));
const exported = await createAgentExport(snapshot, { exportId: "ex_rules_day0", workspaceId: WORKSPACE_ID, createdAt: "2026-10-13T16:30:00Z", build: "rules", scopes: ["confirmed_evidence"], selectedJobIds: [], selectedResumeIds: [], selectedCoverLetterIds: [], schemaDocuments: [] });
const receipts = [exported.receipt];
const src = { exportId: "ex_rules_day0", manifestSha256: exported.manifestSha256 };
const policy = { autoImportKinds: ["workspace_note_version", "follow_up_plan"] };
let n = 0;
const note = (fields = {}) => makeOperation({ operation_id: `op_rule_${(n += 1)}`, record_id: `agent_rule_${n}`, authored_at: "2026-10-20T09:00:00Z", kind: "workspace_note_version", payload: { title: "Note", body: `Body ${n}` }, ...fields });
const batch = (id, ops, extra = {}) => makeBatch({ ...src, batchId: id, actorId: "agent_rules", createdAt: "2026-10-20T10:00:00Z", operations: ops, ...extra });
const reconcile = (submissions, ledger = null) => reconcileWorkspace({ workspaceId: WORKSPACE_ID, receipts, canonical: snapshot, policy, ledger, submissions });
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

// D13: a batch must carry the trusted local workspace ID.
{
  const r = await reconcile([makeSubmission(batch("batch_rules_ws", [note()], { workspaceId: "workspace_other_99" }))]);
  assert.equal(batchOf(r, "batch_rules_ws").status, "rejected");
  assert.ok(batchOf(r, "batch_rules_ws").reasons.includes("workspace_mismatch"));
}

// D13: a batch extends its own claimed actor's chain; otherwise it waits or is rejected.
{
  const first = batch("batch_rules_chain_1", [note()]);
  const second = batch("batch_rules_chain_2", [note()], { previousBatchId: "batch_rules_chain_1" });
  const waiting = await reconcile([makeSubmission(second)]);
  assert.equal(batchOf(waiting, "batch_rules_chain_2").status, "incomplete");
  assert.ok(batchOf(waiting, "batch_rules_chain_2").reasons.includes("previous_batch_unavailable"));
  assert.equal(waiting.report.operations.length, 0, "nothing from a waiting batch is imported");
  const both = await reconcile([makeSubmission(second), makeSubmission(first)]);
  assert.equal(batchOf(both, "batch_rules_chain_2").status, "accepted");
  const later = await reconcile([makeSubmission(second)], (await reconcile([makeSubmission(first)])).ledger);
  assert.equal(batchOf(later, "batch_rules_chain_2").status, "accepted", "a predecessor from an earlier run satisfies the chain");
  const other = batch("batch_rules_chain_x", [note()], { actorId: "agent_rules_other", previousBatchId: "batch_rules_chain_1" });
  const spoof = await reconcile([makeSubmission(first), makeSubmission(other)]);
  assert.equal(batchOf(spoof, "batch_rules_chain_x").status, "rejected");
  assert.ok(batchOf(spoof, "batch_rules_chain_x").reasons.includes("previous_batch_actor_mismatch"));
  const loopA = batch("batch_rules_loop_a", [note()], { previousBatchId: "batch_rules_loop_b" });
  const loopB = batch("batch_rules_loop_b", [note()], { previousBatchId: "batch_rules_loop_a" });
  const loop = await reconcile([makeSubmission(loopA), makeSubmission(loopB)]);
  for (const id of ["batch_rules_loop_a", "batch_rules_loop_b"]) assert.ok(batchOf(loop, id).reasons.includes("previous_batch_cycle"), id);
}

// D02: the marker's attachment inventory must equal the drafts' references exactly.
{
  const pdf = bytesOf("%PDF-1.4 rules");
  const path = "workspace/attachments/rules/a.pdf";
  const draft = (refs) => makeOperation({ operation_id: `op_rule_att_${(n += 1)}`, record_id: `agent_rule_att_${n}`, authored_at: "2026-10-20T09:00:00Z", kind: "material_draft_version", payload: { material_kind: "resume", title: "R", body: "B", source_evidence_refs: [], gate_status: "not_checked", ...(refs ? { attachments: refs } : {}) } });
  const good = await reconcile([makeSubmission(batch("batch_rules_att_ok", [draft([attachmentRef(path, pdf)])]), { attachments: { [path]: { declared: pdf, actual: pdf } } })]);
  assert.equal(batchOf(good, "batch_rules_att_ok").status, "accepted");
  const orphan = await reconcile([makeSubmission(batch("batch_rules_att_orphan", [draft(null)]), { attachments: { [path]: { declared: pdf, actual: pdf } } })]);
  assert.ok(batchOf(orphan, "batch_rules_att_orphan").reasons.includes("attachment_reference_mismatch"), "a marker-only attachment cannot ride along");
  const unlisted = await reconcile([makeSubmission(batch("batch_rules_att_unlisted", [draft([attachmentRef(path, pdf)])]))]);
  assert.ok(batchOf(unlisted, "batch_rules_att_unlisted").reasons.includes("attachment_reference_mismatch"), "a reference missing from the marker is refused");
  const fake = await reconcile([makeSubmission(batch("batch_rules_att_fake", [draft([{ ...attachmentRef(path, pdf), sha256: "d".repeat(64) }])]), { attachments: { [path]: { declared: pdf, actual: pdf } } })]);
  assert.ok(batchOf(fake, "batch_rules_att_fake").reasons.includes("attachment_reference_mismatch"), "a reference digest that differs from the marker is refused");
  const absent = await reconcile([makeSubmission(batch("batch_rules_att_absent", [draft([attachmentRef(path, pdf)])]), { attachments: { [path]: { declared: pdf, actual: null } } })]);
  assert.equal(batchOf(absent, "batch_rules_att_absent").status, "incomplete");
}

// D04/D05: proposal combinations and citation revisions.
{
  const insurance = snapshot.evidence.find((e) => e.evidence.id === "ev_authored_insurance").evidence;
  const token = exported.receipt.record_revisions.ev_authored_insurance;
  const proposal = (payload, base_revision = null) => makeOperation({ operation_id: `op_rule_prop_${(n += 1)}`, record_id: `agent_rule_prop_${n}`, base_revision, authored_at: "2026-10-20T09:00:00Z", kind: "evidence_change_proposal", payload: { change_reason: "r", proposed_text: "t", source_evidence_refs: [], ...payload } });
  const fresh = proposal({ proposal_kind: "new", evidence_id: null });
  const freshWithBase = proposal({ proposal_kind: "new", evidence_id: null }, token);
  const fix = proposal({ proposal_kind: "correction", evidence_id: "ev_authored_insurance" }, token);
  const fixNoBase = proposal({ proposal_kind: "correction", evidence_id: "ev_authored_insurance" });
  const fixUnknown = proposal({ proposal_kind: "correction", evidence_id: "ev_does_not_exist" }, token);
  const fixLegacy = proposal({ proposal_kind: "correction", evidence_id: "ev_authored_insurance" }, insurance.updatedAt);
  const fixStale = proposal({ proposal_kind: "correction", evidence_id: "ev_authored_insurance" }, "evrev1:" + "0".repeat(64));
  const legacyCite = note({ kind: "material_draft_version", payload: { material_kind: "cover_letter", title: "L", body: "B", source_evidence_refs: [{ record_id: "ev_authored_insurance", revision: insurance.updatedAt }], gate_status: "not_checked" } });
  const r = await reconcile([makeSubmission(batch("batch_rules_props", [fresh, freshWithBase, fix, fixNoBase, fixUnknown, fixLegacy, fixStale, legacyCite]))]);
  assert.equal(op(r, fresh.operation_id).outcome, "staged_for_review");
  assert.ok(op(r, freshWithBase.operation_id).flags.includes("base_revision_not_applicable"));
  assert.equal(op(r, fix.operation_id).outcome, "staged_for_review");
  assert.ok(op(r, fixNoBase.operation_id).flags.includes("missing_base_revision"));
  assert.equal(op(r, fixNoBase.operation_id).outcome, "rejected");
  assert.ok(op(r, fixUnknown.operation_id).flags.includes("unknown_evidence_target"));
  assert.equal(op(r, fixUnknown.operation_id).outcome, "rejected");
  assert.equal(op(r, fixLegacy.operation_id).outcome, "needs_rebase");
  assert.ok(op(r, fixLegacy.operation_id).flags.includes("legacy_evidence_revision"), "a G2 timestamp citation is ambiguous, never current");
  assert.ok(op(r, fixStale.operation_id).flags.includes("stale_base_revision"));
  assert.equal(op(r, legacyCite.operation_id).outcome, "needs_rebase");
  assert.ok(quarantined(r, fixUnknown.operation_id) && quarantined(r, fixNoBase.operation_id));
}

// Late record-kind conflicts contest the record already in the ledger.
{
  const a = note({ record_id: "agent_kind_late" });
  const first = await reconcile([makeSubmission(batch("batch_rules_kind_late_a", [a]))]);
  const b = makeOperation({ operation_id: "op_rule_kind_late_b", record_id: "agent_kind_late", authored_at: "2026-10-20T09:00:00Z", kind: "follow_up_plan", payload: { label: "x", description: "y", due_at: null } });
  const second = await reconcile([makeSubmission(batch("batch_rules_kind_late_b", [b]))], first.ledger);
  assert.equal(op(second, b.operation_id).outcome, "rejected");
  assert.deepEqual(operationEligibility(second.ledger, a.operation_id).contest, ["record_kind_conflict"]);
}

// Local ledgers and receipts are validated before use.
for (const ledger of [{}, { format: "jr-agent-reconcile-ledger", schema_version: 2, operations: null, batches: {} }, { format: "jr-agent-reconcile-ledger", schema_version: 2, operations: { op_x: null }, batches: {} }]) {
  await assert.rejects(reconcile([], ledger), (e) => e instanceof AgentWorkspaceError && e.code === "invalid_ledger");
}
const entry = (fields) => ({ content_sha256: "a".repeat(64), outcome: "imported_draft", batch_id: "batch_x1", record_id: "agent_x_1", kind: "workspace_note_version", previous_operation_id: null, contest: [], variants: ["a".repeat(64)], ...fields });
const ledgerWith = (fields) => ({ format: "jr-agent-reconcile-ledger", schema_version: 2, operations: { op_xx_001: entry(fields) }, batches: {} });
for (const [fields, why] of [
  [{ outcome: "confirmed" }, "forged outcome"],
  [{ contest: ["approved"] }, "unknown contest reason"],
  [{ variants: ["b".repeat(64)] }, "variants without its own hash"],
  [{ variants: ["a".repeat(64), "b".repeat(64)] }, "variants without a recorded conflict"],
  [{ outcome: "contested" }, "contested without a reason"],
  [{ contest: ["fork", "fork"] }, "duplicate contest reasons"],
  [{ contest: ["operation_id_conflict", "fork"] }, "unsorted contest reasons"],
]) {
  await assert.rejects(reconcile([], ledgerWith(fields)), (e) => e.code === "invalid_ledger", why);
}
assert.ok(validateLedger(ledgerWith({ contest: ["operation_id_conflict"], variants: ["a".repeat(64), "b".repeat(64)] })));
// A v1 ledger is never read as v2; it is migrated explicitly with contest state empty.
const v1 = { format: "jr-agent-reconcile-ledger", schema_version: 1, operations: { op_xx_001: { content_sha256: "a".repeat(64), outcome: "imported_draft", batch_id: "batch_x1", record_id: "agent_x_1", kind: "workspace_note_version", previous_operation_id: null } }, batches: { batch_x1: "c".repeat(64) } };
await assert.rejects(reconcile([], v1), (e) => e.code === "invalid_ledger" && /migrate/.test(e.message));
const migrated = migrateLedgerV1(v1);
assert.deepEqual(migrated.operations.op_xx_001.contest, []);
assert.deepEqual(migrated.batches.batch_x1, { sha256: "c".repeat(64), actor_claim: null });
assert.equal(operationEligibility(migrated, "op_xx_001").eligible, true);
assert.throws(() => migrateLedgerV1({ ...v1, operations: { op_xx_001: { ...v1.operations.op_xx_001, outcome: "contested" } } }), (e) => e.code === "invalid_ledger");
await assert.rejects(reconcileWorkspace({ workspaceId: WORKSPACE_ID, receipts: [{ ...exported.receipt, manifest_sha256: "nope" }], canonical: snapshot, policy, ledger: null, submissions: [] }), (e) => e.code === "invalid_receipt");
await assert.rejects(reconcileWorkspace({ workspaceId: "workspace_someone_else", receipts, canonical: snapshot, policy, ledger: null, submissions: [] }), (e) => e.code === "invalid_receipt");
await assert.rejects(reconcileWorkspace({ workspaceId: WORKSPACE_ID, receipts: [{ ...exported.receipt, schema_version: 1 }], canonical: snapshot, policy, ledger: null, submissions: [] }), (e) => e.code === "invalid_receipt");
await assert.rejects(reconcileWorkspace({ workspaceId: WORKSPACE_ID, receipts: [{ ...exported.receipt, trusted: true }], canonical: snapshot, policy, ledger: null, submissions: [] }), (e) => e.code === "invalid_receipt");
void sha256;

console.log("agent-workspace reconcile rule tests passed");
