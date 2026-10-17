import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

// #248 / #343: Find Jobs tells an empty workspace, sources without listings, listings hidden by
// filters and an unreadable workspace apart, and clearing filters restores the listings without
// touching the assessment direction or dropping keyboard focus.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

const onboardingDismissed = () => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true");
const emptyState = (page: Page) => page.getByTestId("jobs-empty-state");
const listingCount = (page: Page) => page.getByRole("status").filter({ hasText: /captured listings/i });

async function openJobs(page: Page) {
  await page.goto(server.url + "#/jobs");
  await waitForRuntime(page);
}

async function reloadJobs(page: Page) {
  // Records written through the bridge after load are read again on reload, not on a hash change.
  await page.reload();
  await waitForRuntime(page);
}

async function seedListings(page: Page) {
  await page.route("https://boards-api.greenhouse.io/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await openJobs(page);
  await page.evaluate(async () => {
    const api = window.electronAPI;
    const source = await api.companies.create({
      name: "Harbor Health",
      url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440,
      isActive: false,
    });
    const run = await api.companies.runScrape(source.id);
    if (run.status !== "success") throw Error("Synthetic Greenhouse source failed");
    const constraints = {
      geography: { locations: ["Baltimore, MD"], radiusMiles: 30, strength: "preferred" },
      workModes: { values: ["on-site"], strength: "preferred" },
      employmentArrangements: { values: ["full-time"], strength: "required" },
      schedules: { values: ["day"], strength: "preferred" },
      compensation: { floor: 52000, target: 62000, basis: "annual", floorStrength: "required" },
      onCall: { value: "no", strength: "preferred" },
      industries: { values: ["Healthcare"], strength: "preferred" },
    } as const;
    for (const name of ["Clinic operations", "Patient access"]) {
      await api.career.createTargetTrack({
        name,
        relation: "target",
        roleTitles: ["Medical Office Coordinator"],
        seniority: null,
        direction: "Patient-facing healthcare operations",
        constraints,
        isActive: true,
      });
    }
  });
  await reloadJobs(page);
  await expect(page.getByRole("button", { name: "Medical Office Coordinator", exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.context().addInitScript(onboardingDismissed);
});

test("an empty workspace points to adding a source, not to filters", async ({ page }) => {
  await openJobs(page);
  await expect(emptyState(page)).toContainText("No job sources yet");
  await expect(listingCount(page)).toHaveText("Showing 0 of 0 captured listings");
  await expect(page.getByRole("button", { name: "Clear listing filters" })).toHaveCount(0);
  await expect(emptyState(page)).not.toContainText(/match these filters/);
  const add = emptyState(page).getByRole("link", { name: "Add a job source" });
  await expect(add).toHaveAttribute("href", "#/companies");

  // Typing a filter into an empty workspace still does not blame the filters.
  await page.getByLabel("Keywords").fill("coordinator");
  await expect(emptyState(page)).toContainText("No job sources yet");
  await expect(page.getByRole("button", { name: "Clear listing filters" })).toHaveCount(0);
});

test("sources without captured listings point to scanning them", async ({ page }) => {
  await openJobs(page);
  await page.evaluate(() => window.electronAPI.companies.create({
    name: "Harbor Health",
    url: "https://boards.greenhouse.io/harbor-health",
    frequencyMinutes: 1440,
    isActive: false,
  }));
  await reloadJobs(page);
  await expect(emptyState(page)).toContainText("No listings captured yet");
  await expect(emptyState(page).getByRole("link", { name: "Open Companies" })).toHaveAttribute("href", "#/companies");
  await expect(emptyState(page)).not.toContainText("No job sources yet");
});

test("filters that hide every listing are named, and clearing them by keyboard restores the list", async ({ page }) => {
  await seedListings(page);
  const direction = page.getByRole("combobox", { name: "Assessment direction", exact: true });
  // Choose the track that is not the default, so a reset to the first track would be caught.
  const initialTrack = await direction.inputValue();
  const values = await direction.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const chosenTrack = values.find((value) => value && value !== initialTrack)!;
  expect(chosenTrack).toBeTruthy();
  await direction.selectOption(chosenTrack);
  await expect(direction).toHaveValue(chosenTrack);

  const keywords = page.getByLabel("Keywords");
  const location = page.getByLabel("Location");
  const company = page.getByRole("combobox", { name: "Company", exact: true });
  await company.selectOption({ label: "Harbor Health" });
  await location.fill("Baltimore");
  await keywords.fill("astronaut");

  await expect(listingCount(page)).toHaveText("Showing 0 of 1 captured listings. Your filters hide all of them.");
  // No listing is visible, so the collapsed-description search note has nothing to explain.
  await expect(page.getByText("Search terms may appear inside a collapsed listing description.")).toHaveCount(0);
  await expect(emptyState(page)).toContainText("No listings match these filters. Clear them to see your 1 captured listing.");
  await expect(emptyState(page)).not.toContainText("No job sources yet");
  await expect(page.getByRole("button", { name: "Medical Office Coordinator", exact: true })).toHaveCount(0);

  const clear = page.getByRole("button", { name: "Clear listing filters" });
  await clear.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Medical Office Coordinator", exact: true })).toBeVisible();
  await expect(listingCount(page)).toHaveText("Showing 1 of 1 captured listings");
  await expect(emptyState(page)).toHaveCount(0);
  await expect(keywords).toHaveValue("");
  await expect(location).toHaveValue("");
  await expect(company).toHaveValue("all");
  // Filters are for listings; the assessment direction is a separate choice and stays put.
  await expect(direction).toHaveValue(chosenTrack);
  // The button is gone, so focus moves to the listing count (not a text field, which would open a
  // phone keyboard) instead of falling back to the page.
  await expect(listingCount(page)).toBeFocused();
});

test("whitespace-only filters are not active filters", async ({ page }) => {
  await seedListings(page);
  await page.getByLabel("Keywords").fill("   ");
  await page.getByLabel("Location").fill("  ");
  await expect(listingCount(page)).toHaveText("Showing 1 of 1 captured listings");
  await expect(emptyState(page)).toHaveCount(0);
});

for (const width of [320, 390]) {
  test(`filtered-empty state fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await seedListings(page);
    await page.getByLabel("Keywords").fill("astronaut");
    const clear = page.getByRole("button", { name: "Clear listing filters" });
    await clear.scrollIntoViewIfNeeded();
    await expect(clear).toBeVisible();
    const box = await clear.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.height).toBeGreaterThanOrEqual(24);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await clear.click();
    await expect(page.getByRole("button", { name: "Medical Office Coordinator", exact: true })).toBeVisible();
  });
}

test("a failed workspace read is not presented as an empty workspace and can be retried", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  // Wrap the bridge before the app's first read. Reads fail until the test lets them through, so
  // the 30 s background refresh cannot recover mid-test.
  await page.context().addInitScript(() => {
    const state = window as unknown as { __failReads: boolean };
    state.__failReads = true;
    const define = Object.defineProperty;
    Object.defineProperty = function (target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
      if (target === window && key === "electronAPI" && descriptor.value?.jobs) {
        const jobs = descriptor.value.jobs as { list: (...args: unknown[]) => Promise<unknown> };
        const actual = jobs.list;
        jobs.list = async (...args: unknown[]) => {
          // One long unbroken token: the message must wrap instead of widening a narrow screen.
          if (state.__failReads) throw new Error(`Synthetic-workspace-read-failure-${"x".repeat(160)}`);
          return actual(...args);
        };
      }
      return define(target, key, descriptor);
    } as typeof Object.defineProperty;
  });
  await openJobs(page);
  await expect(page.getByText(/Synthetic-workspace-read-failure-x+/)).toBeVisible();
  await expect(listingCount(page)).toHaveText("Captured listings could not be loaded");
  await expect(emptyState(page)).toContainText("could not be loaded");
  await expect(emptyState(page)).not.toContainText(/No job sources yet|No listings captured yet|match these filters/);
  await expect(emptyState(page).getByRole("link")).toHaveCount(0);
  await expect(page.getByText(/Showing 0 of 0/)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Once the workspace can be read again, "Try again" shows what is really there.
  await page.evaluate(() => { (window as unknown as { __failReads: boolean }).__failReads = false; });
  await emptyState(page).getByRole("button", { name: "Try again" }).click();
  await expect(listingCount(page)).toHaveText("Showing 0 of 0 captured listings");
  await expect(emptyState(page)).toContainText("No job sources yet");
  await expect(page.getByText(/Synthetic-workspace-read-failure/)).toHaveCount(0);
});
