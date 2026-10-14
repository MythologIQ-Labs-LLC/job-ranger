import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function seedThree(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.route("https://boards-api.greenhouse.io/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.goto(server.url);
  await waitForRuntime(page);
  const apps = await page.evaluate(async () => {
    const api = window.electronAPI;
    const results: { id: string; companyName: string; title: string }[] = [];
    for (const slug of ["harbor-health", "cedar-care", "juniper-health"]) {
      const name = slug === "harbor-health" ? "Harbor Health" : slug === "cedar-care" ? "Cedar Care" : "Juniper Health";
      const source = await api.companies.create({
        name,
        url: "https://boards.greenhouse.io/" + slug,
        frequencyMinutes: 1440,
        isActive: false,
      });
      if ((await api.companies.runScrape(source.id)).status !== "success") {
        throw new Error("Synthetic scrape failed: " + slug);
      }
    }
    const jobs = await api.jobs.list();
    if (jobs.length !== 3) throw new Error("Expected three fixture jobs; received " + jobs.length);
    for (const job of jobs) {
      const a = await api.applications.track(job.id);
      results.push({ id: a.id, companyName: a.companyName, title: a.title });
    }
    await api.applications.update(results.find(a => a.companyName === "Cedar Care")!.id, { status: "applied" });
    await api.applications.update(results.find(a => a.companyName === "Juniper Health")!.id, { status: "rejected" });
    return results;
  });
  await page.goto(server.url + "#/applications");
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Focus your applications" })).toBeVisible();
  return apps;
}

test("status groups count saved applications without relabeling or altering them", async ({ page }) => {
  const apps = await seedThree(page);
  const controls = page.getByRole("group", { name: "Application status view" });
  await expect(controls.getByRole("button", { name: "All (3)" })).toHaveAttribute("aria-pressed", "true");
  await expect(controls.getByRole("button", { name: "Interested (1)" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Applied (1)" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Closed (1)" })).toBeVisible();
  await controls.getByRole("button", { name: "Applied (1)" }).click();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article")).toContainText("Cedar Care");
  await controls.getByRole("button", { name: "Closed (1)" }).click();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article")).toContainText("Juniper Health");
  await controls.getByRole("button", { name: "All (3)" }).click();
  await expect(page.locator("article")).toHaveCount(3);
  const after = await page.evaluate(async () =>
    (await window.electronAPI.applications.list()).map(({ id, status }) => ({ id, status })),
  );
  expect(after).toEqual(expect.arrayContaining(apps.map(({ id, companyName }) => ({
    id,
    status: companyName === "Cedar Care" ? "applied" : companyName === "Juniper Health" ? "rejected" : "interested",
  }))));
});

test("in-flight note editing prevents a filtered card from unmounting after its status changes", async ({ page }) => {
  const apps = await seedThree(page);
  const first = apps.find(a => a.companyName === "Harbor Health")!;
  const card = page.locator("article").filter({ hasText: "Harbor Health" });
  const controls = page.getByRole("group", { name: "Application status view" });
  await controls.getByRole("button", { name: "Interested (1)" }).click();
  await expect(card).toBeVisible();

  await page.evaluate(() => {
    const api = window.electronAPI.applications;
    const original = api.update.bind(api);
    const state = window as unknown as { releasePendingNotes?: () => void };
    api.update = async (id, patch) => {
      if (patch.notes !== undefined) {
        await new Promise<void>(resolve => { state.releasePendingNotes = resolve; });
      }
      return original(id, patch);
    };
  });
  await card.getByRole("textbox", { name: "Notes" }).fill("Retain this pending draft until safely stored");
  await expect(card.getByRole("status", { name: "Application notes save status" }))
    .toContainText("Saving notes");
  await card.getByRole("combobox", { name: /Application status for/ }).selectOption("applied");
  await expect(card.getByRole("status", { name: "Application status save status" }))
    .toContainText("Saved");

  // The canonical status now belongs to Applied, but this article still has
  // an in-flight notes write. It must not be unmounted merely by filtering.
  await expect(card).toBeVisible();
  await expect(card.getByRole("textbox", { name: "Notes" }))
    .toHaveValue("Retain this pending draft until safely stored");
  await expect(controls.getByRole("button", { name: "Applied (2)" })).toBeDisabled();
  await expect(page.getByText(/Status filters are paused while an application has unsaved edits/)).toBeVisible();

  await page.evaluate(() => (window as unknown as { releasePendingNotes: () => void }).releasePendingNotes());
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.applications.list()))
    .find(a => a.id === first.id)?.notes).toBe("Retain this pending draft until safely stored");
  await expect(controls.getByRole("button", { name: "Applied (2)" })).toBeEnabled();
  // Once persisted, the Interested group can safely drop the moved article.
  await expect(card).toHaveCount(0);
  await controls.getByRole("button", { name: "Applied (2)" }).click();
  await expect(card.getByRole("textbox", { name: "Notes" }))
    .toHaveValue("Retain this pending draft until safely stored");
});

test("failed notes save keeps its article available and status filters blocked until retry", async ({ page }) => {
  await seedThree(page);
  const card = page.locator("article").filter({ hasText: "Harbor Health" });
  const controls = page.getByRole("group", { name: "Application status view" });
  await page.evaluate(() => {
    const api = window.electronAPI.applications;
    const original = api.update.bind(api);
    let fail = true;
    api.update = async (id, patch) => {
      if (patch.notes !== undefined && fail) {
        fail = false;
        throw new Error("Synthetic local notes write failure");
      }
      return original(id, patch);
    };
  });
  await card.getByRole("textbox", { name: "Notes" }).fill("Unsaved notes remain visible");
  await expect(card.getByRole("alert")).toContainText("Synthetic local notes write failure");
  await expect(controls.getByRole("button", { name: "Closed (1)" })).toBeDisabled();
  await expect(card.getByRole("textbox", { name: "Notes" })).toHaveValue("Unsaved notes remain visible");
  await card.getByRole("button", { name: "Retry saving notes" }).click();
  await expect(card.getByRole("status", { name: "Application notes save status" })).toContainText("Saved");
  await expect(controls.getByRole("button", { name: "Closed (1)" })).toBeEnabled();
  await controls.getByRole("button", { name: "Closed (1)" }).click();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article")).toContainText("Juniper Health");
});

test("empty status group is truthful, and mobile layout avoids horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await seedThree(page);
  const controls = page.getByRole("group", { name: "Application status view" });
  await controls.getByRole("button", { name: "Interview (0)" }).click();
  await expect(page.getByText(/No tracked applications have this recorded status/)).toBeVisible();
  await expect(page.getByText("Showing 0 of 3 tracked applications")).toBeVisible();
  for (const [width, height] of [[320, 700], [390, 780], [1280, 580]]) {
    await page.setViewportSize({ width, height });
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth, width + "px viewport").toBeLessThanOrEqual(width);
  }
});
