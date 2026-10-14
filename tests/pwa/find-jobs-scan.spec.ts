import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function seed(page: Page) {
  await page.context().addInitScript(() =>
    localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"),
  );
  await page.route("https://boards-api.greenhouse.io/**", async route => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.evaluate(async () => {
    const source = await window.electronAPI.companies.create({
      name: "Harbor Health",
      url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440,
      isActive: false,
    });
    const result = await window.electronAPI.companies.runScrape(source.id);
    if (result.status !== "success") throw Error("Synthetic Greenhouse source failed");
    await window.electronAPI.career.createTargetTrack({
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
    });
  });
  await page.goto(server.url + "#/jobs");
  await waitForRuntime(page);
  await expect(page.getByRole("button", { name: "Medical Office Coordinator", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Assessment target track" })).toHaveValue(/track-/);
}

test("compact list retains source quality and assessment access without showing verbose details", async ({ page }) => {
  await seed(page);
  const job = page.locator("article").filter({
    has: page.getByRole("button", { name: "Medical Office Coordinator", exact: true }),
  });
  const toggle = page.getByRole("group", { name: "Listing layout" });
  await expect(toggle.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Showing 1 of 1 captured listings" })).toBeVisible();
  await expect(job).toContainText("Full source text");
  await expect(job.getByRole("button", { name: "Track this job" })).toBeVisible();

  const details = job.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(job.getByText("Still active on source")).toBeHidden();
  await expect(job.getByRole("button", { name: /Opportunity assessment/ })).toBeVisible();
  await job.getByRole("button", { name: /Opportunity assessment/ }).click();
  await expect(job.getByText("Eligibility and blockers")).toBeVisible();
  await expect(job.getByText("Evidence coverage", { exact: true })).toBeVisible();

  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(job.getByText(/First seen/)).toBeVisible();
  await expect(job.getByText(/Last seen/)).toBeVisible();
});

test("detailed and compact modes toggle access to full listing without touching canonical job status", async ({ page }) => {
  await seed(page);
  const job = page.locator("article").filter({ hasText: "Medical Office Coordinator" });
  const before = await page.evaluate(async () => {
    const [item] = await window.electronAPI.jobs.list();
    return { id: item.id, isNew: item.isNew };
  });

  await page.getByRole("group", { name: "Listing layout" }).getByRole("button", { name: "Detailed" }).click();
  await expect(job.locator("details")).toHaveAttribute("open", "");
  await expect(job.getByText("Still active on source")).toBeVisible();
  await expect(job.getByText(/patient scheduling/i).first()).toBeVisible();

  await page.getByRole("group", { name: "Listing layout" }).getByRole("button", { name: "Compact" }).click();
  await expect(job.locator("details")).not.toHaveAttribute("open", "");
  const after = await page.evaluate(async () => {
    const [item] = await window.electronAPI.jobs.list();
    return { id: item.id, isNew: item.isNew };
  });
  expect(after).toEqual(before);
});

test("keyword matching still uses hidden description, which remains inspectable", async ({ page }) => {
  await seed(page);
  await page.getByPlaceholder("Search title or description").fill("insurance verification");
  await expect(page.getByText("Showing 1 of 1 captured listings")).toBeVisible();
  await expect(page.getByText("Search terms may appear inside a collapsed listing description.")).toBeVisible();
  const details = page.locator("article details").first();
  await details.locator("summary").click();
  await expect(page.getByText(/insurance verification/i).first()).toBeVisible();
  await page.getByPlaceholder("Search title or description").fill("phrase-not-in-job");
  await expect(page.getByText("Showing 0 of 1 captured listings")).toBeVisible();
});

test("narrow view keeps mode controls and actions in the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await seed(page);
  for (const view of ["Compact", "Detailed"]) {
    await page.getByRole("group", { name: "Listing layout" }).getByRole("button", { name: view }).click();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, "320px width in " + view + " mode").toBeLessThanOrEqual(320);
    const card = page.locator("article").first();
    const track = await card.getByRole("button", { name: "Track this job" }).boundingBox();
    expect(track).not.toBeNull();
    expect(track!.x + track!.width).toBeLessThanOrEqual(320);
  }
});
