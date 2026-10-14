/**
 * Gate U2 decision-surface prototype smoke tests (#248).
 * Runs against a standalone file: no application, storage, network or canonical writes.
 * Locally: node --test tests/ux-248-decision-surfaces.test.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "@playwright/test";

const fixture = new URL("../docs/design/prototypes/248-task-first/decision-surfaces.html", import.meta.url).href;
const personas = ["licensed", "entry", "nontraditional", "change", "contract"];
const surfaces = ["jobs", "apps", "agent"];
const layouts = ["focused", "dense"];

async function withPage(fn, viewport = { width: 1280, height: 720 }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(fixture);
    await fn(page);
    await page.close();
  } finally {
    await browser.close();
  }
}

test("the comparison is explicitly fictional and makes no outbound requests", async () => {
  await withPage(async (page) => {
    const outbound = [];
    page.on("request", (r) => {
      if (new URL(r.url()).protocol !== "file:") outbound.push(r.url());
    });
    await page.reload();
    assert.deepEqual(outbound, []);
    assert.match(await page.locator("header").innerText(), /UX REVIEW PROTOTYPE, NOT JOB RANGER/);
    assert.equal(await page.locator("[data-page]").count(), 3);
    assert.equal(await page.locator("[data-mode]").count(), 2);
  });
});

test("five career scenarios have comparable focused and dense decision surfaces", async () => {
  await withPage(async (page) => {
    for (const persona of personas) {
      await page.locator("#scenario").selectOption(persona);
      for (const volume of ["1", "12", "50"]) {
        await page.locator("#volume").selectOption(volume);
        for (const surface of surfaces) {
          await page.locator('[data-page="' + surface + '"]').click();
          for (const layout of layouts) {
            await page.locator('[data-mode="' + layout + '"]').click();
            assert.equal(await page.locator("#preview h1").count(), 1);
            assert.equal(await page.locator('[data-mode="' + layout + '"]').getAttribute("aria-pressed"), "true");
            if (surface === "jobs") {
              assert.equal(await page.locator("#preview").getByText("Fit score", { exact: true }).count(), 0);
              assert.equal(await page.locator("#preview").getByText(/Eligibility/).count() > 0, true);
            }
          }
        }
      }
    }
  });
});

test("a job explanation retains four dimensions and moves keyboard focus", async () => {
  await withPage(async (page) => {
    await page.locator("#volume").selectOption("12");
    await page.locator('[data-job="4"]').click();
    assert.equal(await page.locator("#detailPane").evaluate((el) => el === document.activeElement), true);
    for (const label of ["Eligibility", "Evidence", "Career", "Preferences"]) {
      assert.equal(await page.locator("#detailPane .status strong").getByText(label, { exact: true }).count(), 1);
    }
    assert.match(await page.locator("#detailPane").innerText(), /Unseen requirements are unknown/);
  });
});

test("application stages show recorded next action only and hide removal", async () => {
  await withPage(async (page) => {
    await page.locator('[data-page="apps"]').click();
    assert.match(await page.locator("#preview").innerText(), /Recorded follow-up/);
    assert.match(await page.locator("#preview").innerText(), /Remove \(disabled\)/);
    await page.locator('[data-status="offer"]').click();
    assert.equal(await page.locator("#preview").getByText("No applications in this state.").count(), 1);
    assert.equal(await page.locator('[data-status="offer"]').evaluate(el => el === document.activeElement), true);
    await page.locator("#volume").selectOption("50");
    assert.equal(await page.locator("#preview").getByText("No applications in this state.").count(), 0);
  });
});

test("G3 conflict review compares both versions and cannot approve anything", async () => {
  await withPage(async (page) => {
    await page.locator('[data-page="agent"]').click();
    await page.locator('[data-agent="conflict"]').click();
    assert.equal(await page.locator("#detailPane").evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator("#detailPane").getByRole("heading", { name: "Version A" }).count(), 1);
    assert.equal(await page.locator("#detailPane").getByRole("heading", { name: "Version B" }).count(), 1);
    assert.match(await page.locator("#detailPane").innerText(), /not accepted by you/);
    assert.equal(await page.getByRole("button", { name: "Keep as draft (disabled)" }).isDisabled(), true);
    await page.locator('[data-agent="status"]').click();
    assert.match(await page.locator("#detailPane").innerText(), /explicit user confirmation in Applications/);
    await page.locator('[data-agenttab="problems"]').click();
    assert.match(await page.locator("#detailPane").innerText(), /Do not invent an affected resume/);
    await page.locator('[data-agenttab="history"]').click();
    assert.equal(await page.getByText(/No fictional history is available/).count(), 1);
    assert.equal(await page.locator("#detailPane").count(), 0);
  });
});

test("viewport reflow does not create document horizontal overflow", async () => {
  await withPage(async page => {
    for (const [width, height] of [[320,700],[390,780],[1280,580],[1440,900]]) {
      await page.setViewportSize({ width, height });
      for (const volume of ["1","50"]) {
        await page.locator("#volume").selectOption(volume);
        for (const screen of surfaces) {
          await page.locator('[data-page="' + screen + '"]').click();
          for (const mode of layouts) {
            await page.locator('[data-mode="' + mode + '"]').click();
            const size = await page.evaluate(() => document.documentElement.scrollWidth);
            assert.ok(size <= width, width + "px, " + volume + " records, " + screen + ", " + mode + ": " + size);
          }
        }
      }
    }
  }, {width:320,height:700});
});
