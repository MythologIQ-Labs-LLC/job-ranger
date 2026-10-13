// #248 visual-acceptance gate. Uses the same synthetic PWA runtime as the
// existing demo, but produces temporary review screenshots only.
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./pwa/support/server";
import { distPwa, waitForRuntime } from "./pwa/support/fixtures";

let server: PwaServer;
const out = path.resolve("build", "visual-review", "dashboard-248");

test.beforeAll(async () => { server = await startPwaServer(distPwa); mkdirSync(out, { recursive: true }); });
test.afterAll(async () => { await server.close(); });

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "short-desktop", width: 1280, height: 580 },
  { name: "mobile", width: 390, height: 780 },
  { name: "narrow", width: 320, height: 700 },
]) {
  test(`Home elevation ${viewport.name}: actions, overflow and screenshot`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
    await page.goto(`${server.url}#/`);
    await waitForRuntime(page);
    await expect(page.getByRole("heading", { name: "Build a calmer review ritual around the jobs you actually want." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recommended next steps" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Job search overview" })).toBeVisible();
    for (const label of ["Morning review", "Source coverage", "Signal quality"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    const width = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
    await page.screenshot({ path: path.join(out, `home-${viewport.name}.png`) });
  });
}
