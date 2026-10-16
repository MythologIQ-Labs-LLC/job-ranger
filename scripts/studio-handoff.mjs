/**
 * Job Ranger -> MythologIQ Studio integration contract.
 *
 * Produces metadata from the exact PWA build, never a deployment approval.
 * Studio links to a separately hosted, reviewed PWA rather than framing or
 * copying the application into the Studio website.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { PWA_FLAVORS, buildIdMatchesFlavor, parsePwaFlavor } from "./pwa-flavor.mjs";

/** Mirrors DEMO_IDLE_RESET_HOURS in src/pwa/runtime/demo-workspace.ts (checked by tests/pwa-flavor.test.mjs). */
export const DEMO_IDLE_RESET_HOURS = 8;

export const STUDIO_HANDOFF_FILE = "studio-handoff.json";
const PRODUCT = "job-ranger-web";
const HASH = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error("Studio PWA handoff: " + message);
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(label + " is missing");
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Only relative, canonical POSIX build paths may be opened during verification. */
function safeAssetPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") ||
      value.startsWith("/") || value.includes("?") || value.includes("#") ||
      value.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    fail("invalid asset path");
  }
  return value;
}

/**
 * The build flavor recorded in build-info.json, which must agree with the build ID.
 *
 * Builds made before flavors existed have no `flavor` field. Such a legacy build is
 * treated as the standard flavor ONLY when its build ID has no ".demo" suffix, and
 * its handoff must then be the legacy shape (no `flavor` field). Any other value,
 * or a legacy build carrying a demo build ID, fails closed.
 */
export function effectiveBuildFlavor(buildInfo) {
  const buildId = requiredString(buildInfo?.buildId, "buildId");
  if (buildInfo.flavor === undefined) {
    if (!buildIdMatchesFlavor(buildId, "standard")) fail("build-info flavor is missing for a demo build ID");
    return "standard";
  }
  const flavor = buildInfo.flavor;
  if (!PWA_FLAVORS.includes(flavor)) fail("build-info flavor is missing or unknown");
  if (!buildIdMatchesFlavor(buildId, flavor)) fail("build ID does not match the " + flavor + " build flavor");
  return flavor;
}

export function createStudioHandoff(buildInfo) {
  if (!buildInfo || buildInfo.product !== PRODUCT) fail("unexpected build-info product");
  const version = requiredString(buildInfo.version, "version");
  const buildId = requiredString(buildInfo.buildId, "buildId");
  const commit = requiredString(buildInfo.commit, "commit");
  const flavor = effectiveBuildFlavor(buildInfo);
  const legacy = buildInfo.flavor === undefined;
  const demo = flavor === "demo";
  return {
    schemaVersion: 1,
    kind: "job-ranger-studio-handoff",
    product: "job-ranger",
    ...(legacy ? {} : { flavor }),
    build: { version, buildId, commit },
    entry: {
      path: "/",
      mode: "external-navigation",
      iframeAllowed: false,
      preserveOrigin: true,
    },
    runtime: {
      platform: "web-pwa",
      // The demo flavor never holds anyone's canonical career data: its workspace
      // is fictional, session-scoped and reset, on an origin of its own.
      canonicalCareerData: demo ? "none-session-scoped-demo" : "browser-origin-private",
      noAccountRequiredForCore: true,
      browserJobAcquisition: "provider-and-cors-limited",
      closedBrowserMonitoring: false,
      hostedMonitoringAvailable: false,
    },
    ...(demo
      ? {
          demo: {
            fictionalSampleData: true,
            sessionScopedWorkspace: true,
            // The workspace is NOT erased when the browser closes: it is replaced with
            // fresh sample data when the next demo session starts or after this many
            // idle hours (src/pwa/runtime/demo-workspace.ts DEMO_IDLE_RESET_HOURS).
            resetsAtNextSessionStart: true,
            idleResetHours: DEMO_IDLE_RESET_HOURS,
            visitorResettable: true,
            refusesToEraseNonDemoWorkspace: true,
            requiresDedicatedOrigin: true,
            sharesOriginWithRealWorkspace: false,
          },
        }
      : {}),
    studio: {
      pagePath: "/side-projects/job-ranger",
      ctaLabel: demo ? "Try the Job Ranger demo in your browser" : "Try Job Ranger in your browser",
      autoEnableCta: false,
      requiresOwnerApproval: true,
      requiresVerifiedHttpsOrigin: true,
      requiresMatchingLiveBuildId: true,
    },
  };
}

export function assertStudioHandoff(handoff, buildInfo) {
  const expected = createStudioHandoff(buildInfo);
  if (JSON.stringify(handoff) !== JSON.stringify(expected)) {
    fail("studio-handoff.json does not match the reviewed build contract");
  }
  return expected;
}

/** Validate the deployable directory without requiring a network or npm install. */
export async function inspectStudioPwaBuild(directory, expectedBuildId, expectedFlavor) {
  const wantedFlavor = parsePwaFlavor(requiredString(expectedFlavor, "expected build flavor"));
  const dist = path.resolve(directory);
  const root = await realpath(dist);
  const read = async (filename) => {
    const pathname = path.join(dist, safeAssetPath(filename));
    const details = await lstat(pathname);
    if (!details.isFile() || details.isSymbolicLink()) fail("not a regular build file: " + filename);
    const resolved = await realpath(pathname);
    const relative = path.relative(root, resolved);
    if (relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) {
      fail("asset escapes PWA build root");
    }
    return readFile(pathname);
  };

  for (const filename of ["index.html", "sw.js", "_headers", "manifest.webmanifest", "build-info.json", STUDIO_HANDOFF_FILE]) {
    await read(filename);
  }
  const buildInfoBytes = await read("build-info.json");
  const buildInfo = JSON.parse(buildInfoBytes.toString("utf8"));
  if (buildInfo.product !== PRODUCT) fail("wrong build-info product");
  const expected = requiredString(expectedBuildId ?? buildInfo.buildId, "expected build ID");
  if (buildInfo.buildId !== expected) fail("unexpected build ID");

  if (effectiveBuildFlavor(buildInfo) !== wantedFlavor) fail("unexpected build flavor");

  const handoff = JSON.parse((await read(STUDIO_HANDOFF_FILE)).toString("utf8"));
  assertStudioHandoff(handoff, buildInfo);

  const html = (await read("index.html")).toString("utf8");
  if (!html.includes('name="job-ranger-build" content="' + expected + '"')) fail("HTML build identity mismatch");
  const swBytes = await read("sw.js");
  const sw = swBytes.toString("utf8");
  if (!sw.includes('const BUILD_ID = ' + JSON.stringify(expected) + ";")) fail("service-worker build identity mismatch");
  if (!HASH.test(buildInfo.serviceWorkerSha256) || sha256(swBytes) !== buildInfo.serviceWorkerSha256) {
    fail("service-worker checksum mismatch");
  }

  const headers = (await read("_headers")).toString("utf8");
  const policy = requiredString(buildInfo.contentSecurityPolicy, "build-info content security policy");
  const declaredPolicies = [...headers.matchAll(/^\s+Content-Security-Policy:\s*(.+)$/gmi)];
  if (declaredPolicies.length !== 1 || declaredPolicies[0][1].trim() !== policy) {
    fail("static CSP differs from build-info security policy");
  }
  for (const fragment of ["default-src 'none'", "frame-ancestors 'none'", "require-trusted-types-for 'script'"]) {
    if (!policy.includes(fragment)) fail("required security policy missing: " + fragment);
  }
  const lowerHeaders = headers.toLowerCase();
  for (const fragment of ["x-frame-options: deny", "strict-transport-security:",
                          "cross-origin-resource-policy: same-origin"]) {
    if (!lowerHeaders.includes(fragment)) fail("missing required static security header: " + fragment);
  }

  if (!Array.isArray(buildInfo.assets) || !buildInfo.assets.length) fail("missing checksum asset list");
  const seen = new Set();
  for (const asset of buildInfo.assets) {
    const name = safeAssetPath(asset?.path);
    if (seen.has(name)) fail("duplicate asset in build manifest: " + name);
    seen.add(name);
    if (!HASH.test(asset.sha256)) fail("invalid SHA-256 for " + name);
    if (sha256(await read(name)) !== asset.sha256) fail("checksum mismatch for " + name);
  }
  if (!seen.has("index.html")) fail("HTML not covered by shell integrity manifest");
  return {
    status: "candidate-verified-not-approved",
    buildId: expected,
    flavor: wantedFlavor,
    commit: buildInfo.commit,
    version: buildInfo.version,
    verifiedAssets: seen.size,
    buildInfoSha256: sha256(buildInfoBytes),
  };
}

/**
 * Inspect the real HTTPS origin AFTER deployment. This does not authorize the
 * Studio button or prove browser storage/functional acceptance.
 */
export async function inspectLiveStudioPwa(origin, expectedBuildId, expectedBuildInfoSha256, expectedFlavor, fetchImpl = fetch) {
  const wantedFlavor = parsePwaFlavor(requiredString(expectedFlavor, "expected build flavor"));
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    fail("live origin must be an HTTPS origin with no path, credentials, query or fragment");
  }
  const expected = requiredString(expectedBuildId, "expected build ID");
  if (!HASH.test(expectedBuildInfoSha256)) fail("approved build-info SHA-256 is required");
  const get = async (pathname) => {
    const response = await fetchImpl(new URL(pathname, url), {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || response.redirected || response.status >= 300) fail("live response failed: " + pathname);
    return response;
  };
  const root = await get("/");
  const rootBytes = new Uint8Array(await root.arrayBuffer());
  if (rootBytes.byteLength > 2 * 1024 * 1024) fail("live HTML exceeds verification size limit");
  const html = new TextDecoder().decode(rootBytes);
  if (!html.includes('name="job-ranger-build" content="' + expected + '"')) {
    fail("live HTML build identity mismatch");
  }
  const swBytes = new Uint8Array(await (await get("/sw.js")).arrayBuffer());
  if (swBytes.byteLength > 10 * 1024 * 1024) fail("live service worker exceeds verification size limit");
  const sw = new TextDecoder().decode(swBytes);
  if (!sw.includes('const BUILD_ID = ' + JSON.stringify(expected) + ";")) {
    fail("live service worker build identity mismatch");
  }
  const infoBytes = new Uint8Array(await (await get("/build-info.json")).arrayBuffer());
  if (infoBytes.byteLength > 2 * 1024 * 1024) fail("live build-info exceeds verification size limit");
  if (sha256(infoBytes) !== expectedBuildInfoSha256) fail("live build-info checksum differs from approved release");
  const info = JSON.parse(new TextDecoder().decode(infoBytes));
  if (info.product !== PRODUCT || info.buildId !== expected) fail("live build identity mismatch");
  if (effectiveBuildFlavor(info) !== wantedFlavor) fail("unexpected build flavor");
  if (!HASH.test(info.serviceWorkerSha256) || sha256(swBytes) !== info.serviceWorkerSha256) {
    fail("live service-worker checksum mismatch");
  }
  const csp = root.headers.get("content-security-policy") ?? "";
  if (!info.contentSecurityPolicy || csp !== info.contentSecurityPolicy ||
      root.headers.get("x-frame-options")?.toUpperCase() !== "DENY" ||
      !root.headers.get("strict-transport-security") ||
      root.headers.get("cross-origin-resource-policy") !== "same-origin") {
    fail("live security headers differ from approved build policy");
  }
  // A pinned build-info digest is meaningful only when the host actually serves
  // the approved shell bytes, not just a matching metadata document. Verify the
  // complete immutable shell inventory, bounded in-flight and per-asset memory.
  if (!Array.isArray(info.assets) || !info.assets.length || info.assets.length > 2048) {
    fail("invalid live shell inventory");
  }
  const assets = new Map();
  for (const asset of info.assets) {
    const name = safeAssetPath(asset?.path);
    if (assets.has(name) || !HASH.test(asset.sha256)) fail("invalid or duplicate live shell asset: " + name);
    assets.set(name, asset.sha256);
  }
  if (!assets.has("index.html")) fail("live HTML is not covered by shell integrity manifest");
  if (sha256(rootBytes) !== assets.get("index.html")) fail("live HTML asset checksum mismatch");

  let verifiedBytes = rootBytes.byteLength;
  const MAX_ASSET_BYTES = 64 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
  const verifyAsset = async (name, expectedDigest) => {
    const response = await get("/" + name);
    if (response.headers.has("content-length") &&
        Number(response.headers.get("content-length")) > MAX_ASSET_BYTES) {
      fail("live asset exceeds verification size limit: " + name);
    }
    const digest = createHash("sha256");
    let size = 0;
    // Read and hash bounded chunks rather than buffering complete JS bundles.
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          verifiedBytes += value.byteLength;
          if (size > MAX_ASSET_BYTES || verifiedBytes > MAX_TOTAL_BYTES) {
            fail("live asset exceeds verification size limit: " + name);
          }
          digest.update(value);
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      fail("live asset has no response body: " + name);
    }
    if (digest.digest("hex") !== expectedDigest) fail("live asset checksum mismatch: " + name);
  };

  const pending = [...assets.entries()].filter(([name]) => name !== "index.html");
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (next < pending.length) {
      const [name, digest] = pending[next++];
      await verifyAsset(name, digest);
    }
  }));
  const handoff = await (await get("/" + STUDIO_HANDOFF_FILE)).json();
  assertStudioHandoff(handoff, info);
  return {
    status: "live-artifact-verified-owner-approval-still-required",
    origin: url.origin,
    buildId: expected,
    flavor: wantedFlavor,
    verifiedAssets: assets.size,
  };
}
