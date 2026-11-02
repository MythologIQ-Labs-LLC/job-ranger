import { test, expect } from "@playwright/test";
import {
  closeElectronApp,
  launchElectronApp,
  navigateTo,
  type ElectronAppFixture,
} from "./electron-app";

// Electron harness coverage for the opt-in career exploration handoff:
// the brief reaches the system clipboard only after explicit consent to the
// exact text, and applying an idea only fills the editor with an unsaved,
// inactive draft. Nothing is persisted until the existing Save action.

let fixture: ElectronAppFixture;
const statement = "Coordinated scheduling for an outdoor community education program.";
const sentinel = "clipboard-sentinel-before-consent";

const readClipboard = () => fixture.electronApp.evaluate(({ clipboard }) => clipboard.readText());

test.beforeAll(async () => {
  fixture = await launchElectronApp();
  await fixture.page.evaluate(async (text) => {
    await window.electronAPI.career.createUserEvidence({
      subjectType: "project",
      statement: text,
      titleOrName: "Community event coordination",
      skills: ["Coordination"],
    });
  }, statement);
  await fixture.electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), sentinel);
});

test.afterAll(async () => {
  await closeElectronApp(fixture);
});

test("copies the exploration brief only after explicit consent to the exact text", async () => {
  const { page } = fixture;
  await navigateTo(page, "/target-tracks");
  await page.locator("summary").filter({ hasText: "Explore career possibilities with an assistant" }).click();

  await page.getByLabel("Career exploration goal").fill(
    "Find a new career direction that values creativity and community involvement.",
  );
  const brief = page.getByLabel("Exact career exploration brief");
  const copy = page.getByRole("button", { name: "Copy reviewed brief" });
  const consent = page.getByRole("checkbox", {
    name: /I have reviewed this exact brief and choose to copy it/i,
  });

  // Evidence is never included by default.
  await expect(brief).toHaveValue(/none supplied; do not invent a work history/);
  await expect(brief).not.toHaveValue(new RegExp(statement));
  await page.getByRole("checkbox", { name: /Include confirmed Career Evidence/ }).check();
  await expect(brief).toHaveValue(new RegExp(statement));

  // No consent: the copy control is unavailable and the clipboard is untouched.
  await expect(consent).not.toBeChecked();
  await expect(copy).toBeDisabled();
  expect(await readClipboard()).toBe(sentinel);

  // Consent is bound to the exact text; editing the brief withdraws it.
  await consent.check();
  await expect(copy).toBeEnabled();
  await page.getByLabel("Preferences and aspirations").fill("A flexible, collaborative environment.");
  await expect(consent).not.toBeChecked();
  await expect(copy).toBeDisabled();
  expect(await readClipboard()).toBe(sentinel);

  await consent.check();
  await copy.click();
  await expect(page.getByRole("status")).toContainText("Brief copied locally");
  const exact = await brief.inputValue();
  // Windows may normalize clipboard newlines to CRLF; the content must otherwise match exactly.
  expect((await readClipboard()).replace(/\r\n/g, "\n")).toBe(exact.replace(/\r\n/g, "\n"));
  expect(exact).toContain(statement);
  expect(exact).toContain("A flexible, collaborative environment.");
});

test("applying an idea creates an unsaved, inactive draft and never persists it", async () => {
  const { page } = fixture;
  const persisted = () => page.evaluate(() => window.electronAPI.career.listTargetTracks());
  const evidenceCount = () => page.evaluate(async () =>
    (await window.electronAPI.career.listEvidence()).length);
  const before = await persisted();
  const evidenceBefore = await evidenceCount();

  const trackName = page.getByLabel("Track name", { exact: true });
  const active = page.getByRole("checkbox", { name: "Active", exact: true });
  const direction = page.getByLabel("Direction I want to explore");
  const start = page.getByRole("button", { name: "Start an unsaved, paused track draft" });
  const dialog = page.getByRole("dialog", { name: "Replace unsaved track changes?" });

  // A clean editor is replaced directly, with no prompt.
  await direction.fill("Community-centered design operations");
  await start.click();
  await expect(dialog).toHaveCount(0);
  await expect(trackName).toHaveValue("Community-centered design operations");
  await expect(active).not.toBeChecked();
  expect(await persisted()).toEqual(before);

  // Unsaved editor work is never discarded silently.
  await trackName.fill("My in-progress track edits");
  await direction.fill("Hospital logistics coordination");
  await start.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trackName).toHaveValue("My in-progress track edits");
  expect(await persisted()).toEqual(before);

  await start.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard changes and start draft" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trackName).toHaveValue("Hospital logistics coordination");
  await expect(active).not.toBeChecked();
  await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);

  // Nothing was written: tracks and Career Evidence are exactly as before.
  expect(await persisted()).toEqual(before);
  expect(await evidenceCount()).toBe(evidenceBefore);

  // Reloading drops the unsaved draft; it was never persisted.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  expect(await persisted()).toEqual(before);
  await expect(page.getByRole("button", { name: /Hospital logistics coordination/ })).toHaveCount(0);
});
