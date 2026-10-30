import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, healthcareProfile, waitForRuntime } from "./support/fixtures";

// #194: when the workspace database is damaged, Sojourner refuses to open it (and leaves it as
// found) but still lets the user restore a .jobranger backup from the error screen.

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

async function databasePath(page: Page): Promise<string> {
  return page.evaluate(async () => (await window.electronAPI.system.getStatus()).databasePath);
}

/** SHA-256 of the OPFS database file, read from a same-origin page. */
async function fileDigest(page: Page, file: string): Promise<string> {
  return page.evaluate(async (p) => {
    let dir = await navigator.storage.getDirectory();
    const parts = p.split("/").filter(Boolean);
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const bytes = await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }, file);
}

/** Leaves the app (stopping its worker), then overwrites the OPFS database with garbage. */
async function damageDatabase(page: Page, file: string): Promise<void> {
  await page.goto(`${server.url}/manifest.webmanifest`);
  await page.evaluate(async (p) => {
    let dir = await navigator.storage.getDirectory();
    const parts = p.split("/").filter(Boolean);
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const writable = await (await dir.getFileHandle(parts[parts.length - 1])).createWritable();
    await writable.write(new TextEncoder().encode("this is not a database"));
    await writable.close();
  }, file);
}

test("a damaged workspace can be replaced from a backup on the error screen", async () => {
  test.setTimeout(180_000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "sojourner-recovery-"));
  const context = await chromium.launchPersistentContext(profile, {
    acceptDownloads: true,
    executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined,
  });
  let archive: string | null = null;
  try {
    await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(server.url);
    await waitForRuntime(page);
    await page.evaluate((value) => window.electronAPI.career.saveProfile(value as never), { ...healthcareProfile, fullName: "Backed Up Morgan" });

    await page.goto(`${server.url}#/settings`);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Create backup" }).click();
    const saved = await download;
    archive = path.join(profile, "..", `recovery-${Date.now()}.jobranger`);
    await saved.saveAs(archive);

    const file = await databasePath(page);
    await damageDatabase(page, file);
    await page.goto(server.url);
    await expect(page.getByTestId("pwa-boot-error")).toContainText(/not a database/, { timeout: 30_000 });
    await expect(page.getByText("Your saved data has not been modified.")).toBeVisible();
    const recovery = page.getByTestId("pwa-recovery-restore");
    await expect(recovery).toBeVisible();
    // In recovery mode only backup validation and staging are served.
    await expect(page.evaluate(() => window.electronAPI.career.getProfile())).rejects.toThrow(/not a database/);
    const damaged = await fileDigest(page, file);

    const chooser = page.waitForEvent("filechooser");
    await recovery.getByRole("button", { name: "Choose a backup file" }).click();
    await (await chooser).setFiles(archive);
    await expect(recovery.getByTestId("pwa-recovery-selection")).toContainText("passed integrity checks");
    await expect(recovery.getByTestId("pwa-recovery-selection")).toBeFocused();
    await expect(recovery.getByText(/permanently replaces the damaged workspace/)).toBeVisible();
    // Choosing and validating a backup did not touch the damaged database.
    expect(await fileDigest(page, file)).toBe(damaged);

    await Promise.all([
      page.waitForEvent("load"),
      recovery.getByRole("button", { name: "Replace this workspace with the backup and restart" }).click(),
    ]);
    await waitForRuntime(page);
    expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName).toBe("Backed Up Morgan");
  } finally {
    if (archive) rmSync(archive, { force: true });
    await context.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold the log */ }
  }
});

test("a file that is not a valid backup is refused and the workspace stays untouched", async () => {
  test.setTimeout(120_000);
  const profile = mkdtempSync(path.join(os.tmpdir(), "sojourner-recovery-bad-"));
  const context = await chromium.launchPersistentContext(profile, { executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined });
  try {
    await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(server.url);
    await waitForRuntime(page);
    const file = await databasePath(page);
    await damageDatabase(page, file);
    await page.goto(server.url);
    const damaged = await fileDigest(page, file);
    const recovery = page.getByTestId("pwa-recovery-restore");
    await expect(recovery).toBeVisible({ timeout: 30_000 });
    const chooser = page.waitForEvent("filechooser");
    await recovery.getByRole("button", { name: "Choose a backup file" }).click();
    await (await chooser).setFiles({ name: "not-a-backup.jobranger", mimeType: "application/octet-stream", buffer: Buffer.from("garbage") });
    await expect(recovery.getByTestId("pwa-recovery-error")).toContainText("This file is not a Job Ranger archive");
    await expect(recovery.getByRole("button", { name: /Replace this workspace/ })).toHaveCount(0);
    // Still on the error screen; nothing was restored, opened or rewritten.
    expect(await fileDigest(page, file)).toBe(damaged);
    await page.reload();
    await expect(page.getByTestId("pwa-boot-error")).toContainText(/not a database/, { timeout: 30_000 });
    expect(await fileDigest(page, file)).toBe(damaged);
  } finally {
    await context.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold the log */ }
  }
});
