import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

// #291: Home shows exactly one suggested next step, chosen from saved records, with the rest
// secondary; a list of places to work that never claims progress; and no counts or steps
// derived from workspace data that has not loaded (or failed to load).

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

const onboardingDismissed = () => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true");

async function openHome(page: Page) {
  await page.context().addInitScript(onboardingDismissed);
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

async function routeGreenhouse(page: Page, state: { failing: boolean }) {
  await page.route("https://boards-api.greenhouse.io/**", async (route) => {
    if (state.failing) return route.fulfill({ status: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: "unavailable" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(greenhouseFixture),
    });
  });
}

/** Creates a Greenhouse source (active unless stated) and runs one scan through the real core. */
async function addScannedSource(page: Page, isActive = true) {
  return page.evaluate(async (active) => {
    const source = await window.electronAPI.companies.create({
      name: "Harbor Health",
      url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440,
      isActive: active,
    });
    const run = await window.electronAPI.companies.runScrape(source.id);
    return { id: source.id, status: run.status };
  }, isActive);
}

const primary = (page: Page) => page.getByTestId("home-primary-action");
const others = (page: Page) => page.getByTestId("home-other-actions");

async function expectSinglePrimary(page: Page) {
  await expect(page.locator(".home-action-panel .primary-button")).toHaveCount(1);
  await expect(others(page).locator(".primary-button")).toHaveCount(0);
}

test("an empty workspace suggests one goal-first step and keeps the rest secondary", async ({ page }) => {
  await openHome(page);
  await expectSinglePrimary(page);
  await expect(primary(page).getByRole("heading", { name: "Choose a career direction" })).toBeVisible();
  const cta = primary(page).getByRole("link", { name: "Create a target track" });
  await expect(cta).toHaveAttribute("href", "#/target-tracks");
  await expect(cta).toHaveClass(/primary-button/);
  await expect(page.getByRole("list", { name: "Other things you can do" })).toBeVisible();
  await expect(others(page).getByRole("link", { name: "Manage sources" })).toHaveAttribute("href", "#/companies");
});

test("the places to work never show progress and stay above diagnostics", async ({ page }) => {
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
  // An unordered list: places to work in any order, not numbered steps.
  expect(await workflow.locator("ol").count()).toBe(0);
  const text = await workflow.innerText();
  expect(text).not.toMatch(/\d+\s*%|complete(d)?\b|done\b|✓|step \d+ of/i);
  expect(await workflow.locator("[aria-checked], [aria-valuenow], progress, meter").count()).toBe(0);
  await expect(page.getByText("SQLite binary")).toBeHidden();
  const workflowBox = await workflow.boundingBox();
  const diagnosticsBox = await page.getByText("Search activity and technical diagnostics").boundingBox();
  expect(workflowBox!.y).toBeLessThan(diagnosticsBox!.y);
});

test("scannable sources with nothing unseen point to scanning them, where scans actually run", async ({ page }) => {
  await routeGreenhouse(page, { failing: false });
  await openHome(page);
  await createTrack(page);
  const source = await addScannedSource(page);
  expect(source.status).toBe("success");
  await page.evaluate(async () => {
    for (const job of await window.electronAPI.jobs.list()) await window.electronAPI.jobs.markSeen(job.id);
  });
  await reloadHome(page);
  await expectSinglePrimary(page);
  await expect(primary(page).getByRole("heading", { name: "No unseen opportunities right now" })).toBeVisible();
  // Find Jobs has no scan control; scans run from the Companies page.
  await expect(primary(page).getByRole("link", { name: "Run a job source" })).toHaveAttribute("href", "#/companies");
  await expect(primary(page)).toContainText("Companies page");
});

test("until the runtime is known, Home shows loading rather than a wrong or missing step", async ({ page }) => {
  // Hold getRuntimeInfo on the next load only (the bridge is defined once, before React mounts).
  await page.context().addInitScript(() => {
    if (sessionStorage.getItem("jr.test.holdRuntime") !== "1") return;
    const define = Object.defineProperty;
    Object.defineProperty = function (target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
      if (target === window && key === "electronAPI" && descriptor.value?.getRuntimeInfo) {
        const api = descriptor.value as { getRuntimeInfo: (...args: unknown[]) => Promise<unknown> };
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => { release = resolve; });
        (window as unknown as { __releaseRuntime: () => void }).__releaseRuntime = release;
        const held = async (...args: unknown[]) => { await gate; return api.getRuntimeInfo(...args); };
        descriptor = { ...descriptor, value: Object.freeze({ ...api, getRuntimeInfo: held }) };
      }
      return define(target, key, descriptor);
    } as typeof Object.defineProperty;
  });
  await routeGreenhouse(page, { failing: false });
  await openHome(page);
  await createTrack(page);
  const source = await addScannedSource(page);
  expect(source.status).toBe("success");
  await page.evaluate(async () => {
    for (const job of await window.electronAPI.jobs.list()) await window.electronAPI.jobs.markSeen(job.id);
    sessionStorage.setItem("jr.test.holdRuntime", "1");
  });
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByText("Loading your next steps...")).toBeVisible();
  await expect(page.getByText(/cannot be fully determined/)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __releaseRuntime: () => void }).__releaseRuntime());
  await expectSinglePrimary(page);
  await expect(primary(page).getByRole("heading", { name: "No unseen opportunities right now" })).toBeVisible();
});

test("an active source the web app cannot read is not counted as scannable", async ({ page }) => {
  // Workday has a desktop reader but none in the web app; never let it reach the network here.
  await page.route("**/*myworkdayjobs.com/**", (route) => route.abort());
  await openHome(page);
  await createTrack(page);
  const created = await page.evaluate(() => window.electronAPI.companies.create({
    name: "Harbor Workday",
    url: "https://harbor.wd5.myworkdayjobs.com/en-US/careers",
    frequencyMinutes: 1440,
    isActive: true,
  }));
  expect(created.sourceType).toBe("workday");
  await reloadHome(page);
  await expectSinglePrimary(page);
  await expect(primary(page).getByRole("heading", { name: "None of your sources can be read here" })).toBeVisible();
  await expect(primary(page)).toContainText("Greenhouse, Lever, Ashby, SmartRecruiters");
  await expect(page.getByRole("heading", { name: "No unseen opportunities right now" })).toHaveCount(0);
  // The Companies page agrees: nothing is counted as runnable, and Run is not offered for it.
  await page.goto(`${server.url}#/companies`);
  await expect(page.locator(".metric-card").filter({ hasText: "Runnable now" })).toContainText("0");
  const row = page.getByRole("row").filter({ hasText: "Harbor Workday" });
  await expect(row.getByTestId("web-source-limit")).toBeVisible();
  await expect(row.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
});

test("when every readable source is paused, Home says so and points to the sources", async ({ page }) => {
  await routeGreenhouse(page, { failing: false });
  await openHome(page);
  await createTrack(page);
  await page.evaluate(() => window.electronAPI.companies.create({
    name: "Paused Clinic",
    url: "https://boards.greenhouse.io/paused-clinic",
    frequencyMinutes: 1440,
    isActive: false,
  }));
  await reloadHome(page);
  await expectSinglePrimary(page);
  await expect(primary(page).getByRole("heading", { name: "Your job sources are paused" })).toBeVisible();
  await expect(primary(page).getByRole("link", { name: "Review job sources" })).toHaveAttribute("href", "#/companies");
  await expect(page.getByRole("heading", { name: "No unseen opportunities right now" })).toHaveCount(0);
});

test("a failed scan is a suggested step; tracked applications stay secondary with no due claim", async ({ page }) => {
  const greenhouse = { failing: true };
  await routeGreenhouse(page, greenhouse);
  await openHome(page);
  await createTrack(page);
  const source = await addScannedSource(page);
  expect(source.status).not.toBe("success");
  await reloadHome(page);
  await expectSinglePrimary(page);
  await expect(primary(page).getByRole("heading", { name: "1 source failed on the last scan" })).toBeVisible();
  await expect(primary(page).getByRole("link", { name: "Check job sources" })).toHaveAttribute("href", "#/companies");

  // The source recovers and one listing is tracked as an application.
  greenhouse.failing = false;
  await page.evaluate(async (id) => {
    const api = window.electronAPI;
    const run = await api.companies.runScrape(id);
    if (run.status !== "success") throw Error("Fixture source failed");
    const jobs = await api.jobs.list();
    await api.applications.track(jobs[0].id);
    for (const job of jobs) await api.jobs.markSeen(job.id);
  }, source.id);
  await reloadHome(page);
  await expectSinglePrimary(page);
  await expect(page.getByRole("heading", { name: "1 source failed on the last scan" })).toHaveCount(0);
  await expect(primary(page).getByRole("heading", { name: "No unseen opportunities right now" })).toBeVisible();
  await expect(others(page).getByRole("heading", { name: "Your applications" })).toBeVisible();
  await expect(others(page).getByRole("link", { name: "Open applications" })).toHaveAttribute("href", "#/applications");
  await expect(primary(page)).not.toContainText(/application/i);
  const actionText = (await page.locator('[data-testid="home-primary-action"], [data-testid="home-other-actions"]').allInnerTexts()).join(" ");
  expect(actionText).not.toMatch(/\bdue\b|overdue|follow up now|\d+ tracked application/i);
});

test("keyboard users reach the suggested step before diagnostics, and both activate", async ({ page }) => {
  await openHome(page);
  const cta = primary(page).getByRole("link", { name: "Create a target track" });
  const summary = page.locator("summary", { hasText: "Search activity and technical diagnostics" });
  const order: string[] = [];
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 60 && order.length < 2; i += 1) {
    await page.keyboard.press("Tab");
    if (await cta.evaluate((element) => element === document.activeElement) && !order.includes("cta")) order.push("cta");
    if (await summary.evaluate((element) => element === document.activeElement) && !order.includes("summary")) order.push("summary");
  }
  expect(order).toEqual(["cta", "summary"]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Recent runs" })).toBeVisible();
  await cta.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/target-tracks$/);
});

/** Wraps the workspace bridge before the app's first read (it is defined once, before React mounts). */
async function interceptFirstWorkspaceRead(page: Page, mode: "hold" | "fail") {
  await page.context().addInitScript(onboardingDismissed);
  await page.context().addInitScript((failRead) => {
    const define = Object.defineProperty;
    Object.defineProperty = function (target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
      if (target === window && key === "electronAPI" && descriptor.value?.jobs) {
        const jobs = descriptor.value.jobs as { list: (...args: unknown[]) => Promise<unknown> };
        const actual = jobs.list;
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => { release = resolve; });
        (window as unknown as { __releaseJobs: () => void }).__releaseJobs = release;
        let first = true;
        jobs.list = async (...args: unknown[]) => {
          // "fail": every read fails, so the 30 s background refresh cannot recover mid-test.
          if (failRead) throw new Error("Synthetic workspace read failure");
          if (!first) return actual(...args);
          first = false;
          await gate;
          return actual(...args);
        };
      }
      return define(target, key, descriptor);
    } as typeof Object.defineProperty;
  }, mode === "fail");
  await page.goto(server.url);
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Your next steps" })).toBeVisible();
}

test("nothing reads as zero or empty while the workspace is still loading", async ({ page }) => {
  await interceptFirstWorkspaceRead(page, "hold");
  await expect(page.getByText("Loading your next steps...")).toBeVisible();
  await page.locator("summary", { hasText: "Search activity and technical diagnostics" }).click();
  await expect(page.getByText("Loading recent scan results")).toBeVisible();
  await expect(page.getByText("Filters become useful after your first scrape")).toHaveCount(0);
  await expect(page.getByText("Add your first careers page")).toHaveCount(0);
  await expect(page.locator(".metric-value").first()).toHaveText("…");
  await expect(page.locator(".metric-detail").first()).toHaveText("Loading");
  await page.evaluate(() => (window as unknown as { __releaseJobs: () => void }).__releaseJobs());
  await expect(page.locator(".metric-value").first()).toHaveText("0");
  await expect(page.getByText("Filters become useful after your first scrape")).toBeVisible();
});

test("a failed workspace read never suggests source steps or shows zeros", async ({ page }) => {
  await interceptFirstWorkspaceRead(page, "fail");
  await expect(page.getByText("Synthetic workspace read failure")).toBeVisible();
  // Career records loaded fine, so their step is still suggested; source and job steps are not.
  await expectSinglePrimary(page);
  await expect(primary(page).getByRole("heading", { name: "Choose a career direction" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add an opportunity source" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /No unseen opportunities|None of your sources/ })).toHaveCount(0);
  await page.locator("summary", { hasText: "Search activity and technical diagnostics" }).click();
  await expect(page.locator(".metric-value").first()).toHaveText("—");
  await expect(page.locator(".metric-detail").first()).toHaveText("Unavailable");
  await expect(page.getByText("Job sources could not be loaded")).toBeVisible();
  await expect(page.getByText("Add your first careers page")).toHaveCount(0);
});
