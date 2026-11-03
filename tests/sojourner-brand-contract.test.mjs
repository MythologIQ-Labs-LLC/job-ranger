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

// Product and storage identity are Sojourner (owner decision 2026-11-02); existing users'
// data is migrated, not abandoned (electron/src/legacy-migration.cts and the web runtime's
// workspace migration).
assert.equal(manifest.name, "Sojourner: Employment Toolkit");
assert.equal(manifest.short_name, "Sojourner");
assert.equal(manifest.id, "./");
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
assert.match(page, /<title>Sojourner: Employment Toolkit<\/title>/);
assert.match(page, /name="sojourner-build"/);
assert.match(page, /%SOJOURNER_CSP%/);
assert.match(sidebar, />Sojourner<\/h1>/);
assert.match(sidebar, />Employment Toolkit<\/p>/);
assert.match(flavor, /<title>Sojourner Demo<\/title>/);
assert.match(flavor, /name: "Sojourner Demo"/);
assert.match(worker, /name: "sojourner-runtime"/);
// Owner decision 2026-11-02 (#339): the PWA's cache, event and lock identities are Sojourner too.
// An installed pre-rename workspace is migrated, never stranded: the worker also holds the
// LEGACY lock and copies the LEGACY OPFS root (src/pwa/runtime/workspace-migration.ts).
assert.match(read("src/pwa/service-worker.template.js"), /CACHE_PREFIX = "sojourner-shell-"/);
assert.match(read("src/pwa/service-worker.template.js"), /ON_DEMAND_CACHE = "sojourner-on-demand-v1"/);
assert.match(read("src/pwa/runtime/client.ts"), /STORAGE_FAILURE_EVENT = "sojourner:storage-failure"/);
assert.match(read("src/pwa/runtime/client.ts"), /BOOT_STATE_EVENT = "sojourner:boot-state"/);
assert.match(read("src/pwa/runtime/protocol.ts"), /RUNTIME_LOCK_NAME = "sojourner-web-runtime-v1"/);
assert.match(read("src/pwa/runtime/protocol.ts"), /LEGACY_RUNTIME_LOCK_NAME = "job-ranger-web-runtime-v1"/);
assert.match(read("src/pwa/PwaShell.tsx"), /Sojourner \(or an earlier Job Ranger tab\) is open in another tab or window/);
assert.match(packaging, /sojourner-web-v\$\{version\}\.zip/);
assert.match(read("src/demo/session.ts"), /sojourner\.\*/);
assert.match(read("src/demo/session.ts"), /LEGACY_STORAGE_KEY_PREFIX/);
assert.match(read("src/components/BackupRestorePanel.tsx"), /\.sojourner/);
assert.match(read("src/components/BackupRestorePanel.tsx"), /\.jobranger/);
// User-created artifacts, core onboarding and the demo must not carry the old
// public-facing product name, even though legacy data formats remain named.
const pdf = read("src/pwa/runtime/resume-pdf.ts");
assert.match(pdf, /document\.setCreator\("Sojourner"\)/);
assert.match(pdf, /document\.setProducer\("Sojourner web runtime \(pdf-lib\)"\)/);
assert.match(read("src/pages/CareerProfile.tsx"), /Tell Sojourner what good work looks like/);
assert.match(read("scripts/studio-handoff.mjs"), /Try Sojourner in your browser/);
assert.match(read("tests/pwa/demo-flavor.spec.ts"), /Sojourner Demo/);
console.log("Sojourner display, workspace and archive identity contracts passed");
