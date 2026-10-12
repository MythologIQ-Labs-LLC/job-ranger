import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function seedApplication(page: Page) {
  await page.route("https://boards-api.greenhouse.io/**", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.goto(server.url);
  await waitForRuntime(page);
  return page.evaluate(async () => {
    const api = window.electronAPI;
    const evidence = await api.career.createUserEvidence({
      subjectType: "achievement",
      organization: "Harbor Family Clinic",
      titleOrName: "Patient coordination",
      statement: "Coordinated patient scheduling and referrals across six providers.",
      skills: ["Patient scheduling", "Insurance verification"],
    });
    const source = await api.companies.create({
      name: "Harbor Health", url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440, isActive: false,
    });
    if ((await api.companies.runScrape(source.id)).status !== "success") {
      throw new Error("Fixture scrape failed");
    }
    const jobs = await api.jobs.list();
    if (jobs.length !== 1) throw new Error("Expected one fixture job");
    const application = await api.applications.track(jobs[0].id);
    const letter = await api.applicationMaterials.createCoverLetter(application.id);
    return { applicationId: application.id, evidenceId: evidence.id, letter: letter.projection };
  });
}

async function openMaterials(page: Page) {
  await page.goto(`${server.url}#/applications`);
  await page.reload();
  await waitForRuntime(page);
  await page.getByRole("button", { name: /Application materials/ }).click();
}

test("a current cover-letter version copies its exact text for manual use", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: server.url });
  const seeded = await seedApplication(page);
  await openMaterials(page);

  const expected = seeded.letter.sections.map((section) => section.text).join("\n\n");
  expect(expected.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Copy cover letter version 1" }).click();
  await expect(page.getByRole("status", { name: "Cover letter copy status" })).toContainText("Cover letter version 1 copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // The Windows clipboard stores LF line breaks as CRLF; the copied content is otherwise exact.
  expect(copied.replace(/\r\n/g, "\n")).toBe(expected);
});

test("copy failure is reported truthfully and leaves the text available to select", async ({ page }) => {
  const seeded = await seedApplication(page);
  await openMaterials(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Synthetic clipboard denial")) },
    });
  });

  await page.getByRole("button", { name: "Copy cover letter version 1" }).click();
  await expect(page.getByRole("status", { name: "Cover letter copy status" })).toContainText("Copy was unavailable");
  await expect(page.getByRole("status", { name: "Cover letter copy status" })).not.toContainText("copied");
  await expect(page.locator("article pre").first()).toContainText(seeded.letter.sections[0].text.slice(0, 40));
});

test("a version whose supporting evidence changed cannot be copied until rebuilt", async ({ page }) => {
  const seeded = await seedApplication(page);
  await page.evaluate(async (id) => {
    await window.electronAPI.career.reviewEvidence(id, { action: "reject" });
  }, seeded.evidenceId);
  await openMaterials(page);

  await expect(page.getByText("Supporting Career Evidence changed after this draft was created")).toBeVisible();
  const copy = page.getByRole("button", { name: "Copy cover letter version 1" });
  await expect(copy).toBeDisabled();
  await expect(page.getByText("Rebuild before copying")).toBeVisible();
});
