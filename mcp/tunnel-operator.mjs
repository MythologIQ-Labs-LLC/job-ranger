/**
 * Local-only operator gate for OpenAI's official Secure MCP Tunnel.
 *
 * Nothing is created, provisioned, connected, or transmitted in check mode.
 * Run mode requires a human's explicit consent and an already-provisioned
 * OpenAI tunnel with appropriate workspace permissions.
 */
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ALLOWED_SCOPES = Object.freeze([
  "tracks:read", "evidence:read", "opportunities:read",
  "posts:read", "post-content:read", "analytics:read",
]);
const TUNNEL_ID = /^tunnel_[0-9a-f]{32}$/;
const permittedKeys = new Set([
  "mode", "scopes", "data-dir", "tunnel-bin", "approve-private-data-transfer",
]);

export function parseOperatorArguments(argv) {
  const options = new Map();
  for (const entry of argv) {
    if (!entry.startsWith("--") || !entry.includes("="))
      throw new Error("Options must use --name=value. No unspecified actions are accepted.");
    const at = entry.indexOf("=");
    const key = entry.slice(2, at);
    if (!permittedKeys.has(key) || options.has(key))
      throw new Error("Unknown or repeated operator option.");
    options.set(key, entry.slice(at + 1));
  }
  const mode = options.get("mode") ?? "check";
  if (mode !== "check" && mode !== "run") throw new Error("Only check or run is supported.");
  const scopesRaw = options.get("scopes");
  if (!scopesRaw) throw new Error("Explicit --scopes=none or a scope list is required.");
  const scopes = scopesRaw === "none" ? [] : scopesRaw.split(",").map((s) => s.trim());
  if (scopes.some((s) => !ALLOWED_SCOPES.includes(s)) ||
      new Set(scopes).size !== scopes.length)
    throw new Error("Only unique, supported read scopes can be granted.");
  const dataDir = options.get("data-dir") ?? null;
  if (scopes.length && (!dataDir || !path.isAbsolute(dataDir)))
    throw new Error("Data scopes require an absolute --data-dir.");
  if (dataDir && !path.isAbsolute(dataDir))
    throw new Error("Supplied --data-dir must be absolute.");
  const approve = options.get("approve-private-data-transfer") === "yes";
  if (options.has("approve-private-data-transfer") &&
      !["yes", "no"].includes(options.get("approve-private-data-transfer")))
    throw new Error("The disclosure confirmation must be yes or no.");
  if (mode === "run" && scopes.length && !approve)
    throw new Error("Private data transfer requires --approve-private-data-transfer=yes.");
  const binary = options.get("tunnel-bin") ?? "tunnel-client";
  if (!binary || /[\r\n\x00]/.test(binary))
    throw new Error("Invalid tunnel client binary.");
  return { mode, scopes, dataDir, approve, binary };
}

export function inspectLocalPrerequisites(config, fileSystem = {
  realpathSync, lstatSync, statSync, existsSync,
}) {
  const errors = [];
  let realDirectory = null;
  if (config.scopes.length) {
    try {
      realDirectory = fileSystem.realpathSync(config.dataDir);
      // LEGACY: a data folder not yet migrated still holds jobscout.sqlite3.
      const LEGACY_DATABASE_FILE_NAME = "jobscout.sqlite3";
      const current = path.join(realDirectory, "sojourner.sqlite3");
      const database = fileSystem.existsSync(current) ? current : path.join(realDirectory, LEGACY_DATABASE_FILE_NAME);
      const meta = fileSystem.lstatSync(database);
      if (!meta.isFile() || meta.isSymbolicLink())
        errors.push("Expected a regular native sojourner.sqlite3 database, not a link or directory.");
    } catch {
      errors.push("A native SQLite workspace is unavailable at the supplied directory.");
    }
    const runtime = path.join(repoRoot, "electron-runtime", "electron", "src", "backend.cjs");
    if (!fileSystem.existsSync(runtime))
      errors.push("Compiled desktop services are missing. Run npm run desktop:compile.");
  }
  return { ready: errors.length === 0, errors, realDirectory };
}

export function validateTunnelEnvironment(env, mode) {
  const hasKey = typeof env.CONTROL_PLANE_API_KEY === "string" &&
    env.CONTROL_PLANE_API_KEY.length >= 12;
  const tunnelId = env.CONTROL_PLANE_TUNNEL_ID;
  const hasId = typeof tunnelId === "string" && TUNNEL_ID.test(tunnelId);
  const errors = [];
  if (!hasKey) errors.push("CONTROL_PLANE_API_KEY is not configured.");
  if (!hasId) errors.push("CONTROL_PLANE_TUNNEL_ID is missing or invalid.");
  // Never print the secret or identifier in diagnostics.
  return { ready: errors.length === 0, errors, required: mode === "run" };
}

export function buildLaunchSpec(config, env) {
  if (config.mode !== "run") throw new Error("Only run mode builds a live process.");
  const readiness = validateTunnelEnvironment(env, "run");
  if (!readiness.ready) throw new Error("Tunnel credentials and ID must be configured.");
  if (config.scopes.length && !config.approve)
    throw new Error("Explicit private-data approval is required.");
  // The MCP command is fixed and relative to the verified repository CWD.
  // Never interpolate paths, scope strings, credentials, or user-entered
  // values into a shell-interpreted command.
  const args = [
    "run",
    "--mcp.command=node mcp/sanitized-stdio-launcher.mjs",
    "--mcp.max-concurrent-requests=1",
    "--log.level=warn",
  ];
  const childEnv = {
    ...env,
    SOJOURNER_MCP_SCOPES: config.scopes.length ? config.scopes.join(",") : "none",
  };
  if (config.scopes.length) childEnv.SOJOURNER_MCP_DATA_DIR = config.dataDir;
  else delete childEnv.SOJOURNER_MCP_DATA_DIR;
  return { binary: config.binary, args, cwd: repoRoot, env: childEnv };
}

export async function runOperator(argv = process.argv.slice(2), env = process.env) {
  const config = parseOperatorArguments(argv);
  const local = inspectLocalPrerequisites(config);
  const credentials = validateTunnelEnvironment(env, config.mode);
  if (config.mode === "check") {
    const status = {
      mode: "check", transport: "outbound-only Secure MCP Tunnel (not launched)",
      permissions: config.scopes, localReady: local.ready,
      tunnelCredentialsPresent: credentials.ready,
      errors: [...local.errors, ...credentials.errors],
      notes: [
        "No network request, database read, tunnel creation or launch occurs in check mode.",
        "Workspace association, end-user access policy, and ChatGPT tool calls remain unverified here.",
        "For any private-data scopes, use only a tunnel bound to your own verified single-user workspace.",
      ],
    };
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
    return;
  }
  if (!local.ready) throw new Error(local.errors.join(" "));
  if (!credentials.ready) throw new Error(credentials.errors.join(" "));
  const spec = buildLaunchSpec(config, env);
  process.stderr.write("Starting official tunnel-client with explicit scope boundary. Close this terminal to stop forwarding.\n");
  const child = spawn(spec.binary, spec.args, {
    cwd: spec.cwd, env: spec.env, stdio: "inherit", shell: false,
  });
  const forward = (signal) => { if (!child.killed) child.kill(signal); };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOperator().catch(() => {
    process.stderr.write("Tunnel operator refused to start. Check scoped consent, local build, workspace binding, and official tunnel configuration.\n");
    process.exitCode = 1;
  });
}
