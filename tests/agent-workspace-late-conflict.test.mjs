// Agent workspace (#289, D09): a late operation-ID collision or late fork discovered after an
// earlier sync must durably contest the previously imported draft, preserve every variant and
// never restore eligibility automatically. Listing order, timestamps and actor claims never
// pick a winner. Persistence is simulated here by a JSON round-trip of the ledger; the store
// tests repeat this through the real PWA and Electron storage paths.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAgentExport, operationEligibility, reconcileWorkspace } from "../src/agent-workspace/index.ts";
import { makeBatch, makeOperation, makeSubmission, WORKSPACE_ID } from "./support/agent-workspace-helpers.mjs";

const snapshot = JSON.parse(readFileSync(new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url), "utf8"));
const canonicalBefore = JSON.stringify(snapshot);
const exported = await createAgentExport(snapshot, { exportId: "ex_late_day0", workspaceId: WORKSPACE_ID, createdAt: "2026-10-13T16:30:00Z", build: "late-conflict", scopes: ["confirmed_evidence"], selectedJobIds: [], selectedResumeIds: [], selectedCoverLetterIds: [], schemaDocuments: [] });
const receipts = [exported.receipt];
const src = { exportId: "ex_late_day0", manifestSha256: exported.manifestSha256 };
const policy = { autoImportKinds: ["workspace_note_version", "material_draft_version"] };
const persist = (ledger) => JSON.parse(JSON.stringify(ledger));
const reconcile = (submissions, ledger) => reconcileWorkspace({ workspaceId: WORKSPACE_ID, receipts, canonical: snapshot, policy, ledger, submissions });
const opResults = (result, id) => result.report.operations.filter((o) => o.operation_id === id);
const note = (id, record, body, prev = null) => makeOperation({ operation_id: id, record_id: record, previous_operation_id: prev, authored_at: "2026-10-20T09:00:00Z", kind: "workspace_note_version", payload: { title: "Note", body } });
const submit = (batchId, actorId, ops, previousBatchId = null) => makeSubmission(makeBatch({ ...src, batchId, actorId, createdAt: "2026-10-20T10:00:00Z", previousBatchId, operations: ops }));

const variantA = note("op_late_x", "agent_late_note", "Version A, imported first.");
const variantB = note("op_late_x", "agent_late_note", "Version B, same ID, different bytes.");
const batchA = submit("batch_late_a", "agent_late_alpha", [variantA]);
const batchB = submit("batch_late_b", "agent_late_beta", [variantB]);

// 1-3. Import X(A), persist the ledger and reopen.
const first = await reconcile([batchA], null);
assert.equal(opResults(first, "op_late_x")[0].outcome, "imported_draft");
const ledger1 = persist(first.ledger);
assert.equal(operationEligibility(ledger1, "op_late_x").eligible, true);

// 4-6. X arrives again with different bytes after the restart.
const second = await reconcile([batchA, batchB], ledger1);
const ledger2 = persist(second.ledger);
const xState = operationEligibility(ledger2, "op_late_x");
assert.equal(xState.eligible, false, "#289: the earlier imported draft must lose automatic eligibility");
assert.ok(xState.contest.includes("operation_id_conflict"));
assert.equal(ledger2.operations.op_late_x.variants.length, 2, "both content hashes are recorded durably");
assert.ok(opResults(second, "op_late_x").every((o) => o.outcome === "contested" || o.outcome === "already_reconciled"));
assert.ok(opResults(second, "op_late_x").some((o) => o.outcome === "contested"));
assert.ok(second.downgrades.some((d) => d.operation_id === "op_late_x" && d.contest.includes("operation_id_conflict")), "the store is told to downgrade the persisted draft");
const preserved = second.contested.filter((c) => c.operation_id === "op_late_x");
assert.ok(preserved.some((c) => c.operation.payload.body === "Version B, same ID, different bytes."), "the new variant's content is preserved");
assert.ok(preserved.some((c) => c.operation.payload.body === "Version A, imported first."), "the original variant's content is preserved when re-presented");
assert.equal(second.drafts.length, 0, "nothing new is imported");

// 7. Repeated, reordered syncs after more restarts: no re-eligibility, no new writes.
for (const order of [[batchB, batchA], [batchA], [batchB], [batchA, batchB, batchA]]) {
  const again = await reconcile(order, persist(ledger2));
  assert.deepEqual(persist(again.ledger), ledger2, "ledger is stable");
  assert.equal(again.drafts.length, 0);
  assert.equal(operationEligibility(again.ledger, "op_late_x").eligible, false);
}
// A third variant extends the durable record but still restores nothing.
const variantC = note("op_late_x", "agent_late_note", "Version C.");
const third = await reconcile([submit("batch_late_c", "agent_late_gamma", [variantC])], persist(ledger2));
assert.equal(third.ledger.operations.op_late_x.variants.length, 3);
assert.equal(operationEligibility(third.ledger, "op_late_x").eligible, false);

// Same result whichever variant was seen first or when both arrive together.
const together = await reconcile([batchB, batchA], null);
assert.equal(operationEligibility(together.ledger, "op_late_x").eligible, false);
assert.deepEqual([...together.ledger.operations.op_late_x.variants].sort(), [...ledger2.operations.op_late_x.variants].sort());
const reversedFirst = await reconcile([batchB], null);
const reversedSecond = await reconcile([batchA, batchB], persist(reversedFirst.ledger));
assert.equal(operationEligibility(reversedSecond.ledger, "op_late_x").eligible, false);

// Descendants of a contested operation are not eligible either.
const child = note("op_late_x_child", "agent_late_note", "Built on X.", "op_late_x");
const withChild = await reconcile([batchA, submit("batch_late_child", "agent_late_alpha", [child], "batch_late_a")], null);
assert.equal(operationEligibility(withChild.ledger, "op_late_x_child").eligible, true);
const childAfter = await reconcile([batchB], persist(withChild.ledger));
assert.equal(operationEligibility(childAfter.ledger, "op_late_x_child").eligible, false);
assert.ok(operationEligibility(childAfter.ledger, "op_late_x_child").contest.includes("ancestor_contested"));

// 8. A byte-identical replay remains a safe no-op.
const replay = await reconcile([batchA, batchA], ledger1);
assert.deepEqual(persist(replay.ledger), ledger1);
assert.equal(replay.drafts.length, 0);
assert.equal(replay.contested.length, 0);
assert.equal(operationEligibility(replay.ledger, "op_late_x").eligible, true);

// Late fork: a second child of the same parent arrives after the first child was imported.
const root = note("op_fork_root", "agent_fork_note", "Root.");
const childOne = note("op_fork_one", "agent_fork_note", "Alpha's edit.", "op_fork_root");
const childTwo = note("op_fork_two", "agent_fork_note", "Beta's edit.", "op_fork_root");
const forkBatchOne = submit("batch_fork_one", "agent_fork_alpha", [root, childOne]);
const forkBatchTwo = submit("batch_fork_two", "agent_fork_beta", [childTwo]);
const forkFirst = await reconcile([forkBatchOne], null);
assert.equal(operationEligibility(forkFirst.ledger, "op_fork_one").eligible, true);
const forkLate = await reconcile([forkBatchOne, forkBatchTwo], persist(forkFirst.ledger));
for (const id of ["op_fork_one", "op_fork_two"]) {
  const state = operationEligibility(forkLate.ledger, id);
  assert.equal(state.eligible, false, `${id} must not win by arrival order`);
  assert.ok(state.contest.includes("fork"), id);
}
assert.equal(operationEligibility(forkLate.ledger, "op_fork_root").eligible, true, "the shared parent stays usable");
const forkTogether = await reconcile([forkBatchTwo, forkBatchOne], null);
for (const id of ["op_fork_one", "op_fork_two"]) assert.equal(operationEligibility(forkTogether.ledger, id).eligible, false);
assert.ok(forkLate.staged.some((s) => s.operation_id === "op_fork_two"), "the late branch is kept");

assert.equal(JSON.stringify(snapshot), canonicalBefore, "canonical data never changes");
console.log("agent-workspace late conflict (#289) tests passed");
