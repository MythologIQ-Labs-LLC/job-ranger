import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  launchElectronApp,
  closeElectronApp,
  type ElectronAppFixture,
} from "./electron-app";

const execFileAsync = promisify(execFile);
let fixture: ElectronAppFixture;

async function navigateTo(destination: "Career Profile" | "Resume") {
  const toggle = fixture.page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "My Career" });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await fixture.page.getByRole("link", { name: destination, exact: true }).click();
}

async function seedTargetJob() {
  const status = await fixture.page.evaluate(() => window.electronAPI.system.getStatus());
  const now = new Date().toISOString().replaceAll("'", "''");
  const sql = `
    INSERT OR REPLACE INTO companies (
      id, name, url, source_type, frequency_minutes, is_active,
      last_run_status, created_at, updated_at
    ) VALUES (
      990001, 'Tailoring Test Company', 'https://example.test/careers',
      'generic-html', 60, 1, 'idle', '${now}', '${now}'
    );
    INSERT OR REPLACE INTO jobs (
      id, company_id, source_job_id, source_type, title, location,
      employment_type, url, description_snippet, created_at, last_seen_at,
      is_active, is_new, matched_filter_count
    ) VALUES (
      990002, 990001, 'tailoring-test-role', 'generic-html',
      'Operations Program Manager', 'Annapolis, MD', 'Full-time',
      'https://example.test/careers/990002',
      'Must coordinate scheduling for regional field teams. PMP certification required.',
      '${now}', '${now}', 1, 1, 0
    );
  `;
  // The app may be writing at the same moment (opening a job rebuilds its
  // coverage), so wait for its lock the way the app's own client does.
  await execFileAsync(status.sqliteBinaryPath, ["-cmd", ".timeout 5000", status.databasePath, sql]);
}

test.beforeAll(async () => {
  fixture = await launchElectronApp();
});

test.afterAll(async () => {
  await closeElectronApp(fixture);
});

test("user previews, discards, and accepts a deterministic tailoring plan", async () => {
  const { page } = fixture;
  const statement = "Coordinated scheduling for regional field teams.";

  await navigateTo("Career Profile");
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page
    .getByText("Career history or resume text", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill([
      "# Professional Experience",
      "Operations Coordinator at Northstar Distribution | 2022 - Present",
      `- ${statement}`,
    ].join("\n"));
  await page.getByRole("button", { name: "Extract evidence", exact: true }).click();

  const proposal = page.locator("article").filter({
    has: page.locator("p").filter({ hasText: statement }),
  });
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    page.getByText("Confirmed career evidence (1)", { exact: true }),
  ).toBeVisible();

  await navigateTo("Resume");
  await page.getByLabel("Name", { exact: true }).fill("Taylor Example");
  await page.getByLabel("Email", { exact: true }).fill("taylor@example.test");
  await page.getByRole("button", { name: "Create truthful draft", exact: true }).click();
  await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();

  await seedTargetJob();
  await page.evaluate(() => {
    window.location.hash = "/resume?job=990002";
  });
  await expect(
    page.getByText("Targeting tracked job 990002.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Tailor for this job", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Preview tailoring", exact: true }).click();
  await expect(page.getByText("Requirements Sojourner will not claim", { exact: true })).toBeVisible();
  await expect(page.getByText(/PMP certification required/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create tailored draft", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Discard preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Preview tailoring", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create tailored draft", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Preview tailoring", exact: true }).click();
  await page.getByRole("button", { name: "Create tailored draft", exact: true }).click();

  await expect(
    page.getByText(
      "Tailored draft created. The source resume is unchanged, and unsupported requirements remain gaps.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Tailored draft", { exact: true })).toBeVisible();
  await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
});
