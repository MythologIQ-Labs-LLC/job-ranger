import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { strToU8, zipSync } from "fflate";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, healthcareProfile, projectRoot, waitForRuntime } from "./support/fixtures";

// The Electron runtime's compiled shared core (npm run desktop:compile), using
// the native sqlite3 CLI engine — i.e. exactly what the desktop app runs.
const require = createRequire(import.meta.url);
const electronCore = (name: string) => require(path.join(projectRoot, "electron-runtime", "electron", "src", name));
const { JobScoutBackend } = electronCore("backend.cjs");
const { CareerBackend } = electronCore("career-backend.cjs");
const { PersonalBrandBackend } = electronCore("personal-brand-backend.cjs");
const { BackupService, applyPendingRestore } = electronCore("backup-service.cjs");
const { SqliteClient } = electronCore("sqlite.cjs");
const archive = electronCore("portable-archive.cjs");

let server: PwaServer;
let workRoot: string;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
  workRoot = await mkdtemp(path.join(os.tmpdir(), "job-ranger-portability-"));
});

test.afterAll(async () => {
  await server.close();
  await rm(workRoot, { recursive: true, force: true });
});

async function openElectronInstall(userDataDirectory: string) {
  const dataDirectory = path.join(userDataDirectory, "data");
  const backend = new JobScoutBackend({
    dataDirectory,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error("portability test must not use the network");
    },
  });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const career = new CareerBackend({ dataDirectory, databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath });
  await career.initialize();
  const backups = new BackupService({
    dataDirectory,
    userDataDirectory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
    appVersion: "1.2.0",
  });
  return { backend, career, backups, dataDirectory, status };
}

async function chooseRestoreFile(page: Page, file: { name: string; buffer: Buffer }) {
  await page.goto(`${server.url}#/settings`);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Select backup to restore" }).click();
  await (await chooser).setFiles({ name: file.name, mimeType: "application/octet-stream", buffer: file.buffer });
}

test("Electron → PWA: a desktop .jobranger archive restores into the web runtime with provenance intact", async ({ page }) => {
  const desktopUserData = path.join(workRoot, "desktop");
  const desktop = await openElectronInstall(desktopUserData);
  await desktop.career.saveProfile({ ...healthcareProfile, fullName: "Desktop Morgan" });
  const authored = await desktop.career.createUserEvidence({
    subjectType: "role",
    organization: "Harbor Family Clinic",
    titleOrName: "Patient Services Coordinator",
    startDate: "2023-01",
    endDate: null,
    statement: "Coordinated patient scheduling and insurance verification for six providers.",
    skills: ["Patient scheduling"],
    methodsOrTools: [],
    scope: [],
    outcomes: [],
    metrics: [],
    credential: null,
  });
  const imported = await desktop.career.importPastedText({
    label: "Clinic background",
    text: "Experience\nPatient Services Coordinator, Harbor Family Clinic\n- Maintained HIPAA-aware front-desk workflows.",
  });
  const presence = new PersonalBrandBackend({ databasePath: desktop.status.databasePath, sqliteBinaryPath: desktop.status.sqliteBinaryPath });
  await presence.initialize();
  const presenceDraft = await presence.createDraft({
    body: "My professional work is a process of learning.", objective: "career_narrative",
    audiences: ["recruiters"], destination: "linkedin", format: "text",
    hookArchetype: "lesson", hypothesis: "See whether experience-led posts create connections.",
    claimChecks: [], mediaCount: 0, mediaAccessibilityReviewed: true,
  });
  await presence.prepareDraft(presenceDraft.id, 1, true);
  const desktopOutcome = await presence.recordCareerOutcome({
    kind: "recruiter_outreach", occurredAt: "2026-10-08T15:00:00.000Z",
    sourceLabel: "Personal journal", note: "Independent recruiter conversation.",
    relatedPostId: null, association: "none", userConfirmed: true,
  });
  const archivePath = path.join(workRoot, "desktop-export.jobranger");
  await desktop.backups.createArchive(archivePath, {
    runtime: "electron",
    channel: "direct-download",
    appVersion: "1.2.0",
    buildId: "electron-test",
  });
  await desktop.backend.dispose();

  await page.goto(server.url);
  await waitForRuntime(page);
  await page.evaluate((profile) => window.electronAPI.career.saveProfile(profile), { ...healthcareProfile, fullName: "Replace Me" });

  await chooseRestoreFile(page, { name: "desktop-export.jobranger", buffer: await readFile(archivePath) });
  await expect(page.getByTestId("restore-producer")).toContainText("Job Ranger desktop app");
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Restore and restart" }).click()]);
  await waitForRuntime(page);

  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName).toBe("Desktop Morgan");
  const presenceRestored = await page.evaluate(() => window.electronAPI.personalBrand.listDrafts());
  expect(presenceRestored.map((draft) => draft.id)).toContain(presenceDraft.id);
  expect((await page.evaluate(() => window.electronAPI.personalBrand.listPrepared())).length).toBe(1);
  expect((await page.evaluate(() => window.electronAPI.personalBrand.listCareerOutcomes()))
    .map((entry) => entry.id)).toContain(desktopOutcome.id);
  const evidence = await page.evaluate(() => window.electronAPI.career.listEvidence());
  expect(evidence.map((item) => item.evidence.id)).toContain(authored.id);
  const artifacts = await page.evaluate(() => window.electronAPI.career.listSourceArtifacts());
  const restored = artifacts.find((item) => item.id === imported.artifact.id);
  expect(restored?.contentHash).toBe(imported.artifact.contentHash);
  expect(restored?.managedPath.startsWith("/job-ranger/data/artifacts/")).toBe(true);
  // The proposals extracted on the desktop keep their lineage to the same source artifact.
  const lineage = evidence.filter((item) => JSON.stringify(item.sources).includes(imported.artifact.id));
  expect(lineage.length).toBeGreaterThan(0);
});

test("PWA → Electron: a web archive validates and restores in the desktop runtime", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.evaluate((profile) => window.electronAPI.career.saveProfile(profile), { ...healthcareProfile, fullName: "Web Morgan" });
  const webPresenceDraft = await page.evaluate(() => window.electronAPI.personalBrand.createDraft({
    body: "One meaningful lesson from a software project.", objective: "project_visibility",
    audiences: ["peers"], destination: "linkedin", format: "text",
    hookArchetype: "lesson", hypothesis: "Project context may lead to meaningful discussions.",
    claimChecks: [], mediaCount: 0, mediaAccessibilityReviewed: true,
  }));
  const webOutcome = await page.evaluate(() => window.electronAPI.personalBrand.recordCareerOutcome({
    kind: "interview_invitation", occurredAt: "2026-10-08T16:00:00.000Z",
    sourceLabel: "Personal journal", note: "",
    relatedPostId: null, association: "none", userConfirmed: true,
  }));
  const imported = await page.evaluate(() =>
    window.electronAPI.career.importPastedText({
      label: "Web background",
      text: "Experience\nFront Desk Lead, Bayview Pediatrics\n- Verified insurance eligibility before visits.",
    }),
  );

  await page.goto(`${server.url}#/settings`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create backup" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^job-ranger-backup-.*\.jobranger$/);
  const archivePath = path.join(workRoot, saved.suggestedFilename());
  await saved.saveAs(archivePath);
  const sha = (await page.getByTestId("backup-created-sha256").textContent())?.replace("SHA-256 ", "").trim();
  const { createHash } = await import("node:crypto");
  expect(createHash("sha256").update(await readFile(archivePath)).digest("hex")).toBe(sha);

  const desktopUserData = path.join(workRoot, "desktop-target");
  const desktop = await openElectronInstall(desktopUserData);
  const selection = await desktop.backups.validateRestoreSource(archivePath);
  expect(selection.archive.producer.runtime).toBe("web");
  await desktop.backups.stageRestore(selection.bundlePath);
  await desktop.backend.dispose();
  expect(await applyPendingRestore({ userDataDirectory: desktopUserData, dataDirectory: desktop.dataDirectory })).toBe(true);

  const restored = await openElectronInstall(desktopUserData);
  expect((await restored.career.getProfile()).fullName).toBe("Web Morgan");
  const restoredPresence = new PersonalBrandBackend({ databasePath: restored.status.databasePath, sqliteBinaryPath: restored.status.sqliteBinaryPath });
  await restoredPresence.initialize();
  expect((await restoredPresence.listDrafts()).map((draft: { id: string }) => draft.id)).toContain(webPresenceDraft.id);
  expect((await restoredPresence.listCareerOutcomes()).map((event: { id: string }) => event.id)).toContain(webOutcome.id);
  const artifacts = await restored.career.listSourceArtifacts();
  const artifact = artifacts.find((item: { id: string }) => item.id === imported.artifact.id);
  expect(artifact.contentHash).toBe(imported.artifact.contentHash);
  expect(artifact.managedPath.startsWith(restored.dataDirectory)).toBe(true);
  expect(createHash("sha256").update(await readFile(artifact.managedPath)).digest("hex")).toBe(imported.artifact.contentHash);
  await restored.backend.dispose();
});

/** A valid DOCX padded with incompressible, non-sensitive bytes so its artifact spans many 1 MiB reads. */
function paddedResumeDocx(padBytes: number): Buffer {
  const pad = new Uint8Array(padBytes);
  let value = 302;
  for (let index = 0; index < pad.length; index += 1) {
    value = (value * 1103515245 + 12345) >>> 0;
    pad[index] = value >>> 24;
  }
  const body = '<w:p><w:r><w:t>Jordan Ellis</w:t></w:r></w:p><w:p><w:r><w:t>Warehouse Coordinator, Tacoma Freight, 2022 - Present</w:t></w:r></w:p>';
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
    "word/media/padding.bin": [pad, { level: 0 }],
  }));
}

// #302: the web export streams each file into the archive in bounded chunks (two passes) through
// OPFS. A multi-megabyte artifact must come out byte-identical to the in-memory encoder's layout.
test("PWA export streams a multi-megabyte artifact into a canonical archive the desktop restores", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  const docx = paddedResumeDocx(6 * 1024 * 1024 + 123);
  await page.goto(`${server.url}#/career-profile`);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import resume" }).click();
  await (await chooser).setFiles({
    name: "jordan-ellis-resume.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docx,
  });
  await expect.poll(async () => {
    const artifacts = await page.evaluate(() => window.electronAPI.career.listSourceArtifacts());
    return artifacts.length === 1 ? artifacts[0].extractionState : "missing";
  }, { timeout: 30_000 }).not.toMatch(/missing|pending/);
  const [artifact] = await page.evaluate(() => window.electronAPI.career.listSourceArtifacts());
  const { createHash } = await import("node:crypto");
  const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  expect(artifact.contentHash).toBe(sha256(docx));

  await page.goto(`${server.url}#/settings`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create backup" }).click();
  const saved = await download;
  const archivePath = path.join(workRoot, `streamed-${saved.suggestedFilename()}`);
  await saved.saveAs(archivePath);
  const bytes = await readFile(archivePath);
  const shown = (await page.getByTestId("backup-created-sha256").textContent())?.replace("SHA-256 ", "").trim();
  expect(sha256(bytes)).toBe(shown);

  // Same bytes the in-memory STORE encoder produces for these entries, in this order.
  const entries = archive.decodeStoreZip(bytes);
  expect(Buffer.from(archive.encodeStoreZip(entries)).equals(bytes)).toBe(true);
  const stored = entries.find((entry: { bytes: Uint8Array }) => sha256(entry.bytes) === artifact.contentHash);
  expect(stored?.bytes.length).toBe(docx.length);

  const desktop = await openElectronInstall(path.join(workRoot, "desktop-streamed"));
  const selection = await desktop.backups.validateRestoreSource(archivePath);
  expect(selection.archive.producer.runtime).toBe("web");
  await desktop.backend.dispose();
});

test("corrupted, foreign, newer, and unknown-schema backups are rejected without touching data", async ({ page }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.evaluate((profile) => window.electronAPI.career.saveProfile(profile), { ...healthcareProfile, fullName: "Keep Me" });

  const errorBox = page.locator(".border-red-300");

  await chooseRestoreFile(page, { name: "notes.jobranger", buffer: Buffer.from("not a backup at all") });
  await expect(errorBox).toContainText("not a Job Ranger archive");

  // Valid container, newer archive format.
  const desktop = await openElectronInstall(path.join(workRoot, "fixtures-source"));
  await desktop.career.saveProfile({ ...healthcareProfile, fullName: "Fixture" });
  const goodPath = path.join(workRoot, "good.jobranger");
  await desktop.backups.createArchive(goodPath, { runtime: "electron", channel: "development", appVersion: "1.2.0", buildId: "t" });
  const entries = archive.decodeStoreZip(await readFile(goodPath)).map((entry: { name: string; bytes: Uint8Array }) => ({
    name: entry.name,
    bytes: new Uint8Array(entry.bytes),
  }));
  const newer = archive.encodeStoreZip(
    entries.map((entry: { name: string; bytes: Uint8Array }) => {
      if (entry.name !== "job-ranger-archive.json") return entry;
      const manifest = JSON.parse(Buffer.from(entry.bytes).toString("utf8"));
      manifest.archiveVersion = 2;
      return { name: entry.name, bytes: Buffer.from(JSON.stringify(manifest)) };
    }),
  );
  await chooseRestoreFile(page, { name: "newer.jobranger", buffer: Buffer.from(newer) });
  await expect(errorBox).toContainText("newer Job Ranger");

  // Bit-rot inside the database entry.
  const corrupted = Buffer.from(await readFile(goodPath));
  corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
  await chooseRestoreFile(page, { name: "corrupted.jobranger", buffer: corrupted });
  await expect(errorBox).toContainText(/CRC-32|integrity|corrupt/);

  // A database written by a future Job Ranger schema.
  const sqlite = new SqliteClient(desktop.status.databasePath, desktop.status.sqliteBinaryPath);
  await sqlite.exec("INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'future_feature', '2027-01-01T00:00:00.000Z');");
  const futurePath = path.join(workRoot, "future.jobranger");
  // Simulates an archive produced by a newer Job Ranger (this build would
  // refuse to export it, so pack the raw bundle directly).
  const bundleParent = path.join(workRoot, "future-bundle");
  await (await import("node:fs/promises")).mkdir(bundleParent, { recursive: true });
  const bundle = await desktop.backups.createBackup(bundleParent);
  await archive.packBackupBundle({
    bundleDirectory: bundle.summary.bundlePath,
    archivePath: futurePath,
    producer: { runtime: "electron", channel: "development", appVersion: "9.9.9", buildId: "future" },
  });
  await desktop.backend.dispose();
  await chooseRestoreFile(page, { name: "future.jobranger", buffer: await readFile(futurePath) });
  await expect(errorBox).toContainText("does not recognize");

  await expect(page.getByRole("button", { name: "Restore and restart" })).toHaveCount(0);
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName).toBe("Keep Me");
  await writeFile(path.join(workRoot, "done"), "");
});
