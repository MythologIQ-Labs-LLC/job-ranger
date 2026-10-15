import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

// BACKLOG G2: saved filters must show every stored rule and be editable and toggleable.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function seedFilter(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(server.url);
  await waitForRuntime(page);
  const filter = await page.evaluate(() => window.electronAPI.filters.create({
    name: "Clinic coordination",
    companyId: null,
    titleInclude: ["coordinator"],
    titleExclude: ["director"],
    keywordsInclude: ["scheduling"],
    keywordsExclude: ["overnight"],
    salaryMin: 52000,
    locationInclude: ["remote"],
    locationExclude: ["alaska"],
    isActive: true,
  }));
  await page.goto(`${server.url}#/filters`);
  await page.reload();
  await waitForRuntime(page);
  return filter.id;
}

const stored = (page: Page, id: string) =>
  page.evaluate(async (filterId) => (await window.electronAPI.filters.list()).find((f) => f.id === filterId), id);

test("a saved filter shows its exclusion rules", async ({ page }) => {
  await seedFilter(page);
  const card = page.getByRole("region", { name: "Clinic coordination" });
  await expect(card.getByText("Title excludes")).toBeVisible();
  await expect(card.getByText("director")).toBeVisible();
  await expect(card.getByText("Keywords exclude")).toBeVisible();
  await expect(card.getByText("overnight")).toBeVisible();
  await expect(card.getByText("Location excludes")).toBeVisible();
  await expect(card.getByText("alaska")).toBeVisible();
});

test("a filter can be disabled and re-enabled without losing its rules", async ({ page }) => {
  const id = await seedFilter(page);
  const card = page.getByRole("region", { name: "Clinic coordination" });
  await card.getByRole("button", { name: "Disable filter Clinic coordination" }).click();
  await expect(card.getByText("Disabled", { exact: true })).toBeVisible();
  expect((await stored(page, id))?.isActive).toBe(false);

  await page.reload();
  await waitForRuntime(page);
  await card.getByRole("button", { name: "Enable filter Clinic coordination" }).click();
  await expect(card.getByText("Active", { exact: true })).toBeVisible();
  const after = await stored(page, id);
  expect(after?.isActive).toBe(true);
  expect(after?.titleExclude).toEqual(["director"]);
});

test("editing a filter starts from its saved rules, cancel keeps them, save replaces them", async ({ page }) => {
  const id = await seedFilter(page);
  const card = page.getByRole("region", { name: "Clinic coordination" });

  await card.getByRole("button", { name: "Edit filter Clinic coordination" }).click();
  let dialog = page.getByRole("dialog", { name: "Edit filter" });
  await expect(dialog.getByLabel("Filter name", { exact: true })).toHaveValue("Clinic coordination");
  await expect(dialog.getByLabel("Title includes")).toHaveValue("coordinator");
  await expect(dialog.getByLabel("Keywords exclude")).toHaveValue("overnight");
  await expect(dialog.getByLabel("Location excludes")).toHaveValue("alaska");
  await expect(dialog.getByLabel("Minimum salary")).toHaveValue("52000");
  await dialog.getByLabel("Title includes").fill("coordinator, scheduler");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await stored(page, id))?.titleInclude).toEqual(["coordinator"]);

  await card.getByRole("button", { name: "Edit filter Clinic coordination" }).click();
  dialog = page.getByRole("dialog", { name: "Edit filter" });
  await expect(dialog.getByLabel("Title includes")).toHaveValue("coordinator");
  await dialog.getByLabel("Title includes").fill("coordinator, scheduler");
  await dialog.getByLabel("Location excludes").fill("");
  await dialog.getByRole("button", { name: "Save filter" }).click();
  await expect(dialog).toBeHidden();

  const after = await stored(page, id);
  expect(after?.titleInclude).toEqual(["coordinator", "scheduler"]);
  expect(after?.locationExclude).toEqual([]);
  expect(after?.keywordsExclude).toEqual(["overnight"]);
  expect(after?.salaryMin).toBe(52000);
  expect((await page.evaluate(() => window.electronAPI.filters.list())).length).toBe(1);
  await expect(card.getByText("coordinator, scheduler")).toBeVisible();
});

test("editing can clear the minimum salary and widen scope to all companies", async ({ page }) => {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(server.url);
  await waitForRuntime(page);
  const id = await page.evaluate(async () => {
    const api = window.electronAPI;
    const source = await api.companies.create({
      name: "Acme Co", url: "https://boards.greenhouse.io/acme-co", frequencyMinutes: 1440, isActive: false,
    });
    const filter = await api.filters.create({
      name: "Scoped pay floor", companyId: source.id, titleInclude: ["coordinator"], titleExclude: [],
      keywordsInclude: [], keywordsExclude: [], salaryMin: 52000, locationInclude: [], locationExclude: [],
      isActive: true,
    });
    return filter.id;
  });
  await page.goto(`${server.url}#/filters`);
  await page.reload();
  await waitForRuntime(page);
  const card = page.getByRole("region", { name: "Scoped pay floor" });
  await expect(card.getByText("Scoped to Acme Co")).toBeVisible();

  await card.getByRole("button", { name: "Edit filter Scoped pay floor" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit filter" });
  await dialog.getByLabel("Minimum salary").fill("");
  await dialog.getByLabel("Company scope").selectOption("all");
  await dialog.getByRole("button", { name: "Save filter" }).click();
  await expect(dialog).toBeHidden();

  const after = await stored(page, id);
  expect(after?.salaryMin).toBeNull();
  expect(after?.companyId).toBeNull();
  await expect(card.getByText("Applies to every supported company")).toBeVisible();
  await expect(card.getByText("$52,000")).toBeHidden();
});
