// Unit/contract tests for the web/PWA build flavor (standard vs demo), the
// demo-listing helper and the demo session bookkeeping. No build required.
// Run: node --experimental-strip-types tests/pwa-flavor.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_LOCAL_PORTS,
  PWA_FLAVORS,
  STANDARD_LOCAL_PORTS,
  assertDemoPortAllowed,
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
import { DEMO_IDLE_RESET_HOURS, IS_DEMO_FLAVOR, PWA_FLAVOR, resolvePwaFlavor } from "../src/demo/flavor.ts";
import { DEMO_IDLE_RESET_HOURS as HANDOFF_IDLE_RESET_HOURS } from "../scripts/studio-handoff.mjs";
import {
  DEMO_SESSION_KEY,
  ONBOARDING_DISMISSED_KEY,
  completeDemoSession,
  demoSessionId,
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
// A tab without a session id gets a new random one; a reload keeps it.
const tab = memoryStorage();
const first = demoSessionId(tab, () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
assert.equal(first, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
assert.equal(tab.getItem(DEMO_SESSION_KEY), first);
assert.equal(demoSessionId(tab, () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), first, "a reload keeps the session id");
const otherTab = memoryStorage();
assert.notEqual(demoSessionId(otherTab, () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc"), first, "a new tab is a new session");
// An implausible stored value is replaced rather than trusted.
assert.equal(demoSessionId(memoryStorage({ [DEMO_SESSION_KEY]: "2026-10-16T00:00:00Z" }), () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd"), "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
assert.equal(demoSessionId(null, () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"), "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "without sessionStorage every load is new");
assert.match(demoSessionId(memoryStorage()), /^[0-9a-f-]{36}$/);
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
const local2 = memoryStorage({ theme: "night" });
completeDemoSession(false, local2);
assert.equal(local2.getItem("theme"), "night", "a kept workspace keeps preferences");
const local3 = memoryStorage({ theme: "night" });
completeDemoSession(true, local3);
assert.equal(local3.getItem("theme"), null, "a replaced workspace resets preferences");
assert.equal(local3.getItem(ONBOARDING_DISMISSED_KEY), "true", "the seeded workspace skips onboarding");

// --- the standard-flavor runtime never acts on demo session messages
const worker = await readFile(path.join(root, "src/pwa/runtime/worker-main.ts"), "utf8");
assert.match(worker, /if \(IS_DEMO_FLAVOR && message\?\.type === "demo-session"\)/);
// The only erase path is gated on the demo flavor AND a reset decision, and runs before the database opens.
assert.equal((worker.match(/resetDemoWorkspace\(/g) ?? []).length, 1);
assert.equal((worker.match(/fs\.rm\(/g) ?? []).length, 2, "only the existing transient I/O cleanups remove anything directly");
const demoBlock = worker.slice(worker.indexOf("if (IS_DEMO_FLAVOR) {\n      // Demo flavor, under the exclusive lock"));
assert.ok(demoBlock.length > 0);
assert.ok(demoBlock.indexOf("decideDemoStartup(") < demoBlock.indexOf('decision.action === "refuse"'));
assert.ok(demoBlock.indexOf('decision.action === "refuse"') < demoBlock.indexOf("resetDemoWorkspace("));
assert.ok(demoBlock.indexOf("resetDemoWorkspace(") < demoBlock.indexOf("sqlite3InitModule"), "erase happens before the database opens");
assert.equal((worker.match(/seedDemoWorkspace\(\{/g) ?? []).length, 1);
assert.match(worker, /if \(demo && demoClaim\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*await seedDemoWorkspace\(\{/);
const page = await readFile(path.join(root, "src/pwa/main.tsx"), "utf8");
assert.match(page, /if \(IS_DEMO_FLAVOR\) \{[\s\S]*type: "demo-session", sessionId: demoSessionId\(\)[\s\S]*worker\.postMessage\(start\);/);

// --- the handoff advertises the real idle-reset limit
assert.equal(HANDOFF_IDLE_RESET_HOURS, DEMO_IDLE_RESET_HOURS);

// --- B1: the demo is never served on the standard app's local address
assert.deepEqual({ ...STANDARD_LOCAL_PORTS }, { preview: 4174, dev: 5174 });
assert.deepEqual({ ...DEMO_LOCAL_PORTS }, { preview: 4175, dev: 5175 });
for (const port of [4174, 5174, "4174"]) assert.throws(() => assertDemoPortAllowed(port), /Refusing to serve the Job Ranger demo/);
assert.equal(assertDemoPortAllowed(4175), 4175);
for (const args of [["preview", "--port", "4174"], ["preview", "--port=4174"], ["preview", "--port", "5174"]]) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "pwa-demo.mjs"), ...args], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 2, `pwa-demo ${args.join(" ")} must refuse`);
  assert.match(result.stderr, /Refusing to serve the Job Ranger demo/);
}
// The config itself refuses too (vite --port overrides config ports), and keeps the standard shape.
assert.match(viteConfig, /demoPortGuardPlugin\(\)/);
assert.match(viteConfig, /assertDemoPortAllowed\(config\.server\.port\);\s*assertDemoPortAllowed\(config\.preview\.port\);/);
assert.match(viteConfig, /preview:\s*\{[\s\S]*?host:\s*"localhost"[\s\S]*?port:\s*4174[\s\S]*?strictPort:\s*true/);

// --- release and deploy workflows can never pick up demo artifacts
const deploy = (await readFile(path.join(root, ".github/workflows/deploy-pwa.yml"), "utf8")).replace(/\r\n/g, "\n");
const release = (await readFile(path.join(root, ".github/workflows/release-build.yml"), "utf8")).replace(/\r\n/g, "\n");
assert.doesNotMatch(deploy, /job-ranger-web-\*/);
assert.equal((deploy.match(/job-ranger-web-v\*\.zip/g) ?? []).length, 3);
assert.match(deploy, /a\.flavor !== 'standard' \|\| b\.flavor !== 'standard'/, "production deploy asserts the standard flavor");
assert.match(deploy, /verify-studio-handoff\.mjs --site site --build-id "\$expected" --flavor standard/);
assert.match(deploy, /--build-info-sha256 "\$approved_digest" \\\n\s+--flavor standard/);
assert.doesNotMatch(release, /job-ranger-web-\*|build\/trust\/web-\*/);
assert.match(release, /subject-path: web\/release\/job-ranger-web-v\*\.zip/);
assert.match(release, /gh release upload "\$tag" web\/release\/job-ranger-web-v\*\.zip web\/build\/trust\/web-build-info\.json web\/build\/trust\/web-pwa-e2e\.json web\/build\/trust\/web-SHA256SUMS\.txt web\/build\/trust\/web-release-manifest\.json --clobber/);

console.log("pwa flavor tests passed");
