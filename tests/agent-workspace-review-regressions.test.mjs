// Regressions from the independent G3 review VETO (#286 G3, #289). Each case reproduces a
// confirmed defect through the real store. Run on the sqlite3 CLI engine directly and on the
// PWA engine with --import ./tests/support/wasm-sqlite-preload.mjs.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentExport, parseOperationBatch, reconcileWorkspace } from "../src/agent-workspace/index.ts";
import { loadLedger, planCommit, syncAgentWorkspace } from "../src/agent-workspace/sync.ts";
import { bytesOf, makeBatch, makeOperation, makeSubmission } from "./support/agent-workspace-helpers.mjs";

const require = createRequire(import.meta.url);
const { JobScoutBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { AgentWorkspaceBackend } = require("../electron-runtime/electron/src/agent-workspace-backend.cjs");
const sqliteModule = require("../electron-runtime/electron/src/sqlite.cjs");
const engineName = globalThis.__JOB_RANGER_SQL_ENGINE__ ?? "sqlite3-cli";
const onWasm = engineName.startsWith("sqlite-wasm");
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url), "utf8"));
// Real job IDs are stringified integers.
const canonical = structuredClone(fixture);
canonical.jobs.push({ ...structuredClone(fixture.jobs[0]), id: "42" });

async function open(dir) {
  if (onWasm) (await import("../src/pwa/runtime/wasm-sqlite-engine.ts")).requireActiveWasmSqliteEngine().closeAll();
  const core = new JobScoutBackend({ dataDirectory: dir, schedulerEnabled: false, fetchImpl: async () => { throw new Error("no network"); } });
  await core.initialize();
  const status = await core.getSystemStatus(process.platform);
  const backend = new AgentWorkspaceBackend({ databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath });
  await backend.initialize();
  const store = Object.fromEntries(["getState", "setPolicy", "recordExport", "listReceipts", "ledgerOperations", "ledgerBatches", "commitReconciliation", "listItems", "getItem", "listQuarantine", "listRuns", "decide"]
    .map((n) => [n, async (...a) => { try { return clone(await backend[n](...a.map(clone))); } catch (e) { throw new Error(e.code ? `${e.code}: ${e.message}` : e.message); } }]));
  return { store, status };
}

const failures = [];
async function scenario(name, run) {
  const dir = mkdtempSync(join(tmpdir(), "jr-agent-review-"));
  try {
    const { store, status } = await open(dir);
    const { workspaceId } = await store.getState();
    await store.setPolicy({ autoImportKinds: ["workspace_note_version", "opportunity_annotation"] });
    const exported = await createAgentExport(canonical, { exportId: "ex_review_day0", workspaceId, createdAt: "2026-10-13T16:30:00Z", build: "review", scopes: ["confirmed_evidence"], selectedJobIds: [], selectedResumeIds: [], selectedCoverLetterIds: [], schemaDocuments: [] });
    await store.recordExport(exported.receipt);
    const src = { exportId: "ex_review_day0", manifestSha256: exported.manifestSha256, workspaceId };
    const note = (id, body, prev = null, record = "agent_review_note") => makeOperation({ operation_id: id, record_id: record, previous_operation_id: prev, authored_at: "2026-10-20T09:00:00Z", kind: "workspace_note_version", payload: { title: "Note", body } });
    const submit = (batchId, ops, actor = "agent_review_alpha", previousBatchId = null) => makeSubmission(makeBatch({ ...src, batchId, actorId: actor, createdAt: "2026-10-20T10:00:00Z", previousBatchId, operations: ops }));
    const sync = (submissions) => syncAgentWorkspace({ store, canonical, submissions });
    const items = async () => (await store.listItems({ limit: 500 })).rows;
    await run({ store, status, src, note, submit, sync, items, dir });
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`);
  } finally {
    if (onWasm) (await import("../src/pwa/runtime/wasm-sqlite-engine.ts")).requireActiveWasmSqliteEngine().closeAll();
    rmSync(dir, { recursive: true, force: true });
  }
}

// 1. Every schema-valid batch ID (7-128 characters) syncs; one never blocks the others.
await scenario("batch id bounds", async ({ note, submit, sync, items }) => {
  const shortId = "batch_a";
  const longId = `batch_${"x".repeat(122)}`;
  assert.equal(longId.length, 128);
  for (const id of [shortId, longId]) assert.equal(parseOperationBatch(submit(id, [note(`op_rv_${id.length}_1`, "x")]).batchBytes).ok, true, id);
  const result = await sync([submit(shortId, [note("op_rv_short", "Short ID batch.", null, "agent_rv_short")]), submit(longId, [note("op_rv_long", "Long ID batch.", null, "agent_rv_long")]), submit("batch_rv_normal", [note("op_rv_normal", "Normal.", null, "agent_rv_normal")])]);
  assert.equal(result.result.report.counts.batches_accepted, 3);
  assert.equal((await items()).filter((i) => i.state === "draft").length, 3);
});

// 2. Control characters in agent text round-trip exactly and never break a sync.
await scenario("control characters", async ({ store, note, submit, sync, items }) => {
  const body = "line one\r\nline two\u001ahidden\ttab\u0000nul\u007fdel";
  const op = makeOperation({ operation_id: "op_rv_ctrl", record_id: "agent_rv_ctrl", authored_at: "2026-10-20T09:00:00Z", kind: "workspace_note_version", payload: { title: "Title\u001a with \r\n controls", body } });
  await sync([submit("batch_rv_ctrl", [op]), submit("batch_rv_ok", [note("op_rv_ok", "Fine.", null, "agent_rv_ok")])]);
  const item = (await items()).find((i) => i.operationId === "op_rv_ctrl");
  assert.equal(item.state, "draft");
  const detail = await store.getItem(item.operationId, item.contentSha256);
  assert.equal(detail.operation.payload.body, body);
  assert.equal(detail.operation.payload.title, "Title\u001a with \r\n controls");
});

// 3. A pending variant counts: a later different version of the same ID is contested, not imported.
await scenario("pending variant", async ({ note, submit, sync, items }) => {
  await sync([submit("batch_rv_pending", [note("op_rv_dup", "Version A, waits for a missing parent.", "op_rv_missing_parent")])]);
  assert.equal((await items())[0].state, "pending");
  const second = await sync([submit("batch_rv_other", [note("op_rv_dup", "Version B, no parent.")], "agent_review_beta")]);
  const versions = (await items()).filter((i) => i.operationId === "op_rv_dup");
  assert.equal(versions.length, 2);
  assert.ok(versions.every((i) => !i.eligible && i.state === "contested"), JSON.stringify(versions.map((v) => [v.state, v.contest])));
  assert.equal(second.result.drafts.length, 0);
});

// 3b. The same holds for a variant that was refused at operation level.
await scenario("rejected variant", async ({ submit, sync, items }) => {
  const shadow = makeOperation({ operation_id: "op_rv_shadowdup", record_id: "ev_confirmed_scheduling", authored_at: "2026-10-20T09:00:00Z", kind: "workspace_note_version", payload: { title: "Note", body: "Refused: reuses a canonical ID." } });
  await sync([submit("batch_rv_shadow", [shadow])]);
  const clean = makeOperation({ operation_id: "op_rv_shadowdup", record_id: "agent_rv_clean", authored_at: "2026-10-20T09:00:00Z", kind: "workspace_note_version", payload: { title: "Note", body: "Different content, same ID." } });
  await sync([submit("batch_rv_clean", [clean], "agent_review_beta")]);
  assert.ok((await items()).filter((i) => i.operationId === "op_rv_shadowdup").every((i) => !i.eligible));
});

// 4. A kept draft that later becomes contested loses eligibility and returns to review.
await scenario("kept then conflict", async ({ store, note, submit, sync, items }) => {
  await sync([submit("batch_rv_keep", [note("op_rv_keep", "Version A.")])]);
  const [draft] = await items();
  const kept = await store.decide({ operationId: draft.operationId, contentSha256: draft.contentSha256, action: "keep_draft" });
  assert.equal(kept.eligible, true);
  await sync([submit("batch_rv_keep_b", [note("op_rv_keep", "Version B.")], "agent_review_beta")]);
  const after = (await items()).find((i) => i.contentSha256 === draft.contentSha256);
  assert.equal(after.eligible, false);
  assert.equal(after.state, "contested");
  assert.equal(after.previousState, "kept");
  // Keeping it again needs an explicit acknowledgement of the conflict.
  await assert.rejects(store.decide({ operationId: after.operationId, contentSha256: after.contentSha256, action: "keep_draft" }), /contest_not_acknowledged/);
  const rekept = await store.decide({ operationId: after.operationId, contentSha256: after.contentSha256, action: "keep_draft", acknowledgeContest: true });
  assert.equal(rekept.eligible, true, "an acknowledged keep is usable again");
});

// 5. A decision made while a sync is being planned is never overwritten by that sync.
await scenario("decision during sync", async ({ store, note, submit, sync, items }) => {
  await sync([submit("batch_rv_race", [note("op_rv_race", "Version A.")])]);
  const [draft] = await items();
  // Plan a sync that will contest this draft, then decide before it commits.
  const state = await store.getState();
  const ledger = await loadLedger(store);
  const receipts = (await store.listReceipts()).map((r) => r.receipt);
  const result = await reconcileWorkspace({ workspaceId: state.workspaceId, receipts, canonical, policy: state.policy, ledger, submissions: [submit("batch_rv_race", [note("op_rv_race", "Version A.")]), submit("batch_rv_race_b", [note("op_rv_race", "Version B.")], "agent_review_beta")] });
  const plan = planCommit(result, ledger, state.ledgerRevision, "2026-10-21T10:00:00Z");
  await store.decide({ operationId: draft.operationId, contentSha256: draft.contentSha256, action: "keep_draft" });
  await assert.rejects(store.commitReconciliation(plan), /concurrent_update/);
  const mid = (await items()).find((i) => i.contentSha256 === draft.contentSha256);
  assert.equal(mid.state, "kept", "the stale plan wrote nothing");
  // The orchestrator replans from fresh state; the decision log and state stay consistent.
  await sync([submit("batch_rv_race", [note("op_rv_race", "Version A.")]), submit("batch_rv_race_b", [note("op_rv_race", "Version B.")], "agent_review_beta")]);
  const final = await store.getItem(draft.operationId, draft.contentSha256);
  assert.equal(final.state, "contested");
  assert.equal(final.previousState, "kept");
  assert.deepEqual(final.decisions.map((d) => [d.fromState, d.toState]), [["draft", "kept"]]);
});

// 6. Annotations on real (integer-ID) jobs are accepted and recognised.
await scenario("numeric job ids", async ({ submit, sync, items }) => {
  const annotation = makeOperation({ operation_id: "op_rv_annot", record_id: "agent_rv_annot", authored_at: "2026-10-20T09:00:00Z", kind: "opportunity_annotation", payload: { opportunity_id: "42", title: "Fit", notes: "Good fit.", observed_at: "2026-10-20T09:00:00Z" } });
  const result = await sync([submit("batch_rv_annot", [annotation])]);
  assert.equal(result.result.report.batches[0].status, "accepted");
  const item = (await items()).find((i) => i.operationId === "op_rv_annot");
  assert.equal(item.state, "draft");
  assert.ok(!item.flags.includes("unknown_opportunity"));
});

// 7. The backend keeps ledger contest state monotonic even if a plan tries to clear it.
await scenario("backend ledger monotonic", async ({ store, note, submit, sync }) => {
  await sync([submit("batch_rv_mono", [note("op_rv_mono", "Version A.")])]);
  await sync([submit("batch_rv_mono_b", [note("op_rv_mono", "Version B.")], "agent_review_beta")]);
  const before = (await loadLedger(store)).operations.op_rv_mono;
  assert.ok(before.contest.includes("operation_id_conflict"));
  const state = await store.getState();
  await store.commitReconciliation({ expectedRevision: state.ledgerRevision, startedAt: "2026-10-22T10:00:00Z", ledgerOperations: [{ operationId: "op_rv_mono", entry: { ...before, contest: [], variants: [before.content_sha256], outcome: "imported_draft" } }], ledgerBatches: [], items: [], downgrades: [], quarantine: [], acceptedBatchShas: [], counts: {}, batches: [] });
  const after = (await loadLedger(store)).operations.op_rv_mono;
  assert.ok(after.contest.includes("operation_id_conflict"), "contest reasons never shrink");
  assert.deepEqual(after.variants, before.variants, "recorded variants never shrink");
});

// 8. Only a reviewable claim can be recorded as applied; a waiting one cannot.
await scenario("pending claim", async ({ store, status, submit, sync, items }) => {
  const app = fixture.applications[0];
  await new sqliteModule.SqliteClient(status.databasePath, status.sqliteBinaryPath).transaction([`INSERT INTO applications (id, job_id, title, company_name, url, status, notes, created_at, updated_at) VALUES ('${app.id}', '${app.jobId}', 'T', 'C', '${app.url}', 'applied', '', '${app.createdAt}', '${app.updatedAt}');`]);
  const claim = makeOperation({ operation_id: "op_rv_claim", record_id: "agent_rv_claim", previous_operation_id: "op_rv_claim_parent", authored_at: "2026-10-20T09:00:00Z", kind: "application_status_claim", payload: { application_id: app.id, claimed_status: "submitted", reported_context: "Applied." } });
  await sync([submit("batch_rv_claim", [claim])]);
  const item = (await items()).find((i) => i.operationId === "op_rv_claim");
  assert.equal(item.state, "pending");
  await assert.rejects(store.decide({ operationId: item.operationId, contentSha256: item.contentSha256, action: "record_status_applied", applicationId: app.id, appliedStatus: "applied" }), /not_allowed/);
});

void bytesOf;
assert.deepEqual(failures, [], `failed: ${failures.join(", ")}`);
console.log(`agent-workspace review regressions passed on ${engineName}`);
