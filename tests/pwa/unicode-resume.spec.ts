import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
});

test.afterAll(async () => {
  await server.close();
});

async function createEvidence(page: Page, organization: string, title: string, statement: string): Promise<string> {
  const evidence = await page.evaluate(
    (input) =>
      window.electronAPI.career.createUserEvidence({
        subjectType: "role",
        organization: input.organization,
        titleOrName: input.title,
        startDate: "2022-03",
        endDate: null,
        statement: input.statement,
        skills: [],
        methodsOrTools: [],
        scope: [],
        outcomes: [],
        metrics: [],
        credential: null,
      }),
    { organization, title, statement },
  );
  return evidence.id;
}

async function exportResume(page: Page, fullName: string, evidenceIds: string[]) {
  const resume = await page.evaluate(
    (input) =>
      window.electronAPI.resume.create({
        jobId: null,
        context: "private-sector",
        pageFormat: "a4",
        templateId: "ats-standard-v1",
        contact: { fullName: input.fullName, email: "candidate@example.com", phone: "", location: "", links: [] },
        selectedEvidenceIds: input.evidenceIds,
      }),
    { fullName, evidenceIds },
  );
  expect(resume.truthGate.passed).toBe(true);
  return page.evaluate((projectionId) => window.electronAPI.resume.exportPdf({ projectionId }), resume.projection.id);
}

test("non-Latin resumes render with verified on-demand fonts, pass the Parseability Gate, and work offline afterwards", async ({ page, context }) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/fonts/")) fontRequests.push(request.url());
  });

  await page.goto(server.url);
  await waitForRuntime(page);
  // Let the service worker take control so font downloads go through it.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await waitForRuntime(page);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // Precaching the shell never downloads the resume fonts.
  expect(fontRequests).toEqual([]);

  const chinese = await createEvidence(
    page,
    "华东医疗物流有限公司",
    "供应链经理",
    "负责华东区域医疗器材供应链管理，协调 SAP 系统上线，库存周转率提升 25%。",
  );
  const ukrainian = await createEvidence(
    page,
    "Клініка «Здоров'я»",
    "Координаторка пацієнтів",
    "Координувала запис пацієнтів і перевірку страховок для шести лікарів.",
  );
  const first = await exportResume(page, "王小明", [chinese, ukrainian]);
  expect(first.parseabilityGate.passed).toBe(true);
  expect(first.parseabilityGate.issues.filter((issue: { severity: string }) => issue.severity === "critical")).toEqual([]);
  expect(fontRequests.length).toBeGreaterThan(0);
  expect(fontRequests.every((url) => /\/fonts\/noto-sans(-sc)?-[\w-]+\.[0-9a-f]{12}\.ttf$/.test(url))).toBe(true);
  const cachedFonts = await page.evaluate(async () => (await (await caches.open("job-ranger-on-demand-v1")).keys()).length);
  expect(cachedFonts).toBeGreaterThan(0);

  // The same fonts are served from the verified cache with the network gone.
  await context.setOffline(true);
  try {
    const offline = await exportResume(page, "王小明", [chinese]);
    expect(offline.parseabilityGate.passed).toBe(true);
  } finally {
    await context.setOffline(false);
  }

  // Scripts the web writer cannot lay out fail with an explanation instead of a misleading PDF.
  const hebrew = await createEvidence(page, "בית חולים", "מנהלת", "ניהלה את מערך התורים במרפאה.");
  const resume = await page.evaluate(
    (evidenceIds) =>
      window.electronAPI.resume.create({
        jobId: null,
        context: "private-sector",
        pageFormat: "a4",
        templateId: "ats-standard-v1",
        contact: { fullName: "Noa Levi", email: "candidate@example.com", phone: "", location: "", links: [] },
        selectedEvidenceIds: evidenceIds,
      }),
    [hebrew],
  );
  const failure = await page.evaluate(
    (projectionId) => window.electronAPI.resume.exportPdf({ projectionId }).then(() => "exported", (error: Error) => error.message),
    resume.projection.id,
  );
  expect(failure).toMatch(/right-to-left or Indic scripts/);
  expect(failure).toMatch(/Remove or transliterate that text/);
  expect(failure).not.toMatch(/Windows app|desktop app/);
});
