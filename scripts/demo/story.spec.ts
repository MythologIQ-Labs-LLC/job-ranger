// Sojourner public demo: one story, Canopy theme, deterministic fictional data,
// recorded from the production web build. Outputs land in build/demo/.
// Run with `npm run demo:record`.
import { chromium, expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPwaServer, type PwaServer } from "../../tests/pwa/support/server";
import { distPwa, waitForRuntime } from "../../tests/pwa/support/fixtures";
import { DEMO_EMPLOYER, DEMO_JOB_TITLE, TARGET_TRACK, prepareDemoContext, seedDemo } from "./fixture";
import { caption, freezeFrame, glideClick, glideTo, installCursor, installTitleCard, releaseFrame, removeTitleCard, scrollToElement, scrollToTop, waitForDemoReady, waitForLayoutStable, type DemoReadyExpectations } from "./ready";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.JOB_RANGER_DEMO_OUT ?? path.resolve(here, "..", "..", "build", "demo");
const shots = path.join(out, "screenshots");
const executablePath = process.env.JOB_RANGER_PW_CHROMIUM || undefined;
const VIEWPORT = { width: 1600, height: 900 };
const FIND_JOBS = "Spend your time on the jobs that look worth it.";

type Mark = (beat: string) => void;

function watchProblems(page: Page, problems: string[]): void {
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
}

const hold = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Sidebar navigation filmed as a cross-fade from the last ready frame to the next ready page. */
async function nav(page: Page, label: string, ready: DemoReadyExpectations): Promise<void> {
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const groupName = ["Career Profile", "Career Evidence", "Career Stories", "Target Tracks", "Resume"].includes(label)
    ? "My Career"
    : ["Companies", "Filters", "Search Insights"].includes(label) ? "Search Tools" : null;
  if (groupName) {
    const toggle = navigation.getByRole("button", { name: groupName });
    if (await toggle.getAttribute("aria-expanded") !== "true") {
      await toggle.click();
      await waitForLayoutStable(page);
    }
  }
  const link = navigation.getByRole("link", { name: label, exact: true });
  await glideTo(page, link);
  await freezeFrame(page);
  await page.mouse.down();
  await page.mouse.up();
  await waitForDemoReady(page, ready);
  await scrollToTop(page);
  await waitForLayoutStable(page);
  await releaseFrame(page);
}

async function shot(page: Page, name: string): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "canopy");
  await page.screenshot({ path: path.join(shots, name) });
}

async function seedOffCamera(server: PwaServer, profile: string, problems: string[]): Promise<void> {
  const seeding = await chromium.launchPersistentContext(profile, { viewport: VIEWPORT, executablePath });
  await prepareDemoContext(seeding);
  const page = seeding.pages()[0] ?? (await seeding.newPage());
  watchProblems(page, problems);
  await page.goto(server.url);
  await waitForRuntime(page);
  await seedDemo(page);
  await seeding.close();
}

async function careerDirection(page: Page, mark: Mark): Promise<void> {
  await waitForDemoReady(page, { route: "#/target-tracks", heading: "Keep different career directions separate.", content: [TARGET_TRACK, "Patient services (current)"] });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "canopy");
  mark("title");
  await hold(page, 2700);
  await removeTitleCard(page);
  await page.mouse.move(820, 470);
  mark("career-direction");
  await caption(page, "Start with where you want to go.");
  await hold(page, 800);
  await glideClick(page, page.getByRole("button", { name: new RegExp(`^${TARGET_TRACK}`) }).first());
  await expect(page.getByRole("heading", { name: TARGET_TRACK, exact: true })).toBeVisible();
  await waitForLayoutStable(page);
  await shot(page, "01-career-direction.png");
  await hold(page, 4000);
}

async function findJobs(page: Page, mark: Mark): Promise<void> {
  await caption(page, null);
  mark("find-jobs");
  await nav(page, "Find Jobs", { route: "#/jobs", heading: FIND_JOBS, content: [DEMO_JOB_TITLE, DEMO_EMPLOYER] });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "canopy");
  await hold(page, 2000);
}

/** The opportunity assessment opens as a modal drawer over Find Jobs. */
function assessmentDrawer(page: Page) {
  return page.getByRole("dialog", { name: `Opportunity assessment: ${DEMO_JOB_TITLE}` });
}

async function assessment(page: Page, mark: Mark): Promise<void> {
  const toggle = page.getByRole("button", { name: /Opportunity assessment/ }).first();
  await glideClick(page, toggle);
  const drawer = assessmentDrawer(page);
  await expect(drawer.getByText("Eligibility and blockers", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Evidence coverage", { exact: true })).toBeVisible();
  for (const badge of ["Eligibility · Unclear", "Evidence · Partial", "Career · Aligned", "Preferences · Mixed"]) {
    await expect(drawer.getByText(badge, { exact: true })).toBeVisible();
  }
  await expect(drawer.getByText(/Epic EHR/).filter({ visible: true }).first()).toBeVisible();
  await waitForLayoutStable(page);
  mark("assessment");
  await caption(page, "Separate evidence, alignment, blockers, preferences, and unknowns.");
  await shot(page, "02-opportunity-assessment.png");
  await hold(page, 7000);
  mark("evidence-coverage");
  await scrollToElement(page, drawer.getByText("Evidence coverage", { exact: true }), 24);
  await hold(page, 5000);
  // The drawer is modal: close it before the sidebar can be used again.
  await glideClick(page, drawer.getByRole("button", { name: `Close Opportunity assessment: ${DEMO_JOB_TITLE}` }));
  await expect(drawer).toBeHidden();
  await waitForLayoutStable(page);
}

async function careerEvidence(page: Page, mark: Mark): Promise<void> {
  await caption(page, null);
  mark("career-evidence");
  await nav(page, "Career Evidence", { route: "#/career-evidence/new", heading: "Build your career evidence one fact at a time.", content: ["Review and correct confirmed evidence"] });
  await scrollToElement(page, page.locator("#current-evidence-heading"), 24);
  await caption(page, "Keep every claim grounded in work you can support.");
  await hold(page, 4200);
}

async function prepareResume(page: Page, mark: Mark): Promise<void> {
  await caption(page, null);
  mark("prepare-resume");
  await nav(page, "Find Jobs", { route: "#/jobs", heading: FIND_JOBS, content: [DEMO_JOB_TITLE] });
  await glideClick(page, page.getByRole("button", { name: /Opportunity assessment/ }).first());
  const button = assessmentDrawer(page).getByRole("button", { name: "Prepare resume" });
  await expect(button).toBeAttached();
  await waitForLayoutStable(page);
  await scrollToElement(page, button, 360);
  await expect(button).toBeInViewport();
  await caption(page, "Prepare and track the opportunities you deliberately choose.");
  await hold(page, 600);
  await glideTo(page, button);
  await freezeFrame(page);
  await page.mouse.down();
  await page.mouse.up();
  await waitForDemoReady(page, { route: "#/resume", heading: "Build the document from facts you have actually confirmed.", content: ["Targeting tracked job"] });
  await scrollToTop(page);
  await waitForLayoutStable(page);
  await releaseFrame(page);
  mark("resume-ready");
  const email = page.getByLabel("Email", { exact: true });
  await glideClick(page, email);
  await email.pressSequentially("morgan.rivera@example.org", { delay: 12 });
  mark("email-typed");
  const create = page.getByRole("button", { name: "Create truthful draft" });
  await scrollToElement(page, create, 850);
  await glideClick(page, create);
  await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
  mark("draft-created");
  await waitForLayoutStable(page);
  await scrollToElement(page, page.getByText("Truth Gate passed", { exact: true }), 140);
  await hold(page, 800);
  const exportButton = page.getByRole("button", { name: "Export verified PDF" });
  await scrollToElement(page, exportButton, 520);
  await glideClick(page, exportButton);
  await expect(page.getByRole("button", { name: /Download file|Show file/ }).first()).toBeVisible();
  mark("exported");
  await waitForLayoutStable(page);
  await hold(page, 700);
}

/** Scrolls Applications so the status filters, the tracked job and its linked resume file all show. */
async function showLinkedResume(page: Page): Promise<void> {
  await scrollToElement(page, page.getByText("Focus your applications", { exact: true }), 24);
  const file = page.locator("main").getByText(/^PDF v1 · /).first();
  await expect(file).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("combobox", { name: `Application status for ${DEMO_JOB_TITLE}` })).toBeInViewport({ ratio: 1 });
}

async function organizedApplication(page: Page, mark: Mark): Promise<void> {
  mark("application");
  await nav(page, "Applications", { route: "#/applications", heading: "Keep track of what happens after a job looks promising.", content: [DEMO_JOB_TITLE] });
  const status = page.getByRole("combobox", { name: `Application status for ${DEMO_JOB_TITLE}` });
  await glideClick(page, status);
  await status.selectOption("applied");
  await expect(status).toHaveValue("applied");
  await glideClick(page, page.getByRole("button", { name: /Application details/ }).first());
  await expect(page.getByText("Submitted files", { exact: false }).filter({ visible: true }).first()).toBeVisible();
  await waitForLayoutStable(page);
  await showLinkedResume(page);
  await shot(page, "03-deliberate-application.png");
  await hold(page, 2000);
  mark("closing");
  await caption(page, "Local-first Career Ops. Quality over quantity.");
  await page.mouse.move(1520, 110, { steps: 18 });
  await hold(page, 4000);
  mark("end");
}

async function recordStory(server: PwaServer, profile: string, problems: string[], beats: Record<string, number>): Promise<void> {
  const videoDir = path.join(out, "raw-video");
  const context = await chromium.launchPersistentContext(profile, { viewport: VIEWPORT, executablePath, recordVideo: { dir: videoDir, size: VIEWPORT } });
  const started = Date.now();
  const mark: Mark = (beat) => (beats[beat] = (Date.now() - started) / 1000);
  await prepareDemoContext(context);
  await installTitleCard(context, "Find the opportunities actually worth pursuing.", "Sojourner · local-first Career Ops");
  await installCursor(context);
  const page = context.pages()[0] ?? (await context.newPage());
  watchProblems(page, problems);
  await page.goto(`${server.url}#/target-tracks`);
  await waitForRuntime(page);
  for (const beat of [careerDirection, findJobs, assessment, careerEvidence, prepareResume, organizedApplication]) await beat(page, mark);
  const video = page.video();
  await context.close();
  // saveAs needs a live browser; a closed persistent context leaves the finished file at path().
  copyFileSync(await video!.path(), path.join(out, "video.webm"));
  rmSync(videoDir, { recursive: true, force: true });
}

function reviewVideo(beats: Record<string, number>): void {
  const transitions = Object.values(beats).flatMap((t) => [t, t + 1.5]).map((t) => t.toFixed(2));
  execFileSync(process.execPath, [path.join(here, "frames.mjs"), path.join(out, "video.webm"), path.join(out, "frames"), "1", ...transitions], { stdio: "inherit" });
  const review = JSON.parse(readFileSync(path.join(out, "frames", "frames.json"), "utf8"));
  writeFileSync(path.join(out, "demo-report.json"), JSON.stringify({ theme: "canopy", viewport: VIEWPORT, beats, video: review.meta }, null, 2));
  expect(review.meta.width).toBe(VIEWPORT.width);
  expect(review.meta.height).toBe(VIEWPORT.height);
  expect(review.meta.duration).toBeGreaterThanOrEqual(60);
  expect(review.meta.duration).toBeLessThanOrEqual(90);
  expect(review.report.filter((frame: { nearBlank: boolean }) => frame.nearBlank)).toEqual([]);
}

test("sojourner public demo", async () => {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  const server = await startPwaServer(distPwa);
  const profile = mkdtempSync(path.join(os.tmpdir(), "job-ranger-demo-"));
  const problems: string[] = [];
  const beats: Record<string, number> = {};
  try {
    await seedOffCamera(server, profile, problems);
    await recordStory(server, profile, problems, beats);
    expect(problems, problems.join("\n")).toEqual([]);
    reviewVideo(beats);
  } finally {
    await server.close();
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      // The browser may still hold its log file on Windows; the profile is in the OS temp directory.
    }
  }
});
