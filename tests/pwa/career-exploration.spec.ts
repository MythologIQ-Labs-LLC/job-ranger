import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

test("career exploration creates an opt-in handoff, then only an unsaved, paused Target Track", async ({ page, context }) => {
  const outbound: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(server.url).origin) outbound.push(request.url());
  });
  await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(server.url);
  await waitForRuntime(page);

  const statement = "Coordinated scheduling for an outdoor community education program.";
  await page.evaluate((text) => window.electronAPI.career.createUserEvidence({
    subjectType: "project", organization: null, titleOrName: "Community event coordination",
    startDate: null, endDate: null, statement: text, skills: ["Coordination"],
    methodsOrTools: [], scope: [], outcomes: [], metrics: [], credential: null,
  }), statement);

  const before = await page.evaluate(() => window.electronAPI.career.listTargetTracks());
  await page.goto(`${server.url}#/target-tracks`);
  await page.locator("summary").filter({ hasText: "Explore career possibilities with an assistant" }).click();
  await expect(page.getByLabel("Career exploration goal")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Include confirmed Career Evidence/ })).toBeVisible();

  await page.getByLabel("Career exploration goal").fill(
    "Find a new career direction that values creativity and community involvement.",
  );
  await page.getByLabel("Preferences and aspirations").fill("A flexible, collaborative environment.");
  await page.getByLabel("Hard constraints you want respected").fill("No overnight shifts.");

  const brief = page.getByLabel("Exact career exploration brief");
  await expect(brief).toHaveValue(/3–5 materially different directions/);
  await expect(brief).not.toHaveValue(new RegExp(statement));
  await expect(brief).toHaveValue(/none supplied; do not invent a work history/);
  const copy = page.getByRole("button", { name: "Copy reviewed brief" });
  await expect(copy).toBeDisabled();

  await page.getByRole("checkbox", { name: /Include confirmed Career Evidence/ }).check();
  await expect(brief).toHaveValue(new RegExp(statement));
  await expect(copy).toBeDisabled();

  const review = page.getByRole("checkbox", {
    name: /I have reviewed this exact brief and choose to copy it/i,
  });
  await review.check();
  await expect(copy).toBeEnabled();
  await page.getByLabel("Preferences and aspirations").fill("Prefer meaningful collaborative work.");
  await expect(review).not.toBeChecked();
  await expect(copy).toBeDisabled();

  await review.check();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: server.url });
  await copy.click();
  await expect(page.getByRole("status")).toContainText("Brief copied locally");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  const exact = await brief.inputValue();
  // Windows' clipboard API normalizes newline bytes to CRLF even when the
  // controlled textarea has LF. Only that OS transport conversion is allowed;
  // the words, quotes, boundaries and selected Career Evidence must match.
  expect(clipboard.replace(/\r\n/g, "\n")).toBe(exact.replace(/\r\n/g, "\n"));
  expect(clipboard).toContain(statement);

  await page.getByLabel("Direction I want to explore").fill("Community-centered design operations");
  await page.getByRole("button", { name: "Start an unsaved, paused track draft" }).click();
  await expect(page.getByLabel("Track name")).toHaveValue("Community-centered design operations");
  await expect(page.getByRole("checkbox", { name: "Active", exact: true })).not.toBeChecked();
  const unsaved = await page.evaluate(() => window.electronAPI.career.listTargetTracks());
  expect(unsaved).toEqual(before);
  // Existing validated save operation remains the ONLY persistence transition.
  await page.getByRole("button", { name: "Save target track" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => window.electronAPI.career.listTargetTracks());
  expect(saved).toHaveLength(before.length + 1);
  const track = saved.find((item) => item.name === "Community-centered design operations");
  expect(track).toBeTruthy();
  expect(track!.isActive).toBe(false);
  expect(track!.roleTitles).toEqual([]);
  expect(outbound).toEqual([]);
});


test("approved exploration brief cannot copy superseded evidence", async ({ page, context }) => {
  const outbound: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(server.url).origin) outbound.push(request.url());
  });
  await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(server.url);
  await waitForRuntime(page);

  const record = await page.evaluate(() => window.electronAPI.career.createUserEvidence({
    subjectType: "role", organization: "Example Community Group", titleOrName: "Coordinator",
    startDate: "2024-01", endDate: null,
    statement: "Coordinated community volunteer schedules.",
    skills: ["Scheduling"], methodsOrTools: [], scope: [], outcomes: [], metrics: [], credential: null,
  }));
  await page.goto(`${server.url}#/target-tracks`);
  await page.locator("summary").filter({ hasText: "Explore career possibilities with an assistant" }).click();
  await expect(page.getByRole("checkbox", { name: /Include confirmed Career Evidence/ })).toBeVisible();
  await page.getByLabel("Career exploration goal").fill("Explore opportunities supporting community programs.");
  await page.getByRole("checkbox", { name: /Include confirmed Career Evidence/ }).check();
  const approved = page.getByRole("checkbox", { name: /I have reviewed this exact brief and choose to copy it/i });
  await approved.check();
  await expect(page.getByRole("button", { name: "Copy reviewed brief" })).toBeEnabled();

  // External canonical update without a renderer refresh, simulating a stale
  // snapshot at the moment the person tries to hand a brief to a model.
  await page.evaluate((id) => window.electronAPI.careerEvidence.supersedeEvidence(id, {
    subjectType: "role",
    statement: "Coordinated program scheduling under supervision; revised record.",
  }), record.id);

  await page.getByRole("button", { name: "Copy reviewed brief" }).click();
  await expect(page.getByRole("alert")).toContainText("Selected Career Evidence changed");
  await expect(approved).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Copy reviewed brief" })).toBeDisabled();
  expect(outbound).toEqual([]);
});
