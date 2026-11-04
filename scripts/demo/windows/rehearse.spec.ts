// Technical rehearsal on the installed signed app: every state the film shows is asserted and
// screenshotted before anything is recorded. Run:
//   npx playwright test --config scripts/demo/windows/playwright.windows.config.ts rehearse
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEMO_JOB_TITLE, TARGET_TRACK, seedDemo } from "../fixture";
import { buildIdentity, demoRequests, launchInstalled } from "./installed-app";

const out = process.env.SOJOURNER_FILM_OUT ?? path.resolve("build", "film", "rehearsal");

test("rehearse the narrated story on the installed Windows app", async () => {
  mkdirSync(out, { recursive: true });
  const { app, page, problems } = await launchInstalled();
  const log: Record<string, unknown> = { identity: await buildIdentity(app) };
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    await seedDemo(page);
    // The renderer loads sources at start-up; reload so the seeded workspace is what it shows.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => (window.location.hash = "#/target-tracks"));
    await expect(page.locator("main h1").first()).toContainText("Keep different career directions separate.");
    await expect(page.getByText("Patient services (current)").first()).toBeVisible();
    await shot("01-target-tracks");
    await page.getByRole("button", { name: new RegExp(`^${TARGET_TRACK}`) }).first().click();
    await expect(page.getByRole("heading", { name: TARGET_TRACK, exact: true })).toBeVisible();
    await shot("02-practice-operations");

    await page.evaluate(() => (window.location.hash = "#/jobs"));
    await expect(page.getByText(DEMO_JOB_TITLE).first()).toBeVisible();
    await shot("03-find-jobs");
    await page.getByRole("button", { name: /Opportunity assessment/ }).first().click();
    const drawer = page.getByRole("dialog", { name: `Opportunity assessment: ${DEMO_JOB_TITLE}` });
    for (const badge of ["Eligibility · Unclear", "Evidence · Partial", "Career · Aligned", "Preferences · Mixed"]) {
      await expect(drawer.getByText(badge, { exact: true })).toBeVisible();
    }
    await expect(drawer.getByText(/Epic EHR/).filter({ visible: true }).first()).toBeVisible();
    await shot("04-assessment");
    log.assessmentText = await drawer.innerText();
    await drawer.getByText("Evidence coverage", { exact: true }).scrollIntoViewIfNeeded();
    await shot("05-evidence-coverage");
    await drawer.getByRole("button", { name: `Close Opportunity assessment: ${DEMO_JOB_TITLE}` }).click();

    await page.evaluate(() => (window.location.hash = "#/career-evidence/new"));
    await expect(page.locator("main h1").first()).toContainText("Build your career evidence one fact at a time.");
    await page.locator("#current-evidence-heading").scrollIntoViewIfNeeded();
    await shot("06-career-evidence");
    log.evidenceText = await page.locator("main").innerText();

    await page.evaluate(() => (window.location.hash = "#/jobs"));
    await page.getByRole("button", { name: /Opportunity assessment/ }).first().click();
    await drawer.getByRole("button", { name: "Prepare resume" }).click();
    await expect(page.locator("main h1").first()).toContainText("Build the document from facts you have actually confirmed.");
    await shot("07-resume");
    await page.getByLabel("Email", { exact: true }).fill("jordan.ellis@example.org");
    await page.getByRole("button", { name: "Create truthful draft" }).click();
    await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
    await page.getByText("Truth Gate passed", { exact: true }).scrollIntoViewIfNeeded();
    await shot("08-truth-gate");
    await page.getByRole("button", { name: "Export verified PDF" }).click();
    await expect(page.getByRole("button", { name: /Download file|Show file/ }).first()).toBeVisible();
    await shot("09-exported");
    log.resumeText = await page.locator("main").innerText();

    await page.evaluate(() => (window.location.hash = "#/applications"));
    await expect(page.getByText(DEMO_JOB_TITLE).first()).toBeVisible();
    const status = page.getByRole("combobox", { name: `Application status for ${DEMO_JOB_TITLE}` });
    log.statusBefore = await status.inputValue();
    await shot("10-applications");
    await page.getByRole("button", { name: /Application details/ }).first().click();
    await expect(page.getByText("Resume versions", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await shot("11-application-details");
    await page.getByRole("button", { name: "Add event" }).first().click();
    await page.getByLabel("Event type").selectOption("follow-up");
    await page.getByLabel("Event title").fill("Ask Harbor Health about Epic training");
    await page.getByLabel("Event time").fill("2026-11-06T10:00");
    await shot("12-next-step-form");
    await page.getByRole("button", { name: "Save event" }).click();
    await expect(page.getByText("Ask Harbor Health about Epic training").first()).toBeVisible();
    await shot("13-next-step-saved");
    log.applicationText = await page.locator("main").innerText();
    log.statusAfter = await status.inputValue();
    log.mainProcessRequests = await demoRequests(app);
    log.problems = problems;
  } finally {
    writeFileSync(path.join(out, "rehearsal-log.json"), JSON.stringify(log, null, 2));
    await app.close();
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
