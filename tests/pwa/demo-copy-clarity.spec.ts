import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";
import { DEMO_JOB_TITLE, TARGET_TRACK, prepareDemoContext, seedDemo } from "../../scripts/demo/fixture";

// #248: the four copy defects visible in the approved 2026-10-30 walkthrough, driven through the UI
// with the same fictional fixture at the walkthrough's 1600x900 viewport.

let server: PwaServer;
let context: BrowserContext;
let page: Page;
let profile: string;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
  profile = mkdtempSync(path.join(os.tmpdir(), "sojourner-copy-"));
  context = await chromium.launchPersistentContext(profile, {
    viewport: { width: 1600, height: 900 },
    executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined,
  });
  await prepareDemoContext(context);
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto(server.url);
  await waitForRuntime(page);
  await seedDemo(page);
  await page.reload();
  await waitForRuntime(page);
});

test.afterAll(async () => {
  await context.close();
  await server.close();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Windows may still hold the browser log file.
  }
});

async function go(hash: string, heading: string): Promise<void> {
  await page.evaluate((target) => (window.location.hash = target), hash);
  await expect(page.locator("main h1").first()).toContainText(heading);
}

function assessmentDrawer() {
  return page.getByRole("dialog", { name: `Opportunity assessment: ${DEMO_JOB_TITLE}` });
}

test.describe.configure({ mode: "serial" });

test("the profile-derived target track explains itself without migration jargon", async () => {
  await go("#/target-tracks", "Keep different career directions separate.");
  await page.getByRole("button", { name: new RegExp(`^${TARGET_TRACK}`) }).first().click();
  await expect(page.getByRole("heading", { name: TARGET_TRACK, exact: true })).toBeVisible();
  await expect(page.getByText(/started from your Career Profile, which still relies on it, so it cannot be deleted yet/)).toBeVisible();
  await expect(page.getByText(/promoted bridge/i)).toHaveCount(0);
});

test("the assessment lists a blocker once, without stray punctuation, and labels supported evidence consistently", async () => {
  await go("#/jobs", "Spend your time on the jobs that look worth it.");
  await page.getByRole("button", { name: /Opportunity assessment/ }).first().click();
  const drawer = assessmentDrawer();
  await expect(drawer).toBeVisible();

  // The listing writes "hands-on Epic EHR experience;": its own semicolon is not kept before the qualifier.
  await expect(drawer.getByText(/Required: hands-on Epic EHR experience \(no confirmed support\)\.$/)).toBeVisible();
  await expect(drawer.getByText(/;\s*\(no confirmed support\)/)).toHaveCount(0);

  // A required arrangement the listing does not state is a potential blocker, not also a preference unknown.
  const arrangement = /does not provide a usable employment arrangement/;
  const blockers = drawer.getByText("Potential blockers", { exact: true }).locator("xpath=following-sibling::ul[1]");
  await expect(blockers.getByText(arrangement)).toHaveCount(1);
  const unknown = drawer.getByText("Unknown", { exact: true }).locator("xpath=following-sibling::ul[1]");
  await expect(unknown).toBeVisible();
  await expect(unknown.getByText(arrangement)).toHaveCount(0);

  // The coverage badge uses the same word as the requirement rows.
  await expect(drawer.getByText(/^\d+ supported$/)).toBeVisible();
  await expect(drawer.getByText(/^\d+ direct$/)).toHaveCount(0);
  await expect(drawer.getByText("Supported", { exact: true }).first()).toBeVisible();
});

test("the resume Template select shows its whole label at the walkthrough size", async () => {
  await assessmentDrawer().getByRole("button", { name: "Prepare resume" }).click();
  await expect(page.locator("main h1").first()).toContainText("Build the document from facts you have actually confirmed.");
  const template = page.getByRole("combobox", { name: "Template" });
  await expect(template).toHaveValue("ats-standard-v1");
  const fit = await template.evaluate((element) => {
    const select = element as HTMLSelectElement;
    const style = getComputedStyle(select);
    const canvas = document.createElement("canvas").getContext("2d")!;
    canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const widest = Math.max(...[...select.options].map((option) => canvas.measureText(option.text).width));
    // Text area = box minus padding (the right padding holds the dropdown arrow).
    const available = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return { widest, available };
  });
  expect(fit.widest).toBeLessThanOrEqual(fit.available);
});

test("Applications says the status and resume versions are recorded by the user, not sent", async () => {
  await page.getByLabel("Email", { exact: true }).fill("morgan.rivera@example.org");
  await page.getByRole("button", { name: "Create truthful draft" }).click();
  await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Export verified PDF" }).click();
  await expect(page.getByRole("button", { name: /Download file|Show file/ }).first()).toBeVisible();

  await go("#/applications", "Keep track of what happens after a job looks promising.");
  const status = page.getByRole("combobox", { name: `Application status for ${DEMO_JOB_TITLE}` });
  await expect(status).toHaveAccessibleDescription("Status recorded by you");
  await status.selectOption("applied");
  await expect(status).toHaveValue("applied");
  await page.getByRole("button", { name: /Application details/ }).first().click();
  await expect(page.getByText("Resume versions", { exact: true })).toBeVisible();
  await expect(page.getByText(/never sends them to an employer/)).toBeVisible();
  await expect(page.getByText(/^PDF v1 · Version you sent$/)).toBeVisible();
  await expect(page.getByText(/Submitted files/i)).toHaveCount(0);
});
