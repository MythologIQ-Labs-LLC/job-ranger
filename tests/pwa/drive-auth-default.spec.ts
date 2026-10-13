import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
});

test.afterAll(async () => {
  await server.close();
});

test("default PWA has no OAuth prompt, injected vendor script, or silent Google request", async ({ page }) => {
  const googleRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://accounts.google.com/")) googleRequests.push(request.url());
  });
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.goto(server.url + "#/settings");
  await expect(page.getByRole("heading", { name: /Shape the workspace around/i })).toBeVisible();
  await expect(page.getByTestId("pwa-drive-auth-proof")).toHaveCount(0);
  await expect(page.getByTestId("pwa-drive-load-gis")).toHaveCount(0);
  await expect(page.getByTestId("pwa-drive-authorize")).toHaveCount(0);
  expect(googleRequests).toEqual([]);
});
