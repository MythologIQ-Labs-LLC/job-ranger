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
  targetTrack: { roleTitles: string[]; constraints: { geography: { locations: string[] } } };
  evidence: Array<{ subjectType: string; titleOrName: string; statement: string; skills: string[] }>;
  job: { title: string; location: string; descriptionSnippet: string; salaryText: string };
}

// HL (hourly/local worker) is the existing universal fixture whose search is
// defined by an explicit local goal and whose evidence is a single role fact.
const universal = JSON.parse(
  readFileSync(path.join(projectRoot, "tests/fixtures/universal-careers.v1.json"), "utf8"),
) as { fixtures: UniversalFixture[] };
const hl = universal.fixtures.find((fixture) => fixture.code === "HL")!;
const hlEvidence = hl.evidence[0];
const roleGoal = hl.targetTrack.roleTitles[0];
const homeArea = hl.targetTrack.constraints.geography.locations[0];
// Independent constraint vs preference: the person must stay in their home
// area (required) and would like remote work (preferred) but will consider
// on-site roles. The HL listing is on-site in that home area.
const preferredWorkMode = "Remote";
const sourceName = "Chesapeake Outfitters";

/** The HL fixture listing, served exactly as the public Greenhouse board API would. */
function hlGreenhouseBoard() {
  const html = `<p>${hl.job.descriptionSnippet}</p><p>Pay: ${hl.job.salaryText}.</p>`;
  return {
    jobs: [
      {
        id: 5300417,
        title: hl.job.title,
        absolute_url: "https://boards.greenhouse.io/chesapeake-outfitters/jobs/5300417",
        location: { name: hl.job.location },
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

async function addAndRunSource(page: Page) {
  await navigateSidebar(page, "Companies");
  await page.getByRole("button", { name: "Add a source manually" }).click();
  const sourceDialog = page.getByRole("dialog", { name: "Add job source" });
  await sourceDialog.getByRole("textbox", { name: "Name" }).fill(sourceName);
  await sourceDialog.getByRole("textbox", { name: "Careers or board URL" })
    .fill("https://boards.greenhouse.io/chesapeake-outfitters");
  await sourceDialog.getByRole("checkbox", { name: "Enable local scheduling" }).uncheck();
  await sourceDialog.getByRole("button", { name: "Save source" }).click();
  await expect(sourceDialog).toBeHidden();
  const sourceRow = page.getByRole("row").filter({ hasText: sourceName });
  await sourceRow.getByRole("button", { name: "Run", exact: true }).click();
  await expect(sourceRow).toContainText(/success/i, { timeout: 30_000 });
  await expect(sourceRow.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
}

async function openAssessment(page: Page) {
  await navigateSidebar(page, "Find Jobs");
  const job = page.locator("article").filter({ has: page.getByRole("button", { name: hl.job.title, exact: true }) });
  await expect(job).toBeVisible();
  await expect(job).toContainText(sourceName);
  await job.getByRole("button", { name: /Opportunity assessment/ }).click();
  await expect(job.getByText("Evidence coverage", { exact: true })).toBeVisible();
  return job;
}

/**
 * B1/B4 Story B (#216): goals first, evidence later.
 *
 * Every mutation is a visible UI action: the first-run "I know what I want to
 * look for" form, the source dialog/run, and the Career Evidence form.
 * Read-only desktop API getters only observe canonical persistence and
 * provenance. Only the public Greenhouse board read is mocked.
 */
test("a goal-first user keeps the goal while later evidence changes only the evidence assessment", async ({ page, context }) => {
  const outbound = await routePublicBoard(context, hlGreenhouseBoard());

  await page.goto(server.url + "#/onboarding");
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "I know what I want to look for" })).toBeVisible();
  await page.getByRole("textbox", { name: "Work I want to pursue" }).fill(roleGoal);
  await page.getByRole("textbox", { name: "Home area" }).fill(homeArea);
  await page.getByRole("combobox", { name: "Onboarding location importance" }).selectOption("required");
  await page.getByRole("checkbox", { name: preferredWorkMode, exact: true }).check();
  await page.getByRole("combobox", { name: "Onboarding work mode importance" }).selectOption("preferred");
  await page.getByRole("button", { name: "Save goals and continue" }).click();
  await expect(page.getByRole("heading", { name: "Your next steps" })).toBeVisible();

  // A user-owned track exists and survives reload before any evidence does.
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Your next steps" })).toBeVisible();
  const beforeEvidence = await page.evaluate(async () => ({
    tracks: await window.electronAPI.career.listTargetTracks(),
    evidence: await window.electronAPI.career.listEvidence(),
    sources: await window.electronAPI.career.listSourceArtifacts(),
  }));
  expect(beforeEvidence.evidence).toEqual([]);
  expect(beforeEvidence.sources).toEqual([]);
  expect(beforeEvidence.tracks).toHaveLength(1);
  const goal = beforeEvidence.tracks[0];
  expect(goal).toMatchObject({ origin: "user", relation: "target", roleTitles: [roleGoal], isActive: true });
  expect(goal.constraints.geography).toMatchObject({ locations: [homeArea], strength: "required" });
  expect(goal.constraints.workModes).toEqual({ values: ["remote"], strength: "preferred" });
  // Optional fields left blank stay unknown rather than defaulted into constraints.
  expect(goal.constraints.compensation.floor).toBeNull();

  // The distinction is visible (not only stored) on the Target Tracks form.
  await navigateSidebar(page, "Target Tracks");
  await expect(page.getByRole("textbox", { name: "Roles in this track" })).toHaveValue(roleGoal);
  await expect(page.getByRole("textbox", { name: "Track locations" })).toHaveValue(homeArea);
  await expect(page.getByRole("combobox", { name: "Geography importance" })).toHaveValue("required");
  await expect(page.getByRole("checkbox", { name: preferredWorkMode, exact: true })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Work mode importance" })).toHaveValue("preferred");

  // Discovery and source review work with no evidence at all.
  await addAndRunSource(page);

  // Without evidence, the assessment does not pretend eligibility is known.
  let job = await openAssessment(page);
  await expect(job.getByText("Eligibility · Unclear", { exact: true })).toBeVisible();
  await expect(job.getByText("Evidence · Limited", { exact: true })).toBeVisible();
  await expect(job.getByText("0 direct", { exact: true })).toBeVisible();
  await expect(job.getByText("0 transferable", { exact: true })).toBeVisible();
  await expect(job.getByText(/^Evidence: /)).toHaveCount(0);
  await expect(job.getByText("Potential blockers")).toBeVisible();
  await expect(job.getByText(/\(no confirmed support\)\.$/).first()).toBeVisible();
  // Required home area matches; the preferred work-mode miss is a miss, never a blocker.
  await expect(job.getByText(`Location matches ${homeArea}.`)).toBeVisible();
  await expect(job.getByText("Work mode is listed as on-site; your track allows remote.")).toBeVisible();
  await expect(job.getByText("Known blockers")).toHaveCount(0);
  await expect(job.getByText("Preferences · Mixed", { exact: true })).toBeVisible();

  // Later: add Career Evidence through its real form.
  await navigateSidebar(page, "Career Evidence");
  await expect(page.getByRole("heading", { name: "Build your career evidence one fact at a time." })).toBeVisible();
  await expect(page.getByText("No confirmed Career Evidence yet.")).toBeVisible();
  await page.getByRole("combobox", { name: "Evidence type" }).selectOption({ label: "Job or role" });
  await page.getByRole("textbox", { name: "What did you do, know, earn, or accomplish?" }).fill(hlEvidence.statement);
  await page.getByRole("textbox", { name: "Role, project, credential, or item name" }).fill(hlEvidence.titleOrName);
  await page.getByRole("textbox", { name: "Skills or tools demonstrated" }).fill(hlEvidence.skills.join(", "));
  await page.getByRole("button", { name: "Add career evidence" }).click();
  await expect(page.getByText("Saved as user-authored evidence")).toBeVisible();

  const authored = await page.evaluate(() => window.electronAPI.career.listEvidence());
  expect(authored).toHaveLength(1);
  expect(authored[0].sources).toEqual([]);
  expect(authored[0].evidence).toMatchObject({
    subjectType: hlEvidence.subjectType,
    statement: hlEvidence.statement,
    verificationState: "user-authored",
  });
  const evidenceId = authored[0].evidence.id;

  // The assessment changes because of that evidence, and only that evidence.
  job = await openAssessment(page);
  await expect(job.getByText(`Evidence: ${hlEvidence.statement}`).first()).toBeVisible();
  await expect(job.getByText("Eligibility · Likely", { exact: true })).toBeVisible();
  await expect(job.getByText("Potential blockers")).toHaveCount(0);
  await expect(job.getByText("Known blockers")).toHaveCount(0);
  // Preference results are untouched by evidence.
  await expect(job.getByText("Preferences · Mixed", { exact: true })).toBeVisible();
  await expect(job.getByText("Work mode is listed as on-site; your track allows remote.")).toBeVisible();

  const after = await page.evaluate(async (title) => {
    const api = window.electronAPI;
    const listing = (await api.jobs.list()).find((item) => item.title === title)!;
    return {
      coverage: await api.jobs.getEvidenceCoverage(listing.id),
      tracks: await api.career.listTargetTracks(),
    };
  }, hl.job.title);
  expect(after.coverage.supportedCount).toBeGreaterThan(0);
  const cited = after.coverage.items.flatMap((item) => (item.evidence ? [item.evidence.id] : []));
  expect(cited.length).toBeGreaterThan(0);
  expect(new Set(cited)).toEqual(new Set([evidenceId]));
  // The original goal was not rewritten by adding evidence.
  expect(after.tracks).toEqual([goal]);

  // Save/reload: goal, constraint/preference strengths and evidence all persist.
  await page.reload();
  await waitForRuntime(page);
  await navigateSidebar(page, "Target Tracks");
  await expect(page.getByRole("textbox", { name: "Roles in this track" })).toHaveValue(roleGoal);
  await expect(page.getByRole("combobox", { name: "Geography importance" })).toHaveValue("required");
  await expect(page.getByRole("combobox", { name: "Work mode importance" })).toHaveValue("preferred");
  await expect(page.getByRole("checkbox", { name: preferredWorkMode, exact: true })).toBeChecked();
  const persisted = await page.evaluate(async () => ({
    tracks: await window.electronAPI.career.listTargetTracks(),
    evidence: await window.electronAPI.career.listEvidence(),
  }));
  expect(persisted.tracks).toEqual([goal]);
  expect(persisted.evidence.map(({ evidence }) => [evidence.id, evidence.verificationState]))
    .toEqual([[evidenceId, "user-authored"]]);

  expect(outbound).toEqual([]);
});

/*
 * Defect reproduction found while qualifying Story B (#216): an hourly pay
 * floor can never be compared with an hourly Greenhouse (or Lever) listing.
 * parseSalary (electron/src/salary-parser.cts:74, and :59 for ranges) returns
 * `raw` as only the matched amount ("$24"), and the adapter stores that as
 * salaryText (electron/src/adapters/greenhouse.cts:56, lever.cts:43),
 * discarding the detected "hour" period. detectPayBasis
 * (src/shared/opportunity-assessment.ts:95-103) then finds no basis in "$24"
 * and, because 24 <= 1000, returns null, so the comparison is "unknown".
 * Expected to fail until the period survives into the job record.
 */
test("an hourly listing is compared with an hourly pay floor", async ({ page, context }) => {
  test.fail(true, "Greenhouse \"$24 per hour\" is stored as salaryText \"$24\"; the assessment reports pay as unknown");
  await routePublicBoard(context, hlGreenhouseBoard());
  await page.goto(server.url + "#/onboarding");
  await waitForRuntime(page);
  await page.getByRole("textbox", { name: "Work I want to pursue" }).fill(roleGoal);
  await page.getByRole("spinbutton", { name: "Onboarding minimum pay" }).fill("26");
  await page.getByRole("combobox", { name: "Onboarding pay basis" }).selectOption("hourly");
  await page.getByRole("combobox", { name: "Onboarding pay importance" }).selectOption("required");
  await page.getByRole("button", { name: "Save goals and continue" }).click();
  await expect(page.getByRole("heading", { name: "Your next steps" })).toBeVisible();
  await addAndRunSource(page);
  const job = await openAssessment(page);
  // Actual: "The listing does not provide enough pay detail to verify your $26/hr floor."
  // listed as a potential blocker, with eligibility "Unclear".
  await expect.soft(job.getByText("Listed starting pay is approximately $24/hr versus your $26/hr floor.").first()).toBeVisible();
  await expect.soft(job.getByText("Known blockers")).toBeVisible();
  await expect.soft(job.getByText("Eligibility · Unlikely", { exact: true })).toBeVisible();
});
