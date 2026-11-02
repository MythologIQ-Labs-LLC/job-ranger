// Windows (Electron) Google Drive export through the real main/renderer boundary (#314).
// Every Google request goes to an in-process fake (tests/support/fake-google-drive.cjs)
// through the non-packaged JOB_RANGER_GOOGLE_TEST_BASE_URL override; shell.openExternal
// is replaced in the main process so the "system browser" follows the fake authorize
// redirect to the app's 127.0.0.1 loopback receiver. The verified PDF is produced by the
// real ResumeService and renderer. No real Google endpoint is contacted.
import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { closeElectronApp, launchElectronApp, navigateTo, type ElectronAppFixture } from "./electron-app";

const require = createRequire(import.meta.url);
const { createFakeGoogle } = require("../support/fake-google-drive.cjs") as {
  createFakeGoogle: (options?: Record<string, unknown>) => FakeGoogle;
};

interface FakeFile { id: string; owner: string; bytes: Buffer; parents: string[] }
interface FakeGoogle {
  state: {
    counts: { uploadPosts: number; conflicts: number; tokenExchanges: number; gets: number };
    faults: { nextUpload: string | null; root: string | null };
    revoked: string[];
    refreshTokens: Map<string, string>;
    files: Map<string, FakeFile>;
  };
  listen: () => Promise<{ baseUrl: string; close: () => Promise<void> }>;
  uploadedFiles: () => FakeFile[];
}

const CLIENT_ID = "1234567890-e2edrive.apps.googleusercontent.com";
const ACCOUNT = "drive-tester@example.test";
const CREDENTIAL_FILE = "google-drive-credential.bin";

let google: FakeGoogle;
let server: { baseUrl: string; close: () => Promise<void> };
let fixture: ElectronAppFixture | null = null;

test.beforeEach(async () => {
  google = createFakeGoogle({ clientId: CLIENT_ID });
  server = await google.listen();
});

test.afterEach(async () => {
  if (fixture) await closeElectronApp(fixture);
  fixture = null;
  await server.close();
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function launch(options: { userDataDir?: string; configured?: boolean } = {}): Promise<ElectronAppFixture> {
  const configured = options.configured ?? true;
  const launched = await launchElectronApp({
    userDataDir: options.userDataDir,
    env: configured ? {
      JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: CLIENT_ID,
      JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: "GOCSPX-e2e-not-a-secret",
      JOB_RANGER_GOOGLE_TEST_BASE_URL: server.baseUrl,
      JOB_RANGER_GOOGLE_TEST_TIMEOUT_MS: "8000",
    } : {
      JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: "",
      JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: "",
      JOB_RANGER_GOOGLE_TEST_BASE_URL: server.baseUrl,
    },
  });
  await launched.electronApp.evaluate(({ shell }, fakeOrigin) => {
    const opened: string[] = [];
    (globalThis as { __driveOpened?: string[] }).__driveOpened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
      // Plays the system browser for sign-in only; Drive links are just recorded.
      if (url.startsWith(`${fakeOrigin}/o/oauth2/v2/auth`)) void fetch(url).catch(() => undefined);
    };
  }, server.baseUrl);
  return launched;
}

async function openedUrls(app: ElectronAppFixture): Promise<string[]> {
  return app.electronApp.evaluate(() => [...((globalThis as { __driveOpened?: string[] }).__driveOpened ?? [])]);
}

/** A real Truth-Gated resume exported to a verified PDF through the Electron main process. */
async function seedVerifiedPdf(page: Page): Promise<{ artifactId: string; contentHash: string; managedPath: string }> {
  return page.evaluate(async () => {
    const api = window.electronAPI;
    const evidence = await api.career.createUserEvidence({
      subjectType: "role", organization: "Harbor Family Clinic", titleOrName: "Patient Services Coordinator",
      startDate: "2023-01", endDate: null,
      statement: "Coordinated patient scheduling, referrals and insurance verification for six providers.",
      skills: ["Patient scheduling"], methodsOrTools: [], scope: [], outcomes: [], metrics: [], credential: null,
    });
    const resume = await api.resume.create({
      jobId: null, context: "private-sector", pageFormat: "letter", templateId: "ats-standard-v1",
      contact: { fullName: "Morgan Rivera", email: "morgan.rivera@example.org", phone: "", location: "Baltimore, MD", links: [] },
      selectedEvidenceIds: [evidence.id],
    });
    if (!resume.truthGate.passed) throw new Error("Truth Gate did not pass");
    const exported = await api.resume.exportPdf({ projectionId: resume.projection.id });
    if (!exported.parseabilityGate.passed) throw new Error("Parseability Gate did not pass");
    return { artifactId: exported.artifact.id, contentHash: exported.artifact.contentHash, managedPath: exported.artifact.managedPath };
  });
}

async function openDrivePanel(page: Page) {
  await navigateTo(page, "/resume");
  await page.getByRole("button", { name: /ATS-safe standard/ }).first().click();
  const panel = page.getByTestId("drive-resume-export");
  await expect(panel).toBeVisible();
  return panel;
}

async function connect(page: Page) {
  const panel = page.getByTestId("drive-resume-export");
  await panel.getByRole("button", { name: "Connect Google Drive", exact: true }).click();
  await expect(panel.getByRole("status").first()).toContainText(`Google Drive is connected as ${ACCOUNT}`, { timeout: 20_000 });
}

async function reviewAndConfirm(page: Page) {
  const panel = page.getByTestId("drive-resume-export");
  await panel.getByRole("button", { name: "Review PDF for Drive" }).click();
  const review = panel.getByTestId("drive-export-review");
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Confirm and upload this PDF" }).click();
}

function journalRows(userDataDir: string): Array<{ status: string; reservedFileId: string; remoteId: string | null; resolution: string | null }> {
  const sqlite = process.env.SQLITE3_PATH;
  if (!sqlite) throw new Error("SQLITE3_PATH is required for the Electron E2E.");
  const output = execFileSync(sqlite, ["-json", path.join(userDataDir, "data", "jobscout.sqlite3"),
    "SELECT record_json FROM google_drive_export_journal ORDER BY updated_at;"], { encoding: "utf8" }).trim();
  return output ? (JSON.parse(output) as Array<{ record_json: string }>).map((row) => JSON.parse(row.record_json)) : [];
}

async function credentialStorage(page: Page): Promise<string> {
  return page.evaluate(async () => (await window.electronAPI.drive.status()).credentialStorage);
}

test("without a Desktop OAuth client the Windows app shows no Drive export and contacts no Google endpoint", async () => {
  fixture = await launch({ configured: false });
  const { page } = fixture;
  await seedVerifiedPdf(page);
  await navigateTo(page, "/resume");
  await page.getByRole("button", { name: /ATS-safe standard/ }).first().click();
  await expect(page.getByText("PDF v1", { exact: true })).toBeVisible();
  await expect(page.getByTestId("drive-resume-export")).toHaveCount(0);
  const status = await page.evaluate(() => window.electronAPI.drive.status());
  expect(status.available).toBe(false);
  expect(google.state.counts.tokenExchanges + google.state.counts.gets + google.state.counts.uploadPosts).toBe(0);
});

test("connect, review, confirm: the reserved file is created once, verified, and the link opens in the browser", async () => {
  fixture = await launch();
  const { page, tempDataDir } = fixture;
  const seeded = await seedVerifiedPdf(page);
  const panel = await openDrivePanel(page);
  await expect(panel.getByRole("button", { name: "Review PDF for Drive" })).toHaveCount(0);
  await connect(page);
  const authorize = new URL((await openedUrls(fixture)).find((url) => url.includes("/o/oauth2/v2/auth"))!);
  expect(authorize.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(new URL(authorize.searchParams.get("redirect_uri")!).hostname).toBe("127.0.0.1");
  expect(authorize.searchParams.has("client_secret")).toBe(false);

  await panel.getByRole("button", { name: "Review PDF for Drive" }).click();
  const review = panel.getByTestId("drive-export-review");
  await expect(review).toContainText(`Google account: ${ACCOUNT}`);
  await expect(review).toContainText(seeded.contentHash);
  expect(google.state.counts.uploadPosts, "review alone uploads nothing").toBe(0);
  await review.getByRole("button", { name: "Confirm and upload this PDF" }).click();
  await expect(panel.getByText("Drive document verified against the approved bytes.")).toBeVisible({ timeout: 20_000 });

  const files = google.uploadedFiles();
  expect(files).toHaveLength(1);
  expect(google.state.counts.uploadPosts).toBe(1);
  expect(sha256(files[0].bytes)).toBe(seeded.contentHash);
  expect(sha256(await fs.readFile(seeded.managedPath))).toBe(seeded.contentHash);
  const rows = journalRows(tempDataDir);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("verified");
  expect(rows[0].remoteId).toBe(rows[0].reservedFileId);
  expect(rows[0].reservedFileId).toBe(files[0].id);

  await panel.getByRole("link", { name: "Open in Google Drive" }).click();
  await expect.poll(async () => (await openedUrls(fixture!)).filter((url) => url.startsWith("https://drive.google.com/"))).toEqual(
    [`https://drive.google.com/file/d/${files[0].id}/view`]);

  // The refresh token is never on disk in plaintext, in the database or in the renderer.
  const [refreshToken] = google.state.refreshTokens.keys();
  const database = await fs.readFile(path.join(tempDataDir, "data", "jobscout.sqlite3"));
  expect(database.includes(Buffer.from(refreshToken))).toBe(false);
  const storage = await credentialStorage(page);
  if (storage === "encrypted") {
    const credential = await fs.readFile(path.join(tempDataDir, CREDENTIAL_FILE));
    expect(credential.includes(Buffer.from(refreshToken))).toBe(false);
  } else {
    expect(storage).toBe("session");
    await expect(fs.stat(path.join(tempDataDir, CREDENTIAL_FILE))).rejects.toThrow();
  }
  const html = await page.content();
  expect(html.includes(refreshToken)).toBe(false);
});

test("Disconnect Google Drive revokes the grant and deletes the stored sign-in", async () => {
  fixture = await launch();
  const { page, tempDataDir } = fixture;
  await seedVerifiedPdf(page);
  const panel = await openDrivePanel(page);
  await connect(page);
  const [refreshToken] = google.state.refreshTokens.keys();
  await panel.getByRole("button", { name: "Disconnect Google Drive" }).click();
  await expect(panel.getByRole("status").first()).toContainText("Google Drive disconnected. Sojourner deleted its saved Google sign-in");
  await expect(panel.getByRole("button", { name: "Connect Google Drive", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Review PDF for Drive" })).toHaveCount(0);
  expect(google.state.revoked).toContain(refreshToken);
  await expect(fs.stat(path.join(tempDataDir, CREDENTIAL_FILE))).rejects.toThrow();
  const status = await page.evaluate(() => window.electronAPI.drive.status());
  expect(status.phase).toBe("not_connected");
  expect(status.credentialStorage).toBe("none");
});

test("an upload whose response was lost stays blocked, then reconciles through files.get without a second POST", async () => {
  fixture = await launch();
  const { page, tempDataDir } = fixture;
  await seedVerifiedPdf(page);
  let panel = await openDrivePanel(page);
  await connect(page);
  google.state.faults.nextUpload = "drop-after-store";
  await reviewAndConfirm(page);
  await expect(panel.getByRole("alert")).toContainText("The upload is not verified. The upload connection was interrupted.", { timeout: 20_000 });
  expect(journalRows(tempDataDir)[0].status).toBe("unknown_remote_outcome");

  // A renderer reload keeps the main-process sign-in, and the journal keeps the block.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  panel = await openDrivePanel(page);
  await expect(panel.getByRole("status").first()).toContainText(`Google Drive is connected as ${ACCOUNT}`);
  await panel.getByRole("button", { name: "Review PDF for Drive" }).click();
  await expect(panel.getByRole("alert")).toContainText("still unresolved and may already exist in Google Drive");
  await expect(panel.getByTestId("drive-export-review")).toHaveCount(0);

  await panel.getByRole("button", { name: "Check prior Drive exports" }).click();
  await expect(panel.getByText("Verified 1 prior Drive export(s).")).toBeVisible({ timeout: 20_000 });
  expect(google.state.counts.uploadPosts).toBe(1);
  expect(google.uploadedFiles()).toHaveLength(1);
  expect(journalRows(tempDataDir)[0].status).toBe("verified");
});

test("after a crash with a prepared reservation, the relaunched app explains it, cancels it, and a fresh review uploads", async () => {
  fixture = await launch();
  const userDataDir = fixture.tempDataDir;
  await seedVerifiedPdf(fixture.page);
  let panel = await openDrivePanel(fixture.page);
  await connect(fixture.page);
  google.state.faults.root = "status:403";
  await reviewAndConfirm(fixture.page);
  await expect(panel.getByRole("alert")).toContainText("The upload did not begin. The unused reservation remains saved.", { timeout: 20_000 });
  expect(journalRows(userDataDir).map((row) => row.status)).toEqual(["prepared"]);
  expect(google.state.counts.uploadPosts).toBe(0);

  // Simulated crash: the process dies with the prepared row on disk.
  fixture.electronApp.process().kill("SIGKILL");
  await fixture.electronApp.close().catch(() => undefined);
  fixture = null;
  google.state.faults.root = null;

  fixture = await launch({ userDataDir });
  const { page } = fixture;
  panel = await openDrivePanel(page);
  const status = await page.evaluate(() => window.electronAPI.drive.status());
  if (status.phase !== "connected") {
    // Session-only sign-in (no OS encryption on this machine): reconnect after the relaunch.
    await connect(page);
  } else {
    await expect(panel.getByRole("status").first()).toContainText(`Google Drive is connected as ${ACCOUNT}`);
  }
  await panel.getByRole("button", { name: "Review PDF for Drive" }).click();
  await expect(panel.getByRole("alert")).toContainText("An unused Drive export reservation from an earlier attempt is still saved.");

  await panel.getByRole("button", { name: "Check prior Drive exports" }).click();
  const recovery = panel.getByTestId("drive-prepared-recovery");
  await expect(recovery).toBeVisible({ timeout: 20_000 });
  await recovery.getByRole("button", { name: "Cancel unused reservation" }).click();
  await expect(panel.getByText("Unused reservation cancelled. Re-review the PDF before any new upload.")).toBeVisible();
  expect(journalRows(userDataDir).map((row) => row.status)).toEqual(["cancelled"]);

  await reviewAndConfirm(page);
  await expect(panel.getByText("Drive document verified against the approved bytes.")).toBeVisible({ timeout: 20_000 });
  expect(google.state.counts.uploadPosts).toBe(1);
  expect(journalRows(userDataDir).map((row) => row.status)).toEqual(["cancelled", "verified"]);
});
