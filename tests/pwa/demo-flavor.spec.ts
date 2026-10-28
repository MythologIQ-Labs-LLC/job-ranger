// Demo flavor of the web app (npm run build:pwa:demo -> dist-pwa-demo/), served on
// its own origin, separately from the standard build. Each browser session gets a
// freshly reset, seeded, fictional workspace; reloads keep the session's data; the
// standard build has none of this.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, distPwaDemo, projectRoot, waitForRuntime } from "./support/fixtures";

const PRIMARY = "Practice Operations Coordinator";
const HOURLY = "Patient Access Representative";
const TRACKED = "Clinic Operations Coordinator";
const DEMO_BADGE = "Demo listing — fictional, not a real opening";
const SESSION_KEY = "job-ranger.demo.session.v1";

function readBuildInfo(dist: string): { buildId: string; flavor?: string } | null {
  try {
    return JSON.parse(readFileSync(path.join(dist, "build-info.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Builds the demo flavor when it is missing or does not match the standard build under test. */
function ensureDemoBuild(): void {
  const standard = readBuildInfo(distPwa);
  const demo = readBuildInfo(distPwaDemo);
  const current = demo?.flavor === "demo" && standard && demo.buildId === `${standard.buildId}.demo`;
  if (current && existsSync(path.join(distPwaDemo, "index.html"))) return;
  const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "pwa-demo.mjs"), "build"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`demo build failed:\n${result.stdout}\n${result.stderr}`);
}

let demoServer: PwaServer;
let standardServer: PwaServer;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  ensureDemoBuild();
  // Two servers = two origins: the demo never shares origin-private storage with a real workspace.
  demoServer = await startPwaServer(distPwaDemo);
  standardServer = await startPwaServer(distPwa);
});

test.afterAll(async () => {
  await demoServer?.close();
  await standardServer?.close();
});

/** Every request must stay on the page's own origin: no analytics, no listing fetches. */
function recordForeignRequests(context: BrowserContext, origin: string): string[] {
  const foreign: string[] = [];
  context.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (new URL(url).origin !== origin) foreign.push(`${request.method()} ${url}`);
  });
  return foreign;
}

async function openDemo(page: Page, route = ""): Promise<void> {
  await page.goto(demoServer.url + route);
  await waitForRuntime(page);
  await expect(page.getByTestId("demo-banner")).toBeVisible();
}

async function workspaceSummary(page: Page) {
  return page.evaluate(async () => {
    const api = window.electronAPI;
    const [profile, tracks, evidence, jobs, applications, companies] = await Promise.all([
      api.career.getProfile(),
      api.career.listTargetTracks(),
      api.career.listEvidence(),
      api.jobs.list(),
      api.applications.list(),
      api.companies.list(),
    ]);
    return {
      profileName: profile?.fullName ?? null,
      tracks: tracks.map((track) => track.name),
      evidence: evidence.map((item) => item.evidence.statement),
      jobs: jobs.map((job) => job.title).sort(),
      applications: applications.map((application) => `${application.title}:${application.status}`),
      companies: companies.map((company) => `${company.name}:${company.sourceType}:${company.isActive}`),
    };
  });
}

const SEEDED = {
  profileName: "Morgan Rivera",
  tracks: ["Practice operations"],
  jobs: [TRACKED, HOURLY, PRIMARY].sort(),
  applications: [`${TRACKED}:applied`],
  companies: ["Harbor Health:unsupported:false"],
};

async function addEvidence(page: Page, statement: string): Promise<void> {
  await page.evaluate(
    (text) =>
      window.electronAPI.career.createUserEvidence({
        subjectType: "achievement",
        organization: "Visitor test",
        titleOrName: "Session marker",
        startDate: "2026-01",
        endDate: null,
        statement: text,
        skills: [],
        methodsOrTools: [],
        scope: [],
        outcomes: [],
        metrics: [],
        credential: null,
      } as never),
    statement,
  );
}

test("first visit opens a labeled, seeded demo workspace that runs the real flows", async ({ page, context }) => {
  const foreign = recordForeignRequests(context, new URL(demoServer.url).origin);
  const opened: string[] = [];
  context.on("page", (popup) => opened.push(popup.url()));
  await openDemo(page);

  await expect(page).toHaveTitle("Sojourner Demo");
  const banner = page.getByTestId("demo-banner");
  await expect(banner).toContainText("fictional sample data");
  await expect(banner).toContainText("stays in this browser on this site");
  // Accurate about when entries go away: not on tab close, but at the next session or after idling.
  await expect(banner).toContainText("until a new demo session starts");
  await expect(banner).toContainText("unused for 8 hours");
  await expect(banner).toContainText("replaced with fresh sample data");
  await expect(banner).toContainText("use Reset demo or clear this site's data");
  await expect(banner).not.toContainText("erased when");
  await expect(banner.getByRole("button", { name: "Reset demo" })).toBeVisible();
  // Pre-seeded: onboarding is skipped and the dashboard is the landing page.
  await expect(page.locator("main h1").first()).toContainText("Your next steps");
  expect(await workspaceSummary(page)).toMatchObject(SEEDED);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).not.toBeNull();

  await page.goto(demoServer.url + "#/target-tracks");
  await expect(page.getByText("Practice operations").first()).toBeVisible();

  // Find Jobs: every seeded listing is labeled; annual and hourly pay; City, ST locations.
  await page.goto(demoServer.url + "#/jobs");
  await expect(page.getByRole("status").filter({ hasText: "Showing 3 of 3 captured listings" })).toBeVisible();
  await expect(page.getByTestId("demo-listing-badge")).toHaveCount(3);
  const primary = page.locator("article").filter({ has: page.getByRole("button", { name: PRIMARY, exact: true }) });
  await expect(page.locator("article").first()).toContainText(PRIMARY);
  await expect(primary).toContainText(DEMO_BADGE);
  await expect(primary).toContainText("Baltimore, MD");
  await expect(primary).toContainText(/\$56,000\s*-\s*\$66,000.*year/i);
  const hourly = page.locator("article").filter({ has: page.getByRole("button", { name: HOURLY, exact: true }) });
  await expect(hourly).toContainText("Towson, MD");
  await expect(hourly).toContainText(/\$21\.50\s*-\s*\$25\.00.*hour/i);

  // Opening a demo listing explains instead of navigating.
  await primary.getByRole("button", { name: PRIMARY, exact: true }).click();
  await expect(primary.getByTestId("demo-listing-link-message")).toContainText("fictional demo listing");
  expect(page.url()).toBe(demoServer.url + "#/jobs");

  // The real deterministic assessment: supported and unsupported requirements.
  await primary.getByRole("button", { name: /Opportunity assessment/ }).click();
  const drawer = page.getByRole("dialog", { name: `Opportunity assessment: ${PRIMARY}` });
  await expect(drawer.getByText("Evidence coverage", { exact: true })).toBeVisible();
  await expect(drawer.getByTestId("demo-listing-badge")).toBeVisible();
  await expect(drawer.getByText("Supported", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText("Gap", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText(/Epic EHR/).first()).toBeVisible();

  // The real resume flow produces a verified PDF from the seeded Career Evidence.
  await drawer.getByRole("button", { name: "Prepare resume" }).click();
  await expect(page).toHaveURL(/#\/resume\?job=/);
  await expect(page.getByText("Targeting tracked job", { exact: false })).toBeVisible();
  await expect(page.getByTestId("demo-listing-badge").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Morgan Rivera");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("morgan.rivera@example.org");
  await page.getByRole("button", { name: "Create truthful draft" }).click();
  await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Export verified PDF" }).click();
  await expect(page.getByText("PDF v1", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file" }).first().click();
  const pdf = await readFile(await (await download).path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

  // Applications: the seeded application and the one just prepared are labeled; links explain.
  await page.goto(demoServer.url + "#/applications");
  const tracked = page.locator("article").filter({ has: page.getByRole("button", { name: TRACKED, exact: true }) });
  await expect(tracked).toContainText(DEMO_BADGE);
  await expect(tracked.getByRole("combobox", { name: /Application status for/ })).toHaveValue("applied");
  await tracked.getByRole("button", { name: TRACKED, exact: true }).click();
  await expect(tracked.getByTestId("demo-listing-link-message")).toBeVisible();
  await expect(page.locator("article").filter({ has: page.getByRole("button", { name: PRIMARY, exact: true }) })).toContainText(DEMO_BADGE);

  // The fictional employer is labeled and is not a scannable source.
  await page.goto(demoServer.url + "#/companies");
  await expect(page.getByTestId("demo-source-badge")).toContainText("never scanned");

  // Settings and Help state the demo's limitations.
  for (const route of ["#/settings", "#/help"]) {
    await page.goto(demoServer.url + route);
    const limits = page.getByTestId("demo-limitations");
    await expect(limits).toContainText("About this demo");
    await expect(limits).toContainText("while the browser is closed");
    await expect(limits).toContainText("MCP");
    await expect(limits).toContainText("sync and accounts");
    await expect(limits).toContainText("carry no demo marker");
    await expect(limits).not.toContainText("erased when");
  }
  // No persistence or install advice for a temporary demo workspace.
  await page.goto(demoServer.url + "#/settings");
  await expect(page.getByRole("button", { name: "Request persistent storage" })).toHaveCount(0);
  await expect(page.getByText("has not granted persistent storage", { exact: false })).toHaveCount(0);

  expect(opened, "no demo listing opened a window").toEqual([]);
  expect(foreign, "the demo makes no requests beyond its own origin").toEqual([]);
});

test("a session keeps its data across reloads; a new tab starts from a fresh seeded workspace", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const sessionA = await context.newPage();
    await openDemo(sessionA);
    const marker = `Session A entry ${Date.now()}`;
    await addEvidence(sessionA, marker);
    await sessionA.evaluate(() => localStorage.setItem("job-ranger.visitor-preference", "session-a"));

    await sessionA.reload();
    await waitForRuntime(sessionA);
    await expect(sessionA.getByTestId("demo-banner")).toBeVisible();
    const reloaded = await workspaceSummary(sessionA);
    expect(reloaded.evidence).toContain(marker);
    expect(reloaded).toMatchObject(SEEDED);
    expect(reloaded.evidence).toHaveLength(5);
    expect(await sessionA.evaluate(() => localStorage.getItem("job-ranger.visitor-preference"))).toBe("session-a");
    await sessionA.goto(demoServer.url + "#/career-evidence/new");
    await expect(sessionA.getByText(marker).first()).toBeVisible();

    // Closing the tab ends the session; a new page in the same browser is a new visitor session.
    await sessionA.close();
    const sessionB = await context.newPage();
    await openDemo(sessionB);
    const fresh = await workspaceSummary(sessionB);
    expect(fresh).toMatchObject(SEEDED);
    expect(fresh.evidence).not.toContain(marker);
    expect(fresh.evidence).toHaveLength(4);
    expect(await sessionB.evaluate(() => localStorage.getItem("job-ranger.visitor-preference"))).toBeNull();
    expect(await sessionB.evaluate(() => localStorage.getItem("job-ranger.onboarding.dismissed.v1"))).toBe("true");
  } finally {
    await context.close();
  }
});

async function sessionIdOf(page: Page): Promise<string> {
  const id = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id!;
}

test("a tab never opens a demo workspace another session took over while it waited", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const tabA = await context.newPage();
    await openDemo(tabA);
    await addEvidence(tabA, "Entered in tab A");

    // Tab B waits on the single-writer lock and says what closing the other tab means.
    const tabB = await context.newPage();
    await tabB.goto(demoServer.url);
    const waiting = tabB.getByTestId("pwa-boot-screen");
    await expect(waiting).toContainText("The Sojourner demo is open in another tab or window");
    await expect(waiting).toContainText("discards that tab's demo changes");

    // A reloads: B (queued first) takes the workspace and starts its own fresh session.
    await tabA.reload();
    await waitForRuntime(tabB);
    const inB = await workspaceSummary(tabB);
    expect(inB).toMatchObject(SEEDED);
    expect(inB.evidence).not.toContain("Entered in tab A");
    await addEvidence(tabB, "Entered in tab B");
    await expect(tabA.getByTestId("pwa-boot-screen")).toContainText("open in another tab");

    // When B closes, A gets the lock but must not open B's workspace: it starts fresh.
    await tabB.close();
    await waitForRuntime(tabA);
    const inA = await workspaceSummary(tabA);
    expect(inA).toMatchObject(SEEDED);
    expect(inA.evidence).not.toContain("Entered in tab B");
    expect(inA.evidence).not.toContain("Entered in tab A");
    expect(inA.evidence).toHaveLength(4);
  } finally {
    await context.close();
  }
});

test("a restored tab (same session id) does not reopen a workspace a later session owns", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const original = await context.newPage();
    await openDemo(original);
    const originalSession = await sessionIdOf(original);
    await original.close();

    const later = await context.newPage();
    await openDemo(later);
    expect(await sessionIdOf(later)).not.toBe(originalSession);
    await addEvidence(later, "Entered by the later session");
    await later.close();

    // Ctrl+Shift+T / session restore brings back the original tab's sessionStorage.
    const restored = await context.newPage();
    await restored.addInitScript(
      ([key, id]) => {
        if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, id);
      },
      [SESSION_KEY, originalSession] as const,
    );
    await openDemo(restored);
    expect(await sessionIdOf(restored)).toBe(originalSession);
    const summary = await workspaceSummary(restored);
    expect(summary).toMatchObject(SEEDED);
    expect(summary.evidence).not.toContain("Entered by the later session");
  } finally {
    await context.close();
  }
});

test("the demo refuses to erase a non-demo workspace on its origin, which stays intact", async ({ browser }) => {
  // One origin that first serves the standard app, then the demo build (a mis-deployment,
  // or the demo served on a real workspace's address).
  const shared = await startPwaServer(distPwa);
  const context = await browser.newContext();
  const dropShell = async (page: Page) =>
    page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
    });
  try {
    await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
    const real = await context.newPage();
    await real.goto(shared.url);
    await waitForRuntime(real);
    await addEvidence(real, "Real workspace entry");
    await real.evaluate(() => window.electronAPI.career.saveProfile({
      version: 2, fullName: "Real Person", homeLocation: "Towson, MD", radiusMiles: 10, minimumPay: null, payBasis: "hourly",
      targetTitles: [], skills: [], certifications: [], sectors: [], onCallPreference: "either", fullTimeOnly: true, updatedAt: null,
    } as never));
    await dropShell(real);
    await real.close();

    shared.setRoot(distPwaDemo);
    const demo = await context.newPage();
    await demo.goto(shared.url);
    await expect(demo).toHaveTitle("Sojourner Demo");
    await expect(demo.getByTestId("pwa-boot-error")).toHaveText(
      "This site holds a Sojourner workspace that is not a demo; the demo will not erase it.",
    );
    await expect(demo.getByRole("heading", { name: "The Sojourner demo cannot start on this site" })).toBeVisible();
    await expect(demo.getByTestId("demo-banner")).toHaveCount(0);
    // Reloading (same session) or a new tab (new session) refuses the same way.
    await demo.reload();
    await expect(demo.getByTestId("pwa-boot-error")).toContainText("the demo will not erase it");
    await dropShell(demo);
    await demo.close();

    shared.setRoot(distPwa);
    const back = await context.newPage();
    await back.goto(shared.url);
    await waitForRuntime(back);
    const intact = await workspaceSummary(back);
    expect(intact.profileName).toBe("Real Person");
    expect(intact.evidence).toEqual(["Real workspace entry"]);
    expect(intact.jobs).toEqual([]);
    expect(intact.companies).toEqual([]);
  } finally {
    await context.close();
    await shared.close();
  }
});

test("Reset demo wipes the session's changes and reseeds immediately", async ({ page }) => {
  await openDemo(page);
  const sessionBefore = await sessionIdOf(page);
  const marker = `Entered before reset ${Date.now()}`;
  await addEvidence(page, marker);
  await page.evaluate(() => window.electronAPI.applications.list().then((apps) => window.electronAPI.applications.delete(apps[0].id)));
  const changed = await workspaceSummary(page);
  expect(changed.evidence).toContain(marker);
  expect(changed.applications).toEqual([]);

  await page.getByTestId("demo-banner").getByRole("button", { name: "Reset demo" }).click();
  const confirm = page.getByRole("dialog", { name: "Reset the demo workspace?" });
  await expect(confirm).toBeVisible();
  await Promise.all([
    page.waitForEvent("load"),
    confirm.getByRole("button", { name: "Reset demo" }).click(),
  ]);
  await waitForRuntime(page);
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  expect(await sessionIdOf(page)).not.toBe(sessionBefore);
  const reset = await workspaceSummary(page);
  expect(reset).toMatchObject(SEEDED);
  expect(reset.evidence).not.toContain(marker);
  expect(reset.evidence).toHaveLength(4);
});

test("the demo banner and pages fit a 375px phone without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDemo(page);
  for (const route of ["#/", "#/jobs", "#/applications", "#/settings", "#/help"]) {
    await page.goto(demoServer.url + route);
    const banner = page.getByTestId("demo-banner");
    await expect(banner).toBeVisible();
    await expect(page.locator("main h1").first()).toBeVisible();
    const box = await banner.boundingBox();
    expect(box, route).not.toBeNull();
    expect(box!.x, route).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, route).toBeLessThanOrEqual(375);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(0);
  }
});

test("the standard build has no demo banner, seeds nothing and never resets between sessions", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
    const first = await context.newPage();
    await first.goto(standardServer.url);
    await waitForRuntime(first);
    await expect(first).toHaveTitle("Sojourner");
    await expect(first.getByTestId("demo-banner")).toHaveCount(0);
    await expect(first.getByText("Demo workspace", { exact: false })).toHaveCount(0);
    const empty = await workspaceSummary(first);
    expect(empty).toMatchObject({ profileName: null, jobs: [], applications: [], companies: [], evidence: [] });
    expect(await first.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
    for (const route of ["#/settings", "#/help"]) {
      await first.goto(standardServer.url + route);
      await expect(first.locator("main h1").first()).toBeVisible();
      await expect(first.getByTestId("demo-limitations")).toHaveCount(0);
    }

    const marker = `Standard entry ${Date.now()}`;
    await addEvidence(first, marker);
    await first.close();
    // A new tab (new browser session for sessionStorage) keeps the real workspace.
    const second = await context.newPage();
    await second.goto(standardServer.url);
    await waitForRuntime(second);
    await expect(second.getByTestId("demo-banner")).toHaveCount(0);
    expect((await workspaceSummary(second)).evidence).toEqual([marker]);
  } finally {
    await context.close();
  }
});
