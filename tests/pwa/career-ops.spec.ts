import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { startPwaServer, type PwaServer } from "./support/server";
import {
  distPwa,
  greenhouseFixture,
  healthcareProfile,
  healthcareResumeDocx,
  waitForRuntime,
} from "./support/fixtures";

let server: PwaServer;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
});

test.afterAll(async () => {
  await server.close();
});

/**
 * One complete local-first Career Ops workflow in the web runtime, using a
 * materially non-software (healthcare operations) scenario: profile → Target
 * Track → Career Evidence (authored + imported DOCX) → monitored source →
 * preserved job snapshot → requirement/evidence coverage → application
 * lifecycle → Career Story → interview prep → application material →
 * Truth-Gated, parseability-checked PDF linked as the submitted artifact →
 * Search Insights → JSON Resume export.
 */
test("healthcare operations Career Ops workflow runs end to end in the browser", async ({ page, context }) => {
  const outbound: string[] = [];
  await context.route("https://boards-api.greenhouse.io/**", async (route) => {
    outbound.push(`${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(greenhouseFixture),
    });
  });
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(server.url).origin && !url.hostname.endsWith("greenhouse.io")) {
      outbound.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto(server.url);
  await waitForRuntime(page);

  // Career direction.
  await page.evaluate((profile) => window.electronAPI.career.saveProfile(profile), healthcareProfile);
  const track = await page.evaluate(() =>
    window.electronAPI.career.createTargetTrack({
      name: "Healthcare operations",
      relation: "target",
      roleTitles: ["Medical Office Coordinator", "Patient Services Coordinator"],
      seniority: null,
      direction: "Patient-facing healthcare operations",
      constraints: {
        geography: { locations: ["Baltimore, MD"], radiusMiles: 30, strength: "preferred" },
        workModes: { values: ["on-site", "hybrid"], strength: "preferred" },
        employmentArrangements: { values: ["full-time"], strength: "required" },
        schedules: { values: ["day"], strength: "preferred" },
        compensation: { floor: 52000, target: 62000, basis: "annual", floorStrength: "required" },
        onCall: { value: "no", strength: "preferred" },
        industries: { values: ["Healthcare"], strength: "preferred" },
      },
      isActive: true,
    }),
  );
  expect(track.name).toBe("Healthcare operations");

  // Career Evidence: direct authoring.
  const role = await page.evaluate(() =>
    window.electronAPI.career.createUserEvidence({
      subjectType: "role",
      organization: "Harbor Family Clinic",
      titleOrName: "Patient Services Coordinator",
      startDate: "2023-01",
      endDate: null,
      statement:
        "Coordinated patient scheduling, referrals, insurance verification, and front-desk workflows for a multi-provider clinic.",
      skills: ["Patient scheduling", "Insurance verification", "HIPAA workflows"],
      methodsOrTools: [],
      scope: ["Multi-provider outpatient clinic"],
      outcomes: ["Maintained accurate scheduling and referral workflows"],
      metrics: [],
      credential: null,
    }),
  );
  expect(role.verificationState).toBe("user-authored");

  // Career Evidence: resume file import through the real UI and browser file picker.
  await page.goto(`${server.url}#/career-profile`);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import resume" }).click();
  await (await chooser).setFiles({
    name: "morgan-rivera-resume.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: healthcareResumeDocx(),
  });
  await expect
    .poll(async () => {
      const artifacts = await page.evaluate(() => window.electronAPI.career.listSourceArtifacts());
      return artifacts.length === 1 ? artifacts[0].extractionState : "missing";
    }, { timeout: 30_000 })
    .not.toMatch(/missing|pending/);
  const [artifact] = await page.evaluate(() => window.electronAPI.career.listSourceArtifacts());
  expect(artifact.originalName).toBe("morgan-rivera-resume.docx");
  expect(artifact.extractionState).not.toMatch(/failed|malformed|unsupported/);
  expect(artifact.parserId).toBe("sojourner-web-document-parser");
  const evidenceItems = await page.evaluate(() => window.electronAPI.career.listEvidence());
  const imported = evidenceItems.filter((item) => item.sources.some((source) => source.artifact?.id === artifact.id || JSON.stringify(source).includes(artifact.id)));
  expect(imported.length).toBeGreaterThan(0);
  // Imported proposals are not factual authority until the user confirms them.
  expect(imported.every((item) => item.evidence.verificationState !== "user-authored")).toBe(true);
  const confirmed = await page.evaluate(
    (id) => window.electronAPI.career.reviewEvidence(id, { action: "confirm" }),
    imported[0].evidence.id,
  );
  expect(confirmed.verificationState).toBe("user-confirmed");

  // Source monitoring through the browser network boundary (fixture-backed).
  const company = await page.evaluate(() =>
    window.electronAPI.companies.create({
      name: "Harbor Health",
      url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440,
      isActive: false,
    }),
  );
  expect(company.sourceType).toBe("greenhouse");
  const run = await page.evaluate((id) => window.electronAPI.companies.runScrape(id), company.id);
  expect(run.status).toBe("success");
  const jobs = await page.evaluate(() => window.electronAPI.jobs.list());
  expect(jobs).toHaveLength(1);
  const job = jobs[0];
  expect(job.title).toBe("Medical Office Coordinator");

  // Requirement ↔ evidence mapping over the preserved source snapshot.
  const coverage = await page.evaluate((id) => window.electronAPI.jobs.getEvidenceCoverage(id), job.id);
  expect(coverage.items.length).toBeGreaterThanOrEqual(3);
  expect(coverage.supportedCount).toBeGreaterThan(0);

  // Applications and lifecycle.
  const application = await page.evaluate((id) => window.electronAPI.applications.track(id), job.id);
  const applied = await page.evaluate(
    (id) => window.electronAPI.applications.update(id, { status: "applied", notes: "Applied through the clinic careers page." }),
    application.id,
  );
  expect(applied.status).toBe("applied");
  await page.evaluate((id) => window.electronAPI.applicationInsights.setTargetTrack(id, null), application.id).catch(() => undefined);
  const lifecycle = await page.evaluate(async (id) => {
    const api = window.electronAPI.applicationLifecycle;
    await api.createContact(id, { name: "Dana Brooks", role: "Practice Manager", email: "dana@example.org" });
    await api.createEvent(id, {
      kind: "interview",
      title: "Phone screen with practice manager",
      eventAt: "2026-10-12T15:00:00.000Z",
      reminderAt: "2026-10-11T15:00:00.000Z",
    });
    return api.get(id);
  }, application.id);
  expect(lifecycle.contacts.map((contact) => contact.name)).toEqual(["Dana Brooks"]);
  expect(lifecycle.events[0].reminderAt).toBe("2026-10-11T15:00:00.000Z");

  // Career Story grounded in evidence; interview prep; application material.
  const story = await page.evaluate(
    (evidenceId) =>
      window.electronAPI.careerStories.create({
        title: "Untangling the referral backlog",
        tags: ["scheduling"],
        situation: "Referral requests were backing up across six providers.",
        challenge: "Patients waited for callbacks while insurance checks lagged.",
        action: "I rebuilt the referral queue and paired each request with insurance verification.",
        result: "Referrals moved through in days instead of weeks.",
        reflection: "Shared queues need a single owner.",
        evidenceIds: [evidenceId],
      }),
    role.id,
  );
  expect(story.evidence.map((item: { evidenceId: string }) => item.evidenceId)).toContain(role.id);
  const prep = await page.evaluate((id) => window.electronAPI.interviewPrep.get(id), application.id);
  expect(prep).toBeTruthy();
  const material = await page.evaluate((id) => window.electronAPI.applicationMaterials.createCoverLetter(id), application.id);
  expect(material).toBeTruthy();

  // Truth-Gated resume → deterministic browser PDF → Parseability Gate → submitted artifact.
  const resume = await page.evaluate(
    ({ jobId, evidenceIds }) =>
      window.electronAPI.resume.create({
        jobId,
        context: "private-sector",
        pageFormat: "letter",
        templateId: "ats-standard-v1",
        contact: { fullName: "Morgan Rivera", email: "morgan.rivera@example.org", phone: "", location: "Baltimore, MD", links: [] },
        selectedEvidenceIds: evidenceIds,
      }),
    { jobId: job.id, evidenceIds: [role.id, confirmed.id] },
  );
  expect(resume.truthGate.passed).toBe(true);
  const exported = await page.evaluate(
    ({ projectionId, applicationId }) =>
      window.electronAPI.resume.exportPdf({ projectionId, applicationId, purpose: "submitted" }),
    { projectionId: resume.projection.id, applicationId: application.id },
  );
  expect(exported.parseabilityGate.passed).toBe(true);
  expect(exported.parseabilityGate.parserId).toBe("sojourner-web-document-parser");
  expect(exported.linkedApplicationId).toBe(application.id);
  const afterExport = await page.evaluate((id) => window.electronAPI.applicationLifecycle.get(id), application.id);
  const submitted = afterExport.artifacts.find((item) => item.resumeArtifactId === exported.artifact.id);
  expect(submitted?.purpose).toBe("submitted");
  expect(submitted?.contentHash).toBe(exported.artifact.contentHash);

  // The submitted PDF is retrievable byte-for-byte through the UI.
  // ("Show file" in Electron reveals the managed file; the web runtime downloads it.)
  const download = page.waitForEvent("download");
  await page.evaluate((managedPath) => window.electronAPI.showItemInFolder(managedPath), exported.artifact.managedPath);
  const pdf = await readFile(await (await download).path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const { createHash } = await import("node:crypto");
  expect(createHash("sha256").update(pdf).digest("hex")).toBe(exported.artifact.contentHash);

  // Search Insights and JSON Resume interoperability.
  const insights = await page.evaluate(() => window.electronAPI.applicationInsights.getSearchLearning());
  expect(insights.totals).toBeTruthy();
  await page.goto(`${server.url}#/settings`);
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export JSON Resume/i }).click();
  const jsonResume = JSON.parse(await readFile(await (await jsonDownload).path(), "utf8"));
  expect(jsonResume.basics.name).toBe("Morgan Rivera");

  // UI reflects the same local truth.
  await page.goto(`${server.url}#/applications`);
  await expect(page.getByText("Medical Office Coordinator").first()).toBeVisible();

  // No request ever left the browser except the explicit job-board API read.
  expect(outbound.filter((entry) => !entry.startsWith("GET https://boards-api.greenhouse.io/"))).toEqual([]);
});

test("sources that need a full browser are honestly marked unavailable in the web app", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  const company = await page.evaluate(() =>
    window.electronAPI.companies.create({
      name: "Example Workday Employer",
      url: "https://example.wd5.myworkdayjobs.com/en-US/careers",
      frequencyMinutes: 1440,
      isActive: false,
    }),
  );
  const status = await page.evaluate(() => window.electronAPI.system.getStatus());
  expect(status.supportedSources).not.toContain(company.sourceType);
  await page.goto(`${server.url}#/companies`);
  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByTestId("web-source-limit").first()).toBeVisible();
  const run = await page.evaluate((id) => window.electronAPI.companies.runScrape(id), company.id).catch((error: Error) => ({
    status: "error",
    errorMessage: error.message,
  }));
  expect(run.status).not.toBe("success");
});
