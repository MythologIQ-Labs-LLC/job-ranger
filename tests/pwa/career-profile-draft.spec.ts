import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

// #278: a background Career Profile refresh must not discard unsaved edits,
// but an unedited form still follows changes saved elsewhere.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

const profileChanged = "job-ranger:career-profile-changed";

async function openProfile(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(`${server.url}#/career-profile`);
  await waitForRuntime(page);
  const payBasis = page.getByRole("combobox", { name: "Pay basis", exact: true });
  await expect(payBasis).toBeEnabled();
  // A stored profile is required: with none, refresh returns the same empty object.
  await page.getByRole("button", { name: "Save career profile" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  expect(await page.evaluate(() => window.electronAPI.career.getProfile())).not.toBeNull();
  return payBasis;
}

// Let the hook's async refresh (getProfile) settle after the event.
async function refreshAndSettle(page: Page) {
  await page.evaluate(async (event) => {
    window.dispatchEvent(new CustomEvent(event));
    await window.electronAPI.career.getProfile();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }, profileChanged);
}

test("an unsaved edit survives a background profile refresh", async ({ page }) => {
  const payBasis = await openProfile(page);
  const initial = await payBasis.inputValue();
  const edited = initial === "annual" ? "hourly" : "annual";
  await payBasis.selectOption(edited);
  await refreshAndSettle(page);
  await expect(payBasis).toHaveValue(edited);
});

test("an unedited form follows a profile saved elsewhere", async ({ page }) => {
  const payBasis = await openProfile(page);
  const initial = await payBasis.inputValue();
  const next = initial === "annual" ? "hourly" : "annual";
  await page.evaluate(async (basis) => {
    const api = window.electronAPI.career;
    const current = await api.getProfile();
    if (!current) throw new Error("Expected a stored profile");
    await api.saveProfile({ ...current, payBasis: basis as typeof current.payBasis });
  }, next);
  await refreshAndSettle(page);
  await expect(payBasis).toHaveValue(next);
});

test("a choice made the moment the form enables survives the first seed and keeps the stored profile", async ({ page }) => {
  await openProfile(page);
  await page.evaluate(async () => {
    const api = window.electronAPI.career;
    const current = await api.getProfile();
    if (!current) throw new Error("Expected a stored profile");
    await api.saveProfile({ ...current, fullName: "Avery Stored", homeLocation: "Columbus, OH", payBasis: "hourly" });
  });
  // Choose "per year" in the same task that enables the controls, before any
  // effect that runs after paint. Seeding must neither drop that choice nor
  // replace the stored name and area with an empty form that Save would persist.
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="Pay basis"]');
      if (!select || select.disabled) return;
      observer.disconnect();
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setValue.call(select, "annual");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
  });
  await page.reload();
  await waitForRuntime(page);
  const payBasis = page.getByRole("combobox", { name: "Pay basis", exact: true });
  await expect(payBasis).toBeEnabled();
  await expect(payBasis).toHaveValue("annual");
  await expect(page.getByLabel("Your name")).toHaveValue("Avery Stored");
  await expect(page.getByPlaceholder("City, state, or region")).toHaveValue("Columbus, OH");
});
