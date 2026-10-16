// Inspects the two production web builds (npm run build:pwa and
// npm run build:pwa:demo) and proves the flavors cannot be confused: build
// identity, Studio handoff, document/manifest naming, an identical security
// policy, and that the standard build contains none of the demo-only code
// (session reset, seeding, banner), which the bundler removes at build time.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIdMatchesFlavor } from "../scripts/pwa-flavor.mjs";
import { inspectStudioPwaBuild } from "../scripts/studio-handoff.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(flavor) {
  const dist = path.join(root, flavor === "demo" ? "dist-pwa-demo" : "dist-pwa");
  const buildInfo = JSON.parse(await readFile(path.join(dist, "build-info.json"), "utf8"));
  const handoff = JSON.parse(await readFile(path.join(dist, "studio-handoff.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(dist, "manifest.webmanifest"), "utf8"));
  const html = await readFile(path.join(dist, "index.html"), "utf8");
  const assets = path.join(dist, "assets");
  const scripts = (await readdir(assets)).filter((name) => name.endsWith(".js"));
  const javascript = (await Promise.all(scripts.map((name) => readFile(path.join(assets, name), "utf8")))).join("\n");
  const verified = await inspectStudioPwaBuild(dist, buildInfo.buildId, flavor);
  return { buildInfo, handoff, manifest, html, javascript, verified };
}

// Strings that exist only in demo-only code paths.
const DEMO_ONLY = [
  "demo-session",
  "Demo workspace: fictional sample data",
  "Reset the demo workspace?",
  "About this demo",
  "Morgan Rivera",
  "Demo seed: the fictional employer must not be a monitorable job source",
  "job-ranger.demo.session.v1",
  // Fixture data (electron/src/demo-seed.cts) and the workspace-ownership guard.
  "Harbor Health",
  "Practice Operations Coordinator",
  "Patient Access Representative",
  "Clinic Operations Coordinator",
  "Referral backlog cleanup",
  "demo-listing.invalid/harbor-health",
  "job-ranger-demo-workspace",
  ".demo-workspace.json",
  "This site holds a Job Ranger workspace that is not a demo",
  "The Job Ranger demo is open in another tab or window",
  "temporary demo workspace",
];

const standard = await load("standard");
const demo = await load("demo");

assert.equal(standard.buildInfo.flavor, "standard");
assert.equal(demo.buildInfo.flavor, "demo");
assert.ok(buildIdMatchesFlavor(standard.buildInfo.buildId, "standard"), standard.buildInfo.buildId);
assert.ok(buildIdMatchesFlavor(demo.buildInfo.buildId, "demo"), demo.buildInfo.buildId);
assert.equal(demo.buildInfo.buildId, `${standard.buildInfo.buildId}.demo`, "both builds come from the same source commit");
assert.equal(standard.handoff.flavor, "standard");
assert.equal(demo.handoff.flavor, "demo");
assert.equal(standard.verified.flavor, "standard");
assert.equal(demo.verified.flavor, "demo");
assert.equal(demo.handoff.runtime.canonicalCareerData, "none-session-scoped-demo");
assert.equal(demo.handoff.demo.requiresDedicatedOrigin, true);

// The demo flavor names itself; the standard document and install manifest are unchanged.
assert.match(standard.html, /<title>Job Ranger<\/title>/);
assert.match(demo.html, /<title>Job Ranger Demo<\/title>/);
assert.equal(standard.manifest.name, "Job Ranger");
assert.equal(demo.manifest.name, "Job Ranger Demo");
assert.equal(demo.manifest.start_url, standard.manifest.start_url);

// Same security policy: the demo adds no network destinations (no analytics, no fetches).
assert.equal(demo.buildInfo.contentSecurityPolicy, standard.buildInfo.contentSecurityPolicy);

for (const marker of DEMO_ONLY) {
  assert.ok(demo.javascript.includes(marker), `demo build includes ${marker}`);
  assert.ok(!standard.javascript.includes(marker), `standard build must not contain demo-only code: ${marker}`);
}
// The renderer-side honesty labels exist in both builds (they only react to the reserved demo host).
for (const build of [standard, demo]) {
  assert.ok(build.javascript.includes("demo-listing.invalid"));
  assert.ok(build.javascript.includes("Demo listing — fictional, not a real opening"));
}

console.log(`pwa flavor build test passed (${standard.buildInfo.buildId}, ${demo.buildInfo.buildId})`);
