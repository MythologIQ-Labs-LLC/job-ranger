import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStudioHandoff, assertStudioHandoff, inspectStudioPwaBuild, inspectLiveStudioPwa } from "../scripts/studio-handoff.mjs";
import { run as runVerifierCli } from "../scripts/verify-studio-handoff.mjs";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const buildId = "1.3.0+123456789abc";
const index = '<meta name="job-ranger-build" content="' + buildId + '">';
const sw = "const BUILD_ID = " + JSON.stringify(buildId) + ";";
const appChunk = "/* representative immutable JS asset */ const APP_READY = true;";
const policy = "default-src 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'";

const headersFile = "/*\n" +
  "  Content-Security-Policy: " + policy + "\n" +
  "  Strict-Transport-Security: max-age=63072000\n" +
  "  X-Frame-Options: DENY\n" +
  "  Cross-Origin-Resource-Policy: same-origin\n";
const info = {
  schemaVersion: 1,
  product: "job-ranger-web",
  version: "1.3.0",
  contentSecurityPolicy: policy,
  buildId,
  flavor: "standard",
  commit: "123456789abc123456789abc123456789abc1234",
  serviceWorkerSha256: hash(sw),
  assets: [
    { path: "index.html", sha256: hash(index) },
    { path: "assets/app.js", sha256: hash(appChunk) },
  ],
};
const handoff = createStudioHandoff(info);
assert.equal(handoff.studio.autoEnableCta, false);
assert.equal(handoff.studio.requiresOwnerApproval, true);
assert.equal(handoff.entry.iframeAllowed, false);
assert.equal(handoff.runtime.hostedMonitoringAvailable, false);
assert.equal(handoff.runtime.closedBrowserMonitoring, false);
assert.deepEqual(assertStudioHandoff(handoff, info), handoff);
assert.throws(() => assertStudioHandoff({ ...handoff, studio: { ...handoff.studio, autoEnableCta: true } }, info), /does not match/);

// Build flavor: the standard contract only gains the flavor field.
assert.equal(handoff.flavor, "standard");
assert.equal(handoff.runtime.canonicalCareerData, "browser-origin-private");
assert.equal(handoff.studio.ctaLabel, "Try Job Ranger in your browser");
assert.equal("demo" in handoff, false);
assert.throws(() => createStudioHandoff({ ...info, flavor: undefined }), /flavor is missing or unknown/);
assert.throws(() => createStudioHandoff({ ...info, flavor: "preview" }), /flavor is missing or unknown/);
// A demo flavor must carry a demo build ID and a standard flavor must not.
assert.throws(() => createStudioHandoff({ ...info, flavor: "demo" }), /does not match the demo build flavor/);
assert.throws(() => createStudioHandoff({ ...info, buildId: buildId + ".demo" }), /does not match the standard build flavor/);
const demoBuildId = buildId + ".demo";
const demoInfo = { ...info, buildId: demoBuildId, flavor: "demo" };
const demoHandoff = createStudioHandoff(demoInfo);
assert.equal(demoHandoff.flavor, "demo");
assert.equal(demoHandoff.build.buildId, demoBuildId);
assert.equal(demoHandoff.runtime.canonicalCareerData, "none-session-scoped-demo");
assert.deepEqual(demoHandoff.demo, {
  fictionalSampleData: true,
  sessionScopedWorkspace: true,
  resetsWhenBrowserSessionEnds: true,
  visitorResettable: true,
  requiresDedicatedOrigin: true,
  sharesOriginWithRealWorkspace: false,
});
assert.equal(demoHandoff.studio.ctaLabel, "Try the Job Ranger demo in your browser");
assert.equal(demoHandoff.studio.autoEnableCta, false);
assert.equal(demoHandoff.studio.requiresOwnerApproval, true);
assert.equal(demoHandoff.entry.iframeAllowed, false);
// A handoff for one flavor never validates against the other flavor's build.
assert.throws(() => assertStudioHandoff(handoff, demoInfo), /does not match/);
assert.throws(() => assertStudioHandoff(demoHandoff, info), /does not match/);
assert.throws(() => assertStudioHandoff({ ...demoHandoff, flavor: "standard" }, demoInfo), /does not match/);

const dir = await mkdtemp(path.join(os.tmpdir(), "studio-handoff-test-"));
try {
  await mkdir(path.join(dir, "assets"));
  const files = {
    "index.html": index,
    "sw.js": sw,
    "assets/app.js": appChunk,
    "_headers": headersFile,
    "manifest.webmanifest": "{}",
    "build-info.json": JSON.stringify(info),
    "studio-handoff.json": JSON.stringify(handoff),
  };
  for (const [filename, content] of Object.entries(files)) await writeFile(path.join(dir, filename), content);
  const verified = await inspectStudioPwaBuild(dir, buildId);
  assert.equal(verified.status, "candidate-verified-not-approved");
  assert.equal(verified.verifiedAssets, 2);
  assert.equal(verified.buildId, buildId);
  assert.equal(verified.flavor, "standard");
  assert.equal((await inspectStudioPwaBuild(dir, buildId, "standard")).flavor, "standard");
  await assert.rejects(inspectStudioPwaBuild(dir, buildId, "demo"), /unexpected build flavor/);
  assert.equal((await runVerifierCli(["--site", dir, "--flavor", "standard"])).flavor, "standard");
  await assert.rejects(runVerifierCli(["--site", dir, "--flavor", "demo"]), /unexpected build flavor/);
  await assert.rejects(runVerifierCli(["--site", dir, "--flavor", "staging"]), /Unknown Job Ranger PWA flavor/);
  await assert.rejects(inspectStudioPwaBuild(dir, "wrong-build"), /unexpected build ID/);
  await writeFile(path.join(dir, "index.html"), index + "tampered");
  await assert.rejects(inspectStudioPwaBuild(dir), /checksum mismatch/);
  await writeFile(path.join(dir, "index.html"), index);
  await writeFile(path.join(dir, "_headers"), headersFile.replace("X-Frame-Options: DENY", ""));
  await assert.rejects(inspectStudioPwaBuild(dir), /missing required static security header/);
  await writeFile(path.join(dir, "_headers"), headersFile.replace(policy, policy + "; script-src * 'unsafe-inline'"));
  await assert.rejects(inspectStudioPwaBuild(dir), /static CSP differs/);
  await writeFile(path.join(dir, "_headers"), headersFile);
  await writeFile(path.join(dir, "studio-handoff.json"), JSON.stringify({ ...handoff, studio: { autoEnableCta: true } }));
  await assert.rejects(inspectStudioPwaBuild(dir), /does not match/);
  await writeFile(path.join(dir, "studio-handoff.json"), JSON.stringify(handoff));
  const unsafeInfo = { ...info, assets: [...info.assets, { path: "../outside.txt", sha256: hash("outside") }] };
  await writeFile(path.join(dir, "build-info.json"), JSON.stringify(unsafeInfo));
  await assert.rejects(inspectStudioPwaBuild(dir), /invalid asset path/);
  await writeFile(path.join(dir, "build-info.json"), JSON.stringify(info));
  await writeFile(path.join(dir, "sw.js"), sw + "/* injected change */");
  await assert.rejects(inspectStudioPwaBuild(dir), /service-worker checksum mismatch/);
  await writeFile(path.join(dir, "sw.js"), sw);

  const fakeFetch = async (url) => {
    const name = new URL(url).pathname;
    if (name === "/") {
      return new Response(index, { status: 200, headers: {
        "content-security-policy": policy,
        "x-frame-options": "DENY",
        "strict-transport-security": "max-age=63072000",
        "cross-origin-resource-policy": "same-origin",
      } });
    }
    if (name === "/sw.js") return new Response(sw, { status: 200 });
    if (name === "/assets/app.js") return new Response(appChunk, { status: 200 });
    if (name === "/build-info.json") return new Response(JSON.stringify(info), { status: 200 });
    if (name === "/studio-handoff.json") return new Response(JSON.stringify(handoff), { status: 200 });
    return new Response("", { status: 404 });
  };
  const pinnedDigest = hash(JSON.stringify(info));
  const acceptedLive = await inspectLiveStudioPwa("https://jobs.example.org", buildId, pinnedDigest, fakeFetch);
  assert.equal(acceptedLive.buildId, buildId);
  assert.equal(acceptedLive.flavor, "standard");
  assert.equal(acceptedLive.verifiedAssets, 2);
  // The host can serve the approved metadata while replacing actual JS bytes.
  // That deployment must fail even if its build ID, CSP and service worker match.
  const compromisedJs = async (url, options) => {
    if (new URL(url).pathname === "/assets/app.js") {
      return new Response("/* compromised hosted JS */", { status: 200 });
    }
    return fakeFetch(url, options);
  };
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", buildId, pinnedDigest, compromisedJs), /live asset checksum mismatch/);
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", buildId, "0".repeat(64), fakeFetch), /checksum differs/);
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", buildId, "not-a-sha", fakeFetch), /approved build-info SHA-256/);
  await assert.rejects(inspectLiveStudioPwa("http://jobs.example.org", buildId, pinnedDigest, fakeFetch), /HTTPS origin/);
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org/preview", buildId, pinnedDigest, fakeFetch), /HTTPS origin/);
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", "wrong-build", pinnedDigest, fakeFetch), /live HTML build identity mismatch/);
  const compromisedHeaders = async (url, options) => {
    if (new URL(url).pathname === "/") return new Response(index, { status: 200, headers: {
      "content-security-policy": policy + "; script-src * 'unsafe-inline'",
      "x-frame-options": "DENY",
      "strict-transport-security": "max-age=63072000",
      "cross-origin-resource-policy": "same-origin",
    } });
    return fakeFetch(url, options);
  };
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", buildId, pinnedDigest, compromisedHeaders), /live security headers differ/);
  const compromisedWorker = async (url, options) => {
    if (new URL(url).pathname === "/sw.js") return new Response('const BUILD_ID = "fake-build";', { status: 200 });
    return fakeFetch(url, options);
  };
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", buildId, pinnedDigest, compromisedWorker), /live service worker build identity mismatch/);
  const tamperedWorkerSameId = async (url, options) => {
    if (new URL(url).pathname === "/sw.js") return new Response(sw + "/* injected change */", { status: 200 });
    return fakeFetch(url, options);
  };
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", buildId, pinnedDigest, tamperedWorkerSameId), /live service-worker checksum mismatch/);

  // A complete demo-flavor build verifies as demo, and only as demo.
  const demoIndex = '<meta name="job-ranger-build" content="' + demoBuildId + '">';
  const demoSw = "const BUILD_ID = " + JSON.stringify(demoBuildId) + ";";
  const demoBuildInfo = {
    ...demoInfo,
    serviceWorkerSha256: hash(demoSw),
    assets: [
      { path: "index.html", sha256: hash(demoIndex) },
      { path: "assets/app.js", sha256: hash(appChunk) },
    ],
  };
  await writeFile(path.join(dir, "index.html"), demoIndex);
  await writeFile(path.join(dir, "sw.js"), demoSw);
  await writeFile(path.join(dir, "build-info.json"), JSON.stringify(demoBuildInfo));
  await writeFile(path.join(dir, "studio-handoff.json"), JSON.stringify(createStudioHandoff(demoBuildInfo)));
  const verifiedDemo = await inspectStudioPwaBuild(dir, demoBuildId, "demo");
  assert.equal(verifiedDemo.flavor, "demo");
  assert.equal((await runVerifierCli(["--site", dir, "--flavor", "demo"])).buildId, demoBuildId);
  await assert.rejects(inspectStudioPwaBuild(dir, undefined, "standard"), /unexpected build flavor/);
  await assert.rejects(runVerifierCli(["--site", dir, "--flavor", "standard"]), /unexpected build flavor/);
  // A standard handoff shipped inside a demo build (or a relabelled flavor) fails closed.
  await writeFile(path.join(dir, "studio-handoff.json"), JSON.stringify({ ...createStudioHandoff(demoBuildInfo), flavor: "standard" }));
  await assert.rejects(inspectStudioPwaBuild(dir), /does not match/);
  await writeFile(path.join(dir, "studio-handoff.json"), JSON.stringify(createStudioHandoff(demoBuildInfo)));
  await writeFile(path.join(dir, "build-info.json"), JSON.stringify({ ...demoBuildInfo, flavor: "standard" }));
  await assert.rejects(inspectStudioPwaBuild(dir), /does not match the standard build flavor/);
  console.log("Studio PWA handoff contract: local and simulated live checks passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
