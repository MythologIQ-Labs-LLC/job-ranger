const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron/backend.cjs");

async function waitFor(condition, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for test condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createMockFetch() {
  const state = {
    greenhouseCalls: 0,
    holdNextGreenhouseResponse: false,
    releaseHeldGreenhouseResponse: null,
  };

  return {
    state,
    fetch: async (url) => {
      if (String(url).includes("boards-api.greenhouse.io/v1/boards/openai/jobs")) {
        state.greenhouseCalls += 1;

        if (state.holdNextGreenhouseResponse) {
          state.holdNextGreenhouseResponse = false;
          await new Promise((resolve) => {
            state.releaseHeldGreenhouseResponse = resolve;
          });
          state.releaseHeldGreenhouseResponse = null;
        }

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

      if (String(url) === "https://www.oracle.com/careers/") {
        return new Response(
          `
            <html>
              <body>
                <a href="/careers/job/1234">Senior Cloud Engineer</a>
                <a href="/careers/job/5678">Product Manager</a>
              </body>
            </html>
          `,
          {
            status: 200,
            headers: { "Content-Type": "text/html" },
          },
        );
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    },
  };
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-backend-"));
  const mockFetch = createMockFetch();

  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      fetchImpl: mockFetch.fetch,
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

    const runResult = await backend.runCompanyScrape(company.id);
    assert.equal(runResult.status, "success");
    assert.equal(runResult.jobsFoundCount, 2);
    assert.equal(runResult.jobsMatchedCount, 1);

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
      fetchImpl: mockFetch.fetch,
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

    // Arbitrary generic career-site hostnames remain manual review in the
    // v1.2.0 candidate while connection-level anti-rebinding is tracked in #123.
    const genericSource = await reloaded.createCompany({
      name: "Example careers",
      url: "https://example.com/careers",
      frequencyMinutes: 1440,
      isActive: true,
    });
    assert.equal(genericSource.sourceType, "unsupported");
    assert.equal(genericSource.sourceIdentifier, null);
    const genericRun = await reloaded.runCompanyScrape(genericSource.id);
    assert.equal(genericRun.status, "unsupported");
    assert.equal(genericRun.jobsFoundCount, 0);
    assert.match(genericRun.errorMessage ?? "", /no source identifier/i);

    const oracleSource = await reloaded.createCompany({
      name: "Oracle",
      url: "https://www.oracle.com/careers/",
      frequencyMinutes: 1440,
      isActive: true,
    });
    assert.equal(oracleSource.sourceType, "oracle");
    const oracleRun = await reloaded.runCompanyScrape(oracleSource.id);
    assert.equal(oracleRun.status, "success");
    assert.equal(oracleRun.jobsFoundCount, 2);

    const microsoftSource = await reloaded.createCompany({
      name: "Microsoft Careers",
      url: "https://careers.microsoft.com/v2/global/en/home.html",
      frequencyMinutes: 1440,
      isActive: true,
    });
    assert.equal(microsoftSource.sourceType, "microsoft");

    const browserRequired = await reloaded.createCompany({
      name: "LinkedIn",
      url: "https://www.linkedin.com/jobs/",
      frequencyMinutes: 1440,
      isActive: true,
    });
    assert.equal(browserRequired.sourceType, "browser-required");
    const browserRequiredRun = await reloaded.runCompanyScrape(browserRequired.id);
    assert.equal(browserRequiredRun.status, "unsupported");
    assert.match(browserRequiredRun.errorMessage ?? "", /browser-backed extraction is not available/i);

    const deceptive = await reloaded.createCompany({
      name: "Deceptive board",
      url: "https://evilgreenhouse.io/openai",
      frequencyMinutes: 1440,
      isActive: true,
    });
    assert.equal(deceptive.sourceType, "unsupported");

    const concurrencyGuardCompany = await reloaded.createCompany({
      name: "OpenAI duplicate guard",
      url: "https://boards.greenhouse.io/openai",
      frequencyMinutes: 1440,
      isActive: true,
    });

    const callsBeforeConcurrentRun = mockFetch.state.greenhouseCalls;
    mockFetch.state.holdNextGreenhouseResponse = true;

    const firstConcurrentRun = reloaded.runCompanyScrape(concurrencyGuardCompany.id);
    const secondConcurrentRun = reloaded.runCompanyScrape(concurrencyGuardCompany.id);

    await waitFor(
      () => typeof mockFetch.state.releaseHeldGreenhouseResponse === "function",
    );
    assert.equal(mockFetch.state.greenhouseCalls, callsBeforeConcurrentRun + 1);

    mockFetch.state.releaseHeldGreenhouseResponse?.();

    const [firstConcurrentResult, secondConcurrentResult] = await Promise.all([
      firstConcurrentRun,
      secondConcurrentRun,
    ]);

    assert.equal(firstConcurrentResult.id, secondConcurrentResult.id);

    const duplicateGuardRuns = (await reloaded.listRecentScrapeRuns(20)).filter(
      (run) => run.companyId === concurrencyGuardCompany.id,
    );
    assert.equal(duplicateGuardRuns.length, 1);

    await reloaded.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
