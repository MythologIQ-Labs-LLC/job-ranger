import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

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

test("empty Home gives a goal-first next action without requiring a resume", async ({ page }) => {
  await openHome(page);
  await expect(page.getByRole("heading", { name: "Choose a career direction" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a target track" })).toHaveAttribute("href", "#/target-tracks");
  await expect(page.getByRole("heading", { name: "Add an opportunity source" })).toBeVisible();
  const summary = page.getByText("Search activity and technical diagnostics");
  await expect(summary).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent runs" })).toBeHidden();
  await summary.click();
  await expect(page.getByRole("heading", { name: "Recent runs" })).toBeVisible();
});

test("confirmed evidence and tracked applications are read-only Home progress", async ({ page }) => {
  await openHome(page);
  await page.evaluate(async () => {
    const api = window.electronAPI;
    await api.career.createUserEvidence({
      subjectType: "skill",
      statement: "Provides careful customer service across teams.",
    });
  });
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Your next steps" })).toBeVisible();
  await expect(page.getByText("Confirmed career facts").locator("..").getByText("1", { exact: true })).toBeVisible();
  // Tracking counts are non-consequential; no "due" claim may be made from a status alone.
  await expect(page.getByText("A recorded application status alone never means a follow-up is due.")).toBeVisible();
});

test("a real unseen listing appears as an assessment action, not a fit score", async ({ page }) => {
  await page.route("https://boards-api.greenhouse.io/**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await openHome(page);
  await page.evaluate(async () => {
    const api = window.electronAPI;
    const source = await api.companies.create({
      name: "Harbor Health",
      url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440,
      isActive: false,
    });
    const run = await api.companies.runScrape(source.id);
    if (run.status !== "success") throw Error("Fixture source failed");
  });
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "1 unseen opportunity to assess" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review opportunities" })).toHaveAttribute("href", "#/jobs");
  await expect(page.getByText(/Compare eligibility, evidence, career direction, preferences, and unknowns/)).toBeVisible();
});

test("failing career reads never masquerade as an empty queue", async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => {
    window.electronAPI.career.listTargetTracks = async () => {
      throw new Error("Synthetic offline target-track read");
    };
  });
  await page.goto(server.url + "#/jobs");
  await page.goto(server.url + "#/");
  await expect(page.getByRole("alert")).toContainText("Synthetic offline target-track read");
  await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a career direction" })).toHaveCount(0);
});

test("short and narrow Home keeps the next action ahead of diagnostics", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openHome(page);
  const actions = await page.getByRole("heading", { name: "Needs your attention" }).boundingBox();
  const diagnostics = await page.getByText("Search activity and technical diagnostics").boundingBox();
  expect(actions).not.toBeNull();
  expect(diagnostics).not.toBeNull();
  expect(actions!.y).toBeLessThan(diagnostics!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
