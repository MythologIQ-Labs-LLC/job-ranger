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

export function createStudioHandoff(buildInfo) {
  if (!buildInfo || buildInfo.product !== PRODUCT) fail("unexpected build-info product");
  const version = requiredString(buildInfo.version, "version");
  const buildId = requiredString(buildInfo.buildId, "buildId");
  const commit = requiredString(buildInfo.commit, "commit");
  return {
    schemaVersion: 1,
    kind: "job-ranger-studio-handoff",
    product: "job-ranger",
    build: { version, buildId, commit },
    entry: {
      path: "/",
      mode: "external-navigation",
      iframeAllowed: false,
      preserveOrigin: true,
    },
    runtime: {
      platform: "web-pwa",
      canonicalCareerData: "browser-origin-private",
      noAccountRequiredForCore: true,
      browserJobAcquisition: "provider-and-cors-limited",
      closedBrowserMonitoring: false,
      hostedMonitoringAvailable: false,
    },
    studio: {
      pagePath: "/side-projects/job-ranger",
      ctaLabel: "Try Job Ranger in your browser",
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
export async function inspectStudioPwaBuild(directory, expectedBuildId) {
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

  const handoff = JSON.parse((await read(STUDIO_HANDOFF_FILE)).toString("utf8"));
  assertStudioHandoff(handoff, buildInfo);

  const html = (await read("index.html")).toString("utf8");
  if (!html.includes('name="job-ranger-build" content="' + expected + '"')) fail("HTML build identity mismatch");
  const sw = (await read("sw.js")).toString("utf8");
  if (!sw.includes('const BUILD_ID = ' + JSON.stringify(expected) + ";")) fail("service-worker build identity mismatch");

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
export async function inspectLiveStudioPwa(origin, expectedBuildId, expectedBuildInfoSha256, fetchImpl = fetch) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    fail("live origin must be an HTTPS origin with no path, credentials, query or fragment");
  }
  const expected = requiredString(expectedBuildId, "expected build ID");
  if (!HASH.test(expectedBuildInfoSha256)) fail("approved build-info SHA-256 is required");
  const get = async (pathname) => {
    const response = await fetchImpl(new URL(pathname, url), { redirect: "manual", cache: "no-store" });
    if (!response.ok || response.redirected || response.status >= 300) fail("live response failed: " + pathname);
    return response;
  };
  const root = await get("/");
  const html = await root.text();
  if (!html.includes('name="job-ranger-build" content="' + expected + '"')) {
    fail("live HTML build identity mismatch");
  }
  const sw = await (await get("/sw.js")).text();
  if (!sw.includes('const BUILD_ID = ' + JSON.stringify(expected) + ";")) {
    fail("live service worker build identity mismatch");
  }
  const infoBytes = new Uint8Array(await (await get("/build-info.json")).arrayBuffer());
  if (sha256(infoBytes) !== expectedBuildInfoSha256) fail("live build-info checksum differs from approved release");
  const info = JSON.parse(new TextDecoder().decode(infoBytes));
  if (info.product !== PRODUCT || info.buildId !== expected) fail("live build identity mismatch");
  const csp = root.headers.get("content-security-policy") ?? "";
  if (!info.contentSecurityPolicy || csp !== info.contentSecurityPolicy ||
      root.headers.get("x-frame-options")?.toUpperCase() !== "DENY" ||
      !root.headers.get("strict-transport-security") ||
      root.headers.get("cross-origin-resource-policy") !== "same-origin") {
    fail("live security headers differ from approved build policy");
  }
  const handoff = await (await get("/" + STUDIO_HANDOFF_FILE)).json();
  assertStudioHandoff(handoff, info);
  return { status: "live-artifact-verified-owner-approval-still-required", origin: url.origin, buildId: expected };
}
