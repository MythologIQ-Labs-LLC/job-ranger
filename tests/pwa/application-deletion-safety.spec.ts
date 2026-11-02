import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function seedTrackedApplication(page: import("@playwright/test").Page) {
  await page.route("https://boards-api.greenhouse.io/**", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.goto(server.url);
  await waitForRuntime(page);
  return page.evaluate(async () => {
    const api = window.electronAPI;
    const source = await api.companies.create({
      name: "Harbor Health", url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440, isActive: false,
    });
    const scrape = await api.companies.runScrape(source.id);
    if (scrape.status !== "success") throw new Error("Test source did not ingest a job");
    const jobs = await api.jobs.list();
    if (jobs.length !== 1) throw new Error("Expected exactly one job");
    const application = await api.applications.track(jobs[0].id);
    return { applicationId: application.id, title: application.title };
  });
}

test("application and its people/events require explicit deletion approval and preserve cancel", async ({ page }) => {
  const seeded = await seedTrackedApplication(page);
  const contact = await page.evaluate((applicationId) =>
    window.electronAPI.applicationLifecycle.createContact(applicationId, {
      name: "Taylor Morgan", role: "Hiring coordinator",
      email: "taylor@example.org", notes: "Met during community recruitment.",
    }), seeded.applicationId);
  const event = await page.evaluate((applicationId) =>
    window.electronAPI.applicationLifecycle.createEvent(applicationId, {
      kind: "follow-up", title: "Discuss training opportunities",
      eventAt: "2026-10-22T15:00:00.000Z",
      reminderAt: "2026-10-20T15:00:00.000Z",
      notes: "Clarify training support and schedule.",
    }), seeded.applicationId);

  await page.goto(`${server.url}#/applications`);
  await page.reload();
  await waitForRuntime(page);
  await page.getByRole("button", { name: /Application details/ }).click();

  // Removing a person must be cancellable and must not remove the event.
  await page.getByRole("button", { name: "Delete contact Taylor Morgan" }).click();
  const contactDialog = page.getByRole("dialog", { name: "Delete application contact?" });
  await expect(contactDialog).toContainText("Taylor Morgan");
  await contactDialog.getByRole("button", { name: "Cancel" }).click();
  expect((await page.evaluate((id) => window.electronAPI.applicationLifecycle.get(id), seeded.applicationId))
    .contacts.some((person) => person.id === contact.id)).toBe(true);

  await page.getByRole("button", { name: "Delete contact Taylor Morgan" }).click();
  await contactDialog.getByRole("button", { name: "Delete contact", exact: true }).click();
  await expect(contactDialog).toBeHidden();
  let state = await page.evaluate((id) => window.electronAPI.applicationLifecycle.get(id), seeded.applicationId);
  expect(state.contacts.some((person) => person.id === contact.id)).toBe(false);
  expect(state.events.some((item) => item.id === event.id)).toBe(true);

  // Deleting a reminder/milestone must likewise require a second action.
  await page.getByRole("button", { name: "Delete event Discuss training opportunities" }).click();
  const eventDialog = page.getByRole("dialog", { name: "Delete application event?" });
  await expect(eventDialog).toContainText("associated reminder");
  await eventDialog.getByRole("button", { name: "Cancel" }).click();
  state = await page.evaluate((id) => window.electronAPI.applicationLifecycle.get(id), seeded.applicationId);
  expect(state.events.some((item) => item.id === event.id)).toBe(true);
  await page.getByRole("button", { name: "Delete event Discuss training opportunities" }).click();
  await eventDialog.getByRole("button", { name: "Delete event", exact: true }).click();
  await expect(eventDialog).toBeHidden();
  state = await page.evaluate((id) => window.electronAPI.applicationLifecycle.get(id), seeded.applicationId);
  expect(state.events.some((item) => item.id === event.id)).toBe(false);

  const remove = page.getByRole("button", { name: `Remove ${seeded.title} from applications` });
  await remove.click();
  const applicationDialog = page.getByRole("dialog", { name: "Remove tracked application?" });
  await expect(applicationDialog).toContainText("associated contacts and milestones");
  await applicationDialog.getByRole("button", { name: "Cancel" }).click();
  expect((await page.evaluate(() => window.electronAPI.applications.list()))
    .some((item) => item.id === seeded.applicationId)).toBe(true);
  await remove.click();
  await applicationDialog.getByRole("button", { name: "Remove application", exact: true }).click();
  await expect(applicationDialog).toBeHidden();
  expect((await page.evaluate(() => window.electronAPI.applications.list()))
    .some((item) => item.id === seeded.applicationId)).toBe(false);
});

test("failed event deletion retains its confirmation and canonical record", async ({ page }) => {
  const seeded = await seedTrackedApplication(page);
  const event = await page.evaluate((applicationId) =>
    window.electronAPI.applicationLifecycle.createEvent(applicationId, {
      kind: "interview", title: "Interview with operations team",
      eventAt: "2026-10-28T17:00:00.000Z", reminderAt: null,
    }), seeded.applicationId);
  await page.goto(`${server.url}#/applications`);
  await page.reload();
  await waitForRuntime(page);
  await page.getByRole("button", { name: /Application details/ }).click();
  await expect(page.getByRole("button", { name: "Delete event Interview with operations team" })).toBeVisible();

  // Deterministic stalled rejection at the real renderer API boundary.
  await page.evaluate(() => {
    const state = window as unknown as { rejectEvent?: () => void; eventAttempts: number };
    state.eventAttempts = 0;
    window.electronAPI.applicationLifecycle.deleteEvent = async () =>
      new Promise<void>((_resolve, reject) => {
        state.eventAttempts++;
        state.rejectEvent = () => reject(new Error("Synthetic event delete failure"));
      });
  });
  await page.getByRole("button", { name: "Delete event Interview with operations team" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete application event?" });
  await dialog.getByRole("button", { name: "Delete event", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as unknown as { rejectEvent: () => void }).rejectEvent());
  await expect(dialog.getByRole("alert")).toContainText("Synthetic event delete failure");
  expect(await page.evaluate(() => (window as unknown as { eventAttempts: number }).eventAttempts)).toBe(1);
  expect((await page.evaluate((id) => window.electronAPI.applicationLifecycle.get(id), seeded.applicationId))
    .events.some((item) => item.id === event.id)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
