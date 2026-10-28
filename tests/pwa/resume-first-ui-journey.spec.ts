import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, healthcareResumeDocx, waitForRuntime } from "./support/fixtures";

let server: PwaServer;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
});

test.afterAll(async () => {
  await server.close();
});

/** Open supporting destinations without assuming that every link is always expanded. */
async function navigateSidebar(page: import("@playwright/test").Page, destination: string) {
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
 * B1/B4: a genuine user-driven resume-first journey.
 *
 * Mutations happen ONLY through visible controls: onboarding file picker,
 * evidence approval, profile and target track forms, source approval/run,
 * job tracking, application edits, and the Truth-Gated resume composer.
 * Read-only desktop API calls at milestones inspect the canonical authority,
 * not seed records or bypass a required UI action.
 *
 * The existing career-ops.spec.ts separately pressure-tests the complete
 * backend and deterministic PDF byte provenance. This test qualifies the
 * interactive path that those direct IPC calls cannot prove works.
 */
test("resume-first user can pursue a fixture job without importing unapproved facts", async ({ page, context }) => {
  const outbound: string[] = [];
  await context.route("https://boards-api.greenhouse.io/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(greenhouseFixture),
    });
  });
  context.on("request", (request) => {
    const url = new URL(request.url());
    // Hostname suffix tests are not security boundaries: "notgreenhouse.io"
    // and "boards-api.greenhouse.io.attacker.example" are not our fixture.
    // Only exact HTTPS GET reads of the approved public board API are allowed.
    const isFixtureRead =
      request.method() === "GET" &&
      url.protocol === "https:" &&
      url.hostname === "boards-api.greenhouse.io";
    if (url.origin !== new URL(server.url).origin && !isFixtureRead) {
      outbound.push(request.method() + " " + request.url());
    }
  });

  // US-1: start as a new user. Select the existing resume-first option, not
  // a test-only import adapter or hidden database fixture.
  await page.goto(server.url + "#/onboarding");
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Start with what you already have." })).toBeVisible();
  const chooseResume = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import a resume", exact: true }).click();
  await (await chooseResume).setFiles({
    name: "morgan-rivera-healthcare.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: healthcareResumeDocx(),
  });
  await expect(page).toHaveURL(/#\/career-profile$/);
  await expect(page.getByText("morgan-rivera-healthcare.docx", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review imported evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm", exact: true }).first()).toBeVisible();

  // US-9/10: an imported parser proposal is NOT factual Career Evidence.
  // Even when extraction was successful it cannot be used by the resume UI
  // until the person expressly confirms it.
  const before = await page.evaluate(() => window.electronAPI.career.listEvidence());
  const imported = before.filter((item) => item.evidence.verificationState === "imported");
  expect(imported.length).toBeGreaterThan(0);
  expect(before.some((item) =>
    item.evidence.verificationState === "user-confirmed" ||
    item.evidence.verificationState === "user-authored",
  )).toBe(false);

  await navigateSidebar(page, "Resume");
  await expect(page.getByText("Confirm Career Evidence in Career Profile before creating a resume.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create truthful draft" })).toBeDisabled();

  await navigateSidebar(page, "Career Profile");
  await expect(page.getByRole("button", { name: "Confirm", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
  await expect.poll(async () => {
    const records = await page.evaluate(() => window.electronAPI.career.listEvidence());
    return records.filter((item) => item.evidence.verificationState === "user-confirmed").length;
  }).toBeGreaterThan(0);
  // The original source is retained and the remaining unreviewed proposals
  // do not gain factual authority through their neighbor's confirmation.
  const reviewed = await page.evaluate(async () => ({
    items: await window.electronAPI.career.listEvidence(),
    sources: await window.electronAPI.career.listSourceArtifacts(),
  }));
  expect(reviewed.sources.some((item) => item.originalName === "morgan-rivera-healthcare.docx")).toBe(true);
  const remainingImported = reviewed.items.filter((item) =>
    imported.some((candidate) => candidate.evidence.id === item.evidence.id) &&
    item.evidence.verificationState === "imported",
  );
  expect(remainingImported.length).toBe(imported.length - 1);

  // US-0: save broad preference/identity data through the visible profile form.
  await page.getByRole("textbox", { name: "Your name" }).fill("Morgan Rivera");
  await page.getByRole("textbox", { name: "Home area" }).fill("Baltimore, MD");
  await page.getByRole("textbox", { name: "Roles you would consider" })
    .fill("Medical Office Coordinator\nPatient Services Coordinator");
  await page.getByRole("button", { name: "Save career profile" }).click();
  await expect(page.getByText("Saved on this device")).toBeVisible();

  // US-4/5: explicit search direction. Nothing is inferred from a job title.
  await navigateSidebar(page, "Target Tracks");
  await expect(page.getByRole("heading", { name: "Keep different career directions separate." })).toBeVisible();
  await page.getByRole("textbox", { name: "Track name" }).fill("Healthcare operations");
  await page.getByRole("textbox", { name: "Roles in this track" })
    .fill("Medical Office Coordinator\nPatient Services Coordinator");
  await page.getByRole("button", { name: "Save target track" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  // US-13: a source becomes monitored only through an explicit user action.
  // PWA fixture route simulates the public Greenhouse read, never a real
  // employer account or externally submitted job application.
  await navigateSidebar(page, "Companies");
  await page.getByRole("button", { name: "Add a source manually" }).click();
  const sourceDialog = page.getByRole("dialog", { name: "Add job source" });
  await sourceDialog.getByRole("textbox", { name: "Name" }).fill("Harbor Health");
  await sourceDialog.getByRole("textbox", { name: "Careers or board URL" })
    .fill("https://boards.greenhouse.io/harbor-health");
  await sourceDialog.getByRole("checkbox", { name: "Enable local scheduling" }).uncheck();
  await sourceDialog.getByRole("button", { name: "Save source" }).click();
  await expect(sourceDialog).toBeHidden();
  const sourceRow = page.getByRole("row").filter({ hasText: "Harbor Health" });
  await expect(sourceRow).toBeVisible();
  await sourceRow.getByRole("button", { name: "Run", exact: true }).click();
  // Do not race the asynchronous fixture scrape or mistake an enabled button
  // for evidence that the source's canonical run has completed.
  await expect(sourceRow).toContainText(/success/i, { timeout: 30_000 });
  await expect(sourceRow.getByRole("button", { name: "Run", exact: true })).toBeEnabled();

  await navigateSidebar(page, "Find Jobs");
  const job = page.locator("article").filter({ has: page.getByRole("button", {
    name: "Medical Office Coordinator", exact: true,
  }) });
  await expect(job).toBeVisible();
  await expect(job).toContainText("Harbor Health");

  // US-14/15/18: opening the user-facing assessment shows independent
  // eligibility, coverage, preferences and uncertainty, not one fake score.
  await job.getByRole("button", { name: /Opportunity assessment/ }).click();
  const assessment = page.getByRole("dialog", { name: /Opportunity assessment:/ });
  await expect(assessment.getByText("Evidence coverage", { exact: true })).toBeVisible();
  await expect(assessment.getByText("Eligibility and blockers")).toBeVisible();
  // The assessment is a modal drawer; close it before acting on the listing behind it.
  await page.keyboard.press("Escape");
  await expect(assessment).toBeHidden();

  // US-23: tracking is initiated from the discovered listing, not through IPC.
  await job.getByRole("button", { name: "Track this job" }).click();
  await expect(page).toHaveURL(/#\/applications$/);
  const application = page.locator("article").filter({ hasText: "Harbor Health" });
  await expect(application).toContainText("Medical Office Coordinator");
  await application.getByRole("combobox", { name: /Application status for/ }).selectOption("applied");
  await expect(application.getByRole("status", { name: "Application status save status" })).toContainText("Saved");
  await application.getByRole("textbox", { name: "Notes" })
    .fill("Applied via the clinic careers page; awaiting a reply.");
  await expect(application.getByRole("status", { name: "Application notes save status" })).toContainText("Saved");

  // US-19/22: prepare the resume from the real job's assessment, so both
  // the known job and the tracked application are linked to the export.
  await navigateSidebar(page, "Find Jobs");
  const jobAgain = page.locator("article").filter({ has: page.getByRole("button", {
    name: "Medical Office Coordinator", exact: true,
  }) });
  await jobAgain.getByRole("button", { name: /Opportunity assessment/ }).click();
  await page.getByRole("dialog", { name: /Opportunity assessment:/ }).getByRole("button", { name: "Prepare resume" }).click();
  await expect(page).toHaveURL(/#\/resume\?job=/);
  await expect(page.getByText("Targeting tracked job", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create truthful draft" })).toBeEnabled();

  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Morgan Rivera");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("morgan.rivera@example.org");
  await page.getByRole("button", { name: "Create truthful draft" }).click();
  await expect(page.getByText("Resume draft created from confirmed Career Evidence.")).toBeVisible();
  await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Export verified PDF" }).click();
  await expect(page.getByText(/passed the gates and was linked to this application/)).toBeVisible();
  await expect(page.getByText("PDF v1", { exact: true })).toBeVisible();
  // #314: The new Drive export feature reads ONLY a previously verified managed PDF.
  // This uses the real browser worker + shared ResumeService, not a mocked file or
  // test-only path read. No Google request is made by this read-only qualification.
  const preparedForDrive = await page.evaluate(async () => {
    const api = window.electronAPI;
    const [projection] = await api.resume.list();
    const detail = await api.resume.get(projection.id);
    const artifact = detail.artifacts.find((item) => item.format === "pdf");
    if (!artifact) throw Error("No saved verified PDF");
    const content = await api.resume.readVerifiedArtifactForExport(artifact.id);
    const observed = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", content.bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    return {
      idMatch: content.artifactId === artifact.id,
      revisionMatch: content.revision === String(artifact.version),
      contentMatchesRecord: observed === artifact.contentHash && content.contentHash === observed,
      fileName: content.fileName, mimeType: content.mimeType,
      pdfSignature: new TextDecoder().decode(content.bytes.slice(0, 5)),
    };
  });
  expect(preparedForDrive).toMatchObject({
    idMatch: true, revisionMatch: true, contentMatchesRecord: true,
    mimeType: "application/pdf", pdfSignature: "%PDF-",
  });
  expect(preparedForDrive.fileName).toMatch(/\.pdf$/i);


  // Read-only canonical observations, not a parallel mutation path.
  const persisted = await page.evaluate(async () => {
    const api = window.electronAPI;
    const [applications, projections] = await Promise.all([
      api.applications.list(), api.resume.list(),
    ]);
    const matching = applications.find((entry) => entry.companyName === "Harbor Health");
    const lifecycle = matching ? await api.applicationLifecycle.get(matching.id) : null;
    return {
      application: matching ? {
        status: matching.status, notes: matching.notes, jobId: matching.jobId,
      } : null,
      projections: projections.length,
      submittedArtifacts: lifecycle?.artifacts
        .filter((artifact) => artifact.purpose === "submitted")
        .map((artifact) => ({ hash: artifact.contentHash, resumeId: artifact.resumeArtifactId })) ?? [],
    };
  });
  expect(persisted.application).toMatchObject({
    status: "applied",
    notes: "Applied via the clinic careers page; awaiting a reply.",
  });
  expect(persisted.projections).toBeGreaterThan(0);
  expect(persisted.submittedArtifacts.length).toBeGreaterThan(0);
  expect(persisted.submittedArtifacts[0].hash).toMatch(/^[a-f0-9]{64}$/);

  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Saved drafts" })).toBeVisible();
  await page.getByRole("button", { name: /ATS-safe standard/ }).first().click();
  await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
  await expect(page.getByText("PDF v1", { exact: true })).toBeVisible();

  // Nothing left the workspace other than fixture-backed public board reads.
  expect(outbound).toEqual([]);
});
