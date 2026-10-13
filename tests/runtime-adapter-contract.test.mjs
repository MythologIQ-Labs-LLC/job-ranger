// Runtime boundary contract: every runtime-specific shared-core module has a
// web adapter that exports (at least) the same names, adapters stay narrow,
// and the shared core never imports Electron outside the documented
// IPC/infrastructure modules.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_BUILTIN_ADAPTERS, SHARED_CORE_ADAPTERS } from "../src/pwa/adapter-map.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronSource = path.join(root, "electron", "src");
const adapterDirectory = path.join(root, "src", "pwa", "adapters");

function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z0-9_]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && !name.startsWith("type ")) names.add(name);
    }
  }
  return names;
}

for (const [coreModule, adapter] of Object.entries(SHARED_CORE_ADAPTERS)) {
  const compiled = require(path.join(root, "electron-runtime", "electron", "src", coreModule.replace(/\.cts$/, ".cjs")));
  const adapterExports = exportedNames(readFileSync(path.join(adapterDirectory, adapter), "utf8"));
  for (const name of Object.keys(compiled)) {
    if (name === "__esModule") continue;
    assert.ok(adapterExports.has(name), `${adapter} must export ${name} (exported by ${coreModule})`);
  }
}

for (const adapter of Object.values(NODE_BUILTIN_ADAPTERS)) {
  readFileSync(path.join(adapterDirectory, adapter), "utf8");
}

// Electron APIs are confined to the main/IPC/infrastructure layer.
const electronAllowed = new Set([
  "main.cts",
  "preload.cts",
  "browser-loader.cts",
  "resume-renderer.cts",
  "tray-notifications.cts",
  "core-ipc.cts",
  "backup-ipc.cts",
  "json-resume-ipc.cts",
  "resume-ipc.cts",
  "evidence-extension-ipc.cts",
  "career-story-ipc.cts",
  "personal-brand-ipc.cts",
  "application-lifecycle-ipc.cts",
  "application-materials-ipc.cts",
  "application-insights-ipc.cts",
  "interview-prep-ipc.cts",
  "legacy-install-ipc.cts",
  "agent-workspace-ipc.cts",
]);
for (const file of readdirSync(electronSource).filter((name) => name.endsWith(".cts"))) {
  const source = readFileSync(path.join(electronSource, file), "utf8");
  if (/from "electron"/.test(source)) {
    assert.ok(electronAllowed.has(file), `${file} imports Electron but is not an IPC/infrastructure module`);
  }
  if (/from "node:child_process"/.test(source)) {
    assert.equal(file, "sqlite.cts", `${file} must not spawn processes (only the CLI SQLite adapter does)`);
  }
}

console.log("Runtime adapter contract passed");
