import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function open(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(server.url + "#/jobs");
  await waitForRuntime(page);
}

test("Find Jobs inputs retain visible accessible names after typing", async ({ page }) => {
  await open(page);
  const keywords = page.getByRole("textbox", { name: "Keywords" });
  const location = page.getByRole("textbox", { name: "Location" });
  await expect(keywords).toBeVisible();
  await expect(location).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Company" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Assessment direction" })).toBeVisible();
  await keywords.fill("analyst");
  await location.fill("Baltimore");
  await expect(page.getByText("Keywords", { exact: true })).toBeVisible();
  await expect(page.getByText("Location", { exact: true })).toBeVisible();
});

test("reduced motion suppresses page-entry animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await expect(page.locator(".animate-rise").first()).toHaveCSS("animation-name", "none");
});
