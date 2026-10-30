// Curated README and website screenshots: same fixture, build, and theme as the demo,
// but unrecorded and without the demo's cursor or caption overlays.
// Run with `npm run demo:screenshots`; accepted images are reviewed before publication
// (docs/marketing/SOJOURNER_MEDIA_HANDOFF.md).
import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPwaServer } from "../../tests/pwa/support/server";
import { distPwa, waitForRuntime } from "../../tests/pwa/support/fixtures";
import { DEMO_EMPLOYER, DEMO_JOB_TITLE, TARGET_TRACK, prepareDemoContext, seedDemo } from "./fixture";
import { scrollToElement, scrollToTop, waitForDemoReady, waitForLayoutStable } from "./ready";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.JOB_RANGER_DEMO_OUT ?? path.resolve(here, "..", "..", "build", "demo", "curated");
const executablePath = process.env.JOB_RANGER_PW_CHROMIUM || undefined;
const VIEWPORT = { width: 1600, height: 900 };
const FIND_JOBS = "Spend your time on the jobs that look worth it.";

async function capture(page: Page, name: string): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "canopy");
  await expect(page.locator("#demo-cursor, #demo-caption, #demo-title-card, #demo-freeze")).toHaveCount(0);
  await waitForLayoutStable(page);
  await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2);
  await page.screenshot({ path: path.join(out, name) });
}

async function go(page: Page, hash: string, ready: Parameters<typeof waitForDemoReady>[1]): Promise<void> {
  await page.evaluate((target) => (window.location.hash = target), hash);
  await waitForDemoReady(page, ready);
  await scrollToTop(page);
}

/** Opens the assessment drawer unless it is already open (it stays open on the same route). */
async function openAssessment(page: Page) {
  const toggle = page.getByRole("button", { name: /Opportunity assessment/ }).first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const drawer = page.getByRole("dialog", { name: `Opportunity assessment: ${DEMO_JOB_TITLE}` });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function careerDirection(page: Page): Promise<void> {
  await go(page, "#/target-tracks", { route: "#/target-tracks", heading: "Keep different career directions separate.", content: [TARGET_TRACK, "Patient services (current)"] });
  await page.getByRole("button", { name: new RegExp(`^${TARGET_TRACK}`) }).first().click();
  await expect(page.getByRole("heading", { name: TARGET_TRACK, exact: true })).toBeVisible();
  await capture(page, "career-direction.png");
}

async function assessment(page: Page): Promise<void> {
  await go(page, "#/jobs", { route: "#/jobs", heading: FIND_JOBS, content: [DEMO_JOB_TITLE, DEMO_EMPLOYER] });
  const drawer = await openAssessment(page);
  for (const badge of ["Eligibility · Unclear", "Evidence · Partial", "Career · Aligned", "Preferences · Mixed"]) {
    await expect(drawer.getByText(badge, { exact: true })).toBeVisible();
  }
  await expect(drawer.getByText(/Epic EHR/).filter({ visible: true }).first()).toBeVisible();
  // The drawer is viewport-anchored over Find Jobs; capture it whole rather than cropping.
  await capture(page, "opportunity-assessment.png");
}

/** Scrolls Applications so the status filters, the tracked job and its linked resume file all show. */
async function showLinkedResume(page: Page): Promise<void> {
  await scrollToElement(page, page.getByText("Focus your applications", { exact: true }), 24);
  const file = page.locator("main").getByText(/^PDF v1 · /).first();
  await expect(file).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("combobox", { name: `Application status for ${DEMO_JOB_TITLE}` })).toBeInViewport({ ratio: 1 });
}

async function careerEvidence(page: Page): Promise<void> {
  await go(page, "#/career-evidence/new", { route: "#/career-evidence/new", heading: "Build your career evidence one fact at a time.", content: ["Review and correct confirmed evidence"] });
  const current = page.locator("#current-evidence-heading");
  await scrollToElement(page, current, 24);
  const facts = page.locator("main").getByText(/Referral backlog|Rebuilt the referral queue/).filter({ visible: true });
  await expect(facts.first()).toBeInViewport();
  await capture(page, "career-evidence.png");
}

async function deliberateApplication(page: Page): Promise<void> {
  await go(page, "#/jobs", { route: "#/jobs", heading: FIND_JOBS, content: [DEMO_JOB_TITLE] });
  const drawer = await openAssessment(page);
  await drawer.getByRole("button", { name: "Prepare resume" }).click();
  await waitForDemoReady(page, { route: "#/resume", heading: "Build the document from facts you have actually confirmed.", content: ["Targeting tracked job"] });
  await page.getByLabel("Email", { exact: true }).fill("morgan.rivera@example.org");
  await page.getByRole("button", { name: "Create truthful draft" }).click();
  const passed = page.getByText("Truth Gate passed", { exact: true });
  await expect(passed).toBeVisible();
  // The confirmed-fact draft beside the passed Truth Gate, framed as in the walkthrough.
  await scrollToElement(page, passed, 140);
  await expect(passed).toBeInViewport();
  await capture(page, "resume-truth-gate.png");
  await page.getByRole("button", { name: "Export verified PDF" }).click();
  await expect(page.getByRole("button", { name: /Download file|Show file/ }).first()).toBeVisible();
  await go(page, "#/applications", { route: "#/applications", heading: "Keep track of what happens after a job looks promising.", content: [DEMO_JOB_TITLE] });
  const status = page.getByRole("combobox", { name: `Application status for ${DEMO_JOB_TITLE}` });
  await status.selectOption("applied");
  await expect(status).toHaveValue("applied");
  await page.getByRole("button", { name: /Application details/ }).first().click();
  await expect(page.getByText("Submitted files", { exact: false }).filter({ visible: true }).first()).toBeVisible();
  await waitForLayoutStable(page);
  await showLinkedResume(page);
  await capture(page, "deliberate-application.png");
}

test("curated README and website screenshots", async () => {
  test.setTimeout(180_000);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const server = await startPwaServer(distPwa);
  const profile = mkdtempSync(path.join(os.tmpdir(), "job-ranger-shots-"));
  const problems: string[] = [];
  const context = await chromium.launchPersistentContext(profile, { viewport: VIEWPORT, executablePath });
  try {
    await prepareDemoContext(context);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    await page.goto(server.url);
    await waitForRuntime(page);
    await seedDemo(page);
    await page.reload();
    await waitForRuntime(page);
    await careerDirection(page);
    await assessment(page);
    await careerEvidence(page);
    await deliberateApplication(page);
    expect(problems, problems.join("\n")).toEqual([]);
  } finally {
    await context.close();
    await server.close();
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      // The browser may still hold its log file on Windows; the profile is in the OS temp directory.
    }
  }
});
