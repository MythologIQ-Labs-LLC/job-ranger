// Windows storage location (#249) through the real main/renderer boundary: This computer
// (a temporary folder), Google Drive (the fake Google with storage routes) and OneDrive
// (the fake Microsoft identity platform and Graph). Backups are the real streaming
// .jobranger export; restores go through the real validate -> stage -> restart path (the
// restart is replaced by a relaunch from the test). No real cloud endpoint is contacted
// and nothing is written to the real Documents folder.
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeElectronApp, launchElectronApp, navigateTo, type ElectronAppFixture } from "./electron-app";

const require = createRequire(import.meta.url);
const { createFakeGoogleStorage } = require("../support/fake-google-storage.cjs") as {
  createFakeGoogleStorage: (options?: Record<string, unknown>) => FakeServer & { storageFiles: (folder: string) => Array<{ name: string }> };
};
const { createFakeOneDrive } = require("../support/fake-onedrive.cjs") as {
  createFakeOneDrive: (options?: Record<string, unknown>) => FakeServer & { files: (folder: string) => Array<{ name: string }> };
};

interface FakeServer {
  listen: () => Promise<{ baseUrl: string; close: () => Promise<void> }>;
}

const GOOGLE_CLIENT_ID = "1234567890-e2edrive.apps.googleusercontent.com";
const MICROSOFT_CLIENT_ID = "6aea1e3a-0000-4000-8000-0000000000e2";

let fixture: ElectronAppFixture | null = null;
let servers: Array<{ close: () => Promise<void> }> = [];
let locationRoot: string;

test.beforeEach(async () => {
  locationRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-e2e-location-"));
});

test.afterEach(async () => {
  if (fixture) await closeElectronApp(fixture);
  fixture = null;
  for (const server of servers) await server.close();
  servers = [];
  await fs.rm(locationRoot, { recursive: true, force: true });
});

function storageEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    JOB_RANGER_STORAGE_TEST_DEFAULT_FOLDER: path.join(locationRoot, "Sojourner"),
    JOB_RANGER_STORAGE_TEST_DEBOUNCE_MS: "1500",
    JOB_RANGER_STORAGE_TEST_POLL_MS: "200",
    JOB_RANGER_STORAGE_TEST_RETRY_MS: "500",
    JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: "",
    JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: "",
    JOB_RANGER_MICROSOFT_CLIENT_ID: "",
    ...extra,
  };
}

async function launch(env: Record<string, string>, userDataDir?: string): Promise<ElectronAppFixture> {
  const launched = await launchElectronApp({ env, userDataDir });
  // Plays the system browser for sign-in: follows the fake authorize redirect to the
  // app's loopback receiver. The real restart after a staged restore is replaced by a
  // relaunch from the test.
  await launched.electronApp.evaluate(({ app, shell }) => {
    shell.openExternal = async (url: string) => {
      if (/\/o\/oauth2\/v2\/auth|\/common\/oauth2\/v2\.0\/authorize/.test(url)) void fetch(url).catch(() => undefined);
    };
    app.relaunch = () => undefined;
  });
  return launched;
}

async function openStorage(page: Page) {
  await navigateTo(page, "/settings");
  const section = page.getByTestId("storage-location");
  await expect(section).toBeVisible();
  return section;
}

async function addEvidence(page: Page, statement: string): Promise<void> {
  await page.evaluate(async (text) => {
    await window.electronAPI.career.createUserEvidence({
      subjectType: "role", organization: "Harbor Family Clinic", titleOrName: "Patient Services Coordinator",
      startDate: "2023-01", endDate: null, statement: text,
      skills: [], methodsOrTools: [], scope: [], outcomes: [], metrics: [], credential: null,
    });
  }, statement);
}

async function statements(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await window.electronAPI.career.listEvidence()).map((item) => item.evidence.statement).sort());
}

/** Waits for a new verified automatic backup and returns its name. */
async function nextAutomaticBackup(page: Page, after: string | null): Promise<string> {
  let name: string | null = null;
  await expect.poll(async () => {
    const status = await page.evaluate(() => window.electronAPI.storageLocations.status());
    name = status.backup.lastSuccessName;
    return Boolean(name && name !== after && name.includes("-automatic-") && !status.backup.pendingChanges);
  }, { timeout: 30_000 }).toBe(true);
  return name as unknown as string;
}

async function restoreFromLocation(page: Page, section: ReturnType<Page["getByTestId"]>, name: string, app: ElectronAppFixture) {
  await section.getByRole("button", { name: "Restore from this location" }).click();
  await expect(section.getByTestId("storage-listing")).toBeVisible();
  await section.getByRole("button", { name: `Restore ${name}` }).click();
  const confirm = section.getByTestId("storage-restore-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("heading", { name: `Restore ${name}?` })).toBeFocused();
  await expect(confirm).toContainText("replaces your current workspace on this computer");
  const closed = app.electronApp.waitForEvent("close");
  await confirm.getByRole("button", { name: "Restore and restart" }).click();
  await closed;
}

test("This computer: choose the folder, a change is backed up automatically, restore round-trips the data", async () => {
  test.setTimeout(240_000);
  const env = storageEnv();
  fixture = await launch(env);
  const { page, tempDataDir } = fixture;
  const section = await openStorage(page);

  // Unconfigured cloud choices are disabled with an explanation.
  const google = section.getByRole("radio", { name: /Google Drive/ });
  const onedrive = section.getByRole("radio", { name: /OneDrive/ });
  await expect(google).toBeDisabled();
  await expect(onedrive).toBeDisabled();
  await expect(section).toContainText("OneDrive is not set up in this build of Sojourner");
  await expect(section).toContainText("Google Drive is not set up in this build of Sojourner");
  await expect(section.getByTestId("storage-backup-status")).toContainText("No storage location is selected");

  await section.getByRole("radio", { name: /This computer/ }).check();
  await expect(section.getByTestId("storage-notice")).toContainText("New backups and documents now go to");
  const first = await nextAutomaticBackup(page, null);

  await addEvidence(page, "Alpha: coordinated scheduling for six providers.");
  const withAlpha = await nextAutomaticBackup(page, first);
  await addEvidence(page, "Beta: trained two new front-desk staff.");
  const withBeta = await nextAutomaticBackup(page, withAlpha);
  const files = await fs.readdir(path.join(locationRoot, "Sojourner", "Backups"));
  expect(files).toEqual(expect.arrayContaining([first, withAlpha, withBeta]));
  await expect(section.getByTestId("storage-backup-status")).toContainText("Last successful backup");

  await restoreFromLocation(page, section, withAlpha, fixture);
  fixture = await launch(env, tempDataDir);
  expect(await statements(fixture.page)).toEqual(["Alpha: coordinated scheduling for six providers."]);
  // The records survived the restore: history still lists every backup, including the newer one.
  const reopened = await openStorage(fixture.page);
  await reopened.getByRole("button", { name: "Show backup history" }).click();
  await expect(reopened.getByTestId("storage-history")).toContainText(withBeta);
});

test("This computer: quitting with unbacked changes backs them up first", async () => {
  test.setTimeout(180_000);
  const env = storageEnv({ JOB_RANGER_STORAGE_TEST_DEBOUNCE_MS: "600000" });
  fixture = await launch(env);
  const section = await openStorage(fixture.page);
  await section.getByRole("radio", { name: /This computer/ }).check();
  await section.getByRole("button", { name: "Back up now" }).click();
  await expect(section.getByTestId("storage-notice")).toContainText("was saved and verified", { timeout: 30_000 });
  await addEvidence(fixture.page, "Gamma: unbacked change before quitting.");
  await fixture.electronApp.close();
  const files = await fs.readdir(path.join(locationRoot, "Sojourner", "Backups"));
  expect(files.filter((name) => name.includes("-manual-"))).toHaveLength(1);
  expect(files.filter((name) => name.includes("-automatic-"))).toHaveLength(1);
  await fs.rm(fixture.tempDataDir, { recursive: true, force: true });
  fixture = null;
});

test("This computer: an exported resume PDF is copied to Documents/ and opens from the location", async () => {
  test.setTimeout(180_000);
  fixture = await launch(storageEnv({ JOB_RANGER_STORAGE_TEST_DEBOUNCE_MS: "600000" }));
  const { page, electronApp } = fixture;
  const section = await openStorage(page);
  await section.getByRole("radio", { name: /This computer/ }).check();
  await expect(section.getByTestId("storage-notice")).toContainText("New backups and documents now go to");
  const managedPath = await page.evaluate(async () => {
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
    const exported = await api.resume.exportPdf({ projectionId: resume.projection.id });
    if (!exported.artifact) throw new Error("the resume did not pass its gates");
    return exported.artifact.managedPath;
  });
  const documents = path.join(locationRoot, "Sojourner", "Documents");
  await expect.poll(async () => (await fs.readdir(documents).catch(() => [])).length, { timeout: 30_000 }).toBe(1);
  const [copied] = await fs.readdir(documents);
  expect(copied).toMatch(/resume-v1\.pdf$/);
  expect(await fs.readFile(path.join(documents, copied))).toEqual(await fs.readFile(managedPath));

  await electronApp.evaluate(({ shell }) => {
    (globalThis as { __opened?: string[] }).__opened = [];
    shell.openPath = async (target: string) => {
      (globalThis as { __opened?: string[] }).__opened?.push(target);
      return "";
    };
  });
  await section.getByRole("button", { name: "Restore from this location" }).click();
  await section.getByRole("button", { name: `Open ${copied}` }).click();
  await expect.poll(() => electronApp.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? []))
    .toEqual([path.join(documents, copied)]);
});

test("Google Drive (fake): connect, back up into the Sojourner folder, restore, disconnect", async () => {
  test.setTimeout(240_000);
  const google = createFakeGoogleStorage({ clientId: GOOGLE_CLIENT_ID });
  const server = await google.listen();
  servers.push(server);
  const env = storageEnv({
    JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: GOOGLE_CLIENT_ID,
    JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: "GOCSPX-e2e-not-a-secret",
    JOB_RANGER_GOOGLE_TEST_BASE_URL: server.baseUrl,
    JOB_RANGER_GOOGLE_TEST_TIMEOUT_MS: "8000",
  });
  fixture = await launch(env);
  const { page, tempDataDir } = fixture;
  const section = await openStorage(page);
  await section.getByRole("radio", { name: /Google Drive/ }).check();
  await section.getByRole("button", { name: "Connect Google Drive" }).click();
  await expect(section.getByTestId("storage-notice")).toContainText("Google Drive is connected", { timeout: 30_000 });
  await expect(section).toContainText("drive-tester@example.test");
  const initial = await nextAutomaticBackup(page, null);
  await addEvidence(page, "Delta: stored in Google Drive.");
  const backup = await nextAutomaticBackup(page, initial);
  expect(google.storageFiles("Backups").map((file) => file.name)).toContain(backup);

  await addEvidence(page, "Epsilon: added after the Google backup.");
  await restoreFromLocation(page, section, backup, fixture);
  fixture = await launch(env, tempDataDir);
  expect(await statements(fixture.page)).toEqual(["Delta: stored in Google Drive."]);

  const reopened = await openStorage(fixture.page);
  await reopened.getByRole("button", { name: "Disconnect Google Drive" }).click();
  await expect(reopened.getByTestId("storage-notice")).toContainText("Google Drive disconnected");
  await expect(reopened.getByTestId("storage-backup-status")).toContainText("No storage location is selected");
  await expect(reopened.getByRole("button", { name: "Connect Google Drive" })).toBeVisible();
});

test("OneDrive (fake): connect, back up into the app folder, restore, disconnect", async () => {
  test.setTimeout(240_000);
  const onedrive = createFakeOneDrive({ clientId: MICROSOFT_CLIENT_ID });
  const server = await onedrive.listen();
  servers.push(server);
  const env = storageEnv({
    JOB_RANGER_MICROSOFT_CLIENT_ID: MICROSOFT_CLIENT_ID,
    JOB_RANGER_MICROSOFT_TEST_BASE_URL: server.baseUrl,
  });
  fixture = await launch(env);
  const { page, tempDataDir } = fixture;
  const section = await openStorage(page);
  await expect(section.getByRole("radio", { name: /Google Drive/ })).toBeDisabled();
  await section.getByRole("radio", { name: /OneDrive/ }).check();
  await section.getByRole("button", { name: "Connect OneDrive" }).click();
  await expect(section.getByTestId("storage-notice")).toContainText("OneDrive is connected", { timeout: 30_000 });
  await expect(section).toContainText("OneDrive (personal account)");
  const initial = await nextAutomaticBackup(page, null);
  await addEvidence(page, "Zeta: stored in OneDrive.");
  const backup = await nextAutomaticBackup(page, initial);
  expect(onedrive.files("Backups").map((file) => file.name)).toContain(backup);

  await addEvidence(page, "Eta: added after the OneDrive backup.");
  await restoreFromLocation(page, section, backup, fixture);
  fixture = await launch(env, tempDataDir);
  expect(await statements(fixture.page)).toEqual(["Zeta: stored in OneDrive."]);

  const reopened = await openStorage(fixture.page);
  await reopened.getByRole("button", { name: "Disconnect OneDrive" }).click();
  await expect(reopened.getByTestId("storage-notice")).toContainText("Sojourner deleted its saved Microsoft sign-in");
  await expect(reopened.getByTestId("storage-backup-status")).toContainText("No storage location is selected");
  const credential = await fs.stat(path.join(fixture.tempDataDir, "microsoft-onedrive-credential.bin")).catch(() => null);
  expect(credential).toBeNull();
});
