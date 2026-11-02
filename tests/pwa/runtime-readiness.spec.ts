import { expect, test, type Page, type Route } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

// Issue #298: `waitForRuntime` must not resolve until the application surface is attached.
// The web entry sets `window.electronAPI` before it imports the `App` chunk, and the boot
// screen is absent until React mounts, so a helper that only checks those two facts can
// return while `#root` is still empty. These tests hold the `App` chunk back so that
// window is wide and deterministic instead of depending on runner I/O.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

const APP_CHUNK = /\/assets\/App-[^/]+\.js$/;
const HOLD_MS = 1500;

async function holdAppChunk(page: Page): Promise<() => number> {
  let held = 0;
  await page.route(APP_CHUNK, async (route: Route) => {
    held += 1;
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    await route.continue();
  });
  return () => held;
}

async function open(page: Page, route: string) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.url}#${route}`);
  await waitForRuntime(page);
}

test("waitForRuntime resolves only after the application surface is attached, even when the App chunk arrives late", async ({ page }) => {
  const heldRequests = await holdAppChunk(page);
  await open(page, "/applications");
  // Read the DOM in one synchronous step, with no auto-waiting locator, so a premature
  // return is observed rather than masked by a later retry.
  const snapshot = await page.evaluate(() => ({
    rootChildren: document.getElementById("root")?.childElementCount ?? 0,
    bootScreen: Boolean(document.querySelector('[data-testid="pwa-boot-screen"]')),
    mainContent: Boolean(document.getElementById("main-content")),
    skipLink: Boolean(document.querySelector('a.skip-link[href="#main-content"]')),
    api: Boolean((window as unknown as { electronAPI?: unknown }).electronAPI),
  }));
  expect(heldRequests(), "the App chunk request was intercepted").toBeGreaterThan(0);
  expect(snapshot).toEqual({ rootChildren: expect.any(Number), bootScreen: false, mainContent: true, skipLink: true, api: true });
  expect(snapshot.rootChildren).toBeGreaterThan(0);
});

test("the skip link is focusable on the first Tab even when the App chunk arrives late", async ({ page }) => {
  await holdAppChunk(page);
  await open(page, "/applications");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page).toHaveURL(/#\/applications$/);
});

test("waitForRuntime still waits through the boot screen when the runtime itself is slow", async ({ page }) => {
  // A late worker chunk keeps the boot screen on screen; the helper must wait it out
  // rather than return on an empty root or on the boot screen.
  await page.route(/\/assets\/worker-main-[^/]+\.js$/, async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    await route.continue();
  });
  await open(page, "/applications");
  await expect(page.getByTestId("pwa-boot-screen")).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeAttached();
});
