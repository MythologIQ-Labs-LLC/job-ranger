import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ALLOWED_SCOPES, parseOperatorArguments, inspectLocalPrerequisites,
  validateTunnelEnvironment, buildLaunchSpec,
} from "../mcp/tunnel-operator.mjs";
import { adapterArguments, scrubForAdapter } from "../mcp/sanitized-stdio-launcher.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockWorkspace = path.join(root, "_synthetic_workspace");
const tunnelId = `tunnel_${"c".repeat(32)}`;
const env = {
  CONTROL_PLANE_API_KEY: "sk-SENTINEL_CONTROL_PLANE_SECRET_DO_NOT_EXPOSE",
  CONTROL_PLANE_TUNNEL_ID: tunnelId,
  OPENAI_ADMIN_KEY: "sk-SENTINEL_ADMIN_SECRET",
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  SQLITE3_PATH: "/bin/sqlite3",
  NODE_OPTIONS: "--inspect",
};
const off = parseOperatorArguments(["--scopes=none"]);
assert.deepEqual(off.scopes, []);
assert.equal(off.mode, "check");
assert.equal(inspectLocalPrerequisites(off).ready, true);
assert.throws(() => parseOperatorArguments([]), /Explicit/);
assert.throws(() => parseOperatorArguments(["--scopes=all:read"]), /supported read scopes/);
assert.throws(() => parseOperatorArguments(["--scopes=posts:read,posts:read"]), /unique/);
assert.throws(() => parseOperatorArguments(["--scopes=posts:read"]), /absolute --data-dir/);
assert.throws(() => parseOperatorArguments(["--mode=run", "--scopes=evidence:read", `--data-dir=${mockWorkspace}`]), /approval|approve-private-data-transfer/);
assert.throws(() => parseOperatorArguments(["--mode=run", "--scopes=none", "--bad=1"]), /Unknown/);
assert.throws(() => parseOperatorArguments(["--mode=shell", "--scopes=none"]), /Only check or run/);
assert.throws(() => parseOperatorArguments(["--mode=run", "--scopes=none", "--tunnel-bin=a\ncmd"]), /Invalid tunnel/);
assert( ALLOWED_SCOPES.includes("evidence:read") );
assert.equal(validateTunnelEnvironment(env, "run").ready, true);
assert.equal(validateTunnelEnvironment({ ...env, CONTROL_PLANE_API_KEY: "" }, "run").ready, false);
assert.equal(validateTunnelEnvironment({ ...env, CONTROL_PLANE_TUNNEL_ID: "tunnel_notvalid" }, "run").ready, false);
const config = parseOperatorArguments([
  "--mode=run", "--scopes=posts:read,evidence:read",
  `--data-dir=${mockWorkspace}`,
  "--approve-private-data-transfer=yes",
]);
const spec = buildLaunchSpec(config, env);
assert.equal(spec.binary, "tunnel-client");
assert(spec.args.includes("--mcp.max-concurrent-requests=1"));
assert(spec.args.some((v) => v.includes("mcp/sanitized-stdio-launcher.mjs")));
assert(!JSON.stringify(spec.args).includes(mockWorkspace));
assert(!JSON.stringify(spec.args).includes("SENTINEL"));
assert.equal(spec.env.SOJOURNER_MCP_SCOPES, "posts:read,evidence:read");
assert.equal(spec.env.SOJOURNER_MCP_DATA_DIR, mockWorkspace);
assert.deepEqual(adapterArguments(spec.env), [
  `--data-dir=${mockWorkspace}`, "--scopes=posts:read,evidence:read",
]);
const minimal = buildLaunchSpec({ ...off, mode: "run", binary: "tunnel-client" }, env);
assert.equal(minimal.env.SOJOURNER_MCP_SCOPES, "none");
assert.equal(minimal.env.SOJOURNER_MCP_DATA_DIR, undefined);
assert.deepEqual(adapterArguments(minimal.env), ["--scopes=none"]);
const scrubbed = scrubForAdapter(spec.env);
assert.equal(scrubbed.CONTROL_PLANE_API_KEY, undefined);
assert.equal(scrubbed.OPENAI_ADMIN_KEY, undefined);
assert.equal(scrubbed.CONTROL_PLANE_TUNNEL_ID, undefined);
assert.equal(scrubbed.NODE_OPTIONS, undefined);
assert.equal(scrubbed.SQLITE3_PATH, env.SQLITE3_PATH);
assert.throws(() => adapterArguments({}), /explicitly grant/);
assert.throws(() => adapterArguments({ SOJOURNER_MCP_SCOPES: "all:read" }), /Invalid/);
assert.throws(() => adapterArguments({ SOJOURNER_MCP_SCOPES: "posts:read" }), /workspace path/);
const fakeFs = {
  realpathSync: (v) => v,
  lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false }),
  existsSync: () => true,
};
assert.equal(inspectLocalPrerequisites(config, fakeFs).ready, true);
assert.equal(inspectLocalPrerequisites(config, {
  ...fakeFs,
  lstatSync: () => ({ isFile: () => false, isSymbolicLink: () => true }),
}).ready, false);
assert.equal(inspectLocalPrerequisites(config, {
  ...fakeFs, realpathSync: () => { throw new Error("No database."); },
}).ready, false);

// The real sanitized stdio wrapper must serve only capabilities with no
// native database and must not leak inherited control-plane credentials.
async function spawnMcpWithoutData() {
  const child = spawn(process.execPath,
    [path.join(root, "mcp", "sanitized-stdio-launcher.mjs")], {
      cwd: root, env: { ...process.env, ...env, NODE_OPTIONS: "", SOJOURNER_MCP_SCOPES: "none" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  let transcript = "";
  let errors = "";
  child.stdout.on("data", (data) => { transcript += data.toString(); });
  child.stderr.on("data", (data) => { errors += data.toString(); });
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0", method: "initialize", id: 1, params: {
      protocolVersion: "2025-06-18",
    },
  }) + "\n");
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0", method: "tools/list", id: 2, params: {},
  }) + "\n");
  child.stdin.end();
  const code = await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((_, reject) => setTimeout(() => {
      child.kill(); reject(new Error("Sanitized MCP handshake timed out."));
    }, 15000)),
  ]);
  assert.equal(code, 0, errors);
  const messages = transcript.trim().split("\n").map(JSON.parse);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].result.serverInfo.name, "sojourner-local-readonly");
  assert.deepEqual(messages[1].result.tools.map((t) => t.name), ["get_capabilities"]);
  assert(!transcript.includes("SENTINEL"));
  assert(!errors.includes("SENTINEL"));
}
await spawnMcpWithoutData();
console.log("Secure MCP Tunnel scope, approval, secret isolation and local stdio handshake tests passed");
