// #248 Career Direction browser acceptance against the actual PWA.
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./pwa/support/server";
import { distPwa, waitForRuntime } from "./pwa/support/fixtures";

let server: PwaServer;
const out = path.resolve("build", "visual-review", "career-direction-248");
test.beforeAll(async () => { server = await startPwaServer(distPwa); mkdirSync(out, { recursive: true }); });
test.afterAll(async () => { await server.close(); });

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "short-desktop", width: 1280, height: 580 },
  { name: "mobile", width: 390, height: 780 },
  { name: "narrow", width: 320, height: 700 },
]) {
  test(`Target Tracks elevation ${viewport.name}: summary, controls and overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
    await page.goto(`${server.url}#/target-tracks`);
    await waitForRuntime(page);
    await expect(page.getByRole("heading", { name: "Keep different career directions separate." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Career direction editor" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Saved target tracks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save target track" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Saved career direction summary" })).toBeVisible();
    const width = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
    await page.screenshot({ path: path.join(out, `target-tracks-${viewport.name}.png`) });
  });
}
