import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => readFileSync(path.join(root, relative), "utf8");
const manifest = JSON.parse(read("public/manifest.webmanifest"));
const page = read("web/index.html");
const sidebar = read("src/components/Sidebar.tsx");
const flavor = read("vite.pwa.config.ts");
const worker = read("src/pwa/main.tsx");
const packaging = read("scripts/pwa-flavor.mjs");

// Product identity changes; persistent application identity and existing users' files do not.
assert.equal(manifest.name, "Sojourner: Employment Toolkit");
assert.equal(manifest.short_name, "Sojourner");
assert.equal(manifest.id, "./");
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
assert.match(page, /<title>Sojourner: Employment Toolkit<\/title>/);
assert.match(page, /name="job-ranger-build"/);
assert.match(page, /%JOB_RANGER_CSP%/);
assert.match(sidebar, />Sojourner<\/h1>/);
assert.match(sidebar, />Employment Toolkit<\/p>/);
assert.match(flavor, /<title>Sojourner Demo<\/title>/);
assert.match(flavor, /name: "Sojourner Demo"/);
assert.match(worker, /name: "job-ranger-runtime"/);
// Preserve the installed PWA's cache and inter-tab event identities so an update
// does not silently strand an existing workspace or change lock semantics.
assert.match(read("src/pwa/service-worker.template.js"), /CACHE_PREFIX = "job-ranger-shell-"/);
assert.match(read("src/pwa/service-worker.template.js"), /ON_DEMAND_CACHE = "job-ranger-on-demand-v1"/);
assert.match(read("src/pwa/runtime/client.ts"), /STORAGE_FAILURE_EVENT = "job-ranger:storage-failure"/);
assert.match(read("src/pwa/runtime/client.ts"), /BOOT_STATE_EVENT = "job-ranger:boot-state"/);
assert.match(read("src/pwa/PwaShell.tsx"), /Sojourner is open in another tab or window/);
assert.match(packaging, /job-ranger-web-v\$\{version\}\.zip/);
assert.match(read("src/demo/session.ts"), /job-ranger\.\*/);
assert.match(read("src/components/BackupRestorePanel.tsx"), /\.jobranger/);
console.log("Sojourner display identity and legacy workspace/archive identity contracts passed");
