import { expect, test, type Page } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

type Gate = {
  pending: { request: unknown; resolve: (value: unknown) => void; reject: (error: Error) => void }[];
  real: (request: unknown) => Promise<unknown>;
};

async function seedTwoDraftsAndTwoJobs(page: Page) {
  await page.route("https://boards-api.greenhouse.io/**", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(greenhouseFixture),
  }));
  await page.goto(server.url);
  await waitForRuntime(page);
  return page.evaluate(async () => {
    const api = window.electronAPI;
    for (const slug of ["harbor-health", "harbor-health-east"]) {
      const source = await api.companies.create({
        name: slug, url: `https://boards.greenhouse.io/${slug}`, frequencyMinutes: 1440, isActive: false,
      });
      if ((await api.companies.runScrape(source.id)).status !== "success") throw Error("Fixture source unavailable");
    }
    const jobs = await api.jobs.list();
    if (jobs.length < 2) throw Error("Expected two fixture jobs");
    const imported = await api.career.importPastedText({
      label: "Clinic history",
      text: [
        "# Professional Experience",
        "Patient Services Coordinator at Harbor Family Clinic | 2023 - Present",
        "- Coordinated patient scheduling and referrals for six providers.",
        "- Verified insurance eligibility before patient visits.",
      ].join("\n"),
    });
    for (const item of imported.proposedEvidence) await api.career.reviewEvidence(item.id, { action: "confirm" });
    const evidenceIds = imported.proposedEvidence.map((item) => item.id);
    const contact = { fullName: "Morgan Rivera", email: "morgan@example.org", phone: "", location: "Baltimore, MD", links: [] };
    const draftA = await api.resume.create({
      jobId: null, context: "private-sector", pageFormat: "letter", templateId: "ats-standard-v1", contact, selectedEvidenceIds: evidenceIds,
    });
    const draftB = await api.resume.create({
      jobId: null, context: "private-sector", pageFormat: "letter", templateId: "ats-compact-v1", contact, selectedEvidenceIds: evidenceIds,
    });
    return { jobIds: [jobs[0].id, jobs[1].id], draftA: draftA.projection.id, draftB: draftB.projection.id };
  });
}

/** Holds every preview request until the test releases it, so late results are deterministic. */
async function gatePreviews(page: Page) {
  await page.evaluate(() => {
    const resume = window.electronAPI.resume;
    const gate: Gate = { pending: [], real: resume.previewTailoring.bind(resume) as Gate["real"] };
    (window as unknown as { previewGate: Gate }).previewGate = gate;
    resume.previewTailoring = ((request: unknown) =>
      new Promise((resolve, reject) => gate.pending.push({ request, resolve, reject }))) as typeof resume.previewTailoring;
  });
}

async function release(page: Page, index: number, outcome: "success" | "failure") {
  await page.evaluate(async ({ index, outcome }) => {
    const gate = (window as unknown as { previewGate: Gate }).previewGate;
    const pending = gate.pending[index];
    if (outcome === "failure") pending.reject(new Error("Synthetic late preview failure"));
    else pending.resolve(await gate.real(pending.request));
  }, { index, outcome });
  // Let React commit whatever the settled request schedules before asserting absence.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

test("a late tailoring preview never lands under a different draft or job", async ({ page }) => {
  const seeded = await seedTwoDraftsAndTwoJobs(page);
  const [firstJob, secondJob] = seeded.jobIds;
  await page.goto(`${server.url}#/resume?job=${firstJob}`);
  await page.reload();
  await waitForRuntime(page);
  await gatePreviews(page);

  const openDraft = async (name: RegExp, header: string) => {
    await page.getByRole("button", { name }).click();
    await expect(page.getByText(header, { exact: true })).toBeVisible();
  };
  const openA = () => openDraft(/^ATS-safe standard/, "ats-standard-v1 · private-sector");
  const openB = () => openDraft(/^ATS-safe compact/, "ats-compact-v1 · private-sector");
  // The innermost section holding the heading is the tailoring panel itself.
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Tailor for this job" }) }).last();
  const previewButton = panel.getByRole("button", { name: "Preview tailoring", exact: true });
  const plan = panel.getByRole("heading", { name: "Evidence for the tailored draft" });
  const failure = panel.getByRole("alert");
  const previewMessage = page.getByText(/^Tailoring preview found/);
  const pendingCount = () => page.evaluate(() => (window as unknown as { previewGate: Gate }).previewGate.pending.length);

  // Late success for draft A must not appear after switching to draft B.
  await openA();
  await previewButton.click();
  await expect(panel.getByRole("button", { name: "Reviewing..." })).toBeDisabled();
  await openB();
  await expect(previewButton).toBeEnabled();
  await release(page, 0, "success");
  await expect(plan).toHaveCount(0);
  await expect(previewMessage).toHaveCount(0);
  await expect(previewButton).toBeEnabled();

  // Late failure for draft B must not appear after switching back to draft A.
  await previewButton.click();
  await openA();
  await expect(previewButton).toBeEnabled();
  await release(page, 1, "failure");
  await expect(failure).toHaveCount(0);
  await expect(previewButton).toBeEnabled();

  // Repeated requests: leaving and returning to A invalidates the first request even
  // though the selection matches again, so it cannot overwrite the newer plan.
  await previewButton.click();
  await openB();
  await openA();
  await previewButton.click();
  expect(await pendingCount()).toBe(4);
  await release(page, 3, "success");
  await expect(plan).toBeVisible();
  const firstCandidate = panel.getByRole("checkbox").first();
  await firstCandidate.uncheck();
  const selectionAfterEdit = await panel.getByText(/^\d+ selected$/).textContent();
  await release(page, 2, "success");
  await expect(firstCandidate).not.toBeChecked();
  await expect(panel.getByText(/^\d+ selected$/)).toHaveText(selectionAfterEdit ?? "");

  // Changing the target job invalidates a pending preview the same way.
  await panel.getByRole("button", { name: "Discard preview" }).click();
  await previewButton.click();
  await page.evaluate((jobId) => { window.location.hash = `/resume?job=${jobId}`; }, secondJob);
  await expect(page.getByText(`Targeting tracked job ${secondJob}.`, { exact: false })).toBeVisible();
  await expect(previewButton).toBeEnabled();
  await release(page, 4, "success");
  await expect(plan).toHaveCount(0);

  // Switching never wrote anything; only the explicit accept below creates a draft.
  const before = await page.evaluate(async () => ({
    drafts: (await window.electronAPI.resume.list()).length,
    evidence: (await window.electronAPI.career.listEvidence()).length,
  }));
  expect(before.drafts).toBe(2);

  // The current request still works end to end, for the source and job on screen.
  await previewButton.click();
  await release(page, 5, "success");
  await expect(plan).toBeVisible();
  await panel.getByRole("button", { name: "Create tailored draft" }).click();
  await expect(page.getByText(/^Tailored draft created\./)).toBeVisible();
  const after = await page.evaluate(async () => ({
    drafts: await window.electronAPI.resume.list(),
    evidence: (await window.electronAPI.career.listEvidence()).length,
  }));
  expect(after.evidence).toBe(before.evidence);
  expect(after.drafts).toHaveLength(3);
  const tailored = after.drafts.find((draft) => draft.sourceProjectionId !== null);
  expect(tailored).toMatchObject({ sourceProjectionId: seeded.draftA, jobId: secondJob });
});
