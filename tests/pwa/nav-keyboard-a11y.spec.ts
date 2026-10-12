import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

// Issue #274: keyboard, focus and current-page semantics of the grouped navigation.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function open(page: Page, route: string, width: number, height: number) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.setViewportSize({ width, height });
  await page.goto(`${server.url}#${route}`);
  await waitForRuntime(page);
}

test("Escape closes the mobile menu and returns focus to its button", async ({ page }) => {
  await open(page, "/applications", 390, 780);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Find Jobs" }).focus();
  await page.keyboard.press("Escape");
  const toggle = page.getByRole("button", { name: "Open navigation menu" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page).toHaveURL(/#\/applications$/);
});

test("after choosing a page in the mobile menu, focus moves to the new page's main content", async ({ page }) => {
  await open(page, "/applications", 390, 780);
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Find Jobs" }).click();
  await expect(page).toHaveURL(/#\/jobs$/);
  const main = page.getByRole("main");
  await expect(main).toBeFocused();
  await expect(main).toBeVisible();
});

test("a collapsed group that holds the current page says so to assistive technology", async ({ page }) => {
  await open(page, "/resume", 1440, 900);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const career = nav.getByRole("button", { name: /^My Career/ });
  await expect(career).toHaveAttribute("aria-expanded", "true");
  await expect(career).toHaveAccessibleName("My Career");
  await career.click();
  await expect(career).toHaveAttribute("aria-expanded", "false");
  await expect(career).toHaveAccessibleName("My Career (contains current page)");
  const search = nav.getByRole("button", { name: /^Search Tools/ });
  await expect(search).toHaveAccessibleName("Search Tools");
});

test("a skip link reaches the main content without changing the route", async ({ page }) => {
  await open(page, "/applications", 1440, 900);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page).toHaveURL(/#\/applications$/);
});

test("hovering a link does not look like the current page", async ({ page }) => {
  await open(page, "/applications", 1440, 900);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const current = nav.getByRole("link", { name: "Applications" });
  const other = nav.getByRole("link", { name: "Find Jobs" });
  await other.hover();
  await page.waitForTimeout(250);
  const style = (el: Element) => getComputedStyle(el).backgroundColor;
  expect(await other.evaluate(style)).not.toBe(await current.evaluate(style));
});
