import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStudioHandoff, assertStudioHandoff, inspectStudioPwaBuild, inspectLiveStudioPwa } from "../scripts/studio-handoff.mjs";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const buildId = "1.3.0+123456789abc";
const index = '<meta name="job-ranger-build" content="' + buildId + '">';
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
  commit: "123456789abc123456789abc123456789abc1234",
  assets: [{ path: "index.html", sha256: hash(index) }],
};
const handoff = createStudioHandoff(info);
assert.equal(handoff.studio.autoEnableCta, false);
assert.equal(handoff.studio.requiresOwnerApproval, true);
assert.equal(handoff.entry.iframeAllowed, false);
assert.equal(handoff.runtime.hostedMonitoringAvailable, false);
assert.equal(handoff.runtime.closedBrowserMonitoring, false);
assert.deepEqual(assertStudioHandoff(handoff, info), handoff);
assert.throws(() => assertStudioHandoff({ ...handoff, studio: { ...handoff.studio, autoEnableCta: true } }, info), /does not match/);

const dir = await mkdtemp(path.join(os.tmpdir(), "studio-handoff-test-"));
try {
  await mkdir(path.join(dir, "assets"));
  const files = {
    "index.html": index,
    "sw.js": "const BUILD_ID = " + JSON.stringify(buildId) + ";",
    "_headers": headersFile,
    "manifest.webmanifest": "{}",
    "build-info.json": JSON.stringify(info),
    "studio-handoff.json": JSON.stringify(handoff),
  };
  for (const [filename, content] of Object.entries(files)) await writeFile(path.join(dir, filename), content);
  const verified = await inspectStudioPwaBuild(dir, buildId);
  assert.equal(verified.status, "candidate-verified-not-approved");
  assert.equal(verified.verifiedAssets, 1);
  assert.equal(verified.buildId, buildId);
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
    if (name === "/sw.js") return new Response("const BUILD_ID = " + JSON.stringify(buildId) + ";", { status: 200 });
    if (name === "/build-info.json") return new Response(JSON.stringify(info), { status: 200 });
    if (name === "/studio-handoff.json") return new Response(JSON.stringify(handoff), { status: 200 });
    return new Response("", { status: 404 });
  };
  const pinnedDigest = hash(JSON.stringify(info));
  assert.equal((await inspectLiveStudioPwa("https://jobs.example.org", buildId, pinnedDigest, fakeFetch)).buildId, buildId);
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", buildId, "0".repeat(64), fakeFetch), /checksum differs/);
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", buildId, "not-a-sha", fakeFetch), /approved build-info SHA-256/);
  await assert.rejects(inspectLiveStudioPwa("http://jobs.example.org", buildId, pinnedDigest, fakeFetch), /HTTPS origin/);
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org/preview", buildId, pinnedDigest, fakeFetch), /HTTPS origin/);
  await assert.rejects(inspectLiveStudioPwa("https://jobs.example.org", "wrong-build", pinnedDigest, fakeFetch), /live build identity mismatch/);
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
  console.log("Studio PWA handoff contract: local and simulated live checks passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
