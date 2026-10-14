/**
 * Gate U2 isolated UX mockup checks. This is not an application test:
 * it opens the standalone HTML prototype and makes no network/API calls.
 * Execute locally: node --test tests/ux-248-task-first-prototype.test.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const fixture = new URL("../docs/design/prototypes/248-task-first/index.html", import.meta.url).href;
const scenarios = ["entry", "licensed", "nontraditional", "change", "contract"];

async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true });
  try { await fn(browser); } finally { await browser.close(); }
}

test("U2 prototype never fetches remote content or uses career data APIs", async () => {
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    const outgoing = [];
    page.on("request", (request) => {
      if (new URL(request.url()).protocol !== "file:") outgoing.push(request.url());
    });
    await page.goto(fixture);
    assert.deepEqual(outgoing, []);
    assert.match(await page.locator(".review-banner").innerText(), /NOT JOB RANGER/);
    await page.close();
  });
});

test("five universal-user situations switch between focused Home and distinct Target Tracks", async () => {
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(fixture);
    for (const name of scenarios) {
      await page.locator("#scenario").selectOption(name);
      assert.match(await page.locator("#preview h1").innerText(), /Your next steps/);
      await page.getByRole("button", { name: "Career Direction", exact: true }).click();
      assert.match(await page.locator("#preview h1").innerText(), /Where do you want to go/);
      const available = await page.locator("#preview [data-track]").count();
      assert.ok(available >= 1, "Every fixture should supply one explicit direction");
      await page.locator("#home").click();
    }
    await page.close();
  });
});

test("the focused view puts actual decision items ahead of system telemetry", async () => {
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(fixture);
    await page.locator("#scenario").selectOption("licensed");
    assert.match(await page.getByRole("heading", { name: "Needs your attention" }).count().then(String), /1/);
    assert.match(await page.locator("#preview").innerText(), /4 imported facts to review/);
    const reviewY = (await page.getByText("4 imported facts to review").boundingBox()).y;
    const searchY = (await page.getByRole("heading", { name: "Search health" }).boundingBox()).y;
    assert.ok(reviewY < searchY, "Evidence review must appear before source telemetry");
    await page.getByRole("button", { name: "B · Dense" }).click();
    assert.match(await page.locator("#preview h1").innerText(), /Search overview/);
    await page.getByRole("button", { name: "A · Focused" }).click();
    await page.close();
  });
});

test("cross-career and viewport smoke: 320, 390, 1280 short, 1440 desktop", async () => {
  await withBrowser(async (browser) => {
    for (const { width, height } of [
      {width:320,height:700}, {width:390,height:780},
      {width:1280,height:580}, {width:1440,height:900},
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(fixture);
      for (const name of scenarios) {
        await page.locator("#scenario").selectOption(name);
        for (const screen of ["home", "direction"]) {
          await page.locator("#" + screen).click();
          const widthInfo = await page.evaluate(() => ({
            full: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
            viewport: innerWidth,
          }));
          assert.ok(widthInfo.full <= width, width + " " + name + " " + screen + ": " + JSON.stringify(widthInfo));
          assert.ok(widthInfo.body <= width, width + " " + name + " " + screen + ": " + JSON.stringify(widthInfo));
        }
      }
      await page.close();
    }
  });
});

test("career direction remains preview-only and handles independent tracks", async () => {
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(fixture);
    await page.locator("#scenario").selectOption("change");
    await page.getByRole("button", { name: "Career Direction", exact: true }).click();
    assert.equal(await page.locator("#preview [data-track]").count(), 2);
    await page.locator("#preview [data-track='1']").click();
    assert.match(await page.locator("#preview h2").allTextContents().then(x=>x.join(" ")),/Learning and development/);
    await page.getByRole("button", { name: "Simulate edit" }).click();
    assert.match(await page.locator("#preview").innerText(), /Unsaved prototype edits/);
    await page.getByRole("button", { name: "Discard simulated edit" }).click();
    assert.match(await page.locator("#preview").innerText(), /Fixture saved-state preview/);
    assert.match(await page.locator("#preview").innerText(), /not approved/);
    await page.close();
  });
});
