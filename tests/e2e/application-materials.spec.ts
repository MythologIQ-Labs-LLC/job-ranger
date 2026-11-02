import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import {
  closeElectronApp,
  launchElectronApp,
  navigateTo,
  type ElectronAppFixture,
} from "./electron-app";

const execFile = promisify(execFileCallback);
let fixture: ElectronAppFixture;
let evidenceId = "";

const application = {
  id: "application-e2e-materials",
  jobId: "7401",
  title: "Platform Engineer",
  companyName: "Material Systems",
  url: "https://example.com/jobs/platform-engineer",
  status: "interested" as const,
  notes: "",
  createdAt: "2026-10-03T03:25:00.000Z",
  updatedAt: "2026-10-03T03:25:00.000Z",
};

test.beforeAll(async () => {
  fixture = await launchElectronApp();
  const status = await fixture.page.evaluate(() => window.electronAPI.system.getStatus());
  const now = "2026-10-03T03:25:00.000Z";
  const seedSql = `
    PRAGMA busy_timeout = 5000;
    BEGIN IMMEDIATE;
    INSERT INTO companies (
      id, name, url, source_type, source_identifier, frequency_minutes, is_active,
      last_run_at, last_run_status, last_error_message, consecutive_failures,
      circuit_open_until, created_at, updated_at
    ) VALUES (
      7400, 'Material Systems', 'https://example.com/careers', 'generic-html', NULL,
      1440, 1, NULL, 'idle', NULL, 0, NULL, '${now}', '${now}'
    );
    INSERT INTO jobs (
      id, company_id, source_job_id, source_type, title, location, employment_type,
      url, description_snippet, salary_min, salary_max, salary_currency, salary_text,
      post_date, created_at, last_seen_at, is_active, is_new, matched_filter_count
    ) VALUES (
      7401, 7400, 'application-materials-e2e', 'generic-html', 'Platform Engineer',
      'Remote', 'Full-time', 'https://example.com/jobs/platform-engineer',
      'Must have built production TypeScript services and APIs. Python required.',
      NULL, NULL, NULL, NULL, NULL, '${now}', '${now}', 1, 1, 0
    );
    COMMIT;
  `;
  await execFile(status.sqliteBinaryPath, [status.databasePath, seedSql]);

  evidenceId = await fixture.page.evaluate(async (seedApplication) => {
    await window.electronAPI.career.saveProfile({
      version: 2,
      fullName: "Taylor Example",
      homeLocation: "",
      radiusMiles: null,
      minimumPay: null,
      payBasis: "annual",
      targetTitles: [],
      skills: [],
      certifications: [],
      sectors: [],
      onCallPreference: "either",
      fullTimeOnly: false,
    });
    await window.electronAPI.career.migrateLegacy({
      profile: null,
      applications: [seedApplication],
    });
    const evidence = await window.electronAPI.career.createUserEvidence({
      subjectType: "achievement",
      statement: "Built production TypeScript services and APIs for customer-facing systems.",
      titleOrName: "Platform delivery",
      organization: "Example Labs",
      skills: ["TypeScript", "APIs"],
    });
    return evidence.id;
  }, application);
});

test.afterAll(async () => {
  await closeElectronApp(fixture);
});

test("application materials preserve factual evidence links and flag stale drafts", async () => {
  const { page } = fixture;
  await navigateTo(page, "/applications");

  const card = page.locator("article").filter({ hasText: application.title });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Application materials", exact: false }).click();
  await expect(card.getByText("No application materials prepared yet.", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Create cover letter", exact: true }).click();
  await expect(card.getByText("Cover letter v1", { exact: true })).toBeVisible();
  await expect(card.getByText("1 evidence links", { exact: true })).toBeVisible();
  await expect(card.getByText(/Built production TypeScript services and APIs for customer-facing systems/)).toBeVisible();
  await expect(card.getByText(/unsupported or ambiguous requirements/i)).toBeVisible();
  await expect(card.getByText(/Taylor Example/)).toBeVisible();

  // Copying through the single Copy text control writes the exact text and never submits,
  // marks the application applied, or changes its status. Electron's clipboard is substituted.
  const statusOf = () => page.evaluate(async (id) =>
    (await window.electronAPI.applications.list()).find((item) => item.id === id)?.status, application.id);
  expect(await statusOf()).toBe("interested");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => {
        (window as unknown as { __copiedMaterial?: string }).__copiedMaterial = text;
      } },
    });
  });
  const expected = await page.evaluate(async (id) => {
    const [letter] = await window.electronAPI.applicationMaterials.list(id);
    return letter.sections.map((section) => section.text).join("\n\n");
  }, application.id);
  await card.getByRole("button", { name: "Copy text of cover letter version 1" }).click();
  await expect(card.getByRole("status", { name: "Cover letter copy status" }))
    .toContainText("Cover letter version 1 copied");
  const copied = await page.evaluate(() =>
    (window as unknown as { __copiedMaterial?: string }).__copiedMaterial,
  );
  expect(copied).toBe(expected);
  expect(copied).toContain("Built production TypeScript services and APIs");
  expect(await statusOf()).toBe("interested");

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("Clipboard permission denied"); } },
    });
  });
  await card.getByRole("button", { name: "Copy text of cover letter version 1" }).click();
  await expect(card.getByRole("status", { name: "Cover letter copy status" }))
    .toContainText("Copy was unavailable");
  await expect(card.getByRole("status", { name: "Cover letter copy status" })).not.toContainText("copied");
  expect(await statusOf()).toBe("interested");

  await page.evaluate(async (id) => {
    await window.electronAPI.careerEvidence.supersedeEvidence(id, {
      subjectType: "achievement",
      statement: "Built and maintained production TypeScript APIs for internal systems.",
    });
  }, evidenceId);

  await page.reload();
  await navigateTo(page, "/applications");
  const reloadedCard = page.locator("article").filter({ hasText: application.title });
  await reloadedCard.getByRole("button", { name: "Application materials", exact: false }).click();
  await expect(reloadedCard.getByText("Cover letter v1", { exact: true })).toBeVisible();
  await expect(
    reloadedCard.getByText(/Supporting Career Evidence changed after this draft was created/i),
  ).toBeVisible();
  await expect(reloadedCard.getByRole("button", { name: "Copy text of cover letter version 1" })).toBeDisabled();
  expect(await statusOf()).toBe("interested");
});
