import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

// BACKLOG G5: notification preferences save from their own section with truthful feedback.
// BACKLOG B3: runtime settings inputs have accessible names.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function openSettings(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(`${server.url}#/settings`);
  await waitForRuntime(page);
}

const savedSettings = (page: Page) => page.evaluate(() => window.electronAPI.settings.get());

test("runtime settings inputs are labelled", async ({ page }) => {
  await openSettings(page);
  for (const name of ["User agent", "Max concurrent scrapes", "Timeout (ms)", "Retry count"]) {
    await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  }
});

test("notification changes show as unsaved, save from their own section and persist", async ({ page }) => {
  await openSettings(page);
  const before = await savedSettings(page);
  const status = page.getByRole("status", { name: "Notification settings save status" });
  const enable = page.getByRole("checkbox", { name: "Enable desktop notifications" });

  await expect(status).toHaveText("All notification changes saved.");
  await enable.click();
  await expect(status).toHaveText("Unsaved notification changes.");
  expect((await savedSettings(page)).notificationsEnabled).toBe(before.notificationsEnabled);

  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(status).toHaveText("All notification changes saved.");
  expect((await savedSettings(page)).notificationsEnabled).toBe(!before.notificationsEnabled);

  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByRole("checkbox", { name: "Enable desktop notifications" }))
    .toBeChecked({ checked: !before.notificationsEnabled });
});

test("saving one section neither saves nor discards unsaved edits in the other", async ({ page }) => {
  await openSettings(page);
  const before = await savedSettings(page);
  const retry = page.getByLabel("Retry count", { exact: true });
  const nextRetry = before.retryCount === 4 ? 3 : 4;
  await retry.fill(String(nextRetry));

  await page.getByRole("checkbox", { name: "Enable desktop notifications" }).click();
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByRole("status", { name: "Notification settings save status" }))
    .toHaveText("All notification changes saved.");

  const afterNotifications = await savedSettings(page);
  expect(afterNotifications.notificationsEnabled).toBe(!before.notificationsEnabled);
  expect(afterNotifications.retryCount).toBe(before.retryCount);
  await expect(retry).toHaveValue(String(nextRetry));

  await page.getByRole("checkbox", { name: "Enable desktop notifications" }).click();
  await page.getByRole("button", { name: "Save runtime settings" }).click();
  await expect.poll(async () => (await savedSettings(page)).retryCount).toBe(nextRetry);
  expect((await savedSettings(page)).notificationsEnabled).toBe(!before.notificationsEnabled);
  await expect(page.getByRole("status", { name: "Notification settings save status" }))
    .toHaveText("Unsaved notification changes.");
});
