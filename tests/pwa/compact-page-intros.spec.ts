import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

// #248 Option A: compact the shared page introduction only on constrained viewports
// (max-width 767px or max-height 700px), keeping all explanatory copy visible.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

const routes = ["/", "/resume", "/companies", "/career-profile", "/help"];

async function measure(page: Page, route: string) {
  await page.goto(`${server.url}#${route}`);
  await page.reload();
  await waitForRuntime(page);
  const title = page.locator(".page-title").first();
  await expect(title).toBeVisible();
  return title.evaluate((el) => {
    const panel = el.closest(".panel-strong") as HTMLElement;
    const style = getComputedStyle(panel);
    const copy = panel.querySelector(".page-copy") as HTMLElement | null;
    return {
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      paddingTop: parseFloat(style.paddingTop),
      paddingLeft: parseFloat(style.paddingLeft),
      panelBottom: panel.getBoundingClientRect().bottom,
      copyText: copy?.textContent?.trim() ?? "",
      copyVisible: !!copy && copy.offsetHeight > 0 && getComputedStyle(copy).display !== "none",
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
});

test("regular desktop keeps the full page introduction", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of routes) {
    const m = await measure(page, route);
    expect(m.fontSize, route).toBeGreaterThanOrEqual(44);
    expect(m.paddingTop, route).toBeGreaterThanOrEqual(24);
  }
});

for (const vp of [{ width: 1280, height: 580 }, { width: 390, height: 780 }, { width: 320, height: 700 }]) {
  test(`constrained ${vp.width}x${vp.height} compacts the introduction without hiding its explanation`, async ({ page }) => {
    await page.setViewportSize(vp);
    for (const route of routes) {
      const m = await measure(page, route);
      expect(m.fontSize, `${route} title size`).toBeLessThanOrEqual(30);
      expect(m.fontSize, `${route} readable title`).toBeGreaterThanOrEqual(24);
      expect(m.paddingTop, `${route} padding`).toBeLessThanOrEqual(18);
      expect(m.copyVisible, `${route} explanation visible`).toBe(true);
      expect(m.copyText.length, `${route} explanation text`).toBeGreaterThan(40);
      expect(m.overflowX, `${route} horizontal overflow`).toBeLessThanOrEqual(0);
    }
  });
}
