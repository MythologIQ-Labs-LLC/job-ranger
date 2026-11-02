// Cross-platform `JOB_RANGER_PWA_FLAVOR=demo vite <command> --config vite.pwa.config.ts`
// (npm scripts run under cmd.exe on Windows, where inline environment
// assignments do not work).
//
//   node scripts/pwa-demo.mjs build     -> dist-pwa-demo/ (the standard dist-pwa/ is untouched)
//   node scripts/pwa-demo.mjs preview   -> serves dist-pwa-demo/ at http://localhost:4175
//
// The demo's local ports differ from the standard web app's (4174/5174) on
// purpose: the demo wipes its origin's storage every session, so it must never
// run on the address that holds a real local workspace.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PWA_FLAVOR_ENV, assertDemoPortAllowed } from "./pwa-flavor.mjs";

/** Ports requested on the command line (`--port N`, `--port=N`). */
function requestedPorts(args) {
  const ports = [];
  args.forEach((arg, index) => {
    if (arg === "--port") ports.push(args[index + 1]);
    else if (arg.startsWith("--port=")) ports.push(arg.slice("--port=".length));
  });
  return ports;
}

const [command = "build", ...rest] = process.argv.slice(2);
if (!["build", "preview"].includes(command)) {
  console.error("Usage: node scripts/pwa-demo.mjs [build|preview] [vite options]");
  process.exit(2);
}
// Refuse before starting anything (vite.pwa.config.ts enforces the same rule).
try {
  for (const port of requestedPorts(rest)) assertDemoPortAllowed(port);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");

const result = spawnSync(process.execPath, [viteBin, command, "--config", "vite.pwa.config.ts", ...rest], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, [PWA_FLAVOR_ENV]: "demo" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
