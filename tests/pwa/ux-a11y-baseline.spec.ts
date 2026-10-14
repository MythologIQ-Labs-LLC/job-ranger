import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function open(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(server.url + "#/jobs");
  await waitForRuntime(page);
}

test("Find Jobs inputs retain visible accessible names after typing", async ({ page }) => {
  await open(page);
  const keywords = page.getByRole("textbox", { name: "Keywords" });
  const location = page.getByRole("textbox", { name: "Location" });
  await expect(keywords).toBeVisible();
  await expect(location).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Company" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Assessment direction" })).toBeVisible();
  await keywords.fill("analyst");
  await location.fill("Baltimore");
  await expect(page.getByText("Keywords", { exact: true })).toBeVisible();
  await expect(page.getByText("Location", { exact: true })).toBeVisible();
});

test("reduced motion suppresses page-entry animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await expect(page.locator(".animate-rise").first()).toHaveCSS("animation-name", "none");
});

test("tracked Application controls reflow without horizontal clipping at 320px", async ({ page }) => {
  await page.route("https://boards-api.greenhouse.io/**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.evaluate(async () => {
    const api = window.electronAPI;
    const source = await api.companies.create({
      name: "Harbor Health",
      url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440,
      isActive: false,
    });
    if ((await api.companies.runScrape(source.id)).status !== "success") {
      throw Error("Synthetic source unavailable");
    }
    const [job] = await api.jobs.list();
    if (!job) throw Error("Synthetic source contains no job");
    await api.applications.track(job.id);
  });
  await page.goto(server.url + "#/applications");
  await waitForRuntime(page);
  const remove = page.getByRole("button", { name: /Remove .* from applications/ });
  await expect(remove).toBeVisible();
  const rect = await remove.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(-0.5);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(320.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
