import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { closeElectronApp, launchElectronApp, navigateTo, type ElectronAppFixture } from "./electron-app";

let fixture: ElectronAppFixture;

test.beforeAll(async () => {
  fixture = await launchElectronApp({ showOnboarding: true });
});

test.afterAll(async () => {
  await closeElectronApp(fixture);
});

test.describe("progressive first-run onboarding", () => {
  test("fresh users can start from a resume, manual entry, or goals", async () => {
    const { page } = fixture;

    await expect(
      page.getByRole("heading", { name: "Start with what you already have.", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "I already have a resume", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "I do not have a resume handy", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "I know what I want to look for", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import a resume", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter my background", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save goals and continue", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip setup for now", exact: true })).toBeVisible();
  });

  test("required goal constraints fail closed until they have values", async () => {
    const { page } = fixture;

    await page.getByLabel("Work I want to pursue", { exact: true }).fill("Operations Coordinator");

    await page
      .getByRole("combobox", { name: "Onboarding location importance", exact: true })
      .selectOption("required");
    await page.getByRole("button", { name: "Save goals and continue", exact: true }).click();
    await expect(
      page.getByText("Add a home area before making location a requirement.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Onboarding location importance", exact: true })
      .selectOption("preferred");

    await page
      .getByRole("combobox", { name: "Onboarding work mode importance", exact: true })
      .selectOption("required");
    await page.getByRole("button", { name: "Save goals and continue", exact: true }).click();
    await expect(
      page.getByText("Choose at least one work mode before making work mode a requirement.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Onboarding work mode importance", exact: true })
      .selectOption("preferred");

    await page
      .getByRole("combobox", { name: "Onboarding pay importance", exact: true })
      .selectOption("required");
    await page.getByRole("button", { name: "Save goals and continue", exact: true }).click();
    await expect(
      page.getByText("Add a minimum pay before making compensation a requirement.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Onboarding pay importance", exact: true })
      .selectOption("preferred");
  });

  test("goal-first setup persists an explicit target track and enters the workspace", async () => {
    const { page } = fixture;

    await page.evaluate(() => {
      window.location.hash = "#/onboarding";
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Start with what you already have.", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Work I want to pursue", { exact: true }).fill(
      "Customer Success Manager\nImplementation Manager",
    );
    await page.getByLabel("Home area", { exact: true }).fill("Annapolis, MD");
    await page
      .getByRole("combobox", { name: "Onboarding location importance", exact: true })
      .selectOption("required");
    await page.getByLabel("Remote", { exact: true }).check();
    await page
      .getByRole("combobox", { name: "Onboarding work mode importance", exact: true })
      .selectOption("required");
    await page.getByLabel("Onboarding minimum pay", { exact: true }).fill("90000");
    await page
      .getByRole("combobox", { name: "Onboarding pay basis", exact: true })
      .selectOption("annual");
    await page
      .getByRole("combobox", { name: "Onboarding pay importance", exact: true })
      .selectOption("required");
    await page.getByRole("button", { name: "Save goals and continue", exact: true }).click();

    await expect(
      page.getByRole("heading", {
        name: "Your next steps",
        exact: true,
      }),
    ).toBeVisible();

    const track = await page.evaluate(async () => {
      const tracks = await window.electronAPI.career.listTargetTracks();
      return tracks.find((item) => item.id === "legacy-default") ?? null;
    });
    expect(track).not.toBeNull();
    expect(track?.origin).toBe("user");
    expect(track?.roleTitles).toEqual([
      "Customer Success Manager",
      "Implementation Manager",
    ]);
    expect(track?.constraints.geography).toMatchObject({
      locations: ["Annapolis, MD"],
      strength: "required",
    });
    expect(track?.constraints.workModes).toEqual({
      values: ["remote"],
      strength: "required",
    });
    expect(track?.constraints.compensation).toMatchObject({
      floor: 90000,
      basis: "annual",
      floorStrength: "required",
    });
    expect(track?.constraints.employmentArrangements.values).toEqual([]);

    await navigateTo(page, "/career-profile");
    await expect(page.getByLabel("Home area", { exact: true })).toHaveValue("Annapolis, MD");
    await expect(
      page.getByText("Roles you would consider", { exact: true }).locator("..").getByRole("textbox"),
    ).toHaveValue("Customer Success Manager\nImplementation Manager");
    await expect(page.getByRole("combobox", { name: "Pay basis", exact: true })).toHaveValue("annual");

    await navigateTo(page, "/");
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Your next steps",
        exact: true,
      }),
    ).toBeVisible();

    const persistedTrack = await page.evaluate(async () => {
      const tracks = await window.electronAPI.career.listTargetTracks();
      return tracks.find((item) => item.id === "legacy-default") ?? null;
    });
    expect(persistedTrack?.origin).toBe("user");
    expect(persistedTrack?.constraints.workModes).toEqual({
      values: ["remote"],
      strength: "required",
    });
  });

  test("manual-entry path creates durable user-authored Career Evidence", async () => {
    const { page } = fixture;
    const statement = "Built a volunteer scheduling tool for a community food pantry.";

    await page.evaluate(() => {
      window.location.hash = "#/onboarding";
    });
    await expect(
      page.getByRole("heading", { name: "Start with what you already have.", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Enter my background", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Build your career evidence one fact at a time.",
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole("combobox", { name: "Evidence type", exact: true }).selectOption("project");
    await page
      .getByText("What did you do, know, earn, or accomplish?", { exact: true })
      .locator("..")
      .getByRole("textbox")
      .fill(statement);
    await page.getByRole("button", { name: "Add career evidence", exact: true }).click();
    await expect(page.getByText("Saved as user-authored evidence", { exact: true })).toBeVisible();

    const authored = await page.evaluate(async (expectedStatement) => {
      const items = await window.electronAPI.career.listEvidence();
      return items.find(({ evidence }) => evidence.statement === expectedStatement) ?? null;
    }, statement);
    expect(authored).not.toBeNull();
    expect(authored?.evidence.verificationState).toBe("user-authored");
    expect(authored?.sources).toEqual([]);

    await page.reload();
    const persisted = await page.evaluate(async (expectedStatement) => {
      const items = await window.electronAPI.career.listEvidence();
      return items.some(
        ({ evidence }) =>
          evidence.statement === expectedStatement &&
          evidence.verificationState === "user-authored",
      );
    }, statement);
    expect(persisted).toBe(true);

    await page.getByRole("button", { name: "Continue to Career Profile", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Tell Job Ranger what good work looks like for you.",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("resume-first uses the native file dialog and persists imported evidence after restart", async () => {
    const { page, electronApp, tempDataDir } = fixture;
    const resumePath = path.join(tempDataDir, "onboarding-resume.txt");
    const resumeText = [
      "Taylor Example",
      "Customer Success Manager at Example Company",
      "Led enterprise onboarding programs and implementation planning.",
      "Built customer enablement playbooks and cross-functional launch processes.",
    ].join("\n");
    await fs.writeFile(resumePath, resumeText, "utf8");

    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
        bookmarks: [],
      });
    }, resumePath);

    await page.evaluate(() => {
      window.location.hash = "#/onboarding";
    });
    await expect(
      page.getByRole("heading", { name: "Start with what you already have.", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Import a resume", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Tell Job Ranger what good work looks like for you.",
        exact: true,
      }),
    ).toBeVisible();

    const imported = await page.evaluate(async () => {
      const artifacts = await window.electronAPI.career.listSourceArtifacts();
      const evidence = await window.electronAPI.career.listEvidence();
      return {
        artifact: artifacts.find((item) => item.originalName === "onboarding-resume.txt") ?? null,
        evidenceCount: evidence.filter(({ sources }) =>
          sources.some((source) => source.originalName === "onboarding-resume.txt"),
        ).length,
      };
    });
    expect(imported.artifact).not.toBeNull();
    expect(["review-required", "extracted"]).toContain(imported.artifact?.extractionState);
    expect(imported.evidenceCount).toBeGreaterThan(0);

    await page.reload();
    const persisted = await page.evaluate(async () => {
      const artifacts = await window.electronAPI.career.listSourceArtifacts();
      const evidence = await window.electronAPI.career.listEvidence();
      return {
        artifactPresent: artifacts.some(
          (item) => item.originalName === "onboarding-resume.txt",
        ),
        evidencePresent: evidence.some(({ sources }) =>
          sources.some((source) => source.originalName === "onboarding-resume.txt"),
        ),
      };
    });
    expect(persisted).toEqual({ artifactPresent: true, evidencePresent: true });
  });
});
