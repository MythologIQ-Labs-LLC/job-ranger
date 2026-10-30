import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const load = (file) => require(path.join(root, "electron-runtime", "electron", "src", file));
const { JobScoutBackend } = load("backend.cjs");
const { CareerBackend } = load("career-backend.cjs");
const { PersonalBrandBackend } = load("personal-brand-backend.cjs");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jr-mcp-smoke-"));
const dir = path.join(tmp, "canonical");
await fs.mkdir(dir, { recursive: true });
const backend = new JobScoutBackend({ dataDirectory: dir, schedulerEnabled: false,
  fetchImpl: async () => { throw new Error("Network forbidden during test."); } });

function protocolClient(args) {
  const child = spawn(process.execPath, [path.join(root, "mcp", "local-readonly-server.mjs"), ...args], {
    cwd: root, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env },
  });
  let buffer = "";
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const pos = buffer.indexOf("\n");
      const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch (e) { for (const entry of pending.values()) entry.reject(e); pending.clear(); continue; }
      const entry = pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer); pending.delete(message.id); entry.resolve(message);
      }
    }
  });
  let id = 0;
  function call(method, params = {}) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`MCP timeout (${method}), stderr=${stderr.slice(-300)}`)); }, 30000);
      pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
    });
  }
  return { child, call, getStderr: () => stderr };
}
try {
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const opts = { databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath };
  const career = new CareerBackend({ dataDirectory: dir, ...opts });
  await career.initialize();
  const evidence = await career.createUserEvidence({
    subjectType: "role", organization: "Example Company", titleOrName: "Support Lead",
    startDate: "2022-01", endDate: null,
    statement: "Led a customer support improvement project.", skills: ["Service operations"],
    methodsOrTools: [], scope: [], outcomes: [], metrics: [], credential: null,
  });
  const brand = new PersonalBrandBackend(opts);
  await brand.initialize();
  const draft = await brand.createDraft({
    body: "One practical lesson from improving a customer support process.",
    objective: "expertise_proof", audiences: ["recruiters"],
    destination: "linkedin", format: "text", hookArchetype: "lesson",
    hypothesis: "Specific stories may clarify my experience.",
    claimChecks: [], mediaCount: 0, mediaAccessibilityReviewed: true,
  });
  await brand.prepareDraft(draft.id, draft.revision, true);
  const receipt = await brand.confirmPublication({
    draftId: draft.id, revision: 1, publishedUrl: "https://www.linkedin.com/feed/update/urn:li:activity:local-mcp-test",
    publishedAt: "2026-10-01T12:00:00.000Z", userConfirmed: true,
  });
  await backend.dispose();
  const fingerprint = async () => createHash("sha256").update(await fs.readFile(status.databasePath)).digest("hex");
  const before = await fingerprint();

  const cli = protocolClient([
    `--data-dir=${dir}`,
    "--scopes=evidence:read,posts:read,analytics:read",
  ]);
  const init = await cli.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {
    name: "test-client", version: "1.0.0",
  } });
  assert.equal(init.result.serverInfo.name, "job-ranger-local-readonly");
  const toolList = await cli.call("tools/list");
  const toolNames = toolList.result.tools.map((tool) => tool.name);
  assert(toolNames.includes("get_confirmed_career_evidence"));
  assert(!toolNames.includes("get_post_experiment"));
  assert(!toolNames.includes("create_post_draft"));
  const read = await cli.call("tools/call", { name: "get_confirmed_career_evidence", arguments: {} });
  assert.equal(read.result.structuredContent.records[0].id, evidence.id);
  assert.equal(read.result.structuredContent.untrustedData, true);
  const publications = await cli.call("tools/call", { name: "list_personal_brand_posts", arguments: {} });
  assert.equal(publications.result.structuredContent.records[0].postId, receipt.postId);
  assert(!JSON.stringify(publications).includes(draft.body));
  const denied = await cli.call("tools/call", { name: "get_post_experiment",
    arguments: { postId: receipt.postId } });
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /Permission denied/);
  const mutate = await cli.call("tools/call", { name: "create_post_draft", arguments: {
    body: "malicious",
  } });
  assert.equal(mutate.result.isError, true);
  assert.match(mutate.result.content[0].text, /Unknown tool/);
  const analytics = await cli.call("tools/call", { name: "get_post_analytics",
    arguments: { postId: receipt.postId } });
  assert.equal(analytics.result.structuredContent.records.length, 0);
  cli.child.stdin.end();
  const exit = await new Promise((resolve) => {
    cli.child.once("close", (code) => resolve(code));
  });
  assert.equal(exit, 0, cli.getStderr());
  assert.equal(await fingerprint(), before, "Source SQLite database must remain unchanged by MCP.");

  const noData = protocolClient(["--scopes=none"]);
  await noData.call("initialize", { protocolVersion: "2025-06-18" });
  const onlyCapabilities = await noData.call("tools/list");
  assert.deepEqual(onlyCapabilities.result.tools.map((tool) => tool.name), ["get_capabilities"]);
  const introspection = await noData.call("tools/call", { name: "get_capabilities", arguments: {} });
  assert.equal(introspection.result.structuredContent.snapshotCapturedAt, null);
  const deniedEvidence = await noData.call("tools/call", {
    name: "get_confirmed_career_evidence", arguments: {},
  });
  assert.equal(deniedEvidence.result.isError, true);
  noData.child.stdin.end();
  assert.equal(await new Promise((resolve) => noData.child.once("close", resolve)), 0);
  assert.equal(await fingerprint(), before);

  // A client may pipeline small requests and close its input immediately.
  // EOF must not race accepted async requests against backend/snapshot cleanup.
  const burstChild = spawn(process.execPath,
    [path.join(root, "mcp", "local-readonly-server.mjs"), "--scopes=none"], {
      cwd: root, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env },
    });
  let burstOutput = "";
  let burstErrors = "";
  burstChild.stdout.on("data", data => { burstOutput += data.toString(); });
  burstChild.stderr.on("data", data => { burstErrors += data.toString(); });
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    ...Array.from({ length: 3300 }, (_, i) =>
      ({ jsonrpc: "2.0", id: i + 2, method: "ping" })),
    { jsonrpc: "2.0", id: 3302, method: "tools/list", params: {} },
  ];
  const batch = requests.map(message => JSON.stringify(message)).join("\\n") + "\\n";
  assert.ok(Buffer.byteLength(batch, "utf8") > 128 * 1024);
  burstChild.stdin.end(batch);
  const burstExit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      burstChild.kill();
      reject(new Error("Pipelined MCP batch did not drain before EOF."));
    }, 30000);
    burstChild.once("error", err => { clearTimeout(timer); reject(err); });
    burstChild.once("close", code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(burstExit, 0, burstErrors);
  const responses = burstOutput.trim().split("\\n").map(JSON.parse);
  assert.equal(responses.length, requests.length,
    "all framed requests must finish before stdin EOF releases the server");
  for (let index = 0; index < responses.length; index++) {
    assert.equal(responses[index].id, requests[index].id);
    assert.ok("result" in responses[index], "pipelined request may not be discarded");
  }
  assert.deepEqual(responses.at(-1).result.tools.map(tool => tool.name), ["get_capabilities"]);

  const noConsent = protocolClient([`--data-dir=${dir}`]);
  const deniedStartup = await new Promise((resolve) => noConsent.child.once("close", resolve));
  assert.notEqual(deniedStartup, 0);
  assert.match(noConsent.getStderr(), /failed to start/);
  assert(!noConsent.getStderr().includes(evidence.statement));
  assert.equal(await fingerprint(), before);
  console.log("MCP stdio startup, opt-in scopes, read-only snapshot and source integrity tests passed");
} finally {
  await backend.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
}
