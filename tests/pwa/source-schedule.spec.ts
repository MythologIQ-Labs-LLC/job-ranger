import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

// BACKLOG G1: a monitored source can be paused, resumed and rescheduled after creation.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function seedSource(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.route("https://boards-api.greenhouse.io/**", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.goto(server.url);
  await waitForRuntime(page);
  const source = await page.evaluate(() => window.electronAPI.companies.create({
    name: "Harbor Health", url: "https://boards.greenhouse.io/harbor-health",
    frequencyMinutes: 1440, isActive: true,
  }));
  await page.goto(`${server.url}#/companies`);
  await page.reload();
  await waitForRuntime(page);
  return source.id;
}

const stored = (page: Page, id: string) =>
  page.evaluate(async (sourceId) => (await window.electronAPI.companies.list()).find((c) => c.id === sourceId), id);

test("a monitored source can be paused and resumed without losing its configuration", async ({ page }) => {
  const id = await seedSource(page);
  const row = page.getByRole("row", { name: /Harbor Health/ });
  await expect(row.getByText("Scheduled locally")).toBeVisible();

  await row.getByRole("button", { name: "Pause source Harbor Health" }).click();
  await expect(row.getByText("Paused", { exact: true })).toBeVisible();
  expect((await stored(page, id))?.isActive).toBe(false);

  await page.reload();
  await waitForRuntime(page);
  await expect(row.getByText("Paused", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Resume source Harbor Health" }).click();
  await expect(row.getByText("Scheduled locally")).toBeVisible();
  const after = await stored(page, id);
  expect(after?.isActive).toBe(true);
  expect(after?.url).toBe("https://boards.greenhouse.io/harbor-health");
  expect(after?.frequencyMinutes).toBe(1440);
});

test("a monitored source can be rescheduled and the new cadence persists", async ({ page }) => {
  const id = await seedSource(page);
  const row = page.getByRole("row", { name: /Harbor Health/ });
  const cadence = row.getByLabel("Run frequency for Harbor Health");
  await expect(cadence).toHaveValue("1440");

  await cadence.selectOption("60");
  await expect.poll(async () => (await stored(page, id))?.frequencyMinutes).toBe(60);
  await page.reload();
  await waitForRuntime(page);
  await expect(row.getByLabel("Run frequency for Harbor Health")).toHaveValue("60");
  expect((await stored(page, id))?.isActive).toBe(true);
});
