const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SojournerBackend } = require("../electron/backend.cjs");

function createMockFetch() {
  return async (url) => {
    if (String(url).includes("boards-api.greenhouse.io/v1/boards/openai/jobs")) {
      return new Response(
        JSON.stringify({
          jobs: [
            {
              id: 101,
              title: "Platform Engineer",
              location: { name: "Remote" },
              absolute_url: "https://boards.greenhouse.io/openai/jobs/101",
              content: "<p>Build APIs and infrastructure.</p>",
              updated_at: "2026-03-14T12:00:00.000Z",
            },
            {
              id: 102,
              title: "Product Designer",
              location: { name: "New York" },
              absolute_url: "https://boards.greenhouse.io/openai/jobs/102",
              content: "<p>Design thoughtful experiences.</p>",
              updated_at: "2026-03-14T13:00:00.000Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    throw new Error(`Unexpected fetch URL in test: ${url}`);
  };
}

test("backend persists data, scrapes supported sources, and fails unsupported ones honestly", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-backend-"));

  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      fetchImpl: createMockFetch(),
      schedulerEnabled: false,
    });

    await backend.initialize();

    const company = await backend.createCompany({
      name: "OpenAI",
      url: "https://boards.greenhouse.io/openai",
      frequencyMinutes: 1440,
      isActive: true,
    });

    assert.equal(company.sourceType, "greenhouse");
    assert.equal(company.sourceIdentifier, "openai");

    await backend.createFilter({
      name: "Engineering roles",
      companyId: company.id,
      titleInclude: ["engineer"],
      titleExclude: [],
      keywordsInclude: ["api"],
      keywordsExclude: [],
      salaryMin: null,
      locationInclude: [],
      locationExclude: [],
      isActive: true,
    });

    const run = await backend.runCompanyScrape(company.id);
    assert.equal(run.status, "success");
    assert.equal(run.jobsFoundCount, 2);
    assert.equal(run.jobsMatchedCount, 1);

    const jobs = await backend.listJobs();
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].isNew, true);
    assert.equal(jobs.some((job) => job.matchedFilterCount === 1), true);

    const marked = await backend.markJobSeen(jobs[0].id);
    assert.equal(marked.isNew, false);

    const updatedSettings = await backend.updateSettings({
      maxConcurrentScrapes: 3,
      retryCount: 2,
    });
    assert.equal(updatedSettings.maxConcurrentScrapes, 3);
    assert.equal(updatedSettings.retryCount, 2);

    await backend.dispose();

    const reloaded = new SojournerBackend({
      dataDirectory: tempDir,
      fetchImpl: createMockFetch(),
      schedulerEnabled: false,
    });

    await reloaded.initialize();

    const persistedCompanies = await reloaded.listCompanies();
    const persistedJobs = await reloaded.listJobs();
    const persistedSettings = await reloaded.getSettings();

    assert.equal(persistedCompanies.length, 1);
    assert.equal(persistedJobs.length, 2);
    assert.equal(persistedSettings.maxConcurrentScrapes, 3);
    assert.equal(persistedSettings.retryCount, 2);

    const unsupported = await reloaded.createCompany({
      name: "Unsupported board",
      url: "https://example.com/careers",
      frequencyMinutes: 1440,
      isActive: true,
    });

    const unsupportedRun = await reloaded.runCompanyScrape(unsupported.id);
    assert.equal(unsupportedRun.status, "unsupported");
    assert.match(unsupportedRun.errorMessage ?? "", /Unsupported/i);

    await reloaded.deleteCompany(company.id);
    const jobsAfterDelete = await reloaded.listJobs();
    assert.equal(jobsAfterDelete.length, 0);

    await reloaded.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
