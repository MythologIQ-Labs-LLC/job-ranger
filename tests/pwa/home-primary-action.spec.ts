import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

// #291: Home shows exactly one suggested next step, chosen from saved records, with the rest
// secondary; a workflow of places to work that never claims progress; and no counts before
// the data behind them has loaded.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function openHome(page: Page) {
  await page.context().addInitScript(() => {
    localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true");
  });
  await page.goto(server.url);
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Your next steps" })).toBeVisible();
}

async function reloadHome(page: Page) {
  await page.goto(server.url);
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByTestId("home-primary-action")).toBeVisible();
}

async function createTrack(page: Page) {
  await page.evaluate(() => window.electronAPI.career.createTargetTrack({
    name: "Healthcare operations",
    relation: "target",
    roleTitles: ["Medical Office Coordinator"],
    seniority: null,
    direction: "Patient-facing healthcare operations",
    constraints: {
      geography: { locations: ["Baltimore, MD"], radiusMiles: 30, strength: "preferred" },
      workModes: { values: ["on-site", "hybrid"], strength: "preferred" },
      employmentArrangements: { values: ["full-time"], strength: "required" },
      schedules: { values: ["day"], strength: "preferred" },
      compensation: { floor: 52000, target: 62000, basis: "annual", floorStrength: "required" },
      onCall: { value: "no", strength: "preferred" },
      industries: { values: ["Healthcare"], strength: "preferred" },
    },
    isActive: true,
  }));
}

function primary(page: Page) {
  return page.getByTestId("home-primary-action");
}

test("an empty workspace suggests one goal-first step and keeps the rest secondary", async ({ page }) => {
  await openHome(page);
  await expect(page.getByTestId("home-primary-action")).toHaveCount(1);
  await expect(primary(page).getByRole("heading", { name: "Choose a career direction" })).toBeVisible();
  const cta = primary(page).getByRole("link", { name: "Create a target track" });
  await expect(cta).toHaveAttribute("href", "#/target-tracks");
  await expect(cta).toHaveClass(/primary-button/);
  const others = page.getByTestId("home-other-actions");
  await expect(others.getByRole("link", { name: "Manage sources" })).toHaveAttribute("href", "#/companies");
  await expect(others.locator(".primary-button")).toHaveCount(0);
});

test("the workflow links to places to work and never shows progress", async ({ page }) => {
  await openHome(page);
  const workflow = page.getByRole("region", { name: "How the pieces fit" });
  const links = workflow.getByRole("listitem").getByRole("link");
  await expect(links).toHaveCount(4);
  expect(await links.evaluateAll((items) => items.map((item) => item.getAttribute("href")))).toEqual([
    "#/target-tracks",
    "#/jobs",
    "#/career-evidence/new",
    "#/applications",
  ]);
  const text = await workflow.innerText();
  expect(text).not.toMatch(/\d+\s*%|complete(d)?\b|done\b|✓|step \d+ of/i);
  expect(await workflow.locator("[aria-checked], [aria-valuenow], progress, meter").count()).toBe(0);
  // Diagnostics stay behind their summary and below the next step and the workflow.
  await expect(page.getByText("SQLite binary")).toBeHidden();
  const workflowBox = await workflow.boundingBox();
  const diagnosticsBox = await page.getByText("Search activity and technical diagnostics").boundingBox();
  expect(workflowBox!.y).toBeLessThan(diagnosticsBox!.y);
});

test("sources without unseen listings point to Find Jobs instead of an empty queue", async ({ page }) => {
  await openHome(page);
  await createTrack(page);
  await page.evaluate(() => window.electronAPI.companies.create({
    name: "Harbor Health",
    url: "https://boards.greenhouse.io/harbor-health",
    frequencyMinutes: 1440,
    isActive: false,
  }));
  await reloadHome(page);
  await expect(primary(page).getByRole("heading", { name: "No unseen opportunities right now" })).toBeVisible();
  await expect(primary(page).getByRole("link", { name: "Open Find Jobs" })).toHaveAttribute("href", "#/jobs");
  await expect(page.getByText("Nothing is waiting for review.")).toHaveCount(0);
});

test("a failed scan is surfaced as a step, and tracked applications get their own entry", async ({ page }) => {
  let failing = true;
  await page.route("https://boards-api.greenhouse.io/**", async (route) => {
    if (failing) return route.fulfill({ status: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: "unavailable" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(greenhouseFixture),
    });
  });
  await openHome(page);
  await createTrack(page);
  const sourceId = await page.evaluate(async () => {
    const source = await window.electronAPI.companies.create({
      name: "Harbor Health",
      url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440,
      isActive: false,
    });
    const run = await window.electronAPI.companies.runScrape(source.id);
    if (run.status === "success") throw Error("Fixture source unexpectedly succeeded");
    return source.id;
  });
  await reloadHome(page);
  await expect(primary(page).getByRole("heading", { name: "1 source failed on the last scan" })).toBeVisible();
  await expect(primary(page).getByRole("link", { name: "Check job sources" })).toHaveAttribute("href", "#/companies");

  // The source recovers; one listing is tracked as an application.
  failing = false;
  await page.evaluate(async (id) => {
    const api = window.electronAPI;
    const run = await api.companies.runScrape(id);
    if (run.status !== "success") throw Error("Fixture source failed");
    const jobs = await api.jobs.list();
    await api.applications.track(jobs[0].id);
  }, sourceId);
  await reloadHome(page);
  await expect(page.getByRole("heading", { name: "1 source failed on the last scan" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "1 tracked application" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open applications" }).first()).toHaveAttribute("href", "#/applications");
  // A recorded application never becomes a "due" claim.
  const actionText = (await page.locator('[data-testid="home-primary-action"], [data-testid="home-other-actions"]').allInnerTexts()).join(" ");
  expect(actionText).not.toMatch(/\bdue\b|overdue|follow up now/i);
});

test("keyboard users reach the suggested step and the diagnostics toggle", async ({ page }) => {
  await openHome(page);
  const cta = primary(page).getByRole("link", { name: "Create a target track" });
  await cta.focus();
  await expect(cta).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/target-tracks$/);
  await page.goto(server.url);
  await waitForRuntime(page);
  const summary = page.locator("summary", { hasText: "Search activity and technical diagnostics" });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Recent runs" })).toBeVisible();
});

test("diagnostic counts never read as zero while the workspace is still loading", async ({ page }) => {
  // Hold the app's first jobs read (AppContext's initial load) until the test releases it.
  await page.context().addInitScript(() => {
    localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true");
    const define = Object.defineProperty;
    Object.defineProperty = function (target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
      if (target === window && key === "electronAPI" && descriptor.value?.jobs) {
        const jobs = descriptor.value.jobs as { list: (...args: unknown[]) => Promise<unknown> };
        const actual = jobs.list;
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => { release = resolve; });
        (window as unknown as { __releaseJobs: () => void }).__releaseJobs = release;
        jobs.list = async (...args: unknown[]) => { await gate; return actual(...args); };
      }
      return define(target, key, descriptor);
    } as typeof Object.defineProperty;
  });
  await page.goto(server.url);
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Your next steps" })).toBeVisible();
  await expect(page.getByText("Loading your next steps...")).toBeVisible();
  await page.locator("summary", { hasText: "Search activity and technical diagnostics" }).click();
  await expect(page.getByText("Loading recent scan results")).toBeVisible();
  await expect(page.getByText("Filters become useful after your first scrape")).toHaveCount(0);
  await expect(page.locator(".metric-value").first()).toHaveText("…");
  await expect(page.locator(".metric-detail").first()).toHaveText("Loading");
  await page.evaluate(() => (window as unknown as { __releaseJobs: () => void }).__releaseJobs());
  await expect(page.locator(".metric-value").first()).toHaveText("0");
  await expect(page.getByText("Filters become useful after your first scrape")).toBeVisible();
});
