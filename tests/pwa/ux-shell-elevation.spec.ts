import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

// Visual elevation is accepted only if it keeps working navigation and the
// task-first Home behavior. These tests exercise the real built application.
let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function openHome(page: Page, theme: string) {
  await page.addInitScript((name) => {
    localStorage.setItem("theme", name);
    localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true");
  }, theme);
  // Going to "#/" from "#/" is a same-document fragment change: no reload, so the
  // init script above would never apply the next theme. Start a fresh document.
  await page.goto("about:blank");
  await page.goto(server.url + "#/");
  await waitForRuntime(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByRole("heading", { name: "Your next steps" })).toBeVisible();
}

test("app shell displays its packaged logo and meaningful route icons", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHome(page, "atelier");
  const artwork = page.locator(".brand-logo-frame img");
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveAttribute("src", /ICON\.png$/);
  expect(await artwork.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  for (const label of ["Home", "Find Jobs", "Applications", "Personal Brand"]) {
    const link = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: label });
    await expect(link).toBeVisible();
    await expect(link.locator(".sidebar-nav-glyph svg")).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
  await expect(page.locator(".home-progress-row")).toHaveCount(3);
});

test("mobile navigation remains keyboard operable and hands focus to the destination", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openHome(page, "midnight");
  const openMenu = page.getByRole("button", { name: "Open navigation menu" });
  await openMenu.click();
  const findJobs = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Find Jobs" });
  await expect(findJobs).toBeVisible();
  await findJobs.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/jobs$/);
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
  await expect(page.locator("#main-content")).toBeFocused();
});

test("the three themes retain narrow and short viewport reflow", async ({ page }) => {
  for (const theme of ["atelier", "midnight", "canopy"]) {
    for (const viewport of [
      { width: 320, height: 700 },
      { width: 390, height: 780 },
      { width: 1280, height: 580 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await openHome(page, theme);
      const geometry = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>(".app-main");
        return {
          rootOverhang: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          mainOverhang: main ? main.scrollWidth - main.clientWidth : -1,
          decisionVisible: !!document.querySelector(".home-action-panel"),
        };
      });
      expect(geometry.rootOverhang, `${theme} ${viewport.width} root`).toBeLessThanOrEqual(1);
      expect(geometry.mainOverhang, `${theme} ${viewport.width} main`).toBeLessThanOrEqual(1);
      expect(geometry.decisionVisible).toBe(true);
    }
  }
});

test("reduced motion suppresses decorative transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHome(page, "canopy");
  const action = page.locator(".home-action-row").first();
  // Global reduced-motion safety already pins decorative transitions at
  // 0.01ms !important, rather than reporting an exact computed "0s".
  if (await action.count()) {
    expect(await action.evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.001);
  }
  const icon = page.locator(".sidebar-nav-glyph").first();
  expect(await icon.evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.001);
});

test("theme picker previews each 60/30/10 palette and reflects the active selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHome(page, "atelier");
  await page.goto(server.url + "#/settings");
  await waitForRuntime(page);
  const atelier = page.getByRole("button", { name: /Atelier/ });
  const midnight = page.getByRole("button", { name: /Midnight/ });
  const canopy = page.getByRole("button", { name: /Canopy/ });
  for (const option of [atelier, midnight, canopy]) {
    await expect(option).toBeVisible();
    await expect(option.locator(".theme-palette-preview span")).toHaveCount(3);
  }
  await expect(atelier).toHaveAttribute("aria-pressed", "true");
  await midnight.click();
  await expect(midnight).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await atelier.click();
  await expect(atelier).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "atelier");
  await expect(atelier.locator(".theme-palette-preview span").first())
    .toHaveCSS("background-color", "rgb(246, 243, 235)");
});

test("a short desktop window shows every collapsed sidebar entry without scrolling", async ({ page }) => {
  // The brand text and section labels once pushed the last entry under the
  // pinned Preferences footer at 1280x600 and 1280x580 with no visible scroll cue.
  for (const height of [600, 580]) {
    await page.setViewportSize({ width: 1280, height });
    for (const theme of ["atelier", "midnight", "canopy"]) {
      await openHome(page, theme);
      const nav = page.getByRole("navigation", { name: "Primary navigation" });
      const fit = await nav.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
      expect(fit.scroll, `${theme} sidebar overflows at 1280x${height}`).toBeLessThanOrEqual(fit.client + 1);
      await expect(page.locator(".sidebar-section-label").first()).toBeHidden();
      await expect(page.getByRole("heading", { name: "Sojourner", level: 1 })).toBeVisible();
    }
  }
});
