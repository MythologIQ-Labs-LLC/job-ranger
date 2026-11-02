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
  const record = await page.evaluate(async () => {
    const api = window.electronAPI;
    await api.career.createUserEvidence({
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
    return api.applications.track(jobs[0].id);
  });
  await page.goto(`${server.url}#/applications`);
  await page.reload();
  await waitForRuntime(page);
  return record.id;
}

test("cover-letter version deletion requires review and leaves other versions and evidence untouched", async ({ page }) => {
  const applicationId = await seedApplication(page);
  const created = await page.evaluate(async (id) => {
    const api = window.electronAPI.applicationMaterials;
    const first = await api.createCoverLetter(id);
    const second = await api.createCoverLetter(id);
    return { first: first.projection, second: second.projection };
  }, applicationId);

  await page.reload();
  await waitForRuntime(page);
  await page.getByRole("button", { name: /Application materials/ }).click();
  const versionOne = page.getByRole("button", { name: "Delete cover letter version 1" });
  const versionTwo = page.getByRole("button", { name: "Delete cover letter version 2" });
  await expect(versionOne).toBeVisible();
  await expect(versionTwo).toBeVisible();

  await versionOne.click();
  const dialog = page.getByRole("dialog", { name: "Delete cover letter version?" });
  await expect(dialog).toContainText("version 1");
  await expect(dialog).toContainText("Other versions and Career Evidence remain unchanged");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await page.evaluate((id) => window.electronAPI.applicationMaterials.list(id), applicationId)).length).toBe(2);

  // A failed canonical deletion must not close the dialog or remove a version
  // from the UI. A retry must use the same selected version, not the next one.
  await page.evaluate(() => {
    const api = window.electronAPI.applicationMaterials;
    const original = api.delete.bind(api);
    let failOnce = true;
    api.delete = async (id) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("Synthetic cover letter deletion failure");
      }
      return original(id);
    };
  });
  await versionOne.click();
  await dialog.getByRole("button", { name: "Delete cover letter", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Synthetic cover letter deletion failure");
  await expect(versionTwo).toBeVisible();
  expect((await page.evaluate((id) => window.electronAPI.applicationMaterials.list(id), applicationId)).length).toBe(2);
  await dialog.getByRole("button", { name: "Delete cover letter", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(versionOne).toBeHidden();
  await expect(versionTwo).toBeVisible();
  const remaining = await page.evaluate((id) => window.electronAPI.applicationMaterials.list(id), applicationId);
  expect(remaining.map((x) => x.id)).toEqual([created.second.id]);
  const evidence = await page.evaluate(() => window.electronAPI.career.listEvidence());
  expect(evidence.length).toBeGreaterThan(0);
  await page.reload();
  await waitForRuntime(page);
  expect((await page.evaluate((id) => window.electronAPI.applicationMaterials.list(id), applicationId))
    .map((x) => x.id)).toEqual([created.second.id]);
});

test("offer deletion preserves negotiation details on cancel and failed persistence then removes them after confirmation", async ({ page }) => {
  const applicationId = await seedApplication(page);
  await page.evaluate(async (id) => {
    await window.electronAPI.applicationInsights.saveOffer(id, {
      status: "active", basePay: 82000, payBasis: "annual", currency: "USD",
      bonusNotes: "Performance bonus under discussion",
      equityNotes: "", benefitsNotes: "Healthcare and 401k",
      negotiationNotes: "Request a written remote-work policy",
      startDate: null, responseDeadline: "2026-10-27",
    });
  }, applicationId);
  await page.reload();
  await waitForRuntime(page);
  await page.getByRole("button", { name: /Search context & offer/ }).click();
  const remove = page.getByRole("button", { name: "Remove offer details", exact: true });
  await expect(remove).toBeVisible();
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Remove offer details?" });
  await expect(dialog).toContainText("private negotiation notes");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await page.evaluate((id) => window.electronAPI.applicationInsights.get(id), applicationId))
    .offer?.negotiationNotes).toBe("Request a written remote-work policy");

  await page.evaluate(() => {
    const original = window.electronAPI.applicationInsights.deleteOffer.bind(window.electronAPI.applicationInsights);
    const state = window as unknown as { rejectOffer?: () => void; offerDeletes?: number; restoreOfferDelete?: () => void };
    state.offerDeletes = 0;
    state.restoreOfferDelete = () => { window.electronAPI.applicationInsights.deleteOffer = original; };
    window.electronAPI.applicationInsights.deleteOffer = async () => new Promise<void>((_resolve, reject) => {
      state.offerDeletes = (state.offerDeletes ?? 0) + 1;
      state.rejectOffer = () => reject(new Error("Synthetic offer deletion interruption"));
    });
  });
  await remove.click();
  await dialog.getByRole("button", { name: "Remove offer details", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as unknown as { rejectOffer: () => void }).rejectOffer());
  await expect(dialog.getByRole("alert")).toContainText("Synthetic offer deletion interruption");
  expect(await page.evaluate(() => (window as unknown as { offerDeletes: number }).offerDeletes)).toBe(1);
  expect((await page.evaluate((id) => window.electronAPI.applicationInsights.get(id), applicationId))
    .offer?.negotiationNotes).toBe("Request a written remote-work policy");

  await page.evaluate(() => (window as unknown as { restoreOfferDelete: () => void }).restoreOfferDelete());
  await dialog.getByRole("button", { name: "Remove offer details", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await page.evaluate((id) => window.electronAPI.applicationInsights.get(id), applicationId)).offer).toBeNull();
  await page.reload();
  await waitForRuntime(page);
  expect((await page.evaluate((id) => window.electronAPI.applicationInsights.get(id), applicationId)).offer).toBeNull();
});
