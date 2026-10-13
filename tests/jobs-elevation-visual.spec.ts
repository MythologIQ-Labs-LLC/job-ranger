// #248 Find Jobs browser acceptance: capture real PWA renders, not snapshots of a mock.
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./pwa/support/server";
import { distPwa, waitForRuntime } from "./pwa/support/fixtures";

let server: PwaServer;
const out = path.resolve("build", "visual-review", "jobs-248");
test.beforeAll(async () => { server = await startPwaServer(distPwa); mkdirSync(out, { recursive: true }); });
test.afterAll(async () => { await server.close(); });

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "short-desktop", width: 1280, height: 580 },
  { name: "mobile", width: 390, height: 780 },
  { name: "narrow", width: 320, height: 700 },
]) {
  test(`Find Jobs elevation ${viewport.name}: controls, recovery and overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
    await page.goto(`${server.url}#/jobs`);
    await waitForRuntime(page);
    await expect(page.getByRole("heading", { name: "Spend your time on the jobs that look worth it." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Refine job listings" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Job search results" })).toBeVisible();

    const search = page.getByRole("textbox", { name: "Search job title or description" });
    const location = page.getByRole("textbox", { name: "Filter by location" });
    await expect(search).toBeVisible();
    await expect(location).toBeVisible();

    const padding = await search.evaluate((input) => parseFloat(getComputedStyle(input).paddingInlineStart));
    expect(padding).toBeGreaterThan(43); // 1rem icon offset + 1rem icon + gap

    await search.fill("nonexistent-synthetic-filter-term-248");
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(search).toHaveValue("");

    const width = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
    await page.screenshot({ path: path.join(out, `jobs-${viewport.name}.png`) });
  });
}
