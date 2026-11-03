// Regression: once a scrape's result has been delivered with nothing left in
// the queue, the backend must not touch the database again. A late
// settings read raced callers that dispose the backend and remove its data
// directory (seen on Windows CI as an unhandled "unable to open database").
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { SojournerBackend } = require("../electron-runtime/electron/src/backend.cjs");

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-queue-idle-"));
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ jobs: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    const backend = new SojournerBackend({ dataDirectory: tempDir, fetchImpl, schedulerEnabled: false });
    await backend.initialize();
    const company = await backend.createCompany({
      name: "Empty board",
      url: "https://boards.greenhouse.io/empty",
      frequencyMinutes: 1440,
      isActive: true,
    });

    let settingsReads = 0;
    const getSettings = backend.getSettings.bind(backend);
    backend.getSettings = async () => {
      settingsReads += 1;
      return getSettings();
    };

    const result = await backend.runCompanyScrape(company.id);
    assert.equal(result.status, "success");
    const readsWhenDelivered = settingsReads;
    await backend.dispose();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settingsReads, readsWhenDelivered, "an idle queue must not read the database after a scrape is delivered");
    assert.deepEqual(unhandled, [], "no unhandled rejections from the scrape queue");
    console.log("Scrape queue idle regression passed!");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
