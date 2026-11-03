import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

// Web production build: icons and affixes inside form controls must clear the
// control's text (BACKLOG G8; shell padding once overrode padding utilities).

let server: PwaServer;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
});

test.afterAll(async () => {
  await server.close();
});

type Clearance = { label: string; gap: number };

async function decorationClearance(page: Page): Promise<Clearance[]> {
  return page.locator("main").evaluate((root) => {
    const results: { label: string; gap: number }[] = [];
    for (const control of Array.from(root.querySelectorAll<HTMLElement>("input.input-shell, select.select-shell"))) {
      const wrapper = control.parentElement;
      if (!wrapper || getComputedStyle(wrapper).position !== "relative") continue;
      const style = getComputedStyle(control);
      const box = control.getBoundingClientRect();
      const contentLeft = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const contentRight = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      const label = control.getAttribute("aria-label") || control.getAttribute("placeholder") || control.closest("label")?.textContent?.trim().slice(0, 40) || control.tagName;
      for (const decoration of Array.from(wrapper.children).filter((child) => child !== control)) {
        const mark = decoration.getBoundingClientRect();
        if (mark.width === 0) continue;
        const onLeft = mark.left < box.left + box.width / 2;
        results.push({ label: `${label} (${onLeft ? "left" : "right"})`, gap: onLeft ? contentLeft - mark.right : mark.left - contentRight });
      }
    }
    return results;
  });
}

function expectClear(clearances: Clearance[], expected: number) {
  expect(clearances).toHaveLength(expected);
  for (const { label, gap } of clearances) expect(gap, label).toBeGreaterThanOrEqual(4);
}

test("form-control text clears its icons and affixes in the web app", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("sojourner.onboarding.dismissed.v1", "true"));
  await page.goto(`${server.url}#/jobs`);
  await waitForRuntime(page);
  const search = page.getByPlaceholder("Search title or description");
  await expect(search).toBeVisible();
  expectClear(await decorationClearance(page), 4);

  const location = page.getByPlaceholder("Filter by location");
  const restingShadow = await location.evaluate((el) => getComputedStyle(el).boxShadow);
  await search.focus();
  await page.keyboard.press("Tab");
  await expect(location).toBeFocused();
  await expect.poll(() => location.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(restingShadow);

  await page.goto(`${server.url}#/career-profile`);
  await expect(page.getByLabel("Home area", { exact: true })).toBeEnabled();
  expectClear(await decorationClearance(page), 3);
  const roles = page.getByLabel(/^Roles you would consider/);
  const geometry = await roles.evaluate((el) => {
    const style = getComputedStyle(el);
    return { top: style.paddingTop, bottom: style.paddingBottom, width: el.getBoundingClientRect().width, parent: el.parentElement!.getBoundingClientRect().width };
  });
  expect(geometry.top).toBe("12px");
  expect(geometry.bottom).toBe("12px");
  expect(Math.abs(geometry.width - geometry.parent)).toBeLessThanOrEqual(1);
});
