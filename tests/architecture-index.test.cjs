// Architecture authority regression guard. Fast and dependency-free.
// This checks the routing contract and explicit supersessions, not whether historical text vanished.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const indexPath = "docs/ARCHITECTURE_INDEX.md";
const index = read(indexPath);
assert.match(index, /^# Canonical Architecture Index/m);
for (const decision of ["ARCH-001", "ARCH-002", "ARCH-003", "ARCH-004", "ARCH-005", "ARCH-006"]) {
  assert.match(index, new RegExp('\\b' + decision + '\\b'), 'missing decision: ' + decision);
}
assert.match(index, /Progressive Web App is the sole intended product runtime and distribution channel/);
assert.match(index, /Electron is an internal engineering harness/);
assert.match(index, /Microsoft Store.*Superseded|Superseded.*Microsoft Store/i);
const requiredEntryPoints = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "HELP.md",
  "docs/README.md",
  "docs/GOVERNANCE_INDEX.md",
  "docs/ARCHITECTURE_PLAN.md",
  "docs/design/PWA_RUNTIME.md",
  "docs/design/DISTRIBUTION_ARCHITECTURE.md",
  "docs/design/MICROSOFT_STORE_PACKAGING.md",
  "docs/RELEASE_READINESS.md",
  "docs/planning/PLAN.md",
  "docs/SYSTEM_STATE.md",
];
for (const file of requiredEntryPoints) {
  const body = read(file);
  assert.match(body, /ARCHITECTURE_INDEX\.md/, file + " must route architectural authority through canonical index");
}
assert.match(read("docs/RELEASE_READINESS.md"), /## Current PWA release acceptance/);
assert.match(read("docs/RELEASE_READINESS.md"), /## Historical native release verification/);
for (const pathRef of [
  "docs/ARCHITECTURE_PLAN.md",
  "docs/CONCEPT.md",
  "docs/design/PWA_RUNTIME.md",
  "docs/design/INFERENCE_CONTRACT.md",
  "docs/design/UNIVERSAL_USER_STORIES.md",
  "docs/GOVERNANCE_INDEX.md",
  "docs/RELEASE_READINESS.md",
]) {
  assert.ok(fs.existsSync(path.join(root, pathRef)), 'index canonical target missing: ' + pathRef);
}
console.log("Architecture authority routing and supersession guard: PASS");
