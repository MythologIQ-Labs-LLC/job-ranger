import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

// #288: an asynchronous save must not overwrite edits made after the user
// clicked Save, and must not display a misleading Saved cue for those edits.
// The test wraps only the page's mutable nested career adapter; canonical
// persistence is still exercised through the real PWA SQLite/OPFS runtime.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

type SaveTestControl = { pending: boolean; release: () => void };
type ControlledPage = typeof window & { __jrInFlightSave?: SaveTestControl };

async function openProfile(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(`${server.url}#/career-profile`);
  await waitForRuntime(page);
  const payBasis = page.getByRole("combobox", { name: "Pay basis", exact: true });
  await expect(payBasis).toBeEnabled();
  await page.getByRole("button", { name: "Save career profile" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  return payBasis;
}

async function deferNextSave(page: Page, fail: boolean) {
  await page.evaluate((shouldFail) => {
    const career = window.electronAPI.career;
    const actual = career.saveProfile;
    let resolve: () => void = () => {};
    const gate = new Promise<void>((done) => { resolve = done; });
    const control: SaveTestControl = {
      pending: false,
      release: () => {
        career.saveProfile = actual;
        resolve();
      },
    };
    (window as ControlledPage).__jrInFlightSave = control;
    career.saveProfile = async (next) => {
      // For the successful case, the older snapshot has genuinely reached
      // storage. Only its completion is deferred while the UI keeps editing.
      if (!shouldFail) {
        const persisted = await actual(next);
        control.pending = true;
        await gate;
        return persisted;
      }
      control.pending = true;
      await gate;
      throw new Error("Simulated profile save failure");
    };
  }, fail);
}

async function releaseSave(page: Page) {
  await page.evaluate(() => (window as ControlledPage).__jrInFlightSave?.release());
}

test("edits made while Save is pending remain unsaved and can be saved again", async ({ page }) => {
  const payBasis = await openProfile(page);
  const before = await payBasis.inputValue();
  const first = before === "annual" ? "hourly" : "annual";
  await payBasis.selectOption(first);
  await deferNextSave(page, false);
  await page.getByRole("button", { name: "Save career profile" }).click();
  await page.waitForFunction(() => (window as ControlledPage).__jrInFlightSave?.pending === true);
  const later = before;
  await payBasis.selectOption(later);

  // The first save really persisted the older value. The later value is a
  // valid new edit made while the storage result was still pending.
  expect(await page.evaluate(() => window.electronAPI.career.getProfile()))
    .toMatchObject({ payBasis: first });
  await releaseSave(page);
  await expect(page.getByRole("button", { name: "Save career profile" })).toBeEnabled();
  await expect(payBasis).toHaveValue(later);
  await expect(page.getByText("Saved on this device")).not.toBeVisible();

  await page.getByRole("button", { name: "Save career profile" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  expect(await page.evaluate(() => window.electronAPI.career.getProfile()))
    .toMatchObject({ payBasis: later });
});

test("failed in-flight save never discards subsequently edited form values", async ({ page }) => {
  const payBasis = await openProfile(page);
  const before = await payBasis.inputValue();
  const first = before === "annual" ? "hourly" : "annual";
  await payBasis.selectOption(first);
  await deferNextSave(page, true);
  await page.getByRole("button", { name: "Save career profile" }).click();
  await page.waitForFunction(() => (window as ControlledPage).__jrInFlightSave?.pending === true);
  await payBasis.selectOption(before);
  await releaseSave(page);

  await expect(page.getByText("Simulated profile save failure")).toBeVisible();
  await expect(payBasis).toHaveValue(before);
  await expect(page.getByText("Saved on this device")).not.toBeVisible();
  await page.getByRole("button", { name: "Save career profile" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
});
