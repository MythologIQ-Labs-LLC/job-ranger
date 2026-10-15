import { test, expect } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

// Every page renders its own Layout, so Home replacing its loading placeholder
// with the dashboard remounts the sidebar without any navigation. A group the
// person opened during that moment used to snap shut, detaching the link they
// were about to click (the intermittent Electron e2e navigation timeout).
test("a navigation group opened while a page is loading stays open when the page finishes", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.goto(`${server.url}#/settings`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

  // Hold the next Career Profile read so Home stays on its loading placeholder.
  await page.evaluate(() => {
    const career = window.electronAPI.career;
    const real = career.getProfile.bind(career);
    const gate = { release: () => {} };
    (window as unknown as { profileGate: typeof gate }).profileGate = gate;
    career.getProfile = () => new Promise((resolve, reject) => {
      gate.release = () => { real().then(resolve, reject); };
    });
  });
  await page.evaluate(() => { window.location.hash = "/"; });
  const loading = page.getByText("Loading your workspace...", { exact: true });
  await expect(loading).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const myCareer = nav.getByRole("button", { name: "My Career" });
  await expect(myCareer).toHaveAttribute("aria-expanded", "false");
  await myCareer.click();
  await expect(myCareer).toHaveAttribute("aria-expanded", "true");

  await page.evaluate(() => (window as unknown as { profileGate: { release: () => void } }).profileGate.release());
  await expect(loading).toHaveCount(0);
  await expect(myCareer).toHaveAttribute("aria-expanded", "true");
  await nav.getByRole("link", { name: "Career Profile", exact: true }).click();
  await expect(page).toHaveURL(/#\/career-profile$/);

  // The remembered choice belongs to that visit only: returning Home later
  // restores the compact default.
  await nav.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(loading).toHaveCount(0);
  await expect(myCareer).toHaveAttribute("aria-expanded", "false");
});
