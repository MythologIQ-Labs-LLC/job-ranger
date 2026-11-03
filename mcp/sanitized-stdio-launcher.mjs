#!/usr/bin/env node
/**
 * Fixed MCP command for tunnel-client. It deliberately inherits no tunnel
 * control-plane keys into the Sojourner data-reading subprocess.
 *
 * The operator passes scopes/data path through explicit nonsecret environment
 * variables; external MCP requests cannot set these values.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ALLOWED_SCOPES } from "./tunnel-operator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const permittedEnvironment = [
  "PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT",
  "WINDIR", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR",
  "SQLITE3_PATH", "LANG", "LC_ALL",
];

export function scrubForAdapter(input) {
  const clean = {};
  for (const name of permittedEnvironment) {
    if (typeof input[name] === "string") clean[name] = input[name];
  }
  return clean;
}

export function adapterArguments(env) {
  const raw = env.SOJOURNER_MCP_SCOPES;
  if (!raw) throw new Error("The tunnel operator did not explicitly grant a scope selection.");
  if (raw === "none") return ["--scopes=none"];
  const scopes = raw.split(",");
  if (!scopes.length || scopes.some((scope) => !ALLOWED_SCOPES.includes(scope)) ||
      new Set(scopes).size !== scopes.length)
    throw new Error("Invalid fixed read-only scope selection.");
  if (!env.SOJOURNER_MCP_DATA_DIR || !path.isAbsolute(env.SOJOURNER_MCP_DATA_DIR))
    throw new Error("Private reads require an absolute native workspace path.");
  return [
    `--data-dir=${env.SOJOURNER_MCP_DATA_DIR}`,
    `--scopes=${scopes.join(",")}`,
  ];
}

async function main() {
  const args = adapterArguments(process.env);
  const child = spawn(process.execPath,
    [path.join(root, "mcp", "local-readonly-server.mjs"), ...args], {
      cwd: root,
      shell: false,
      stdio: "inherit",
      env: scrubForAdapter(process.env),
    });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
  process.exitCode = code;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("MCP adapter launcher refused to start with invalid permissions or workspace.\n");
    process.exitCode = 1;
  });
}
