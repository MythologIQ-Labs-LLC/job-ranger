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
  const assessment = job.getByRole("dialog", { name: /Opportunity assessment:/ });
  await expect(assessment).toBeVisible();
  await expect(assessment.getByText("Eligibility and blockers")).toBeVisible();
  await expect(assessment.getByText("Evidence coverage", { exact: true })).toBeVisible();
  await assessment.getByRole("button", { name: /Close Opportunity assessment:/ }).click();
  await expect(assessment).toBeHidden();

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


test("detail drawer confines the long assessment, retains four axes and returns focus on Escape", async ({ page }) => {
  await seed(page);
  const job = page.locator("article").filter({
    has: page.getByRole("button", { name: "Medical Office Coordinator", exact: true }),
  });
  const trigger = job.getByRole("button", { name: /Opportunity assessment/ });
  const before = await page.evaluate(async () => {
    const [job] = await window.electronAPI.jobs.list();
    return { id: job.id, isNew: job.isNew, isActive: job.isActive };
  });

  await trigger.focus();
  await page.keyboard.press("Enter");
  const drawer = job.getByRole("dialog", { name: "Opportunity assessment: Medical Office Coordinator" });
  await expect(drawer).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const close = drawer.getByRole("button", { name: "Close Opportunity assessment: Medical Office Coordinator" });
  await expect(close).toBeFocused();
  for (const axis of ["Eligibility", "Evidence", "Career", "Preferences"]) {
    await expect(drawer.getByText(new RegExp("^" + axis + " · "))).toBeVisible();
  }
  await expect(drawer.getByText("Evidence coverage", { exact: true })).toBeVisible();
  await expect(drawer.getByText(/not a hiring prediction/)).toBeVisible();
  expect(await page.locator("article").count()).toBe(1);
  expect(await page.getByText(/\d+% fit/).count()).toBe(0);

  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Prepare resume" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  const after = await page.evaluate(async () => {
    const [job] = await window.electronAPI.jobs.list();
    return { id: job.id, isNew: job.isNew, isActive: job.isActive };
  });
  expect(after).toEqual(before);
});

test("right-side detail drawer contains scrolling on short desktop and mobile widths", async ({ page }) => {
  await seed(page);
  for (const [width, height] of [[320, 700], [390, 780], [1280, 580], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    const trigger = page.getByRole("button", { name: /Opportunity assessment/ }).first();
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: /Opportunity assessment:/ });
    await expect(drawer).toBeVisible();
    const measurement = await drawer.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const scroll = el.lastElementChild as HTMLElement;
      return {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        scrollable: getComputedStyle(scroll).overflowY === "auto",
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(measurement.left).toBeGreaterThanOrEqual(-1);
    expect(measurement.right).toBeLessThanOrEqual(width + 1);
    expect(measurement.top).toBeGreaterThanOrEqual(-1);
    expect(measurement.bottom).toBeLessThanOrEqual(height + 1);
    expect(measurement.scrollable).toBe(true);
    expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.viewportWidth);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});
