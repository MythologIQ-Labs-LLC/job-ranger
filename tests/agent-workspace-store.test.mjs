// Agent workspace G3 (#286, #289): persistent local state through the real shared backend.
// Run directly for the Electron sqlite3-CLI engine, and with
//   --import ./tests/support/wasm-sqlite-preload.mjs
// for the PWA's SQLite WASM engine. Every "restart" builds a fresh backend (and, on WASM,
// drops the cached connection so state is reloaded from the persisted database image).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentExport, operationEligibility } from "../src/agent-workspace/index.ts";
import { loadLedger, planCommit, syncAgentWorkspace } from "../src/agent-workspace/sync.ts";
import { scanWorkspaceFiles } from "../src/agent-workspace/workspace-files.ts";
import { makeBatch, makeOperation, makeSubmission } from "./support/agent-workspace-helpers.mjs";

const require = createRequire(import.meta.url);
const { JobScoutBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { AgentWorkspaceBackend } = require("../electron-runtime/electron/src/agent-workspace-backend.cjs");
const { CareerBackend } = require("../electron-runtime/electron/src/career-backend.cjs");
const sqliteModule = require("../electron-runtime/electron/src/sqlite.cjs");
const engineName = globalThis.__JOB_RANGER_SQL_ENGINE__ ?? "sqlite3-cli";
const onWasm = engineName.startsWith("sqlite-wasm");

const snapshot = JSON.parse(readFileSync(new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url), "utf8"));
const canonicalBefore = JSON.stringify(snapshot);
const temp = mkdtempSync(join(tmpdir(), "jr-agent-store-"));

// IPC carries structured clones and plain error messages; mimic both.
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
function ipcStore(backend) {
  const methods = ["getState", "setPolicy", "recordExport", "listReceipts", "ledgerOperations", "ledgerBatches", "commitReconciliation", "listItems", "getItem", "listQuarantine", "getQuarantine", "listRuns", "decide"];
  return Object.fromEntries(methods.map((name) => [name, async (...args) => {
    try {
      return clone(await backend[name](...args.map(clone)));
    } catch (error) {
      throw new Error(error.code ? `${error.code}: ${error.message}` : error.message);
    }
  }]));
}

let status;
async function openRuntime() {
  if (onWasm) {
    const { requireActiveWasmSqliteEngine } = await import("../src/pwa/runtime/wasm-sqlite-engine.ts");
    requireActiveWasmSqliteEngine().closeAll();
  }
  const core = new JobScoutBackend({ dataDirectory: temp, schedulerEnabled: false, fetchImpl: async () => { throw new Error("no network"); } });
  await core.initialize();
  status = await core.getSystemStatus(process.platform);
  const backend = new AgentWorkspaceBackend({ databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath });
  await backend.initialize();
  return { backend, store: ipcStore(backend) };
}
const rawSql = () => new sqliteModule.SqliteClient(status.databasePath, status.sqliteBinaryPath);
const allItems = async (store) => {
  const rows = [];
  for (let cursor = null, first = true; first || cursor; first = false) {
    const page = await store.listItems({ cursor, limit: 2 });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  }
  return rows;
};
const stable = (items) => items.map(({ lastSeenRun, updatedAt, ...rest }) => rest);

try {
  let { store } = await openRuntime();
  const state0 = await store.getState();
  assert.match(state0.workspaceId, /^ws_[a-f0-9]{32}$/);
  assert.equal(state0.ledgerRevision, 0);
  assert.deepEqual(state0.policy.autoImportKinds, []);
  const workspaceId = state0.workspaceId;

  // Policy accepts only agent-owned kinds.
  await assert.rejects(store.setPolicy({ autoImportKinds: ["evidence_change_proposal"] }), /invalid/);
  await store.setPolicy({ autoImportKinds: ["workspace_note_version", "material_draft_version", "opportunity_annotation"] });

  // A receipt is recorded locally from Job Ranger's own export, bound to this workspace.
  const exported = await createAgentExport(snapshot, { exportId: "ex_store_day0", workspaceId, createdAt: "2026-10-13T16:30:00Z", build: "store-test", scopes: ["confirmed_evidence", "selected_opportunities", "selected_applications"], selectedJobIds: ["job_selected_001"], selectedApplicationIds: ["app_harbor_001"], selectedResumeIds: [], selectedCoverLetterIds: [], schemaDocuments: [] });
  await store.recordExport(exported.receipt);
  await store.recordExport(exported.receipt); // idempotent
  await assert.rejects(store.recordExport({ ...exported.receipt, manifest_sha256: "f".repeat(64) }), /receipt_conflict/);
  await assert.rejects(store.recordExport({ ...exported.receipt, export_id: "ex_store_other", workspace_id: "ws_someone_else_000" }), /another workspace/);
  await assert.rejects(store.recordExport({ ...exported.receipt, export_id: "ex_store_extra", approved: true }), /unexpected field/);

  // Re-open: identity and receipts persist.
  ({ store } = await openRuntime());
  assert.equal((await store.getState()).workspaceId, workspaceId);
  assert.equal((await store.listReceipts()).length, 1);

  const src = { exportId: "ex_store_day0", manifestSha256: exported.manifestSha256, workspaceId };
  const note = (id, record, body, prev = null) => makeOperation({ operation_id: id, record_id: record, previous_operation_id: prev, authored_at: "2026-10-20T09:00:00Z", kind: "workspace_note_version", payload: { title: `Note ${id}`, body } });
  const submit = (batchId, actorId, ops, previousBatchId = null) => makeSubmission(makeBatch({ ...src, batchId, actorId, createdAt: "2026-10-20T10:00:00Z", previousBatchId, operations: ops }));
  const batchA = submit("batch_store_a", "agent_store_alpha", [note("op_store_x", "agent_store_note", "Version A.")]);
  const batchB = submit("batch_store_b", "agent_store_beta", [note("op_store_x", "agent_store_note", "Version B, same ID.")]);

  // #289 step 1-2: import X(A) and persist.
  const first = await syncAgentWorkspace({ store, canonical: snapshot, submissions: [batchA] });
  assert.equal(first.commit.runId, 1);
  let items = await allItems(store);
  assert.equal(items.length, 1);
  assert.equal(items[0].state, "draft");
  assert.equal(items[0].eligible, true);

  // Step 3-6: close, reopen, receive X(B).
  ({ store } = await openRuntime());
  const second = await syncAgentWorkspace({ store, canonical: snapshot, submissions: [batchB, batchA] });
  assert.equal(second.result.downgrades.length, 1);
  items = await allItems(store);
  assert.equal(items.length, 2, "both versions are stored");
  for (const item of items) {
    assert.equal(item.state, "contested", item.contentSha256);
    assert.equal(item.eligible, false);
    assert.ok(item.contest.includes("operation_id_conflict"));
  }
  const original = items.find((i) => i.previousState === "draft");
  assert.ok(original, "the earlier imported draft records that it was downgraded");
  const detail = await store.getItem(original.operationId, original.contentSha256);
  assert.equal(detail.operation.payload.body, "Version A.");
  assert.equal(detail.variants.length, 1);
  const ledger2 = await loadLedger(store);
  assert.equal(operationEligibility(ledger2, "op_store_x").eligible, false);
  assert.equal(ledger2.operations.op_store_x.variants.length, 2);

  // Step 7: repeat and reorder across restarts; nothing new, nothing re-eligible.
  const settled = stable(await allItems(store));
  for (const order of [[batchA], [batchB], [batchA, batchB], [batchB, batchA, batchB]]) {
    ({ store } = await openRuntime());
    const again = await syncAgentWorkspace({ store, canonical: snapshot, submissions: order });
    assert.equal(again.result.drafts.length, 0);
    assert.deepEqual(stable(await allItems(store)), settled);
    assert.deepEqual(await loadLedger(store), ledger2);
  }

  // Step 8: a byte-identical replay of a clean operation stays a no-op.
  const clean = submit("batch_store_clean", "agent_store_alpha", [note("op_store_clean", "agent_store_clean", "Clean.")], "batch_store_a");
  await syncAgentWorkspace({ store, canonical: snapshot, submissions: [clean] });
  const afterClean = stable(await allItems(store));
  await syncAgentWorkspace({ store, canonical: snapshot, submissions: [clean, clean] });
  assert.deepEqual(stable(await allItems(store)), afterClean);
  assert.equal(afterClean.find((i) => i.operationId === "op_store_clean").eligible, true);

  // Decisions: keeping a contested version needs acknowledgement; decisions survive syncs.
  await assert.rejects(store.decide({ operationId: original.operationId, contentSha256: original.contentSha256, action: "keep_draft" }), /contest_not_acknowledged/);
  const kept = await store.decide({ operationId: original.operationId, contentSha256: original.contentSha256, action: "keep_draft", acknowledgeContest: true, note: "Version A is right." });
  assert.equal(kept.state, "kept");
  assert.equal(kept.decisions.length, 1);
  await assert.rejects(store.decide({ operationId: original.operationId, contentSha256: original.contentSha256, action: "dismiss" }), /already_decided/);
  ({ store } = await openRuntime());
  await syncAgentWorkspace({ store, canonical: snapshot, submissions: [batchA, batchB] });
  assert.equal((await store.getItem(original.operationId, original.contentSha256)).state, "kept", "a sync never overrides a user decision");

  // A status claim is applied only after the user changes the status through the existing workflow.
  const career = new CareerBackend({ dataDirectory: temp, databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath });
  await career.initialize();
  const app = snapshot.applications[0];
  await rawSql().transaction([`INSERT INTO applications (id, job_id, title, company_name, url, status, notes, created_at, updated_at) VALUES ('${app.id}', '${app.jobId}', 'Clinic Operations Coordinator', 'Harbor Health', '${app.url}', 'interested', '', '${app.createdAt}', '${app.updatedAt}');`]);
  const claim = makeOperation({ operation_id: "op_store_claim", record_id: "agent_store_claim", authored_at: "2026-10-21T09:00:00Z", kind: "application_status_claim", payload: { application_id: app.id, claimed_status: "submitted", reported_context: "The user told the agent they applied." } });
  await syncAgentWorkspace({ store, canonical: snapshot, submissions: [batchA, batchB, clean, submit("batch_store_claim", "agent_store_alpha", [claim], "batch_store_clean")] });
  const claimItem = (await allItems(store)).find((i) => i.operationId === "op_store_claim");
  assert.equal(claimItem.state, "proposal");
  await assert.rejects(store.decide({ operationId: claimItem.operationId, contentSha256: claimItem.contentSha256, action: "keep_draft" }), /not_allowed/);
  await assert.rejects(store.decide({ operationId: claimItem.operationId, contentSha256: claimItem.contentSha256, action: "record_status_applied", applicationId: app.id, appliedStatus: "applied" }), /status_not_changed/);
  await assert.rejects(store.decide({ operationId: claimItem.operationId, contentSha256: claimItem.contentSha256, action: "record_status_applied", applicationId: app.id, appliedStatus: "offer" }), /does not match/);
  assert.equal((await career.listApplications()).find((a) => a.id === app.id).status, "interested", "nothing changed the status yet");
  await career.updateApplication(app.id, { status: "applied" }); // the existing, user-driven workflow
  const applied = await store.decide({ operationId: claimItem.operationId, contentSha256: claimItem.contentSha256, action: "record_status_applied", applicationId: app.id, appliedStatus: "applied" });
  assert.equal(applied.state, "applied");

  // Atomicity: a commit that fails inside its transaction leaves nothing behind.
  const before = await store.getState();
  const itemsBefore = stable(await allItems(store));
  const ledgerBefore = await loadLedger(store);
  const failing = await syncPlan(store, [submit("batch_store_fail", "agent_store_alpha", [note("op_store_fail", "agent_store_fail", "Never stored.")], "batch_store_claim")]);
  // Two identical new quarantine rows violate the primary key midway through the transaction.
  const duplicate = { kind: "batch", location: "workspace/agents/agent_store_alpha/batches/batch_dup.json", batchId: null, operationId: null, sha256: "e".repeat(64), reasons: ["invalid_location"], bytesBase64: null, byteLength: null, operation: null };
  failing.quarantine.push(duplicate, duplicate);
  assert.ok(failing.items.length > 0 && failing.ledgerOperations.length > 0, "the failing plan would otherwise write items and ledger rows");
  await assert.rejects(store.commitReconciliation(failing), /UNIQUE constraint failed/);
  assert.equal((await store.getState()).ledgerRevision, before.ledgerRevision);
  assert.deepEqual(stable(await allItems(store)), itemsBefore);
  assert.deepEqual(await loadLedger(store), ledgerBefore);
  // A stale plan (another window committed first) is refused as a whole.
  const stale = await syncPlan(store, [submit("batch_store_stale", "agent_store_alpha", [note("op_store_stale", "agent_store_stale", "Late.")], "batch_store_claim")]);
  await syncAgentWorkspace({ store, canonical: snapshot, submissions: [clean] });
  await assert.rejects(store.commitReconciliation(stale), /concurrent_update/);
  assert.ok(!(await allItems(store)).some((i) => i.operationId === "op_store_stale"));
  // Forged plans are refused at the boundary.
  const forged = await syncPlan(store, [submit("batch_store_forged", "agent_store_alpha", [makeOperation({ ...claim, operation_id: "op_store_claim_2", record_id: "agent_store_claim_2" })], "batch_store_claim")]);
  forged.items = forged.items.map((i) => ({ ...i, outcome: "imported_draft" }));
  await assert.rejects(store.commitReconciliation(forged), /cannot be imported as drafts/);

  // Quarantine keeps rejected bytes within limits; a large plan commits (stdin path on the CLI).
  const bad = makeSubmission(null, { rawBatch: '{"format":"jr-agent-operation-batch","format":"x"}' });
  bad.location = "workspace/agents/agent_store_alpha/batches/batch_store_bad.json";
  const many = Array.from({ length: 150 }, (_, i) => note(`op_store_bulk_${String(i).padStart(3, "0")}`, `agent_store_bulk_${i}`, `Bulk note ${i} `.repeat(20)));
  const bulk = [0, 1].map((k) => submit(`batch_store_bulk_${k}`, "agent_store_bulk", many.slice(k * 75, k * 75 + 75), k ? "batch_store_bulk_0" : null));
  const big = await syncAgentWorkspace({ store, canonical: snapshot, submissions: [bad, ...bulk] });
  assert.equal(big.result.drafts.length, 150);
  const quarantine = await store.listQuarantine();
  const badEntry = quarantine.find((q) => q.location.endsWith("batch_store_bad.json"));
  assert.equal(badEntry.bytesRetained, true);
  assert.equal(Buffer.from((await store.getQuarantine(badEntry.quarantineKey)).bytesBase64, "base64").toString(), '{"format":"jr-agent-operation-batch","format":"x"}');

  // Folder scanning feeds the same path.
  const scan = scanWorkspaceFiles([
    { path: "My Drive Folder/workspace/agents/agent_store_alpha/batches/batch_store_a.json", bytes: batchA.batchBytes },
    { path: "My Drive Folder/workspace/agents/agent_store_alpha/batches/batch_store_a.commit.json", bytes: batchA.commitBytes },
    { path: "My Drive Folder/../escape/workspace/agents/x/batches/batch_x.json", bytes: batchA.batchBytes },
  ]);
  assert.equal(scan.submissions.length, 1);
  assert.equal(scan.skipped.length, 1);

  // Corruption is detected and stops the sync; nothing is repaired silently.
  await rawSql().transaction(["UPDATE agent_workspace_ledger_operations SET entry_json = '{\"outcome\":\"confirmed\"}' WHERE operation_id = 'op_store_clean';"]);
  ({ store } = await openRuntime());
  const revisionBeforeCorruptSync = (await store.getState()).ledgerRevision;
  await assert.rejects(syncAgentWorkspace({ store, canonical: snapshot, submissions: [clean] }), (e) => e.code === "ledger_corrupt");
  assert.equal((await store.getState()).ledgerRevision, revisionBeforeCorruptSync);

  const runs = await store.listRuns(50);
  assert.ok(runs.length >= 10 && runs.every((r) => r.completedAt >= r.startedAt.slice(0, 19)));
  assert.equal(JSON.stringify(snapshot), canonicalBefore, "canonical snapshot never changes");
  console.log(`agent-workspace store tests passed on ${engineName}`);

  async function syncPlan(s, submissions) {
    const state = await s.getState();
    const ledger = await loadLedger(s);
    const { reconcileWorkspace } = await import("../src/agent-workspace/index.ts");
    const receipts = (await s.listReceipts()).map((r) => r.receipt);
    const result = await reconcileWorkspace({ workspaceId: state.workspaceId, receipts, canonical: snapshot, policy: state.policy, ledger, submissions });
    return planCommit(result, ledger, state.ledgerRevision, "2026-10-21T10:00:00Z");
  }
} finally {
  if (onWasm) {
    const { requireActiveWasmSqliteEngine } = await import("../src/pwa/runtime/wasm-sqlite-engine.ts");
    requireActiveWasmSqliteEngine().closeAll();
  }
  rmSync(temp, { recursive: true, force: true });
}
