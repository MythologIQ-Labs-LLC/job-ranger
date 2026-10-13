#!/usr/bin/env node
// Local, user-invoked agent workspace tool (#285/#286). Run with:
//   node --experimental-strip-types scripts/agent-workspace-cli.mjs <command> [options]
//
// Commands (all offline; no network, no server, no OAuth, no database access):
//   export          --canonical <snapshot.json> --out <dir> --receipt-out <file> --export-id <ex_...>
//                   --workspace-id <id> --created-at <UTC> --build <id> --scopes <a,b> [--jobs ids]
//                   [--applications ids] [--resumes ids] [--cover-letters ids] [--schema-dir <dir>]
//   validate-batch  <batch.json> [--commit <batch.commit.json>]
//   reconcile       --workspace <dir> --workspace-id <id> --receipts <file|dir> --canonical <snapshot.json>
//                   [--ledger <ledger.json>] [--auto-import kinds] [--report-out <file>] [--ledger-out <file>]
//   migrate-ledger  --ledger <v1 ledger.json> --ledger-out <v2 ledger.json>
//
// reconcile only reads the workspace folder: workspace/agents/<actor>/batches/<batch_id>.json,
// its <batch_id>.commit.json marker and the attachments that marker declares. It never follows
// symlinks, never reads outside the folder and never writes into it. It produces a plan and a
// ledger; canonical Job Ranger data is not modified by this tool.

import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AgentWorkspaceError,
  LIMITS,
  canonicalJson,
  createAgentExport,
  decodeStrictUtf8,
  parseCommitMarker,
  parseOperationBatch,
  migrateLedgerV1,
  parseStrictJson,
  reconcileWorkspace,
} from "../src/agent-workspace/index.ts";

const MAX_INPUT = 64 * 1024 * 1024;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith("--")) {
      options[rest[i].slice(2)] = rest[i + 1] ?? "";
      i += 1;
    } else {
      positional.push(rest[i]);
    }
  }
  return { command, options, positional };
}

function fail(message, code = 2) {
  process.stderr.write(`agent-workspace: ${message}\n`);
  process.exit(code);
}

function readRegularFile(path, limit = MAX_INPUT) {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) throw new AgentWorkspaceError("symlink_refused", `Refusing to follow symlink ${path}.`);
  if (!info.isFile()) throw new AgentWorkspaceError("not_a_file", `${path} is not a regular file.`);
  if (info.size > limit) throw new AgentWorkspaceError("too_large", `${path} exceeds ${limit} bytes.`);
  return new Uint8Array(readFileSync(path));
}

const readJsonFile = (path) => parseStrictJson(decodeStrictUtf8(readRegularFile(path)));

function writeOutput(path, text) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const temp = `${resolve(path)}.tmp-${process.pid}`;
  writeFileSync(temp, text);
  renameSync(temp, resolve(path));
}

const list = (value) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []);

async function exportCommand({ options }) {
  for (const key of ["canonical", "out", "receipt-out", "export-id", "workspace-id", "created-at", "build", "scopes"]) if (!options[key]) fail(`export requires --${key}`);
  const snapshot = JSON.parse(JSON.stringify(readJsonFile(options.canonical)));
  const schemaDocuments = options["schema-dir"]
    ? readdirSync(options["schema-dir"]).filter((f) => f.endsWith(".schema.json")).sort().map((f) => ({ path: `schema/${f}`, text: decodeStrictUtf8(readRegularFile(join(options["schema-dir"], f))) }))
    : [];
  const result = await createAgentExport(snapshot, {
    exportId: options["export-id"],
    workspaceId: options["workspace-id"],
    createdAt: options["created-at"],
    build: options.build,
    scopes: list(options.scopes),
    selectedJobIds: list(options.jobs),
    selectedApplicationIds: list(options.applications),
    selectedResumeIds: list(options.resumes),
    selectedCoverLetterIds: list(options["cover-letters"]),
    schemaDocuments,
  });
  const root = resolve(options.out, result.receipt.export_id);
  for (const file of result.files) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.bytes);
  }
  writeFileSync(join(root, "manifest.json"), result.manifestBytes);
  writeOutput(options["receipt-out"], canonicalJson(result.receipt));
  process.stdout.write(`${canonicalJson({ export_id: result.receipt.export_id, manifest_sha256: result.manifestSha256, files: result.manifest.files, receipt: resolve(options["receipt-out"]) })}`);
}

function validateBatchCommand({ options, positional }) {
  if (!positional[0]) fail("validate-batch requires a batch file");
  const batch = parseOperationBatch(readRegularFile(positional[0], LIMITS.maxBatchBytes + 1));
  const commit = options.commit ? parseCommitMarker(readRegularFile(options.commit, LIMITS.maxCommitBytes + 1)) : null;
  const report = { batch: { ok: batch.ok, diagnostics: batch.diagnostics }, commit: commit && { ok: commit.ok, diagnostics: commit.diagnostics } };
  process.stdout.write(canonicalJson(report));
  process.exit(batch.ok && (!commit || commit.ok) ? 0 : 1);
}

/** Discovers batches strictly inside the workspace root without following links. */
function discover(workspaceRoot) {
  const root = realpathSync(workspaceRoot);
  // Resolve links in every path component (including Windows junctions) before trusting a path.
  const inside = (path) => {
    let real;
    try { real = realpathSync(path); } catch { return false; }
    const rel = relative(root, real);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  const agentsDir = join(root, "workspace", "agents");
  const submissions = [];
  const skipped = [];
  let agents = [];
  try { agents = readdirSync(agentsDir, { withFileTypes: true }); } catch { return { submissions, skipped }; }
  for (const agent of agents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!agent.isDirectory()) { skipped.push({ path: `workspace/agents/${agent.name}`, reason: "not_a_directory" }); continue; }
    const batchesDir = join(agentsDir, agent.name, "batches");
    let entries = [];
    try { entries = readdirSync(batchesDir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!entry.name.endsWith(".json") || entry.name.endsWith(".commit.json")) continue;
      const location = `workspace/agents/${agent.name}/batches/${entry.name}`;
      if (!entry.isFile()) { skipped.push({ path: location, reason: entry.isSymbolicLink() ? "symlink_refused" : "not_a_file" }); continue; }
      const batchPath = join(batchesDir, entry.name);
      if (!inside(batchPath)) { skipped.push({ path: location, reason: "outside_workspace" }); continue; }
      const commitPath = join(batchesDir, entry.name.replace(/\.json$/, ".commit.json"));
      let batchBytes;
      try { batchBytes = readRegularFile(batchPath, LIMITS.maxBatchBytes + 1); } catch (error) { skipped.push({ path: location, reason: error.code ?? "unreadable" }); continue; }
      let commitBytes = null;
      try { if (statSync(commitPath)) commitBytes = readRegularFile(commitPath, LIMITS.maxCommitBytes + 1); } catch { commitBytes = null; }
      const attachments = {};
      const marker = commitBytes ? parseCommitMarker(commitBytes) : null;
      if (marker?.ok) {
        for (const attachment of marker.value.attachments) {
          const target = join(root, ...attachment.path.split("/"));
          if (!inside(target)) continue;
          try { attachments[attachment.path] = readRegularFile(target, LIMITS.maxAttachmentBytes + 1); } catch { /* missing or refused: reconciliation reports it */ }
        }
      }
      submissions.push({ location, batchBytes, commitBytes, attachments });
    }
  }
  return { submissions, skipped };
}

function loadReceipts(path) {
  const info = lstatSync(path);
  const files = info.isDirectory() ? readdirSync(path).filter((f) => f.endsWith(".json")).sort().map((f) => join(path, f)) : [path];
  return files.map((file) => JSON.parse(JSON.stringify(readJsonFile(file)))).filter((r) => r.format === "jr-agent-export-receipt");
}

async function reconcileCommand({ options }) {
  for (const key of ["workspace", "workspace-id", "receipts", "canonical"]) if (!options[key]) fail(`reconcile requires --${key}`);
  // Outputs are local records; they must never be written where agents can edit them.
  const workspaceRoot = realpathSync(options.workspace);
  for (const key of ["report-out", "ledger-out"]) {
    if (!options[key]) continue;
    const rel = relative(workspaceRoot, resolve(options[key]));
    if (!rel.startsWith("..") && !isAbsolute(rel)) fail(`--${key} must be outside the workspace folder`, 1);
  }
  const { submissions, skipped } = discover(options.workspace);
  const result = await reconcileWorkspace({
    workspaceId: options["workspace-id"],
    receipts: loadReceipts(options.receipts),
    canonical: JSON.parse(JSON.stringify(readJsonFile(options.canonical))),
    policy: { autoImportKinds: list(options["auto-import"]) },
    ledger: options.ledger ? JSON.parse(JSON.stringify(readJsonFile(options.ledger))) : null,
    submissions,
  });
  const report = {
    ...result.report,
    skipped,
    drafts: result.drafts,
    staged: result.staged,
    contested: result.contested,
    downgrades: result.downgrades,
    quarantine: result.quarantine.map(({ bytes, ...rest }) => ({ ...rest, byte_length: bytes?.length ?? null })),
    history: result.history,
  };
  if (options["report-out"]) writeOutput(options["report-out"], canonicalJson(report));
  if (options["ledger-out"]) writeOutput(options["ledger-out"], canonicalJson(result.ledger));
  process.stdout.write(canonicalJson({ counts: result.report.counts, skipped: skipped.length }));
}

/** Explicit, one-way v1 to v2 ledger migration; v1 ledgers are never read as v2. */
function migrateLedgerCommand({ options }) {
  for (const key of ["ledger", "ledger-out"]) if (!options[key]) fail(`migrate-ledger requires --${key}`);
  if (resolve(options.ledger) === resolve(options["ledger-out"])) fail("migrate-ledger writes a new file; keep the v1 ledger as a backup", 1);
  const migrated = migrateLedgerV1(JSON.parse(JSON.stringify(readJsonFile(options.ledger))));
  writeOutput(options["ledger-out"], canonicalJson(migrated));
  process.stdout.write(canonicalJson({ migrated_operations: Object.keys(migrated.operations).length, migrated_batches: Object.keys(migrated.batches).length }));
}

const args = parseArgs(process.argv.slice(2));
try {
  if (args.command === "export") await exportCommand(args);
  else if (args.command === "validate-batch") validateBatchCommand(args);
  else if (args.command === "reconcile") await reconcileCommand(args);
  else if (args.command === "migrate-ledger") migrateLedgerCommand(args);
  else fail("usage: agent-workspace-cli.mjs <export|validate-batch|reconcile|migrate-ledger> [options]");
} catch (error) {
  // Report every failure as a short message; never print a raw stack trace or partial output.
  if (error instanceof AgentWorkspaceError) fail(`${error.code}: ${error.message}`, 1);
  fail(`${error?.code ?? "error"}: ${error?.message ?? String(error)}`, 1);
}
