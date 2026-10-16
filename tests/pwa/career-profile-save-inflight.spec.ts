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
  const notice = page.getByTestId("profile-save-notice");
  await expect(notice).toContainText("Changes made during saving are still here");
  // Still unsaved after another edit, so the note stays until a save succeeds.
  await payBasis.selectOption(first);
  await payBasis.selectOption(later);
  await expect(notice).toBeVisible();

  await page.getByRole("button", { name: "Save career profile" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await expect(notice).toHaveCount(0);
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

test("rapid text and list edits during a pending save are kept, and a background refresh does not undo them", async ({ page }) => {
  await openProfile(page);
  const name = page.getByLabel("Your name");
  const skills = page.getByLabel("Skills you already use");
  await name.fill("Avery Submitted");
  await deferNextSave(page, false);
  await page.getByRole("button", { name: "Save career profile" }).click();
  await page.waitForFunction(() => (window as ControlledPage).__jrInFlightSave?.pending === true);

  // Several quick edits while the older snapshot's save is unresolved, including a list
  // field whose typed text (trailing space, new line) must survive as typed.
  await name.fill("Avery Later");
  await skills.fill("Scheduling ");
  await skills.press("End");
  await skills.type("\nReferrals");
  await releaseSave(page);

  await expect(page.getByRole("button", { name: "Save career profile" })).toBeEnabled();
  await expect(name).toHaveValue("Avery Later");
  await expect(skills).toHaveValue("Scheduling \nReferrals");
  await expect(page.getByText("Saved on this device")).not.toBeVisible();
  expect(await page.evaluate(() => window.electronAPI.career.getProfile())).toMatchObject({ fullName: "Avery Submitted" });

  // A later background refresh of the stored (older) profile must not replace the newer draft.
  // Wait for the hook's own refresh read to complete (counted through a wrapper), not a fixed delay.
  await page.evaluate(() => {
    const career = window.electronAPI.career;
    const actual = career.getProfile;
    const state = window as unknown as { __profileReads: number };
    state.__profileReads = 0;
    career.getProfile = async () => {
      const value = await actual();
      state.__profileReads += 1;
      return value;
    };
    window.dispatchEvent(new CustomEvent("job-ranger:career-profile-changed"));
  });
  await page.waitForFunction(() => (window as unknown as { __profileReads: number }).__profileReads > 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(name).toHaveValue("Avery Later");

  await page.getByRole("button", { name: "Save career profile" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  expect(await page.evaluate(() => window.electronAPI.career.getProfile()))
    .toMatchObject({ fullName: "Avery Later", skills: ["Scheduling", "Referrals"] });
});

test("a save with no later edits shows the stored, normalized profile", async ({ page }) => {
  await openProfile(page);
  const name = page.getByLabel("Your name");
  await name.fill("   Avery Normalized   ");
  await page.getByRole("button", { name: "Save career profile" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await expect(name).toHaveValue("Avery Normalized");
  await expect(page.getByTestId("profile-save-notice")).toHaveCount(0);
  expect(await page.evaluate(() => window.electronAPI.career.getProfile())).toMatchObject({ fullName: "Avery Normalized" });
});

test("whitespace-only typing in a list field during a save is not treated as a new edit", async ({ page }) => {
  await openProfile(page);
  const skills = page.getByLabel("Skills you already use");
  await skills.fill("Scheduling");
  await deferNextSave(page, false);
  await page.getByRole("button", { name: "Save career profile" }).click();
  await page.waitForFunction(() => (window as ControlledPage).__jrInFlightSave?.pending === true);
  await skills.press("End");
  await skills.type(" \n");
  await releaseSave(page);
  await expect(page.getByText("Saved on this device")).toBeVisible();
  await expect(page.getByTestId("profile-save-notice")).toHaveCount(0);
});
