// Records "The Right Next Step" from the INSTALLED signed Sojourner Windows app. Jordan's workspace is
// seeded in a first, unfilmed launch; a second launch on the same disposable data folder is filmed.
// Each scene holds at least as long as its narration (FILM_VO_TIMING: scene -> seconds), so the edit
// never has to speed up a line or freeze the picture under it.
//   FILM_VO_TIMING=<json> SOJOURNER_FILM_OUT=<dir> npx playwright test --config scripts/demo/windows/playwright.windows.config.ts record
import { expect, test, type Locator, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEMO_EMPLOYER, DEMO_JOB_TITLE, TARGET_TRACK, seedDemo } from "../fixture";
import { freezeFrame, glideClick, glideTo, releaseFrame, scrollToElement, scrollToTop, waitForDemoReady, waitForLayoutStable, type DemoReadyExpectations } from "../ready";
import { buildIdentity, demoRequests, launchInstalled } from "./installed-app";

const out = process.env.SOJOURNER_FILM_OUT ?? path.resolve("build", "film", "capture");
const vo: Record<string, number> = JSON.parse(readFileSync(process.env.FILM_VO_TIMING ?? "vo-timing.json", "utf8"));
const VO_LEAD = 0.6; // narration starts this long after a scene's mark
const SCENE_TAIL = 0.9; // breathing room after a line before the next scene
const FIND_JOBS = "Spend your time on the jobs that look worth it.";
const NEXT_STEP = "Ask Harbor Health about Epic training";

interface Clock { start: number; marks: Record<string, number>; scene: string; sceneAt: number }
const clock: Clock = { start: 0, marks: {}, scene: "", sceneAt: 0 };
const now = () => (Date.now() - clock.start) / 1000;
function mark(name: string): void {
  clock.marks[name] = now();
}
function scene(name: string): void {
  clock.scene = name;
  clock.sceneAt = now();
  mark(name);
}
/** Holds until the current scene's narration (plus a tail) has finished. */
async function holdForLine(page: Page, extra = 0): Promise<void> {
  const until = clock.sceneAt + VO_LEAD + (vo[clock.scene] ?? 0) + SCENE_TAIL + extra;
  const wait = (until - now()) * 1000;
  if (wait > 0) await page.waitForTimeout(wait);
}
const hold = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);

/** Same visible cursor as the PWA film: the screencast has none of its own. */
async function installCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById("demo-cursor")) return;
    const dot = document.createElement("div");
    dot.id = "demo-cursor";
    Object.assign(dot.style, {
      position: "fixed", left: "-40px", top: "-40px", width: "22px", height: "22px", marginLeft: "-11px", marginTop: "-11px",
      borderRadius: "999px", background: "rgba(255, 255, 255, 0.4)", border: "2px solid rgba(16, 38, 28, 0.9)",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)", zIndex: "2147483645", pointerEvents: "none", transition: "transform 120ms ease",
    });
    document.body.appendChild(dot);
    window.addEventListener("mousemove", (event) => {
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
    }, true);
    window.addEventListener("mousedown", () => (dot.style.transform = "scale(0.75)"), true);
    window.addEventListener("mouseup", () => (dot.style.transform = "scale(1)"), true);
  });
}

/** A one-second black frame whose end is the timeline's zero: the edit finds it with blackdetect. */
async function syncFlash(page: Page): Promise<void> {
  await page.evaluate(() => {
    const black = document.createElement("div");
    black.id = "demo-sync";
    Object.assign(black.style, { position: "fixed", inset: "0", background: "#000", zIndex: "2147483647" });
    document.documentElement.appendChild(black);
  });
  await hold(page, 1.0);
  await page.evaluate(() => document.getElementById("demo-sync")?.remove());
  clock.start = Date.now();
}

/** Points at an element from just left of it, so the cursor never sits on the words being read. */
async function pointAt(page: Page, locator: Locator, steps = 20): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("pointAt: target has no box");
  await page.mouse.move(Math.max(4, box.x - 16), box.y + box.height / 2, { steps });
  await page.waitForTimeout(200);
}

async function nav(page: Page, label: string, ready: DemoReadyExpectations): Promise<void> {
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const groupName = ["Career Profile", "Career Evidence", "Career Stories", "Target Tracks", "Resume"].includes(label) ? "My Career" : null;
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

function drawer(page: Page) {
  return page.getByRole("dialog", { name: `Opportunity assessment: ${DEMO_JOB_TITLE}` });
}

async function s01(page: Page): Promise<void> {
  scene("S01");
  await page.mouse.move(470, 640, { steps: 12 });
  await holdForLine(page);
}

async function s02(page: Page): Promise<void> {
  scene("S02");
  await glideClick(page, page.getByRole("button", { name: new RegExp(`^${TARGET_TRACK}`) }).first());
  await expect(page.getByRole("heading", { name: TARGET_TRACK, exact: true })).toBeVisible();
  await waitForLayoutStable(page);
  await hold(page, 2.6);
  mark("S02-preferences");
  await scrollToElement(page, page.getByRole("heading", { name: "Where I can work" }), 24);
  await page.mouse.move(1100, 520, { steps: 14 });
  await holdForLine(page);
}

async function s03(page: Page): Promise<void> {
  await nav(page, "Find Jobs", { route: "#/jobs", heading: FIND_JOBS, content: [DEMO_JOB_TITLE, DEMO_EMPLOYER] });
  scene("S03");
  await hold(page, 1.8);
  await glideClick(page, page.getByRole("button", { name: /Opportunity assessment/ }).first());
  const d = drawer(page);
  for (const badge of ["Eligibility · Unclear", "Evidence · Partial", "Career · Aligned", "Preferences · Mixed"]) {
    await expect(d.getByText(badge, { exact: true })).toBeVisible();
  }
  await waitForLayoutStable(page);
  await page.mouse.move(1200, 860, { steps: 14 });
  mark("S03-assessment");
  // "But there's a catch": the cursor settles on the Epic EHR blocker while the line says it.
  const until = clock.sceneAt + VO_LEAD + (vo.S03 ?? 0) * 0.55 - now();
  if (until > 0) await hold(page, until);
  mark("S03-epic");
  await pointAt(page, d.getByText(/hands-on Epic EHR experience \(no confirmed support\)/).first(), 22);
  await holdForLine(page, 1.2);
}

async function s04(page: Page): Promise<void> {
  const d = drawer(page);
  await glideClick(page, d.getByRole("button", { name: `Close Opportunity assessment: ${DEMO_JOB_TITLE}` }));
  await expect(d).toBeHidden();
  await nav(page, "Career Evidence", { route: "#/career-evidence/new", heading: "Build your career evidence one fact at a time.", content: ["Review and correct confirmed evidence"] });
  await scrollToElement(page, page.locator("#current-evidence-heading"), 24);
  scene("S04");
  await page.mouse.move(1150, 760, { steps: 16 });
  await holdForLine(page);
}

async function s05(page: Page): Promise<void> {
  await nav(page, "Find Jobs", { route: "#/jobs", heading: FIND_JOBS, content: [DEMO_JOB_TITLE] });
  await glideClick(page, page.getByRole("button", { name: /Opportunity assessment/ }).first());
  const d = drawer(page);
  // Passing the coverage list on the way: 3 supported, 1 transferable, 2 gaps (Epic EHR among them).
  await scrollToElement(page, d.getByText("Evidence coverage", { exact: true }), 24);
  // "With those facts...": the line starts on the coverage list (facts matched to requirements, gaps
  // included), so "Its truth check..." arrives as the Truth Gate result does.
  scene("S05");
  mark("S05-coverage");
  await hold(page, 2.2);
  const button = d.getByRole("button", { name: "Prepare resume" });
  await scrollToElement(page, button, 360);
  await glideTo(page, button);
  await freezeFrame(page);
  await page.mouse.down();
  await page.mouse.up();
  await waitForDemoReady(page, { route: "#/resume", heading: "Build the document from facts you have actually confirmed.", content: ["Targeting tracked job"] });
  await scrollToTop(page);
  await waitForLayoutStable(page);
  await releaseFrame(page);
  mark("S05-resume");
  const email = page.getByLabel("Email", { exact: true });
  await glideClick(page, email);
  await email.pressSequentially("jordan.ellis@example.org", { delay: 8 });
  const create = page.getByRole("button", { name: "Create truthful draft" });
  await scrollToElement(page, create, 850);
  await glideClick(page, create);
  await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
  await waitForLayoutStable(page);
  await scrollToElement(page, page.getByText("Truth Gate passed", { exact: true }), 140);
  mark("S05-truth-gate");
  await pointAt(page, page.getByText("Truth Gate passed", { exact: true }));
  await hold(page, 2.4);
  const exportButton = page.getByRole("button", { name: "Export verified PDF" });
  await scrollToElement(page, exportButton, 520);
  await glideClick(page, exportButton);
  await expect(page.getByRole("button", { name: /Download file|Show file/ }).first()).toBeVisible();
  mark("S05-exported");
  await waitForLayoutStable(page);
  await holdForLine(page, 0.2);
}

async function s06(page: Page): Promise<void> {
  scene("S06");
  await nav(page, "Applications", { route: "#/applications", heading: "Keep track of what happens after a job looks promising.", content: [DEMO_JOB_TITLE] });
  const status = page.getByRole("combobox", { name: `Application status for ${DEMO_JOB_TITLE}` });
  await expect(status).toHaveValue("interested");
  await scrollToElement(page, page.getByText("Focus your applications", { exact: true }), 24);
  mark("S06-tracked");
  await glideTo(page, status);
  await hold(page, 1.6);
  await glideClick(page, page.getByRole("button", { name: /Application details/ }).first());
  await expect(page.getByText("Resume versions", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await waitForLayoutStable(page);
  await scrollToElement(page, page.getByText("Resume versions", { exact: true }).filter({ visible: true }).first(), 60);
  mark("S06-resume-linked");
  await hold(page, 1.4);
  await glideClick(page, page.getByRole("button", { name: "Add event" }).first());
  await page.getByLabel("Event type").selectOption("follow-up");
  const title = page.getByLabel("Event title");
  await glideClick(page, title);
  await title.pressSequentially(NEXT_STEP, { delay: 14 });
  await page.getByLabel("Event time").fill("2026-11-06T10:00");
  mark("S06-next-step-typed");
  await glideClick(page, page.getByRole("button", { name: "Save event" }));
  await expect(page.getByText(NEXT_STEP).first()).toBeVisible();
  await waitForLayoutStable(page);
  await scrollToElement(page, page.getByText("Resume versions", { exact: true }).filter({ visible: true }).first(), 60);
  mark("S06-next-step-saved");
  await holdForLine(page);
}

async function s07(page: Page): Promise<void> {
  scene("S07");
  await page.mouse.move(1000, 600, { steps: 20 });
  await pointAt(page, page.getByText(NEXT_STEP).first(), 26);
  await holdForLine(page, 0.8);
  mark("end");
}

test("record the narrated story on the installed Windows app", async () => {
  mkdirSync(out, { recursive: true });
  // 1. Unfilmed: seed Jordan's workspace into a disposable data folder.
  const seeding = await launchInstalled();
  const identity = await buildIdentity(seeding.app);
  await seedDemo(seeding.page);
  const seedingRequests = await demoRequests(seeding.app);
  await seeding.app.close();
  expect(seeding.problems, seeding.problems.join("\n")).toEqual([]);

  // 2. Filmed: the same folder, the installed app again.
  const videoDir = path.join(out, "raw-video");
  rmSync(videoDir, { recursive: true, force: true });
  const { app, page, problems } = await launchInstalled({ userData: seeding.userData, recordVideoDir: videoDir });
  await page.evaluate(() => (window.location.hash = "#/target-tracks"));
  await waitForDemoReady(page, { route: "#/target-tracks", heading: "Keep different career directions separate.", content: [TARGET_TRACK, "Patient services (current)"] });
  await installCursor(page);
  await page.mouse.move(800, 450);
  await syncFlash(page);
  for (const beat of [s01, s02, s03, s04, s05, s06, s07]) await beat(page);
  const filmedRequests = await demoRequests(app);
  const identityFilmed = await buildIdentity(app);
  // The app also opens a short-lived hidden window; keep the main window's recording.
  const mainVideo = await page.video()!.path();
  await app.close();
  copyFileSync(mainVideo, path.join(out, "installed-app-capture.webm"));
  const otherVideos = readdirSync(videoDir).filter((f) => f.endsWith(".webm") && path.join(videoDir, f) !== mainVideo);
  writeFileSync(path.join(out, "capture-log.json"), JSON.stringify({
    identity, identityFilmed, marks: clock.marks, voLead: VO_LEAD, sceneTail: SCENE_TAIL, voTiming: vo,
    seedingRequests, filmedRequests, problems, otherVideos, recordedAt: new Date().toISOString(),
  }, null, 2));
  expect(problems, problems.join("\n")).toEqual([]);
});
