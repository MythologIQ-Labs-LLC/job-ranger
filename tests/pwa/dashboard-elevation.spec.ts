import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";
import { prepareDemoContext, seedDemo } from "../../scripts/demo/fixture";

// #291 Home elevation: one contextual next action, real observed activity,
// and career navigation without false completion/AI/Drive claims.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function openHome(page: Page) {
  await page.goto(`${server.url}#/`);
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Make the next career move count." })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
});

test("empty workspace puts one actionable source link above diagnostics", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHome(page);
  const hero = page.locator(".dashboard-hero");
  await expect(hero.locator("a.primary-button")).toHaveCount(1);
  await expect(hero.getByRole("link", { name: "Add your first job source" })).toHaveAttribute("href", "#/companies");
  await expect(page.getByRole("region", { name: "One decision at a time" })).toHaveCount(1);
  const journey = page.getByRole("heading", { name: "One decision at a time" });
  await expect(journey).toBeVisible();
  await expect(page.locator(".dashboard-step")).toHaveCount(4);
  const diagnostics = page.locator("details.dashboard-diagnostics");
  await expect(diagnostics).not.toHaveAttribute("open");
  await diagnostics.locator("summary").click();
  await expect(diagnostics).toHaveAttribute("open");
  await expect(diagnostics.getByText("Database location")).toBeVisible();
  await hero.getByRole("link", { name: "Add your first job source" }).click();
  await expect(page).toHaveURL(/#\/companies$/);
});

test("career workflow links navigate to existing governed routes", async ({ page }) => {
  await openHome(page);
  const expected = [
    ["Know your direction", "#/career-profile"],
    ["Find promising work", "#/jobs"],
    ["Ground your evidence", "#/career-evidence/new"],
    ["Track what happens", "#/applications"],
  ] as const;
  for (const [title, href] of expected) {
    const link = page.locator(".dashboard-step").filter({ hasText: title });
    await expect(link).toHaveAttribute("href", href);
  }
  await expect(page.getByText("These are places to work, not completion scores.")).toBeVisible();
  await expect(page.getByText("Job Ranger supports your judgment.")).toBeVisible();
});

test("seeded fictional jobs give the review queue the lead action", async ({ page, context }) => {
  await prepareDemoContext(context);
  await openHome(page);
  await seedDemo(page);
  await page.reload();
  await waitForRuntime(page);
  const hero = page.locator(".dashboard-hero");
  await expect(hero.getByRole("link", { name: /^Review \d+ new jobs?$/ })).toHaveAttribute("href", "#/jobs");
  await expect(page.getByRole("heading", { name: "Search at a glance" })).toBeVisible();
  await expect(page.getByText("Observed activity")).toBeVisible();
});

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 780 },
  { width: 1280, height: 580 },
  { width: 1440, height: 900 },
]) {
  test(`dashboard fits ${viewport.width}x${viewport.height} without horizontal clipping`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openHome(page);
    await expect(page.locator(".dashboard-hero")).toBeVisible();
    await expect(page.locator(".dashboard-step")).toHaveCount(4);
    const state = await page.evaluate(() => ({
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      mainOverflow: (document.querySelector(".app-main") as HTMLElement).scrollWidth -
        (document.querySelector(".app-main") as HTMLElement).clientWidth,
      primaryHeight: (document.querySelector(".dashboard-hero .primary-button") as HTMLElement).getBoundingClientRect().height,
    }));
    expect(state.pageOverflow).toBeLessThanOrEqual(0);
    expect(state.mainOverflow).toBeLessThanOrEqual(1);
    expect(state.primaryHeight).toBeGreaterThanOrEqual(40);
    // Explicit navigation to avoid unintended route regressions after refresh.
    const destination = page.locator(".dashboard-step").first();
    await destination.click();
    await expect(page).toHaveURL(/#\/career-profile$/);
  });
}

test("keyboard can open diagnostics and journey actions", async ({ page }) => {
  await openHome(page);
  const summary = page.locator("details.dashboard-diagnostics summary");
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("details.dashboard-diagnostics")).toHaveAttribute("open");
  const link = page.locator(".dashboard-step").first();
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/career-profile$/);
});
