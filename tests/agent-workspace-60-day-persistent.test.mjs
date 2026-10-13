// Agent workspace G3 (#286, #289): a 60-day, two-agent gap through the real persistent store,
// with restarts between syncs. Run on the sqlite3 CLI engine directly and on the PWA's SQLite
// WASM engine with --import ./tests/support/wasm-sqlite-preload.mjs.
//
// Day 0   export (receipt stored locally)
// Day 30  sync 1 sees part of the folder; one upload has a corrupted attachment
// Day 50  the user edits Career Evidence in Job Ranger
// Day 60  sync 2 sees everything: forks, stale citations, replay, a missing parent, the repaired
//         attachment and a late operation-ID conflict with a draft imported on day 30
// Day 61  sync 3 repeats day 60 after another restart and changes nothing
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentExport } from "../src/agent-workspace/index.ts";
import { loadLedger, syncAgentWorkspace } from "../src/agent-workspace/sync.ts";
import { attachmentRef, bytesOf, makeBatch, makeOperation, makeSubmission } from "./support/agent-workspace-helpers.mjs";

const require = createRequire(import.meta.url);
const { JobScoutBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { AgentWorkspaceBackend } = require("../electron-runtime/electron/src/agent-workspace-backend.cjs");
const sqliteModule = require("../electron-runtime/electron/src/sqlite.cjs");
const { BackupService, applyPendingRestore } = require("../electron-runtime/electron/src/backup-service.cjs");
const engineName = globalThis.__JOB_RANGER_SQL_ENGINE__ ?? "sqlite3-cli";
const onWasm = engineName.startsWith("sqlite-wasm");
const temp = mkdtempSync(join(tmpdir(), "jr-agent-60-"));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const day = (n, h = 10) => new Date(Date.UTC(2026, 9, 13 + n, h)).toISOString().replace(".000Z", "Z");

let status;
async function restart() {
  if (onWasm) (await import("../src/pwa/runtime/wasm-sqlite-engine.ts")).requireActiveWasmSqliteEngine().closeAll();
  const core = new JobScoutBackend({ dataDirectory: temp, schedulerEnabled: false, fetchImpl: async () => { throw new Error("no network"); } });
  await core.initialize();
  status = await core.getSystemStatus(process.platform);
  const backend = new AgentWorkspaceBackend({ databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath });
  await backend.initialize();
  return Object.fromEntries(Object.getOwnPropertyNames(AgentWorkspaceBackend.prototype).filter((n) => n !== "constructor" && !n.startsWith("map") && n !== "stateRow" && n !== "existingItems")
    .map((name) => [name, async (...args) => {
      try { return clone(await backend[name](...args.map(clone))); } catch (e) { throw new Error(e.code ? `${e.code}: ${e.message}` : e.message); }
    }]));
}
const db = () => new sqliteModule.SqliteClient(status.databasePath, status.sqliteBinaryPath);
// Every table outside the agent workspace's own state must be byte-for-byte unchanged.
async function canonicalDigest() {
  const hash = createHash("sha256");
  const tables = await db().queryAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'agent_workspace_%' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  assert.ok(tables.length > 20, "the canonical schema is present");
  for (const { name } of tables) {
    // Startup rewrites settings.updated_at on every launch; compare the values themselves.
    const columns = name === "settings" ? "key, value_json" : "*";
    const rows = JSON.stringify(await db().queryAll(`SELECT ${columns} FROM "${name}" ORDER BY rowid;`));
    hash.update(name).update(rows);
  }
  return hash.digest("hex");
}
async function items(store) {
  const rows = [];
  for (let cursor = null, first = true; first || cursor; first = false) {
    const page = await store.listItems({ cursor, limit: 500 });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  }
  return rows;
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url), "utf8"));
try {
  let store = await restart();
  const { workspaceId } = await store.getState();
  await store.setPolicy({ autoImportKinds: ["workspace_note_version", "opportunity_annotation", "material_draft_version"] });

  // Day 0: export and local receipt.
  const day0 = structuredClone(fixture);
  const exported = await createAgentExport(day0, { exportId: "ex_sixty_day0", workspaceId, createdAt: day(0), build: "sixty-day", scopes: ["confirmed_evidence", "selected_opportunities"], selectedJobIds: ["job_selected_001"], selectedResumeIds: [], selectedCoverLetterIds: [], schemaDocuments: [] });
  await store.recordExport(exported.receipt);
  const src = { exportId: "ex_sixty_day0", manifestSha256: exported.manifestSha256, workspaceId };
  const evRev = exported.receipt.record_revisions.ev_confirmed_scheduling;
  const insRev = exported.receipt.record_revisions.ev_authored_insurance;
  const app = fixture.applications[0];
  await db().transaction([`INSERT INTO applications (id, job_id, title, company_name, url, status, notes, created_at, updated_at) VALUES ('${app.id}', '${app.jobId}', 'Clinic Operations Coordinator', 'Harbor Health', '${app.url}', 'interested', 'PRIVATE', '${app.createdAt}', '${app.updatedAt}');`]);
  const digestBefore = await canonicalDigest();

  // Agents' work.
  const op = (id, kind, record, payload, prev = null, n = 1) => makeOperation({ operation_id: id, record_id: record, previous_operation_id: prev, authored_at: day(n), kind, payload });
  const note = (id, body, prev, n) => op(id, "workspace_note_version", "agent_sixty_note", { title: "Harbor Health research", body }, prev, n);
  const letter = (id, body, prev, n) => op(id, "material_draft_version", "agent_sixty_letter", { material_kind: "cover_letter", title: "Harbor letter", body, source_evidence_refs: [{ record_id: "ev_confirmed_scheduling", revision: evRev }], gate_status: "not_checked" }, prev, n);
  const batch = (id, actor, ops, prev, n) => makeBatch({ ...src, batchId: id, actorId: actor, createdAt: day(n, 18), previousBatchId: prev, operations: ops });
  const pdf = bytesOf("%PDF-1.4 resume draft");
  const resumeRef = attachmentRef("workspace/attachments/alpha/resume.pdf", pdf);
  const alpha1 = batch("batch_sixty_alpha_1", "agent_sixty_alpha", [note("op_sixty_note_v1", "Initial research.", null, 2), letter("op_sixty_letter_v1", "Draft one.", null, 3), op("op_sixty_annot", "opportunity_annotation", "agent_sixty_annot", { opportunity_id: "job_selected_001", title: "Fit", notes: "Strong overlap.", observed_at: day(3) }, null, 3)], null, 3);
  const alpha2 = batch("batch_sixty_alpha_2", "agent_sixty_alpha", [op("op_sixty_resume_v1", "material_draft_version", "agent_sixty_resume", { material_kind: "resume", title: "Resume draft", body: "See attachment.", source_evidence_refs: [{ record_id: "ev_authored_insurance", revision: insRev }], gate_status: "not_checked", attachments: [resumeRef] }, null, 20)], "batch_sixty_alpha_1", 20);
  const alpha3 = batch("batch_sixty_alpha_3", "agent_sixty_alpha", [note("op_sixty_note_v2a", "Alpha's revision.", "op_sixty_note_v1", 40), letter("op_sixty_letter_v2", "Draft two.", "op_sixty_letter_v1", 41), op("op_sixty_resume_v2", "material_draft_version", "agent_sixty_resume", { material_kind: "resume", title: "Resume draft", body: "Second revision.", source_evidence_refs: [], gate_status: "not_checked" }, "op_sixty_resume_v1", 42)], "batch_sixty_alpha_2", 42);
  const beta1 = batch("batch_sixty_beta_1", "agent_sixty_beta", [note("op_sixty_note_v2b", "Beta's competing revision.", "op_sixty_note_v1", 38), op("op_sixty_claim", "application_status_claim", "agent_sixty_claim", { application_id: "app_harbor_001", claimed_status: "submitted", reported_context: "User said they applied." }, null, 39), op("op_sixty_orphan", "workspace_note_version", "agent_sixty_orphan", { title: "Orphan", body: "Revises a version that never arrived." }, "op_sixty_never_written", 39)], null, 39);
  // Day 55: Beta replays Alpha's annotation verbatim, then reuses the note ID with other content.
  const annotationReplay = alpha1.operations[2];
  const beta2 = batch("batch_sixty_beta_2", "agent_sixty_beta", [annotationReplay, { ...alpha1.operations[0], payload: { title: "Harbor Health research", body: "Beta overwrote the initial research." } }], "batch_sixty_beta_1", 55);

  const corrupted = makeSubmission(alpha2, { attachments: { [resumeRef.path]: { declared: pdf, actual: bytesOf("%PDF-1.4 bit rot") } } });
  const repaired = makeSubmission(alpha2, { attachments: { [resumeRef.path]: { declared: pdf, actual: pdf } } });

  // Day 30: partial listing with a corrupted upload.
  store = await restart();
  const sync1 = await syncAgentWorkspace({ store, canonical: day0, submissions: [makeSubmission(alpha1), corrupted], now: () => day(30) });
  assert.equal(sync1.result.drafts.length, 3, "note, letter and annotation imported");
  assert.equal(sync1.result.report.batches.find((b) => b.batch_id === "batch_sixty_alpha_2").status, "incomplete");
  const afterDay30 = await items(store);
  assert.ok(afterDay30.find((i) => i.operationId === "op_sixty_note_v1").eligible);

  // Day 50: the user edits Career Evidence (canonical change, made in Job Ranger by the user).
  const day60 = structuredClone(fixture);
  day60.evidence[0].evidence.statement = "Coordinated scheduling and referrals across seven providers.";
  day60.evidence[0].evidence.updatedAt = day(50);

  // Day 60: everything is listed, after a restart.
  store = await restart();
  const all = [makeSubmission(alpha1), repaired, makeSubmission(alpha3), makeSubmission(beta1), makeSubmission(beta2)];
  const sync2 = await syncAgentWorkspace({ store, canonical: day60, submissions: all, now: () => day(60) });
  const after = await items(store);
  const byOp = (id) => after.filter((i) => i.operationId === id);
  // Forks: both revisions kept, neither eligible.
  for (const id of ["op_sixty_note_v2a", "op_sixty_note_v2b"]) assert.ok(byOp(id).length === 1 && !byOp(id)[0].eligible, id);
  // Late operation-ID conflict: the day-30 draft is downgraded, both versions kept.
  const noteVersions = byOp("op_sixty_note_v1");
  assert.equal(noteVersions.length, 2);
  assert.ok(noteVersions.every((i) => i.state === "contested" && !i.eligible));
  assert.ok(noteVersions.some((i) => i.previousState === "draft"));
  assert.ok(sync2.result.downgrades.some((d) => d.operation_id === "op_sixty_note_v1"));
  // Stale citation: the letter revision cites evidence the user changed on day 50.
  assert.equal(byOp("op_sixty_letter_v2")[0].state, "needs_rebase");
  // Replay: one stored annotation, the copy counted as a duplicate.
  assert.equal(byOp("op_sixty_annot").length, 1);
  assert.ok(sync2.result.report.duplicates.some((d) => d.operation_id === "op_sixty_annot"));
  // Missing parent: waits, kept.
  assert.equal(byOp("op_sixty_orphan")[0].state, "pending");
  // Repaired attachment completes the held chain and resolves its quarantine entry.
  assert.equal(byOp("op_sixty_resume_v1")[0].state, "draft");
  assert.equal(byOp("op_sixty_resume_v2")[0].state, "draft");
  assert.ok((await store.listQuarantine()).filter((q) => q.batchId === "batch_sixty_alpha_2").every((q) => q.status === "resolved"));
  // Claims are only staged.
  assert.equal(byOp("op_sixty_claim")[0].state, "proposal");

  // Day 61: restart and repeat; nothing changes, nothing is re-imported, nothing re-eligible.
  const settled = after.map(({ lastSeenRun, updatedAt, ...rest }) => rest);
  const ledgerSettled = await loadLedger(store);
  store = await restart();
  const sync3 = await syncAgentWorkspace({ store, canonical: day60, submissions: [...all].reverse(), now: () => day(61) });
  assert.equal(sync3.result.drafts.length, 0);
  assert.deepEqual((await items(store)).map(({ lastSeenRun, updatedAt, ...rest }) => rest), settled);
  assert.deepEqual(await loadLedger(store), ledgerSettled);

  // Invariants across the whole gap.
  const final = await items(store);
  const distinctSubmitted = new Set([alpha1, alpha2, alpha3, beta1, beta2].flatMap((b) => b.operations.map((o) => `${o.operation_id}|${JSON.stringify(o)}`)));
  assert.equal(final.length, distinctSubmitted.size, "every distinct piece of agent work is stored once");
  for (const item of final) {
    const detail = await store.getItem(item.operationId, item.contentSha256);
    const payload = detail.operation.payload;
    if ("gate_status" in payload) assert.equal(payload.gate_status, "not_checked", "no Truth Gate result is ever claimed");
  }
  assert.ok(!JSON.stringify(final).match(/"(PASS|approved|confirmed)"/), "no authority values appear in stored agent items");
  assert.equal(await canonicalDigest(), digestBefore, "canonical Job Ranger tables are unchanged");
  const runs = await store.listRuns(10);
  assert.deepEqual(runs.map((r) => r.runId), [3, 2, 1]);

  // A portable backup carries the trusted local state; restoring it on another installation
  // keeps the workspace identity, receipts, ledger, items and decisions, and a later sync of
  // the same folder changes nothing.
  const sourceState = await store.getState();
  const backupDir = join(temp, "backups");
  const userData = join(temp, "user-data");
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(userData, { recursive: true });
  const created = await new BackupService({ dataDirectory: temp, userDataDirectory: userData, databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath, appVersion: "test-g3" }).createBackup(backupDir);
  const targetRoot = mkdtempSync(join(tmpdir(), "jr-agent-60-target-"));
  try {
    const targetData = join(targetRoot, "data");
    const targetCore = new JobScoutBackend({ dataDirectory: targetData, schedulerEnabled: false, fetchImpl: async () => { throw new Error("no network"); } });
    await targetCore.initialize();
    const targetStatus = await targetCore.getSystemStatus(process.platform);
    await new AgentWorkspaceBackend({ databasePath: targetStatus.databasePath, sqliteBinaryPath: targetStatus.sqliteBinaryPath }).initialize();
    const targetBackup = new BackupService({ dataDirectory: targetData, userDataDirectory: targetRoot, databasePath: targetStatus.databasePath, sqliteBinaryPath: targetStatus.sqliteBinaryPath, appVersion: "test-g3" });
    await targetBackup.validateBackup(created.summary.bundlePath);
    await targetBackup.stageRestore(created.summary.bundlePath);
    await targetCore.dispose();
    if (onWasm) (await import("../src/pwa/runtime/wasm-sqlite-engine.ts")).requireActiveWasmSqliteEngine().closeAll();
    assert.equal(await applyPendingRestore({ userDataDirectory: targetRoot, dataDirectory: targetData }), true);
    const restoredCore = new JobScoutBackend({ dataDirectory: targetData, schedulerEnabled: false, fetchImpl: async () => { throw new Error("no network"); } });
    await restoredCore.initialize();
    const restoredStatus = await restoredCore.getSystemStatus(process.platform);
    const restoredBackend = new AgentWorkspaceBackend({ databasePath: restoredStatus.databasePath, sqliteBinaryPath: restoredStatus.sqliteBinaryPath });
    await restoredBackend.initialize();
    const restored = Object.fromEntries(["getState", "listReceipts", "ledgerOperations", "ledgerBatches", "listItems", "commitReconciliation", "getItem", "listQuarantine", "listRuns"].map((n) => [n, async (...a) => clone(await restoredBackend[n](...a.map(clone)))]));
    const restoredState = await restored.getState();
    assert.equal(restoredState.workspaceId, sourceState.workspaceId, "the workspace identity travels with the backup");
    assert.equal((await restored.listReceipts()).length, 1);
    assert.deepEqual(await loadLedger(restored), await loadLedger(store));
    assert.deepEqual((await items(restored)).map(({ lastSeenRun, updatedAt, ...r }) => r), (await items(store)).map(({ lastSeenRun, updatedAt, ...r }) => r));
    const afterRestore = await syncAgentWorkspace({ store: restored, canonical: day60, submissions: all, now: () => day(62) });
    assert.equal(afterRestore.result.drafts.length, 0, "no re-import after restore");
    assert.equal(afterRestore.result.contested.length, 0);
    await restoredCore.dispose();
  } finally {
    if (onWasm) (await import("../src/pwa/runtime/wasm-sqlite-engine.ts")).requireActiveWasmSqliteEngine().closeAll();
    rmSync(targetRoot, { recursive: true, force: true });
  }
  console.log(`agent-workspace 60-day persistent scenario passed on ${engineName}`, JSON.stringify({ items: final.length, states: Object.fromEntries([...new Set(final.map((i) => i.state))].map((s) => [s, final.filter((i) => i.state === s).length])), downgraded: sync2.result.downgrades.length }));
} finally {
  if (onWasm) (await import("../src/pwa/runtime/wasm-sqlite-engine.ts")).requireActiveWasmSqliteEngine().closeAll();
  rmSync(temp, { recursive: true, force: true });
}
