import { test, expect } from "@playwright/test";
import {
  closeElectronApp,
  launchElectronApp,
  navigateTo,
  type ElectronAppFixture,
} from "./electron-app";

let fixture: ElectronAppFixture;

const application = {
  id: "application-e2e-lifecycle",
  jobId: "job-e2e-lifecycle",
  title: "Customer Success Program Manager",
  companyName: "Northstar Systems",
  url: "https://example.com/jobs/customer-success-program-manager",
  status: "applied" as const,
  notes: "",
  createdAt: "2026-10-03T01:00:00.000Z",
  updatedAt: "2026-10-03T01:00:00.000Z",
};

test.beforeAll(async () => {
  fixture = await launchElectronApp();

  await fixture.page.evaluate(async (seedApplication) => {
    await window.electronAPI.career.migrateLegacy({
      profile: null,
      applications: [seedApplication],
    });

    const evidence = await window.electronAPI.career.createUserEvidence({
      subjectType: "achievement",
      statement: "Built a customer success operating cadence across cross-functional teams.",
      titleOrName: "Customer success operating cadence",
      organization: "Northstar Consulting",
      skills: ["Customer Success", "Program Management"],
    });

    const resume = await window.electronAPI.resume.create({
      jobId: null,
      context: "private-sector",
      pageFormat: "letter",
      templateId: "ats-standard-v1",
      contact: {
        fullName: "Taylor Example",
        email: "taylor@example.com",
        phone: "555-0100",
        location: "Annapolis, MD",
        links: [],
      },
      selectedEvidenceIds: [evidence.id],
    });

    const exported = await window.electronAPI.resume.exportPdf({
      projectionId: resume.projection.id,
      applicationId: seedApplication.id,
      purpose: "submitted",
    });
    if (!exported.artifact) {
      throw new Error("E2E setup failed to produce a submitted resume artifact");
    }
  }, application);
});

test.afterAll(async () => {
  await closeElectronApp(fixture);
});

test("application lifecycle preserves submitted file, contact, event, and reminder", async () => {
  const { page } = fixture;
  await navigateTo(page, "/applications");

  const applicationCard = page.locator("article").filter({
    hasText: application.title,
  });
  await expect(applicationCard).toBeVisible();
  await applicationCard.getByRole("button", { name: "Application details", exact: false }).click();

  await expect(applicationCard.getByText("PDF v1 · Version you sent", { exact: true })).toBeVisible();

  await applicationCard.getByRole("button", { name: "Add person", exact: true }).click();
  await applicationCard.getByLabel("Contact name", { exact: true }).fill("Morgan Recruiter");
  await applicationCard.getByLabel("Contact role", { exact: true }).fill("Recruiter");
  await applicationCard.getByLabel("Contact email", { exact: true }).fill("morgan@example.com");
  await applicationCard.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(applicationCard.getByText("Morgan Recruiter · Recruiter", { exact: true })).toBeVisible();

  await applicationCard.getByRole("button", { name: "Add event", exact: true }).click();
  await applicationCard.getByLabel("Event type", { exact: true }).selectOption("interview");
  await applicationCard.getByLabel("Event title", { exact: true }).fill("Panel interview");
  await applicationCard.getByLabel("Event time", { exact: true }).fill("2030-01-15T10:00");
  await applicationCard.getByLabel("Reminder time", { exact: true }).fill("2030-01-15T09:00");
  await applicationCard.getByLabel("Event notes", { exact: true }).fill("Bring customer program examples.");
  await applicationCard.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(applicationCard.getByText("Panel interview", { exact: true })).toBeVisible();
  await expect(applicationCard.getByText(/· reminder /)).toBeVisible();

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await navigateTo(page, "/applications");

  const reloadedCard = page.locator("article").filter({ hasText: application.title });
  await reloadedCard.getByRole("button", { name: "Application details", exact: false }).click();
  await expect(reloadedCard.getByText("PDF v1 · Version you sent", { exact: true })).toBeVisible();
  await expect(reloadedCard.getByText("Morgan Recruiter · Recruiter", { exact: true })).toBeVisible();
  await expect(reloadedCard.getByText("Panel interview", { exact: true })).toBeVisible();

  await reloadedCard.getByRole("button", { name: "Complete Panel interview", exact: true }).click();
  await expect(
    reloadedCard.getByRole("button", { name: "Reopen Panel interview", exact: true }),
  ).toBeVisible();
});
