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
  const application = await page.evaluate(async () => {
    const api = window.electronAPI;
    const source = await api.companies.create({
      name: "Harbor Health", url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440, isActive: false,
    });
    if ((await api.companies.runScrape(source.id)).status !== "success") throw Error("Fixture source unavailable");
    const [job] = await api.jobs.list();
    if (!job) throw Error("Fixture has no job");
    return api.applications.track(job.id);
  });
  await page.goto(`${server.url}#/applications`);
  await page.reload();
  await waitForRuntime(page);
  return application.id;
}

test("a rejected notes save blocks leaving until the user explicitly chooses what to do", async ({ page }) => {
  const id = await seedTrackedApplication(page);
  await page.evaluate(() => {
    window.electronAPI.applications.update = async () => { throw new Error("Synthetic offline notes save"); };
  });
  const notes = page.getByRole("textbox", { name: "Notes" });
  await notes.fill("Carefully recorded interview notes not yet persisted");
  await expect(page.getByRole("alert")).toContainText("Synthetic offline notes save");
  expect((await page.evaluate(() => window.electronAPI.applications.list()))
    .find((row) => row.id === id)?.notes).toBe("");

  await page.getByRole("link", { name: "Find Jobs" }).click();
  // This fails on baseline. Declarative HashRouter currently unmounts the
  // unsaved editor without any consent, losing the in-memory draft.
  await expect(page).toHaveURL(/#\/applications$/);
  await expect(page.getByRole("dialog", { name: "Leave with unsaved changes?" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Stay on this page" }).click();
  await expect(notes).toHaveValue("Carefully recorded interview notes not yet persisted");
  await page.getByRole("link", { name: "Find Jobs" }).click();
  await page.getByRole("dialog", { name: "Leave with unsaved changes?" })
    .getByRole("button", { name: "Leave without saving" }).click();
  await expect(page).toHaveURL(/#\/jobs$/);
  await page.getByRole("link", { name: "Applications" }).click();
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("");
});

test("clean application navigation is not blocked", async ({ page }) => {
  await seedTrackedApplication(page);
  await page.getByRole("link", { name: "Find Jobs" }).click();
  await expect(page).toHaveURL(/#\/jobs$/);
});


test("a pending status write blocks route navigation until the canonical update completes", async ({ page }) => {
  const id = await seedTrackedApplication(page);
  await page.evaluate(() => {
    const original = window.electronAPI.applications.update.bind(window.electronAPI.applications);
    (window as unknown as { releaseStatus?: () => void }).releaseStatus = undefined;
    window.electronAPI.applications.update = async (applicationId, patch) => {
      if (patch.status !== undefined) {
        await new Promise<void>((resolve) => {
          (window as unknown as { releaseStatus?: () => void }).releaseStatus = resolve;
        });
      }
      return original(applicationId, patch);
    };
  });
  const select = page.getByRole("combobox", { name: /Application status for/ });
  await select.selectOption("interview");
  await expect(page.getByRole("status", { name: "Application status save status" }))
    .toContainText("Saving status");
  await page.getByRole("link", { name: "Career Profile" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave with unsaved changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stay on this page" }).click();
  await expect(select).toHaveValue("interview");
  await page.evaluate(() => (window as unknown as { releaseStatus: () => void }).releaseStatus());
  await expect(page.getByRole("status", { name: "Application status save status" }))
    .toContainText("Saved");
  expect((await page.evaluate(() => window.electronAPI.applications.list()))
    .find((row) => row.id === id)?.status).toBe("interview");
  await page.getByRole("link", { name: "Career Profile" }).click();
  await expect(page).toHaveURL(/#\/career-profile$/);
});

test("reverting text or status during a pending write cannot bypass the unsaved guard", async ({ page }) => {
  const id = await seedTrackedApplication(page);
  await page.evaluate(() => {
    const api = window.electronAPI.applications;
    const original = api.update.bind(api);
    const state = window as unknown as { releaseFirstNotes?: () => void };
    api.update = async (applicationId, patch) => {
      if (patch.notes === "Temporary unsaved content") {
        await new Promise<void>((resolve) => { state.releaseFirstNotes = resolve; });
      }
      return original(applicationId, patch);
    };
  });

  const notes = page.getByRole("textbox", { name: "Notes" });
  await notes.fill("Temporary unsaved content");
  await notes.fill("");
  await expect(notes).toHaveValue("");
  await expect(page.getByRole("status", { name: "Application notes save status" }))
    .toContainText("Saving notes");
  await page.getByRole("link", { name: "Find Jobs" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave with unsaved changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stay on this page" }).click();
  await page.evaluate(() => (window as unknown as { releaseFirstNotes: () => void }).releaseFirstNotes());
  await expect(page.getByRole("status", { name: "Application notes save status" })).toContainText("Saved");
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.applications.list()))
    .find((item) => item.id === id)?.notes).toBe("");

  await page.evaluate(() => {
    const api = window.electronAPI.applications;
    const original = api.update.bind(api);
    const state = window as unknown as { releaseFirstStatus?: () => void };
    api.update = async (applicationId, patch) => {
      if (patch.status === "applied") {
        await new Promise<void>((resolve) => { state.releaseFirstStatus = resolve; });
      }
      return original(applicationId, patch);
    };
  });
  const status = page.getByRole("combobox", { name: /Application status for/ });
  await status.selectOption("applied");
  await status.selectOption("interested");
  await expect(status).toHaveValue("interested");
  await expect(page.getByRole("status", { name: "Application status save status" }))
    .toContainText("Saving status");
  await page.getByRole("link", { name: "Career Profile" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stay on this page" }).click();
  await page.evaluate(() => (window as unknown as { releaseFirstStatus: () => void }).releaseFirstStatus());
  await expect(page.getByRole("status", { name: "Application status save status" })).toContainText("Saved");
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.applications.list()))
    .find((item) => item.id === id)?.status).toBe("interested");

  await page.getByRole("link", { name: "Find Jobs" }).click();
  await expect(page).toHaveURL(/#\/jobs$/);
});

test("dirty browser-history navigation is blocked and unload warning is registered", async ({ page }) => {
  await seedTrackedApplication(page);
  // Create a same-document hash-router history entry through the actual UI.
  // Back to the seed helper's pre-router URL would instead be a full document
  // navigation, governed by the native beforeunload prompt, not useBlocker.
  await page.getByRole("link", { name: "Find Jobs" }).click();
  await expect(page).toHaveURL(/#\/jobs$/);
  await page.getByRole("link", { name: "Applications" }).click();
  await expect(page).toHaveURL(/#\/applications$/);
  await page.evaluate(() => {
    window.electronAPI.applications.update = async () => { throw new Error("Synthetic offline notes write"); };
  });
  await page.getByRole("textbox", { name: "Notes" }).fill("Unsaved interview preparation");
  await expect(page.getByRole("alert")).toContainText("Synthetic offline notes write");

  // A synthetic cancellable event validates the listener's decision, not
  // Chrome's browser-owned tab-close prompt (which cannot be customized).
  const unloadPrevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(unloadPrevented).toBe(true);

  await page.evaluate(() => window.history.back());
  const dialog = page.getByRole("dialog", { name: "Leave with unsaved changes?" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/#\/applications$/);
  await dialog.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("Unsaved interview preparation");
});
