// #248 Applications browser acceptance, screenshots are review artifacts only.
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./pwa/support/server";
import { distPwa, waitForRuntime } from "./pwa/support/fixtures";

let server: PwaServer;
const out = path.resolve("build", "visual-review", "applications-248");

test.beforeAll(async () => { server = await startPwaServer(distPwa); mkdirSync(out, { recursive: true }); });
test.afterAll(async () => { await server.close(); });

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "short-desktop", width: 1280, height: 580 },
  { name: "mobile", width: 390, height: 780 },
  { name: "narrow", width: 320, height: 700 },
]) {
  test(`Applications elevation ${viewport.name}: landmarks and overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
    await page.goto(`${server.url}#/applications`);
    await waitForRuntime(page);
    await expect(page.getByRole("heading", { name: "Keep track of what happens after a job looks promising." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Tracked applications" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find jobs", exact: true })).toBeVisible();
    // Presence of real fixture applications depends on the deterministic PWA seed.
    // Both the populated pipeline and empty state must be legible and honest.
    const pipeline = page.getByRole("heading", { name: "Application pipeline" });
    const empty = page.getByRole("heading", { name: "No applications tracked yet." });
    await expect(pipeline.or(empty)).toBeVisible();
    const width = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
    await page.screenshot({ path: path.join(out, `applications-${viewport.name}.png`) });
  });
}
