import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, projectRoot, waitForRuntime } from "./support/fixtures";

let server: PwaServer;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
});

test.afterAll(async () => {
  await server.close();
});

interface UniversalFixture {
  code: string;
  targetTrack: {
    name: string;
    roleTitles: string[];
    constraints: {
      geography: { locations: string[]; radiusMiles: number };
      employmentArrangements: { values: string[] };
      compensation: { floor: number; target: number; basis: "hourly" | "annual" };
    };
  };
  evidence: Array<{ subjectType: string; titleOrName: string; statement: string; skills: string[] }>;
  job: { title: string; location: string; descriptionSnippet: string; salaryText: string };
}

// RT (return-to-work / nonlinear history) is the existing universal fixture
// whose only evidence is volunteer/project work with no employer chronology.
const universal = JSON.parse(
  readFileSync(path.join(projectRoot, "tests/fixtures/universal-careers.v1.json"), "utf8"),
) as { fixtures: UniversalFixture[] };
const rt = universal.fixtures.find((fixture) => fixture.code === "RT")!;
const rtEvidence = rt.evidence[0];
const sourceName = "Severn Community Services";

/**
 * The RT fixture listing, served exactly as the public Greenhouse board API would. RT's own
 * fixture source is SmartRecruiters; Greenhouse carries no employment type, so the listing's
 * arrangement is unknown here by design.
 */
function rtGreenhouseBoard() {
  const html = `<p>${rt.job.descriptionSnippet}</p><p>Pay: ${rt.job.salaryText}.</p>`;
  return {
    jobs: [
      {
        id: 5200301,
        title: rt.job.title,
        absolute_url: "https://boards.greenhouse.io/severn-community/jobs/5200301",
        location: { name: rt.job.location },
        updated_at: "2026-10-01T12:00:00-04:00",
        content: html.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      },
    ],
  };
}

/** Mock ONLY the known public job provider and record anything else that leaves the origin. */
async function routePublicBoard(context: BrowserContext, board: unknown): Promise<string[]> {
  const outbound: string[] = [];
  await context.route("https://boards-api.greenhouse.io/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(board),
    });
  });
  context.on("request", (request) => {
    const url = new URL(request.url());
    const isFixtureRead =
      request.method() === "GET" &&
      url.protocol === "https:" &&
      url.hostname === "boards-api.greenhouse.io";
    if (url.origin !== new URL(server.url).origin && !isFixtureRead) {
      outbound.push(request.method() + " " + request.url());
    }
  });
  return outbound;
}

/** Open supporting destinations without assuming that every link is always expanded. */
async function navigateSidebar(page: Page, destination: string) {
  const group = ["Resume", "Career Profile", "Target Tracks", "Career Evidence", "Career Stories"].includes(destination)
    ? "My Career"
    : ["Companies", "Filters", "Search Insights"].includes(destination) ? "Search Tools" : null;
  if (group) {
    const toggle = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: group });
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  }
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: destination, exact: true }).click();
}

/**
 * B1/B4 Story A (#216): no resume, incremental evidence.
 *
 * Every mutation is a visible UI action: the first-run "Enter my background"
 * choice, the Career Evidence form, Career Profile, Target Tracks, the
 * source dialog/run, and "Track this job". Read-only desktop API getters only
 * observe canonical persistence and provenance. Only the public Greenhouse
 * board read is mocked; nothing is pre-seeded.
 */
test("a person without a resume can author evidence, assess a fixture job and track it", async ({ page, context }) => {
  const outbound = await routePublicBoard(context, rtGreenhouseBoard());

  // First run: choose to build the record by hand, not to import a document.
  await page.goto(server.url + "#/onboarding");
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Start with what you already have." })).toBeVisible();
  await page.getByRole("button", { name: "Enter my background" }).click();
  await expect(page).toHaveURL(/#\/career-evidence\/new$/);
  await expect(page.getByRole("heading", { name: "Build your career evidence one fact at a time." })).toBeVisible();

  // Minimal legitimate volunteer/project evidence. Organization, dates and
  // credentials stay empty; the form must not demand an employer chronology.
  await page.getByRole("combobox", { name: "Evidence type" })
    .selectOption({ label: "Project, freelance, volunteer, or portfolio work" });
  await page.getByRole("textbox", { name: "What did you do, know, earn, or accomplish?" }).fill(rtEvidence.statement);
  await page.getByRole("textbox", { name: "Role, project, credential, or item name" }).fill(rtEvidence.titleOrName);
  await page.getByRole("textbox", { name: "Skills or tools demonstrated" }).fill(rtEvidence.skills.join(", "));
  await page.getByRole("button", { name: "Add career evidence" }).click();
  await expect(page.getByText("Saved as user-authored evidence")).toBeVisible();
  await expect(page.getByRole("button", { name: `Replace evidence: ${rtEvidence.statement}` })).toBeVisible();

  // Provenance: stored as user-authored, with no parser source behind it.
  const authored = await page.evaluate(async () => ({
    items: await window.electronAPI.career.listEvidence(),
    sources: await window.electronAPI.career.listSourceArtifacts(),
  }));
  expect(authored.sources).toEqual([]);
  expect(authored.items).toHaveLength(1);
  expect(authored.items[0].sources).toEqual([]);
  expect(authored.items[0].evidence).toMatchObject({
    subjectType: "project",
    statement: rtEvidence.statement,
    titleOrName: rtEvidence.titleOrName,
    organization: null,
    startDate: null,
    endDate: null,
    verificationState: "user-authored",
  });
  expect(authored.items[0].evidence.skills).toEqual(rtEvidence.skills);
  expect(authored.items[0].evidence.credential ?? null).toBeNull();
  const evidenceId = authored.items[0].evidence.id;

  // Career Profile: only what is known. Name, pay, skills, credentials and
  // sectors are unknown and stay empty rather than being guessed.
  await page.getByRole("button", { name: "Continue to Career Profile" }).click();
  await expect(page).toHaveURL(/#\/career-profile$/);
  await expect(page.getByText("Nothing is waiting for review.")).toBeVisible();
  await page.getByRole("textbox", { name: "Home area" }).fill(rt.job.location);
  await page.getByRole("textbox", { name: "Roles you would consider" }).fill(rt.targetTrack.roleTitles.join("\n"));
  await page.getByRole("button", { name: "Save career profile" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  const profile = await page.evaluate(() => window.electronAPI.career.getProfile());
  expect(profile).toMatchObject({
    fullName: "",
    homeLocation: rt.job.location,
    minimumPay: null,
    targetTitles: rt.targetTrack.roleTitles,
    skills: [],
    certifications: [],
    sectors: [],
  });

  // A straightforward, explicitly authored target track (RT fixture values).
  const track = rt.targetTrack;
  await navigateSidebar(page, "Target Tracks");
  await expect(page.getByRole("heading", { name: "Keep different career directions separate." })).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("textbox", { name: "Track name" }).fill(track.name);
  await page.getByRole("combobox", { name: "Relationship to my career" }).selectOption("target");
  await page.getByRole("textbox", { name: "Roles in this track" }).fill(track.roleTitles.join("\n"));
  // Geography is left empty here; the home area is already recorded in Career
  // Profile, and "City, ST" track locations are covered by the regression
  // test below.
  await page.getByRole("checkbox", { name: "Hybrid" }).check();
  for (const arrangement of ["Full-time", "Part-time"]) {
    await page.getByRole("checkbox", { name: arrangement, exact: true }).check();
  }
  await page.getByRole("spinbutton", { name: "Compensation floor" }).fill(String(track.constraints.compensation.floor));
  await page.getByRole("spinbutton", { name: "Compensation target" }).fill(String(track.constraints.compensation.target));
  await page.getByRole("combobox", { name: "Track pay basis" }).selectOption(track.constraints.compensation.basis);
  await page.getByText("Optional context").click();
  await page.getByRole("combobox", { name: "Track on-call preference" }).selectOption("no");
  await page.getByRole("button", { name: "Save target track" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const savedTrack = await page.evaluate(async (name) =>
    (await window.electronAPI.career.listTargetTracks()).find((item) => item.name === name) ?? null, track.name);
  expect(savedTrack).toMatchObject({
    origin: "user",
    relation: "target",
    roleTitles: track.roleTitles,
    isActive: true,
  });
  expect(savedTrack!.constraints.geography.locations).toEqual([]);
  expect(savedTrack!.constraints.workModes).toEqual({ values: ["hybrid"], strength: "preferred" });
  expect(savedTrack!.constraints.compensation).toMatchObject({
    floor: track.constraints.compensation.floor,
    target: track.constraints.compensation.target,
    basis: track.constraints.compensation.basis,
    floorStrength: "preferred",
  });
  expect(savedTrack!.constraints.onCall).toEqual({ value: "no", strength: "preferred" });
  expect(savedTrack!.constraints.employmentArrangements.values.sort()).toEqual([...track.constraints.employmentArrangements.values].sort());

  // Discovery: the user adds and runs a public board source.
  await navigateSidebar(page, "Companies");
  await page.getByRole("button", { name: "Add a source manually" }).click();
  const sourceDialog = page.getByRole("dialog", { name: "Add job source" });
  await sourceDialog.getByRole("textbox", { name: "Name" }).fill(sourceName);
  await sourceDialog.getByRole("textbox", { name: "Careers or board URL" })
    .fill("https://boards.greenhouse.io/severn-community");
  await sourceDialog.getByRole("checkbox", { name: "Enable local scheduling" }).uncheck();
  await sourceDialog.getByRole("button", { name: "Save source" }).click();
  await expect(sourceDialog).toBeHidden();
  const sourceRow = page.getByRole("row").filter({ hasText: sourceName });
  await sourceRow.getByRole("button", { name: "Run", exact: true }).click();
  await expect(sourceRow).toContainText(/success/i, { timeout: 30_000 });
  await expect(sourceRow.getByRole("button", { name: "Run", exact: true })).toBeEnabled();

  // Evaluate the fixture opportunity against the authored track.
  await navigateSidebar(page, "Find Jobs");
  await page.getByRole("combobox", { name: "Assessment direction" }).selectOption({ label: track.name });
  const job = page.locator("article").filter({ has: page.getByRole("button", { name: rt.job.title, exact: true }) });
  await expect(job).toBeVisible();
  await expect(job).toContainText(sourceName);
  await job.getByRole("button", { name: /Opportunity assessment/ }).click();
  await expect(job.getByText("Evidence coverage", { exact: true })).toBeVisible();

  // Explicit support: the authored volunteer statement is the cited evidence.
  await expect(job.getByText(`Evidence: ${rtEvidence.statement}`).first()).toBeVisible();
  // Blockers: none established; the absence of a resume is not a negative signal.
  await expect(job.getByText("Eligibility and blockers")).toBeVisible();
  await expect(job.getByText("Known blockers")).toHaveCount(0);
  await expect(job.getByText("Potential blockers")).toHaveCount(0);
  await expect(job.getByText("Eligibility · Likely", { exact: true })).toBeVisible();
  await expect(job.getByText(/resume/i).filter({ hasNotText: "Prepare resume" })).toHaveCount(0);
  // Unknowns: a preference the listing cannot answer stays unknown, not a penalty.
  await expect(job.getByText(/does not provide a usable employment arrangement/).first()).toBeVisible();

  const assessment = await page.evaluate(async (title) => {
    const api = window.electronAPI;
    const listing = (await api.jobs.list()).find((item) => item.title === title)!;
    return api.jobs.getEvidenceCoverage(listing.id);
  }, rt.job.title);
  expect(assessment.supportedCount).toBeGreaterThan(0);
  const cited = assessment.items.flatMap((item) => (item.evidence ? [item.evidence.id] : []));
  expect(cited.length).toBeGreaterThan(0);
  expect(new Set(cited)).toEqual(new Set([evidenceId]));

  // Track the job from the listing, then reload the whole app.
  await job.getByRole("button", { name: "Track this job" }).click();
  await expect(page).toHaveURL(/#\/applications$/);
  const application = page.locator("article").filter({ hasText: sourceName });
  await expect(application).toContainText(rt.job.title);

  await page.reload();
  await waitForRuntime(page);
  await expect(page.locator("article").filter({ hasText: sourceName })).toContainText(rt.job.title);

  const persisted = await page.evaluate(async () => {
    const api = window.electronAPI;
    const [applications, evidence, sources, resumes, tracks] = await Promise.all([
      api.applications.list(),
      api.career.listEvidence(),
      api.career.listSourceArtifacts(),
      api.resume.list(),
      api.career.listTargetTracks(),
    ]);
    return { applications, evidence, sources, resumes, tracks };
  });
  expect(persisted.applications.map(({ companyName, title }) => ({ companyName, title })))
    .toEqual([{ companyName: sourceName, title: rt.job.title }]);
  // Still exactly one user-authored fact: no generated CV, no parser output,
  // and no fictitious role/employer added along the way.
  expect(persisted.resumes).toEqual([]);
  expect(persisted.sources).toEqual([]);
  expect(persisted.evidence.map(({ evidence }) => ({
    id: evidence.id,
    subjectType: evidence.subjectType,
    organization: evidence.organization,
    verificationState: evidence.verificationState,
  }))).toEqual([{ id: evidenceId, subjectType: "project", organization: null, verificationState: "user-authored" }]);
  expect(persisted.tracks.find((item) => item.name === track.name)).toMatchObject({ origin: "user", roleTitles: track.roleTitles });

  await navigateSidebar(page, "Career Evidence");
  await expect(page.getByRole("button", { name: `Replace evidence: ${rtEvidence.statement}` })).toBeVisible();

  expect(outbound).toEqual([]);
});

/*
 * Regressions for defects found while qualifying Story A (#216): the list
 * textareas on Target Tracks and Career Profile were re-derived from a parsed
 * array on every keystroke (dropping typed spaces and line breaks) and split
 * entries on commas. They now keep the typed text and read one entry per line
 * (src/components/LineListTextarea.tsx).
 */
test("a target-track location written as \"City, ST\" stays one location", async ({ page }) => {
  await page.goto(server.url + "#/target-tracks");
  await waitForRuntime(page);
  await page.getByRole("textbox", { name: "Track name" }).fill(rt.targetTrack.name);
  await page.getByRole("textbox", { name: "Roles in this track" }).fill(rt.targetTrack.roleTitles.join("\n"));
  await page.getByRole("textbox", { name: "Track locations" }).fill(rt.targetTrack.constraints.geography.locations.join("\n"));
  await page.getByRole("button", { name: "Save target track" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => (await window.electronAPI.career.listTargetTracks())[0]);
  expect(saved.constraints.geography.locations).toEqual(rt.targetTrack.constraints.geography.locations);
});

test("typing into list fields keeps spaces and line breaks", async ({ page }) => {
  await page.goto(server.url + "#/target-tracks");
  await waitForRuntime(page);
  const roles = page.getByRole("textbox", { name: "Roles in this track" });
  await roles.click();
  await roles.pressSequentially("Operations Coordinator");
  await roles.press("Enter");
  await roles.pressSequentially("Office Manager");
  expect.soft(await roles.inputValue()).toBe("Operations Coordinator\nOffice Manager");

  await navigateSidebar(page, "Career Profile");
  const profileRoles = page.getByRole("textbox", { name: "Roles you would consider" });
  await expect(profileRoles).toBeEnabled();
  await profileRoles.click();
  await profileRoles.pressSequentially("Operations Coordinator");
  expect.soft(await profileRoles.inputValue()).toBe("Operations Coordinator");
});
