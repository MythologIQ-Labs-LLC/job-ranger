// Google Drive export through the real Electron main/renderer boundary (#314).
// Every Google request goes to an in-process fake server through the
// non-packaged JOB_RANGER_GOOGLE_TEST_BASE_URL override; shell.openExternal is
// replaced in the main process so the "system browser" is a fetch that follows
// the fake authorize redirect to the app's loopback receiver.
import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launchElectronApp, navigateTo, type ElectronAppFixture } from "./electron-app";

const require = createRequire(import.meta.url);
const { createFakeGoogle } = require("../support/fake-google-drive.cjs") as {
  createFakeGoogle: (options?: Record<string, unknown>) => FakeGoogle;
};

interface FakeFile { id: string; bytes: Buffer | null; appProperties: Record<string, string> }
interface FakeGoogle {
  state: {
    counts: { uploadPosts: number; folderCreates: number };
    faults: { nextUpload: string | null };
    revoked: string[];
    files: Map<string, FakeFile>;
  };
  listen: () => Promise<{ baseUrl: string; close: () => Promise<void> }>;
  uploadedFiles: () => FakeFile[];
}

const CLIENT_ID = "1234567890-e2edrive.apps.googleusercontent.com";
const ACCOUNT = "drive-tester@example.test";
const CREDENTIAL_FILE = "google-drive-credential.bin";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function launch(baseUrl: string, userDataDir?: string, timeoutMs = "4000"): Promise<ElectronAppFixture> {
  const fixture = await launchElectronApp({
    userDataDir,
    env: {
      JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: CLIENT_ID,
      JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: "GOCSPX-e2e-not-a-secret",
      JOB_RANGER_GOOGLE_TEST_BASE_URL: baseUrl,
      JOB_RANGER_GOOGLE_TEST_TIMEOUT_MS: timeoutMs,
    },
  });
  await fixture.electronApp.evaluate(({ shell }, fakeOrigin) => {
    const opened: string[] = [];
    (globalThis as { __driveOpened?: string[] }).__driveOpened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
      // Plays the system browser for sign-in only; Drive links are just recorded.
      if (url.startsWith(fakeOrigin)) void fetch(url).catch(() => undefined);
    };
  }, baseUrl);
  return fixture;
}

async function openedUrls(fixture: ElectronAppFixture): Promise<string[]> {
  return fixture.electronApp.evaluate(() => [...((globalThis as { __driveOpened?: string[] }).__driveOpened ?? [])]);
}

async function connectInSettings(page: Page) {
  await navigateTo(page, "/settings");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Google Drive", exact: true }) });
  await expect(panel.getByText("Job Ranger can only see files it creates in your Drive (drive.file).", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Connect Google Drive", exact: true }).click();
  await expect(panel.getByTestId("drive-account")).toHaveText(`Connected as ${ACCOUNT}`, { timeout: 20_000 });
  return panel;
}

async function createVerifiedPdf(page: Page, expectedVersion: number) {
  if (expectedVersion === 1) {
    const statement = "Coordinated scheduling for regional field teams.";
    await navigateTo(page, "/career-profile");
    await page.getByRole("button", { name: "Paste text", exact: true }).click();
    await page.getByText("Career history or resume text", { exact: true }).locator("..").getByRole("textbox").fill([
      "# Professional Experience",
      "Operations Coordinator at Northstar Distribution | 2022 - Present",
      `- ${statement}`,
    ].join("\n"));
    await page.getByRole("button", { name: "Extract evidence", exact: true }).click();
    const proposal = page.locator("article").filter({ has: page.locator("p").filter({ hasText: statement }) });
    await proposal.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText("Confirmed career evidence (1)", { exact: true })).toBeVisible();
    await navigateTo(page, "/resume");
    await page.getByLabel("Name", { exact: true }).fill("Taylor Example");
    await page.getByLabel("Email", { exact: true }).fill("taylor@example.test");
    await page.getByRole("button", { name: "Create truthful draft", exact: true }).click();
    await expect(page.getByText("Truth Gate passed", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Export verified PDF", exact: true }).click();
  await expect(page.getByText(`PDF v${expectedVersion} passed the gates and was saved locally.`, { exact: true })).toBeVisible({ timeout: 30_000 });
  return page.getByTestId(`resume-artifact-v${expectedVersion}`);
}

async function localPdf(userDataDir: string, version: number): Promise<Buffer> {
  const directory = path.join(userDataDir, "data", "artifacts", "resumes");
  const name = (await fs.readdir(directory)).find((file) => file.endsWith(`-v${version}.pdf`));
  if (!name) throw new Error(`PDF v${version} not found`);
  return fs.readFile(path.join(directory, name));
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 20_000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test.describe("Google Drive export", () => {
  test("connect, review, approve, verify receipt, retry without duplicates, and disconnect", async () => {
    test.setTimeout(180_000);
    const fake = createFakeGoogle({ clientId: CLIENT_ID, email: ACCOUNT });
    const server = await fake.listen();
    const fixture = await launch(server.baseUrl);
    const { page, tempDataDir } = fixture;
    try {
      const settings = await connectInSettings(page);
      await expect(settings.getByText(/encrypted by your operating system/)).toBeVisible();
      const stored = await fs.readFile(path.join(tempDataDir, CREDENTIAL_FILE));
      expect(stored.toString("latin1")).not.toContain("fake-refresh");

      const row = await createVerifiedPdf(page, 1);
      await row.getByRole("button", { name: "Save to Google Drive", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Save to Google Drive" });
      await expect(dialog.getByTestId("drive-file-name")).toHaveText("Taylor Example - Resume v1.pdf");
      await expect(dialog.getByTestId("drive-destination")).toHaveText("My Drive › Job Ranger");
      await expect(dialog.getByTestId("drive-review-account")).toHaveText(ACCOUNT);
      await expect(dialog.getByTestId("drive-generated-for")).toHaveText(/General resume · ATS-safe standard/);
      await expect(dialog.getByText("PDF · version 1", { exact: true })).toBeVisible();
      const local = await localPdf(tempDataDir, 1);
      await expect(dialog.getByTestId("drive-sha256").locator("span")).toHaveAttribute("title", sha256(local));
      expect(fake.state.counts.uploadPosts, "nothing uploads before approval").toBe(0);

      await dialog.getByRole("button", { name: "Approve and upload", exact: true }).click();
      await expect(dialog.getByText("Saved to Google Drive and verified.", { exact: true })).toBeVisible({ timeout: 20_000 });
      const driveFileId = (await dialog.getByTestId("drive-receipt-id").textContent())?.trim() ?? "";
      const uploaded = fake.state.files.get(driveFileId);
      expect(uploaded?.bytes && sha256(uploaded.bytes)).toBe(sha256(local));
      await dialog.getByRole("button", { name: "Open in Google Drive", exact: true }).click();
      await expect.poll(async () => (await openedUrls(fixture)).at(-1)).toBe(`https://drive.google.com/file/d/${driveFileId}/view`);
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(row.getByTestId("drive-row-status")).toContainText("Saved to Google Drive");

      // A second approval of the same artifact must be an explicit choice.
      await row.getByRole("button", { name: "Save to Google Drive", exact: true }).click();
      await expect(dialog.getByText(/Already saved to Drive on/)).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Save another copy", exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Approve and upload", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");

      // Injected timeout after Drive stored the file: Retry reconciles without a second upload.
      const row2 = await createVerifiedPdf(page, 2);
      fake.state.faults.nextUpload = "hang";
      await row2.getByRole("button", { name: "Save to Google Drive", exact: true }).click();
      await dialog.getByRole("button", { name: "Approve and upload", exact: true }).click();
      await expect(dialog.getByTestId("drive-error")).toContainText("did not answer in time", { timeout: 20_000 });
      expect(fake.state.counts.uploadPosts).toBe(2);
      await dialog.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(dialog.getByText("Saved to Google Drive and verified.", { exact: true })).toBeVisible({ timeout: 20_000 });
      expect(fake.state.counts.uploadPosts, "retry found the stored file instead of uploading again").toBe(2);
      const local2 = await localPdf(tempDataDir, 2);
      const copies = fake.uploadedFiles().filter((file) => file.bytes && sha256(file.bytes) === sha256(local2));
      expect(copies).toHaveLength(1);
      expect(fake.state.counts.folderCreates).toBe(1);
      await dialog.getByRole("button", { name: "Done", exact: true }).click();

      // Disconnect revokes at Google and deletes the stored credential.
      await navigateTo(page, "/settings");
      const panel = page.locator("section", { has: page.getByRole("heading", { name: "Google Drive", exact: true }) });
      await panel.getByRole("button", { name: "Disconnect Google Drive", exact: true }).click();
      await expect(panel.getByText(/revoked its access and deleted the stored sign-in/)).toBeVisible();
      expect(fake.state.revoked).toHaveLength(1);
      await expect(fs.access(path.join(tempDataDir, CREDENTIAL_FILE))).rejects.toThrow();
      await expect(panel.getByRole("button", { name: "Connect Google Drive", exact: true })).toBeVisible();
      const signIns = (await openedUrls(fixture)).filter((url) => url.startsWith(server.baseUrl));
      expect(signIns).toHaveLength(1);
      const authorize = new URL(signIns[0]);
      expect(authorize.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authorize.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await fixture.electronApp.close().catch(() => undefined);
      await server.close();
      await fs.rm(tempDataDir, { recursive: true, force: true });
    }
  });

  test("an upload interrupted by an app crash is reconciled after relaunch, never re-posted", async () => {
    test.setTimeout(180_000);
    const fake = createFakeGoogle({ clientId: CLIENT_ID, email: ACCOUNT });
    const server = await fake.listen();
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-e2e-drive-crash-"));
    let fixture = await launch(server.baseUrl, userDataDir, "60000");
    try {
      await connectInSettings(fixture.page);
      const row = await createVerifiedPdf(fixture.page, 1);
      fake.state.faults.nextUpload = "hang";
      await row.getByRole("button", { name: "Save to Google Drive", exact: true }).click();
      await fixture.page.getByRole("dialog", { name: "Save to Google Drive" }).getByRole("button", { name: "Approve and upload", exact: true }).click();
      await waitFor(() => fake.state.counts.uploadPosts === 1, "the upload to reach Drive");
      fixture.electronApp.process().kill("SIGKILL");
      await fixture.electronApp.close().catch(() => undefined);

      fixture = await launch(server.baseUrl, userDataDir, "60000");
      const { page } = fixture;
      await navigateTo(page, "/resume");
      await page.getByRole("button", { name: /ATS-safe standard/ }).first().click();
      const relaunchedRow = page.getByTestId("resume-artifact-v1");
      await expect(relaunchedRow.getByTestId("drive-row-status")).toHaveText(/upload not confirmed/);
      await relaunchedRow.getByRole("button", { name: "Save to Google Drive", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Save to Google Drive" });
      await expect(dialog.getByText(/An earlier upload of this PDF was not confirmed/)).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Approve and upload", exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Retry upload", exact: true }).click();
      await expect(dialog.getByText("Saved to Google Drive and verified.", { exact: true })).toBeVisible({ timeout: 20_000 });
      expect(fake.state.counts.uploadPosts, "the crashed upload was found by operation id").toBe(1);
      const local = await localPdf(userDataDir, 1);
      expect(fake.uploadedFiles().map((file) => file.bytes && sha256(file.bytes))).toEqual([sha256(local)]);
    } finally {
      await fixture.electronApp.close().catch(() => undefined);
      await server.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  });
});
