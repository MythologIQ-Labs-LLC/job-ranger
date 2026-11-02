import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

test("Target Track deletion requires explicit review, cancel preserves the record", async ({ page }) => {
  await page.goto(`${server.url}#/target-tracks`);
  await waitForRuntime(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Track name").fill("Community operations");
  await page.getByRole("button", { name: "Save target track" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const before = await page.evaluate(() => window.electronAPI.career.listTargetTracks());
  const target = before.find((track) => track.name === "Community operations");
  expect(target).toBeTruthy();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete target track?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Community operations");
  await expect(dialog).toContainText("cannot be undone");
  expect(await page.evaluate(() => window.electronAPI.career.listTargetTracks())).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.electronAPI.career.listTargetTracks())).toEqual(before);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete target track", exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await page.evaluate(() => window.electronAPI.career.listTargetTracks());
  expect(after.some((track) => track.id === target!.id)).toBe(false);
});

test("Filter deletion is specific, cancellable and keeps failures visible", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  const added = await page.evaluate(() => window.electronAPI.filters.create({
    name: "No overnight openings",
    companyId: null,
    titleInclude: ["Coordinator"],
    titleExclude: [],
    keywordsInclude: [],
    keywordsExclude: [],
    salaryMin: null,
    locationInclude: [],
    locationExclude: [],
    isActive: true,
  }));
  await page.goto(`${server.url}#/filters`);
  await page.reload(); // AppContext's initial read must see the synthetic record.
  await waitForRuntime(page);
  const remove = page.getByRole("button", { name: "Delete filter No overnight openings" });
  await expect(remove).toBeVisible();
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Delete filter?" });
  await expect(dialog).toContainText("No overnight openings");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await page.evaluate(() => window.electronAPI.filters.list())).some((filter) => filter.id === added.id)).toBe(true);

  // Hold the canonical API call open until the test explicitly rejects it.
  // This verifies the pending interaction without races or arbitrary sleeps.
  await page.evaluate(() => {
    const state = window as unknown as { rejectDelete?: () => void; deleteAttempts?: number };
    state.deleteAttempts = 0;
    window.electronAPI.filters.delete = async () => new Promise<void>((_resolve, reject) => {
      state.deleteAttempts = (state.deleteAttempts ?? 0) + 1;
      state.rejectDelete = () => reject(new Error("Synthetic filter deletion failure"));
    });
  });
  await remove.click();
  await dialog.getByRole("button", { name: "Delete filter", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Working..." })).toBeDisabled();
  // Closing or confirming twice during persistence would misrepresent the
  // operation. Escape must not bypass the active confirmation contract.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Working..." })).toBeDisabled();
  await page.evaluate(() => {
    (window as unknown as { rejectDelete: () => void }).rejectDelete();
  });
  await expect(dialog.getByRole("alert")).toContainText("Synthetic filter deletion failure");
  expect(await page.evaluate(() => (window as unknown as { deleteAttempts: number }).deleteAttempts)).toBe(1);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeEnabled();
  expect((await page.evaluate(() => window.electronAPI.filters.list())).some((filter) => filter.id === added.id)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("Job source removal warns about cascading job and history deletion", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  const company = await page.evaluate(() => window.electronAPI.companies.create({
    name: "Example community clinic",
    url: "https://boards.greenhouse.io/examplecommunityclinic",
    frequencyMinutes: 60,
    isActive: true,
  }));
  await page.goto(`${server.url}#/companies`);
  await page.reload(); // AppContext's initial read must see the synthetic record.
  await waitForRuntime(page);
  const remove = page.getByRole("button", { name: "Remove source Example community clinic" });
  await expect(remove).toBeVisible();
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Remove job source?" });
  await expect(dialog).toContainText("saved jobs and scrape history");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await page.evaluate(() => window.electronAPI.companies.list())).some((item) => item.id === company.id)).toBe(true);
  await remove.click();
  await dialog.getByRole("button", { name: "Remove source", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await page.evaluate(() => window.electronAPI.companies.list())).some((item) => item.id === company.id)).toBe(false);
});
