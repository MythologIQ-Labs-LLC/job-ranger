import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

test("unconfigured Sojourner PWA never silently loads Google or advertises an unavailable upload", async ({ page }) => {
  const google: string[] = [];
  page.on("request", (request) => {
    if (/https:\/\/(?:accounts\.google\.com|www\.googleapis\.com|oauth2\.googleapis\.com)\//.test(request.url())) {
      google.push(request.url());
    }
  });
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(server.url + "#/resume");
  await waitForRuntime(page);
  await expect(page.getByTestId("drive-resume-export")).toHaveCount(0);
  await page.goto(server.url + "#/settings");
  await waitForRuntime(page);
  await expect(page.getByTestId("drive-resume-export")).toHaveCount(0);
  expect(google).toEqual([]);
});
