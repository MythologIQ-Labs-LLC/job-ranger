import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

test("modal is keyboard-contained and restores focus after Escape and cancellation", async ({ page }) => {
  await page.goto(`${server.url}#/filters`);
  await waitForRuntime(page);
  const trigger = page.getByRole("button", { name: "Create filter", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Create filter" });
  await expect(dialog).toBeVisible();
  const firstInput = dialog.getByRole("textbox", { name: "Filter name" });
  await expect(firstInput).toBeFocused();

  // Shift+Tab from the first input reaches the dialog's close control.
  await page.keyboard.press("Shift+Tab");
  const closeButton = dialog.getByRole("button", { name: "Close Create filter" });
  await expect(closeButton).toBeFocused();

  // Tab cannot escape behind the dialog in either direction.
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Save filter" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.electronAPI.filters.list())).toEqual([]);

  await page.keyboard.press("Enter");
  await expect(firstInput).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("form actions remain reachable on a short mobile viewport, without saving on cancel", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 400 });
  await page.goto(`${server.url}#/filters`);
  await waitForRuntime(page);
  const trigger = page.getByRole("button", { name: "Create filter", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Create filter" });
  await expect(dialog).toBeVisible();

  const layout = await dialog.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const content = node.lastElementChild as HTMLElement;
    const scroll = getComputedStyle(content);
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      viewport: window.innerHeight,
      bodyScrollHeight: content.scrollHeight,
      bodyClientHeight: content.clientHeight,
      overflowY: scroll.overflowY,
    };
  });
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewport);
  expect(layout.bodyScrollHeight).toBeGreaterThan(layout.bodyClientHeight);
  expect(layout.overflowY).toBe("auto");

  // Scroll the actual modal content and reach the form's last controls.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.electronAPI.filters.list())).toEqual([]);
});
