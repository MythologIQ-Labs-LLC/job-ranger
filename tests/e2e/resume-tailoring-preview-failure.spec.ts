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

async function runSql(sql: string) {
  const status = await fixture.page.evaluate(() => window.electronAPI.system.getStatus());
  await execFileAsync(status.sqliteBinaryPath, [status.databasePath, sql]);
}

test.beforeAll(async () => {
  fixture = await launchElectronApp();
});

test.afterAll(async () => {
  await closeElectronApp(fixture);
});

// A failed preview used to be reported only through the page banner, which the
// Resume page clears whenever it reloads in the background. The failure has to
// stay visible until the person acts on it.
test("a failed tailoring preview stays visible after the resume workspace reloads", async () => {
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
  await proposal.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Confirmed career evidence (1)", { exact: true })).toBeVisible();

  await navigateTo("Resume");
  await page.getByLabel("Name", { exact: true }).fill("Taylor Example");
  await page.getByLabel("Email", { exact: true }).fill("taylor@example.test");
  await page.getByRole("button", { name: "Create truthful draft", exact: true }).click();
  await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();

  const now = new Date().toISOString();
  await runSql(`
    INSERT INTO companies (
      id, name, url, source_type, frequency_minutes, is_active,
      last_run_status, created_at, updated_at
    ) VALUES (
      990011, 'Preview Failure Company', 'https://example.test/careers',
      'generic-html', 60, 1, 'idle', '${now}', '${now}'
    );
    INSERT INTO jobs (
      id, company_id, source_job_id, source_type, title, location,
      employment_type, url, description_snippet, created_at, last_seen_at,
      is_active, is_new, matched_filter_count
    ) VALUES (
      990012, 990011, 'preview-failure-role', 'generic-html',
      'Operations Program Manager', 'Annapolis, MD', 'Full-time',
      'https://example.test/careers/990012',
      'Must coordinate scheduling for regional field teams.',
      '${now}', '${now}', 1, 1, 0
    );
  `);
  await page.evaluate(() => {
    window.location.hash = "/resume?job=990012";
  });
  await expect(page.getByRole("heading", { name: "Tailor for this job", exact: true })).toBeVisible();

  // Remove the open draft behind the page's back so the preview request fails
  // while the workspace reload that follows still succeeds.
  const [projection] = await page.evaluate(() => window.electronAPI.resume.list());
  await runSql(`DELETE FROM resume_projections WHERE id = '${projection.id}';`);

  const failure = page.getByText(/Resume projection \S+ not found/);
  await page.getByRole("button", { name: "Preview tailoring", exact: true }).click();
  await expect(failure).toBeVisible();

  // A completed reload reselects the confirmed evidence in the same render that
  // clears the page banner, so "1 selected" proves the reload has finished.
  await page.getByRole("checkbox", { name: new RegExp(statement) }).uncheck();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await expect(page.getByText("No resume drafts yet.", { exact: true })).toBeVisible();
  await expect(failure).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Tailoring preview failed." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview tailoring", exact: true })).toBeEnabled();
});
