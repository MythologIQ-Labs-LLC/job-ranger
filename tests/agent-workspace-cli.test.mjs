// Agent workspace (#285/#286): the local CLI reuses the same core, reads only the workspace
// folder, refuses links that leave it, and never writes into it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesOf, makeBatch, makeOperation, makeSubmission } from "./support/agent-workspace-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "scripts", "agent-workspace-cli.mjs");
const fixture = join(root, "tests", "fixtures", "agent-workspace", "canonical-snapshot.synthetic.json");
const run = (...args) => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", cli, ...args], { encoding: "utf8" });
const temp = mkdtempSync(join(tmpdir(), "jr-agent-cli-"));

try {
  // Export a packet and its local receipt.
  const exported = JSON.parse(run("export", "--canonical", fixture, "--out", join(temp, "exports"), "--receipt-out", join(temp, "receipts", "ex_cli_day0.json"),
    "--export-id", "ex_cli_day0", "--created-at", "2026-10-13T16:30:00Z", "--build", "cli-test", "--scopes", "confirmed_evidence,selected_opportunities",
    "--jobs", "job_selected_001", "--schema-dir", join(root, "docs", "design", "schemas")));
  assert.match(exported.manifest_sha256, /^[a-f0-9]{64}$/);
  const manifestBytes = readFileSync(join(temp, "exports", "ex_cli_day0", "manifest.json"));
  assert.equal(createHash("sha256").update(manifestBytes).digest("hex"), exported.manifest_sha256);
  for (const file of exported.files) {
    const bytes = readFileSync(join(temp, "exports", "ex_cli_day0", ...file.path.split("/")));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
  }

  // An agent writes a batch and its commit marker into a separate workspace folder.
  const workspace = join(temp, "Agent Workspace");
  const writeSubmission = (submission) => {
    const path = join(workspace, ...submission.location.split("/"));
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, submission.batchBytes);
    if (submission.commitBytes) writeFileSync(path.replace(/\.json$/, ".commit.json"), submission.commitBytes);
  };
  const note = makeOperation({ operation_id: "op_cli_note_v1", record_id: "agent_note_cli", authored_at: "2026-10-20T09:00:00Z", kind: "workspace_note_version", payload: { title: "CLI note", body: "Written while Job Ranger was closed." } });
  writeSubmission(makeSubmission(makeBatch({ batchId: "batch_cli_001", actorId: "agent_cli_alpha", createdAt: "2026-10-20T10:00:00Z", exportId: "ex_cli_day0", manifestSha256: exported.manifest_sha256, operations: [note] })));

  // A second batch declares an attachment reached only through a link that leaves the workspace.
  const outside = join(temp, "outside");
  mkdirSync(outside, { recursive: true });
  const secret = bytesOf("%PDF-1.4 outside the workspace");
  writeFileSync(join(outside, "secret.pdf"), secret);
  mkdirSync(join(workspace, "workspace", "attachments"), { recursive: true });
  let linked = true;
  try { symlinkSync(outside, join(workspace, "workspace", "attachments", "evil"), process.platform === "win32" ? "junction" : "dir"); } catch { linked = false; }
  const draft = makeOperation({ operation_id: "op_cli_draft_v1", record_id: "agent_draft_cli", authored_at: "2026-10-21T09:00:00Z", kind: "material_draft_version", payload: { material_kind: "resume", title: "Draft", body: "See attachment.", source_evidence_refs: [], gate_status: "not_checked" } });
  writeSubmission(makeSubmission(makeBatch({ batchId: "batch_cli_002", actorId: "agent_cli_alpha", createdAt: "2026-10-21T10:00:00Z", exportId: "ex_cli_day0", manifestSha256: exported.manifest_sha256, operations: [draft] }), {
    attachments: { "workspace/attachments/evil/secret.pdf": { declared: secret, actual: null } },
  }));

  const snapshotWorkspace = () => {
    const files = [];
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(`${p}:${createHash("sha256").update(readFileSync(p)).digest("hex")}:${statSync(p).mtimeMs}`);
    });
    walk(workspace);
    return files.sort().join("\n");
  };
  const before = snapshotWorkspace();

  // validate-batch exits non-zero with diagnostics for an invalid file.
  const badBatch = join(temp, "bad.json");
  writeFileSync(badBatch, '{"format":"jr-agent-operation-batch","format":"x"}');
  const invalid = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", cli, "validate-batch", badBatch], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.ok(JSON.parse(invalid.stdout).batch.diagnostics.some((d) => d.code === "duplicate_key"));

  // reconcile: the note is imported, the linked attachment is never read.
  const reportPath = join(temp, "out", "report.json");
  const ledgerPath = join(temp, "out", "ledger.json");
  const counts = JSON.parse(run("reconcile", "--workspace", workspace, "--receipts", join(temp, "receipts"), "--canonical", fixture,
    "--auto-import", "workspace_note_version,material_draft_version", "--report-out", reportPath, "--ledger-out", ledgerPath)).counts;
  assert.equal(counts.imported_draft, 1);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const second = report.batches.find((b) => b.batch_id === "batch_cli_002");
  assert.equal(second.status, "incomplete");
  assert.ok(second.reasons.includes("attachment_missing"), "a linked attachment outside the workspace is never read");
  if (linked) {
    // The bytes are reachable through the link, so only the containment check kept them out.
    assert.deepEqual(new Uint8Array(readFileSync(join(workspace, "workspace", "attachments", "evil", "secret.pdf"))), secret);
  }
  assert.equal(snapshotWorkspace(), before, "the workspace folder is never modified");

  // A second run with the ledger is idempotent.
  const ledgerBefore = readFileSync(ledgerPath, "utf8");
  const again = JSON.parse(run("reconcile", "--workspace", workspace, "--receipts", join(temp, "receipts"), "--canonical", fixture,
    "--auto-import", "workspace_note_version", "--ledger", ledgerPath, "--ledger-out", ledgerPath)).counts;
  assert.equal(again.imported_draft, 0);
  assert.equal(again.already_reconciled, 1);
  assert.equal(readFileSync(ledgerPath, "utf8"), ledgerBefore);

  // Consequential kinds can never be auto-imported.
  const refused = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", cli, "reconcile", "--workspace", workspace, "--receipts", join(temp, "receipts"), "--canonical", fixture, "--auto-import", "application_status_claim"], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /invalid_policy/);
  console.log(`agent-workspace CLI tests passed${linked ? "" : " (link creation unavailable; containment path not exercised)"}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
