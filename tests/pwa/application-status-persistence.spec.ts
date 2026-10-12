import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function seedTwoApplications(page: Page) {
  await page.route("https://boards-api.greenhouse.io/**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.goto(server.url);
  await waitForRuntime(page);
  const apps = await page.evaluate(async () => {
    const api = window.electronAPI;
    const results: { id: string; companyName: string; title: string }[] = [];
    for (const [name,slug] of [["Harbor Health", "harbor-health"],["Bayview Care", "bayview-care"]]) {
      const source = await api.companies.create({
        name, url: `https://boards.greenhouse.io/${slug}`,
        frequencyMinutes: 1440, isActive: false,
      });
      const result = await api.companies.runScrape(source.id);
      if (result.status !== "success") throw new Error(`Fixture scrape failed for ${name}`);
    }
    const jobs = await api.jobs.list();
    if (jobs.length !== 2) throw new Error(`Expected two distinct jobs, found ${jobs.length}`);
    for (const job of jobs) {
      const app = await api.applications.track(job.id);
      results.push({ id: app.id, companyName: app.companyName, title: app.title });
    }
    return results;
  });
  await page.goto(`${server.url}#/applications`);
  await page.reload();
  await waitForRuntime(page);
  return apps;
}

test("failed application status retains unsaved intent, reveals failure and supports retry", async ({ page }) => {
  const apps = await seedTwoApplications(page);
  const first = apps.find((app) => app.companyName === "Harbor Health")!;
  const other = apps.find((app) => app.companyName === "Bayview Care")!;
  // Both cards have the same title. Isolate by the card's company name.
  const card = page.locator("article").filter({ hasText: first.companyName });
  const select = card.getByRole("combobox");
  const otherSelect = page.locator("article").filter({ hasText: other.companyName }).getByRole("combobox");
  await expect(select).toHaveValue("interested");
  await expect(otherSelect).toHaveValue("interested");
  await page.evaluate(() => {
    const original = window.electronAPI.applications.update.bind(window.electronAPI.applications);
    let shouldFail = true;
    window.electronAPI.applications.update = async (id, patch) => {
      if (patch.status !== undefined && shouldFail) {
        shouldFail = false;
        throw new Error("Synthetic status write rejection");
      }
      return original(id, patch);
    };
  });
  await select.focus();
  await select.selectOption("applied");
  await expect(card.getByRole("alert")).toContainText("Synthetic status write rejection");
  await expect(select).toHaveValue("applied");
  await expect(otherSelect).toHaveValue("interested");
  expect((await page.evaluate(() => window.electronAPI.applications.list()))
    .find((app) => app.id === first.id)?.status).toBe("interested");
  await card.getByRole("button", { name: "Retry saving status" }).click();
  await expect(card.getByRole("status", { name: "Application status save status" })).toContainText("Saved");
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.applications.list()))
    .find((app) => app.id === first.id)?.status).toBe("applied");
  await page.reload();
  await waitForRuntime(page);
  await expect(page.locator("article").filter({ hasText: first.companyName }).getByRole("combobox")).toHaveValue("applied");
  await expect(page.locator("article").filter({ hasText: other.companyName }).getByRole("combobox")).toHaveValue("interested");
});

test("status updates while notes are pending preserve both fields after restart", async ({ page }) => {
  const apps = await seedTwoApplications(page);
  const first = apps.find((a) => a.companyName === "Harbor Health")!;
  const card = page.locator("article").filter({ hasText: first.companyName });
  const select = card.getByRole("combobox");
  const notes = card.getByRole("textbox", { name: "Notes" });
  await page.evaluate(() => {
    const original = window.electronAPI.applications.update.bind(window.electronAPI.applications);
    const state = window as unknown as { releaseNotes?: () => void; notesCalls: number };
    state.notesCalls = 0;
    window.electronAPI.applications.update = async (id, patch) => {
      if (patch.notes !== undefined && state.notesCalls++ === 0) {
        await new Promise<void>((resolve) => { state.releaseNotes = resolve; });
      }
      return original(id, patch);
    };
  });
  await notes.fill("Evidence-based notes must remain");
  await expect(card.getByRole("status", { name: "Application notes save status" }))
    .toContainText("Saving notes");
  await select.selectOption("interview");
  await expect(card.getByRole("status", { name: "Application status save status" })).toContainText("Saved");
  await page.evaluate(() => (window as unknown as { releaseNotes: () => void }).releaseNotes());
  await expect(card.getByRole("status", { name: "Application notes save status" })).toContainText("Saved");
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.applications.list()))
    .find((app) => app.id === first.id)).toMatchObject({
      status: "interview", notes: "Evidence-based notes must remain",
    });
  await page.reload();
  await waitForRuntime(page);
  const restored = page.locator("article").filter({ hasText: first.companyName });
  await expect(restored.getByRole("combobox")).toHaveValue("interview");
  await expect(restored.getByRole("textbox", { name: "Notes" })).toHaveValue("Evidence-based notes must remain");
});
