import { test, expect } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

test("desktop sidebar stays in a viewport frame while expanded navigation scrolls independently", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 580 });
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.goto(`${server.url}#/personal-brand`);
  const sidebar = page.locator(".app-sidebar");
  const main = page.locator(".app-main");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(sidebar).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(main).toBeVisible();
  const initial = await sidebar.boundingBox();
  expect(initial).not.toBeNull();
  expect(initial!.y).toBeLessThan(2);
  expect(Math.abs(initial!.height - 580)).toBeLessThan(3);

  const before = await main.evaluate(el => ({ scroll: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }));
  expect(before.height).toBeGreaterThan(before.client + 300);
  await main.evaluate(el => el.scrollTo({ top: 900, behavior: "instant" }));
  await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeGreaterThan(600);
  const after = await sidebar.boundingBox();
  expect(Math.abs(after!.y - initial!.y)).toBeLessThan(2);
  expect(Math.abs(after!.height - initial!.height)).toBeLessThan(2);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The compact default navigation should not need a scrollbar. Expanded tools
  // must remain reachable independently of the separately scrolled content.
  await nav.getByRole("button", { name: "My Career" }).click();
  await expect(nav.getByRole("button", { name: "My Career" })).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Resume" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Utility navigation" }).getByRole("link", { name: "Settings" })).toBeVisible();
  const beforeMain = await main.evaluate(el => el.scrollTop);
  await nav.evaluate(el => el.scrollTop = el.scrollHeight);
  await expect.poll(() => nav.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await main.evaluate(el => el.scrollTop)).toBe(beforeMain);
  await expect(nav.getByRole("link", { name: "Personal Brand", exact: true })).toHaveAttribute("aria-current", "page");
});

test("group toggles support direct routes, single-open sections and browser history", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.goto(`${server.url}#/applications`);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const career = nav.getByRole("button", { name: "My Career" });
  const search = nav.getByRole("button", { name: "Search Tools" });

  await expect(career).toHaveAttribute("aria-expanded", "false");
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await career.click();
  await expect(nav.getByRole("link", { name: "Career Stories" })).toBeVisible();
  await search.click();
  await expect(career).toHaveAttribute("aria-expanded", "false");
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Companies" })).toBeVisible();

  await page.goto(`${server.url}#/career-stories`);
  await expect(career).toHaveAttribute("aria-expanded", "true");
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Career Stories" })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(nav.getByRole("link", { name: "Applications" })).toHaveAttribute("aria-current", "page");
  await expect(career).toHaveAttribute("aria-expanded", "false");
  await page.goForward();
  await expect(career).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Career Stories" })).toHaveAttribute("aria-current", "page");
});

test("mobile groups and utility navigation stay accessible and close after navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.goto(`${server.url}#/personal-brand`);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const utility = page.getByRole("navigation", { name: "Utility navigation" });
  const menu = page.getByRole("button", { name: "Open navigation menu" });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(nav).toBeHidden();
  await expect(utility).toBeHidden();

  const sidebar = await page.locator(".app-sidebar").boundingBox();
  const main = await page.locator(".app-main").boundingBox();
  expect(sidebar!.width).toBeLessThanOrEqual(392);
  expect(main!.width).toBeLessThanOrEqual(392);
  expect(main!.y).toBeGreaterThanOrEqual(sidebar!.y + sidebar!.height - 2);

  await menu.click();
  await expect(page.getByRole("button", { name: "Close navigation menu" })).toHaveAttribute("aria-expanded", "true");
  await expect(nav).toBeVisible();
  await expect(utility).toBeVisible();
  await nav.getByRole("button", { name: "My Career" }).click();
  await nav.getByRole("link", { name: "Target Tracks" }).click();
  await expect(nav).toBeHidden();
  await expect(utility).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/#\/target-tracks$/);

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(nav.getByRole("button", { name: "My Career" })).toHaveAttribute("aria-expanded", "true");
  await utility.getByRole("link", { name: "Settings" }).click();
  await expect(nav).toBeHidden();
  await expect(page).toHaveURL(/#\/settings$/);
});

test("keyboard can reveal a grouped destination without losing focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 780 });
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.goto(`${server.url}#/jobs`);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const toggle = nav.getByRole("button", { name: "Search Tools" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await expect(nav.getByRole("link", { name: "Filters" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
