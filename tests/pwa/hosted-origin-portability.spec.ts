import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, healthcareProfile, waitForRuntime } from "./support/fixtures";

let oldSite: PwaServer;
let newSite: PwaServer;
let tempRoot: string;

test.beforeAll(async () => {
  oldSite = await startPwaServer(distPwa);
  newSite = await startPwaServer(distPwa);
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "job-ranger-origin-transfer-"));
});

test.afterAll(async () => {
  await Promise.all([oldSite.close(), newSite.close()]);
  await rm(tempRoot, { recursive: true, force: true });
});

test("moving between different web origins requires an explicit archive and never merges or syncs accounts", async ({ page }) => {
  // The production hosting equivalent is localhost -> a new HTTPS hostname.
  // Using two distinct loopback ports is enough to exercise OPFS origin isolation.
  expect(new URL(oldSite.url).origin).not.toBe(new URL(newSite.url).origin);

  await page.goto(oldSite.url);
  await waitForRuntime(page);
  await page.evaluate((profile) =>
    window.electronAPI.career.saveProfile(profile),
    { ...healthcareProfile, fullName: "Original Site Person" },
  );
  const imported = await page.evaluate(() =>
    window.electronAPI.career.importPastedText({
      label: "Original local evidence",
      text: "Experience\nClinic Coordinator, Harbor Care\n- Helped patients book appointments.",
    }),
  );
  const originalCount = (await page.evaluate(() => window.electronAPI.career.listEvidence())).length;
  expect(originalCount).toBeGreaterThan(0);

  await page.goto(newSite.url);
  await waitForRuntime(page);
  // OPFS must not leak from the old web origin automatically.
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName)
    .not.toBe("Original Site Person");
  await page.evaluate((profile) =>
    window.electronAPI.career.saveProfile(profile),
    { ...healthcareProfile, fullName: "New Site Person" },
  );

  await page.goto(oldSite.url + "#/settings");
  await waitForRuntime(page);
  await expect(page.getByTestId("origin-migration-guide")).toContainText("replaces");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create backup" }).click();
  const backup = await downloadPromise;
  expect(backup.suggestedFilename()).toMatch(/\.jobranger$/);
  const backupPath = path.join(tempRoot, backup.suggestedFilename());
  await backup.saveAs(backupPath);
  const bytes = await readFile(backupPath);
  const digest = (await page.getByTestId("backup-created-sha256").textContent())?.replace("SHA-256 ", "").trim();
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);

  await page.goto(newSite.url + "#/settings");
  await waitForRuntime(page);
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName)
    .toBe("New Site Person");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Select backup to restore" }).click();
  await (await chooser).setFiles({
    name: "migrate-workspace.jobranger",
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  await expect(page.getByText("Validated backup")).toBeVisible();
  await expect(page.getByTestId("restore-producer")).toContainText("Job Ranger web app");
  // Make a safety copy of the *destination* before the destructive restore.
  // This must not reset its validated incoming archive selection.
  const safeDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create backup" }).click();
  const destinationCopy = await safeDownload;
  expect(destinationCopy.suggestedFilename()).toMatch(/\.jobranger$/);
  const safetyPath = path.join(tempRoot, "destination-safety.jobranger");
  await destinationCopy.saveAs(safetyPath);
  await expect(page.getByTestId("backup-download-reminder")).toContainText("does not prove");
  await expect(page.getByText("Validated backup")).toBeVisible();
  await expect(page.getByTestId("restore-producer")).toContainText("Job Ranger web app");
  await expect(page.getByRole("button", { name: "Restore and restart" })).toBeEnabled();
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName)
    .toBe("New Site Person");

  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Restore and restart" }).click(),
  ]);
  await waitForRuntime(page);
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName)
    .toBe("Original Site Person");
  const artifacts = await page.evaluate(() => window.electronAPI.career.listSourceArtifacts());
  expect(artifacts.some(a => a.id === imported.artifact.id && a.contentHash === imported.artifact.contentHash)).toBe(true);
  expect((await page.evaluate(() => window.electronAPI.career.listEvidence())).length).toBe(originalCount);

  // The safety copy is an independent restore path, not an automatic merge.
  // A user can deliberately return the destination to its former workspace.
  const rollbackChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Select backup to restore" }).click();
  await (await rollbackChooser).setFiles({
    name: "destination-safety.jobranger",
    mimeType: "application/octet-stream",
    buffer: await readFile(safetyPath),
  });
  await expect(page.getByText("Validated backup")).toBeVisible();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Restore and restart" }).click(),
  ]);
  await waitForRuntime(page);
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName)
    .toBe("New Site Person");

  // Neither a restore nor a visit to the new origin can change the source origin.
  await page.goto(oldSite.url);
  await waitForRuntime(page);
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName)
    .toBe("Original Site Person");
  const sourceArtifacts = await page.evaluate(() => window.electronAPI.career.listSourceArtifacts());
  expect(sourceArtifacts.some(a => a.id === imported.artifact.id)).toBe(true);
});
