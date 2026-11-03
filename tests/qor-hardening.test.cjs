const assert = require("node:assert/strict");
const path = require("node:path");

const {
  validateCompanyDraft,
  validateSettingsUpdate,
} = require("../electron-runtime/electron/src/validators.cjs");
const {
  detectSourceFromUrl,
  isHostOrSubdomain,
} = require("../electron-runtime/electron/src/scrapers.cjs");
const {
  assertManagedArtifactPath,
} = require("../electron-runtime/electron/src/managed-path-policy.cjs");
const {
  shouldMinimizeToTray,
} = require("../electron-runtime/electron/src/tray-policy.cjs");

function validSettings(overrides = {}) {
  return {
    userAgent: "Sojourner Test",
    maxConcurrentScrapes: 2,
    scrapeTimeoutMs: 20_000,
    retryCount: 1,
    notificationsEnabled: false,
    notifyOnNewJobs: true,
    notifyOnMatchedJobs: true,
    minimizeToTray: false,
    ...overrides,
  };
}

function validCompany(overrides = {}) {
  return {
    name: "Acme",
    url: "https://careers.example.com/jobs",
    frequencyMinutes: 60,
    isActive: true,
    ...overrides,
  };
}

function assertNotSourceType(url, sourceType) {
  assert.notEqual(
    detectSourceFromUrl(url).sourceType,
    sourceType,
    `${url} must not be classified as ${sourceType}`,
  );
}

function run() {
  assert.throws(() => validateSettingsUpdate([]), /must be an object/);
  assert.equal(validateSettingsUpdate(validSettings()).maxConcurrentScrapes, 2);
  assert.throws(() => validateSettingsUpdate(validSettings({ maxConcurrentScrapes: 0 })), /1 through 10/);
  assert.throws(() => validateSettingsUpdate(validSettings({ maxConcurrentScrapes: 11 })), /1 through 10/);
  assert.throws(() => validateSettingsUpdate(validSettings({ maxConcurrentScrapes: 1.5 })), /integer/);
  assert.throws(() => validateSettingsUpdate(validSettings({ scrapeTimeoutMs: 999 })), /1000/);
  assert.throws(() => validateSettingsUpdate(validSettings({ retryCount: -1 })), /0 through 5/);
  assert.throws(() => validateSettingsUpdate(validSettings({ retryCount: 6 })), /0 through 5/);

  assert.equal(validateCompanyDraft(validCompany()).frequencyMinutes, 60);
  assert.throws(() => validateCompanyDraft(validCompany({ frequencyMinutes: 14 })), /15 through/);
  assert.throws(() => validateCompanyDraft(validCompany({ frequencyMinutes: 15.5 })), /integer/);
  assert.throws(() => validateCompanyDraft(validCompany({ frequencyMinutes: 35_792 })), /15 through 35791/);

  assert.equal(isHostOrSubdomain("jobs.example.com", "example.com"), true);
  assert.equal(isHostOrSubdomain("example.com", "example.com"), true);
  assert.equal(isHostOrSubdomain("notexample.com", "example.com"), false);

  assert.equal(detectSourceFromUrl("https://acme.wd1.myworkdayjobs.com/jobs").sourceType, "workday");
  assert.equal(detectSourceFromUrl("https://jobs.smartrecruiters.com/acme").sourceType, "smartrecruiters");
  assert.equal(detectSourceFromUrl("https://jobs.ashbyhq.com/acme").sourceType, "ashby");
  assert.equal(detectSourceFromUrl("https://jobs.linkedin.com/jobs/123").sourceType, "browser-required");

  // Arbitrary career-site hostnames stay manual-review until the transport can pin
  // an approved DNS answer to the actual network connection (see #123).
  assert.equal(detectSourceFromUrl("https://careers.example.com/jobs").sourceType, "unsupported");
  assert.equal(detectSourceFromUrl("https://example.com/careers/openings").sourceType, "unsupported");

  assertNotSourceType("https://evilworkday.com/", "workday");
  assertNotSourceType("https://fakeicims.com/jobs", "icims");
  assertNotSourceType("https://smartrecruiters.com.evil.example/jobs", "smartrecruiters");
  assertNotSourceType("https://evilashbyhq.com/jobs", "ashby");
  assertNotSourceType("https://notbamboohr.com/jobs", "bamboohr");
  assertNotSourceType("https://eviltaleo.net/jobs", "taleo");
  assertNotSourceType("https://eviloracle.com/careers", "oracle");
  assertNotSourceType("https://notlinkedin.com/jobs", "browser-required");

  const artifactsRoot = path.resolve("tmp-qor-artifacts");
  const managedFile = path.join(artifactsRoot, "resumes", "resume.pdf");
  assert.equal(assertManagedArtifactPath(managedFile, artifactsRoot), managedFile);
  assert.equal(assertManagedArtifactPath(artifactsRoot, artifactsRoot), artifactsRoot);
  assert.throws(
    () => assertManagedArtifactPath(path.join(artifactsRoot, "..", "secrets.txt"), artifactsRoot),
    /managed artifacts/,
  );
  assert.throws(() => assertManagedArtifactPath("", artifactsRoot), /non-empty string/);

  const traySettings = { minimizeToTray: true };
  assert.equal(shouldMinimizeToTray(traySettings, false), true);
  assert.equal(shouldMinimizeToTray(traySettings, true), false);
  assert.equal(shouldMinimizeToTray({ minimizeToTray: false }, false), false);
  assert.equal(shouldMinimizeToTray(null, false), false);

  console.log("QOR hardening regressions passed!");
}

run();
