// Unit/contract tests for the web/PWA build flavor (standard vs demo), the
// demo-listing helper and the demo session bookkeeping. No build required.
// Run: node --experimental-strip-types tests/pwa-flavor.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PWA_FLAVORS,
  buildIdMatchesFlavor,
  parsePwaFlavor,
  pwaArchiveName,
  pwaBuildId,
  pwaOutDirName,
  pwaTrustFileName,
} from "../scripts/pwa-flavor.mjs";
import { selectPlatformArtifacts } from "../scripts/generate-release-manifest.mjs";
import {
  DEMO_LISTING_BADGE_TEXT,
  DEMO_LISTING_HOST,
  demoListingUrl,
  isDemoListing,
} from "../src/shared/demo-listing.ts";
import { IS_DEMO_FLAVOR, PWA_FLAVOR, resolvePwaFlavor } from "../src/demo/flavor.ts";
import {
  DEMO_SESSION_KEY,
  ONBOARDING_DISMISSED_KEY,
  completeDemoSession,
  demoSessionNeedsReset,
  isJobRangerLocalStorageKey,
  resetDemoLocalStorage,
} from "../src/demo/session.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- flavor parsing: unset means standard, unknown fails closed
assert.deepEqual([...PWA_FLAVORS], ["standard", "demo"]);
assert.equal(parsePwaFlavor(undefined), "standard");
assert.equal(parsePwaFlavor(""), "standard");
assert.equal(parsePwaFlavor("  "), "standard");
assert.equal(parsePwaFlavor("standard"), "standard");
assert.equal(parsePwaFlavor("demo"), "demo");
assert.equal(parsePwaFlavor(" Demo "), "demo");
assert.throws(() => parsePwaFlavor("staging"), /Unknown Job Ranger PWA flavor/);
assert.throws(() => parsePwaFlavor("demo2"), /Unknown Job Ranger PWA flavor/);

// --- build identity: the standard ID is unchanged; the demo ID is always marked
const commit = "058f34db445a38ed0dccda289b4787c205e2ce7b";
assert.equal(pwaBuildId({ version: "1.3.0", commit, flavor: undefined }), "1.3.0+058f34db445a");
assert.equal(pwaBuildId({ version: "1.3.0", commit, flavor: "standard" }), "1.3.0+058f34db445a");
assert.equal(pwaBuildId({ version: "1.3.0", commit, flavor: "demo" }), "1.3.0+058f34db445a.demo");
assert.equal(pwaBuildId({ version: "1.3.0", commit, flavor: "standard", override: " 1.3.0+release " }), "1.3.0+release");
assert.equal(pwaBuildId({ version: "1.3.0", commit, flavor: "demo", override: "1.3.0+release" }), "1.3.0+release.demo");
assert.equal(pwaBuildId({ version: "1.3.0", commit, flavor: "demo", override: "1.3.0+release.demo" }), "1.3.0+release.demo");
assert.throws(() => pwaBuildId({ version: "1.3.0", commit, flavor: "standard", override: "1.3.0+x.demo" }), /cannot use the demo build ID/);
assert.equal(buildIdMatchesFlavor("1.3.0+058f34db445a", "standard"), true);
assert.equal(buildIdMatchesFlavor("1.3.0+058f34db445a.demo", "demo"), true);
assert.equal(buildIdMatchesFlavor("1.3.0+058f34db445a", "demo"), false);
assert.equal(buildIdMatchesFlavor("1.3.0+058f34db445a.demo", "standard"), false);
assert.equal(buildIdMatchesFlavor("1.3.0+058f34db445a", undefined), false);

// --- separate output directories, archives and trust evidence that cannot be confused
assert.equal(pwaOutDirName(undefined), "dist-pwa");
assert.equal(pwaOutDirName("demo"), "dist-pwa-demo");
assert.equal(pwaArchiveName("1.3.0", "standard"), "job-ranger-web-v1.3.0.zip");
assert.equal(pwaArchiveName("1.3.0", "demo"), "job-ranger-web-demo-v1.3.0.zip");
assert.equal(pwaTrustFileName("standard"), "web-build-info.json");
assert.equal(pwaTrustFileName("demo"), "web-demo-build-info.json");
assert.notEqual(pwaArchiveName("1.3.0", "demo"), pwaArchiveName("1.3.0", "standard"));
// A demo archive in release/ is never selected as the standard web release artifact.
assert.deepEqual(
  selectPlatformArtifacts([pwaArchiveName("1.3.0", "demo"), pwaArchiveName("1.3.0", "standard")], "web"),
  ["job-ranger-web-v1.3.0.zip"],
);

// --- the vite define reaches the page and the worker, and defaults to standard elsewhere
const viteConfig = await readFile(path.join(root, "vite.pwa.config.ts"), "utf8");
assert.match(viteConfig, /__JOB_RANGER_PWA_FLAVOR__: JSON\.stringify\(flavor\)/);
assert.match(viteConfig, /const flavor = parsePwaFlavor\(process\.env\[PWA_FLAVOR_ENV\]\)/);
assert.equal(PWA_FLAVOR, "standard", "outside the PWA build (Electron, Node) the flavor is standard");
assert.equal(IS_DEMO_FLAVOR, false);
assert.equal(resolvePwaFlavor("demo"), "demo");
assert.equal(resolvePwaFlavor("standard"), "standard");
assert.equal(resolvePwaFlavor(undefined), "standard");
assert.equal(resolvePwaFlavor("DEMO"), "standard");

// --- isDemoListing: only the reserved, non-resolving demo host
assert.equal(DEMO_LISTING_HOST, "demo-listing.invalid");
assert.equal(DEMO_LISTING_BADGE_TEXT, "Demo listing — fictional, not a real opening");
assert.equal(demoListingUrl("/harbor-health/jobs/1"), "https://demo-listing.invalid/harbor-health/jobs/1");
for (const url of [
  "https://demo-listing.invalid/harbor-health/practice-operations-coordinator",
  "https://DEMO-LISTING.INVALID/x",
  "http://demo-listing.invalid",
  "https://jobs.demo-listing.invalid/a",
  "https://demo-listing.invalid./a",
]) {
  assert.equal(isDemoListing(url), true, url);
}
for (const url of [
  null,
  undefined,
  "",
  "not a url",
  "https://boards.greenhouse.io/harbor-health/jobs/4100777",
  "https://demo-listing.invalid.example.com/a",
  "https://example.com/?next=https://demo-listing.invalid/a",
  "https://notdemo-listing.invalid/a",
  "ftp://demo-listing.invalid/a",
  "javascript:alert('demo-listing.invalid')",
]) {
  assert.equal(isDemoListing(url), false, String(url));
}

// --- demo session bookkeeping (page side)
function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    entries: () => Object.fromEntries(map),
  };
}
assert.equal(demoSessionNeedsReset(memoryStorage()), true, "a new tab has no session marker");
assert.equal(demoSessionNeedsReset(memoryStorage({ [DEMO_SESSION_KEY]: "2026-10-16T00:00:00Z" })), false, "a reload keeps the session");
assert.equal(demoSessionNeedsReset(null), true, "without sessionStorage the demo starts fresh");
assert.equal(isJobRangerLocalStorageKey("theme"), true);
assert.equal(isJobRangerLocalStorageKey("job-ranger.onboarding.dismissed.v1"), true);
assert.equal(isJobRangerLocalStorageKey("job-ranger.career-profile.v1"), true);
assert.equal(isJobRangerLocalStorageKey("someone-else"), false);
const local = memoryStorage({
  theme: "canopy",
  "job-ranger.career-profile.v1": "{}",
  "job-ranger.applications.v1": "[]",
  "job-ranger.onboarding.dismissed.v1": "false",
  unrelated: "kept",
});
resetDemoLocalStorage(local);
assert.deepEqual(local.entries(), { unrelated: "kept", [ONBOARDING_DISMISSED_KEY]: "true" });
const session = memoryStorage();
const local2 = memoryStorage({ theme: "night" });
completeDemoSession(false, { session, local: local2 });
assert.equal(local2.getItem("theme"), "night", "a reload in the same session keeps preferences");
assert.notEqual(session.getItem(DEMO_SESSION_KEY), null);
const session3 = memoryStorage();
const local3 = memoryStorage({ theme: "night" });
completeDemoSession(true, { session: session3, local: local3 });
assert.equal(local3.getItem("theme"), null, "a new session resets preferences");
assert.equal(local3.getItem(ONBOARDING_DISMISSED_KEY), "true", "the seeded workspace skips onboarding");
assert.equal(demoSessionNeedsReset(session3), false);

// --- the standard-flavor runtime never acts on demo session messages
const worker = await readFile(path.join(root, "src/pwa/runtime/worker-main.ts"), "utf8");
assert.match(worker, /if \(IS_DEMO_FLAVOR && message\?\.type === "demo-session"\)/);
assert.match(worker, /if \(IS_DEMO_FLAVOR\) \{\s*const reset = await demoSessionRequest;\s*if \(reset\) await wipeDemoWorkspace\(\);/);
assert.equal((worker.match(/wipeDemoWorkspace\(\)/g) ?? []).length, 2, "one definition and one gated call");
assert.equal((worker.match(/seedDemoWorkspace\(\{/g) ?? []).length, 1);
assert.match(worker, /if \(demo\?\.reset\) \{\s*\/\/[^\n]*\n\s*await seedDemoWorkspace\(\{/);
const page = await readFile(path.join(root, "src/pwa/main.tsx"), "utf8");
assert.match(page, /if \(IS_DEMO_FLAVOR\) \{[\s\S]*type: "demo-session", reset: demoSessionNeedsReset\(\)[\s\S]*worker\.postMessage\(start\);/);

console.log("pwa flavor tests passed");
