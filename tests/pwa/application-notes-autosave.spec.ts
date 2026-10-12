import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function prepareApplication(page: Page): Promise<string> {
  await page.route("https://boards-api.greenhouse.io/**", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.goto(server.url);
  await waitForRuntime(page);
  const id = await page.evaluate(async () => {
    const api = window.electronAPI;
    const company = await api.companies.create({
      name: "Harbor Health", url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440, isActive: false,
    });
    const scrape = await api.companies.runScrape(company.id);
    if (scrape.status !== "success") throw new Error("Fixture ingest failed");
    const [job] = await api.jobs.list();
    if (!job) throw new Error("Fixture did not produce job");
    return (await api.applications.track(job.id)).id;
  });
  await page.goto(`${server.url}#/applications`);
  await page.reload();
  await waitForRuntime(page);
  return id;
}

test("out-of-order note writes never erase the latest text in UI or durable storage", async ({ page }) => {
  const id = await prepareApplication(page);
  const notes = page.getByRole("textbox", { name: "Notes" });
  await expect(notes).toBeVisible();

  // An intentionally delayed first canonical write reproduces the current race:
  // the second call persists before the older first call is even dispatched.
  await page.evaluate(() => {
    const api = window.electronAPI.applications;
    const original = api.update.bind(api);
    const state = window as unknown as { releaseFirstNote?: () => void; noteCalls: number };
    state.noteCalls = 0;
    api.update = async (id, patch) => {
      if (patch.notes === undefined) return original(id, patch);
      state.noteCalls++;
      if (state.noteCalls === 1) {
        await new Promise<void>((resolve) => { state.releaseFirstNote = resolve; });
      }
      return original(id, patch);
    };
  });
  await notes.fill("First draft");
  await expect(page.getByRole("status", { name: "Application notes save status" }))
    .toContainText("Saving notes");
  await notes.fill("Final draft that must survive");
  await page.waitForFunction(() => (window as unknown as { noteCalls?: number }).noteCalls >= 1);
  // There must be no unacknowledged last-write-wins race, whether the UI
  // sends both writes concurrently or serializes the user intent.
  await page.evaluate(() => {
    const state = window as unknown as { releaseFirstNote: () => void };
    state.releaseFirstNote();
  });
  await expect(notes).toHaveValue("Final draft that must survive");
  await expect(page.getByRole("status", { name: "Application notes save status" }))
    .toContainText("Saved");
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.applications.list()))
    .find((row) => row.id === id)?.notes).toBe("Final draft that must survive");
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("Final draft that must survive");
});

test("a failed autosave preserves the entered draft, displays error, and permits retry", async ({ page }) => {
  const id = await prepareApplication(page);
  await page.evaluate(() => {
    const api = window.electronAPI.applications;
    const original = api.update.bind(api);
    let failOnce = true;
    api.update = async (id, patch) => {
      if (patch.notes !== undefined && failOnce) {
        failOnce = false;
        throw new Error("Synthetic storage interruption");
      }
      return original(id, patch);
    };
  });
  const notes = page.getByRole("textbox", { name: "Notes" });
  await notes.fill("My unsaved interview notes");
  await expect(notes).toHaveValue("My unsaved interview notes");
  await expect(page.getByRole("alert")).toContainText("Synthetic storage interruption");
  expect((await page.evaluate(() => window.electronAPI.applications.list()))
    .find((row) => row.id === id)?.notes).toBe("");
  await page.getByRole("button", { name: "Retry saving notes" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  expect((await page.evaluate(() => window.electronAPI.applications.list()))
    .find((row) => row.id === id)?.notes).toBe("My unsaved interview notes");
});
