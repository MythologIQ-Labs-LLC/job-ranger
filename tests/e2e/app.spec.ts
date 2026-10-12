import { test, expect } from "@playwright/test";
import { launchElectronApp, closeElectronApp, type ElectronAppFixture } from "./electron-app";

let fixture: ElectronAppFixture;

test.beforeAll(async () => {
  fixture = await launchElectronApp();
});

test.afterAll(async () => {
  await closeElectronApp(fixture);
});

async function navigateTo(
  page: ElectronAppFixture["page"],
  destination:
    | "Home"
    | "Find Jobs"
    | "Applications"
    | "Career Profile"
    | "Resume"
    | "Companies"
    | "Filters"
    | "Settings",
) {
  await page.getByRole("link", { name: destination, exact: true }).click();
}

test.describe("Job Ranger E2E Tests", () => {
  test("app launches and shows dashboard", async () => {
    const { page } = fixture;

    await expect(page.getByRole("heading", { name: "Job Ranger", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Build a calmer review ritual around the jobs you actually want.",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("dashboard next-step prompts are real navigation", async () => {
    const { page } = fixture;

    await navigateTo(page, "Home");
    const sourceAction = page.getByRole("link", { name: "Add a job source", exact: true }).first();
    await expect(sourceAction).toBeVisible();
    await sourceAction.click();
    await expect(
      page.getByRole("heading", {
        name: "Find places to look, then choose what Job Ranger should monitor.",
        exact: true,
      }),
    ).toBeVisible();

    await navigateTo(page, "Home");
    const filterAction = page.getByRole("link", { name: "Set up filters", exact: true });
    await expect(filterAction).toBeVisible();
    await filterAction.click();
    await expect(
      page.getByRole("heading", {
        name: "Build filters that coach the next scrape toward relevance.",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("career profile is occupation agnostic and supports annual pay", async () => {
    const { page } = fixture;

    await navigateTo(page, "Career Profile");
    await expect(page.getByText("HVAC starter", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Broaden the search, not your résumé", exact: true }),
    ).toBeVisible();

    const payBasis = page.getByRole("combobox", { name: "Pay basis", exact: true });
    await expect(payBasis).toBeVisible();
    await payBasis.selectOption("annual");
    await expect(payBasis).toHaveValue("annual");
  });

  test("pasted resume text becomes reviewable evidence before it becomes truth", async () => {
    const { page } = fixture;
    const statement = "Coordinated scheduling for regional field teams.";

    await navigateTo(page, "Career Profile");
    await page.getByRole("button", { name: "Paste text", exact: true }).click();
    await page.getByText("Career history or resume text", { exact: true }).locator("..").getByRole("textbox").fill([
      "# Professional Experience",
      "Operations Coordinator at Northstar Distribution | 2022 - Present",
      `- ${statement}`,
      "# Skills",
      "Scheduling, Vendor coordination",
    ].join("\n"));
    await page.getByRole("button", { name: "Extract evidence", exact: true }).click();

    const proposal = page.locator("article").filter({
      has: page.locator("p").filter({ hasText: statement }),
    });
    await expect(proposal).toBeVisible();
    await expect(page.getByText("Confirmed career evidence (1)", { exact: true })).toHaveCount(0);

    await proposal.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(proposal).toHaveCount(0);
    await expect(
      page.getByText("Confirmed career evidence (1)", { exact: true }),
    ).toBeVisible();
  });

  test("confirmed Career Evidence produces a verified resume PDF", async () => {
    const { page } = fixture;

    await navigateTo(page, "Resume");
    await expect(
      page.getByRole("heading", {
        name: "Build the document from facts you have actually confirmed.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("Taylor Example");
    await page.getByLabel("Email", { exact: true }).fill("taylor@example.com");
    await page.getByRole("button", { name: "Create truthful draft", exact: true }).click();

    await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Resume draft created from confirmed Career Evidence.", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Export verified PDF", exact: true }).click();
    await expect(
      page.getByText("PDF v1 passed the gates and was saved locally.", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("PDF v1", { exact: true })).toBeVisible();
    await expect(page.getByText(/1 page · Passed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Show file", exact: true })).toBeVisible();
  });

  test("navigation sidebar works", async () => {
    const { page } = fixture;

    await navigateTo(page, "Companies");
    await expect(
      page.getByRole("heading", {
        name: "Find places to look, then choose what Job Ranger should monitor.",
        exact: true,
      }),
    ).toBeVisible();

    await navigateTo(page, "Find Jobs");
    await expect(
      page.getByRole("heading", {
        name: "Spend your time on the jobs that look worth it.",
        exact: true,
      }),
    ).toBeVisible();

    await navigateTo(page, "Applications");
    await expect(
      page.getByRole("heading", {
        name: "Keep track of what happens after a job looks promising.",
        exact: true,
      }),
    ).toBeVisible();

    await navigateTo(page, "Career Profile");
    await expect(
      page.getByRole("heading", {
        name: "Tell Job Ranger what good work looks like for you.",
        exact: true,
      }),
    ).toBeVisible();

    await navigateTo(page, "Resume");
    await expect(
      page.getByRole("heading", {
        name: "Build the document from facts you have actually confirmed.",
        exact: true,
      }),
    ).toBeVisible();

    await navigateTo(page, "Filters");
    await expect(
      page.getByRole("heading", {
        name: "Build filters that coach the next scrape toward relevance.",
        exact: true,
      }),
    ).toBeVisible();

    await navigateTo(page, "Settings");
    await expect(
      page.getByRole("heading", {
        name: "Shape the workspace around how you actually review opportunities.",
        exact: true,
      }),
    ).toBeVisible();

    await navigateTo(page, "Home");
    await expect(
      page.getByRole("heading", {
        name: "Build a calmer review ritual around the jobs you actually want.",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("companies page shows empty state", async () => {
    const { page } = fixture;

    await navigateTo(page, "Companies");
    await expect(page.getByText("Monitored sources", { exact: true })).toBeVisible();
  });

  test("can open add company modal", async () => {
    const { page } = fixture;

    await navigateTo(page, "Companies");
    await page.getByRole("button", { name: "Add a source manually", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Add job source", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#company-name")).toBeVisible();
    await expect(dialog.locator("#company-url")).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("can add a company source", async () => {
    const { page } = fixture;

    await navigateTo(page, "Companies");
    await page.getByRole("button", { name: "Add a source manually", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Add job source", exact: true });
    await dialog.locator("#company-name").fill("Test Company");
    await dialog.locator("#company-url").fill("https://boards.greenhouse.io/testcompany");
    await dialog.getByRole("button", { name: "Save source", exact: true }).click();

    await expect(page.getByText("Test Company", { exact: true })).toBeVisible();
    await expect(page.getByText("Greenhouse", { exact: true })).toBeVisible();
  });

  test("jobs page loads", async () => {
    const { page } = fixture;

    await navigateTo(page, "Find Jobs");
    await expect(
      page.getByRole("heading", {
        name: "Spend your time on the jobs that look worth it.",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("filters page shows empty state", async () => {
    const { page } = fixture;

    await navigateTo(page, "Filters");
    await expect(page.getByRole("heading", { name: "No filters yet", exact: true })).toBeVisible();
  });

  test("can open add filter modal", async () => {
    const { page } = fixture;

    await navigateTo(page, "Filters");
    await page.getByRole("button", { name: "Create filter", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Create filter", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Filter name", { exact: true })).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("settings page shows configuration options", async () => {
    const { page } = fixture;

    await navigateTo(page, "Settings");

    await expect(page.getByRole("heading", { name: "Functional themes", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Runtime behavior", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save runtime settings", exact: true }),
    ).toBeVisible();
  });

  test("can toggle notification settings", async () => {
    const { page } = fixture;

    await navigateTo(page, "Settings");

    const notificationCheckbox = page.getByRole("checkbox", {
      name: "Enable desktop notifications",
      exact: true,
    });
    const initialChecked = await notificationCheckbox.isChecked();

    await notificationCheckbox.click();
    await expect(notificationCheckbox).toBeChecked({ checked: !initialChecked });
  });

  test("can delete a company", async () => {
    const { page } = fixture;

    await navigateTo(page, "Companies");

    const company = page.getByText("Test Company", { exact: true });
    if ((await company.count()) > 0) {
      const row = page.getByRole("row").filter({ has: company });
      await row.getByRole("button", { name: "Remove source Test Company", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Remove job source?", exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Remove source", exact: true }).click();
      await expect(row).toHaveCount(0);
    }
  });
});
