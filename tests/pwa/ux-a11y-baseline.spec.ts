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

test("rendered status badges meet small-text contrast in every theme", async ({ page }) => {
  await page.route("https://boards-api.greenhouse.io/**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
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
  });
  for (const theme of ["atelier", "midnight", "canopy"]) {
    await page.evaluate((nextTheme) => localStorage.setItem("theme", nextTheme), theme);
    await page.goto(server.url + "#/jobs");
    await page.reload();
    await waitForRuntime(page);
    for (const kind of ["warning", "success"]) {
      const badge = page.locator(".soft-badge-" + kind).first();
      await expect(badge).toBeVisible();
      const ratio = await badge.evaluate((element) => {
        const style = getComputedStyle(element);
        const rgb = (value: string) => {
          const entries = value.match(/[\\d.]+/g)?.slice(0, 3).map(Number) ?? [];
          if (entries.length !== 3) throw Error("Expected opaque RGB: " + value);
          return entries.map((num) => {
            const channel = num / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        };
        const lum = (value: string) => {
          const [r, g, b] = rgb(value);
          return r * 0.2126 + g * 0.7152 + b * 0.0722;
        };
        const background = lum(style.backgroundColor);
        const foreground = lum(style.color);
        return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
      });
      expect(ratio, theme + " " + kind + " rendered contrast").toBeGreaterThanOrEqual(4.5);
    }
  }
});
