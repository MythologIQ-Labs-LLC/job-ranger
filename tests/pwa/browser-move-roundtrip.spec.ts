import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, healthcareProfile, healthcareResumeDocx, waitForRuntime } from "./support/fixtures";

// #194 / #302: moving to another browser. A .jobranger backup made in one PWA workspace, through
// Settings, restores through Settings into a different browser profile that already has its own
// data, replacing it with exactly the backed-up career records and managed artifact bytes.

let server: PwaServer;
const profiles: string[] = [];
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => {
  await server.close();
  for (const profile of profiles) {
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold the log */ }
  }
});

async function openProfile(): Promise<{ context: BrowserContext; page: Page }> {
  const profile = mkdtempSync(path.join(os.tmpdir(), "sojourner-move-"));
  profiles.push(profile);
  const context = await chromium.launchPersistentContext(profile, {
    acceptDownloads: true,
    executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined,
  });
  await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(server.url);
  await waitForRuntime(page);
  return { context, page };
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Comparable snapshot of the canonical records a user would expect to move with them. */
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const api = window.electronAPI;
    const profile = await api.career.getProfile();
    const evidence = (await api.career.listEvidence()).map((item) => ({ id: item.evidence.id, statement: item.evidence.statement, state: item.evidence.verificationState }));
    const tracks = (await api.career.listTargetTracks()).map((track) => ({ id: track.id, name: track.name, relation: track.relation, isActive: track.isActive }));
    const artifacts = (await api.career.listSourceArtifacts()).map((artifact) => ({ id: artifact.id, contentHash: artifact.contentHash }));
    return {
      profile: profile && { fullName: profile.fullName, homeLocation: profile.homeLocation, minimumPay: profile.minimumPay, skills: profile.skills },
      evidence: evidence.sort((a, b) => a.id.localeCompare(b.id)),
      tracks: tracks.sort((a, b) => a.id.localeCompare(b.id)),
      artifacts: artifacts.sort((a, b) => a.id.localeCompare(b.id)),
    };
  });
}

test("a backup from one browser restores into another browser's workspace with identical records", async () => {
  test.setTimeout(180_000);
  const source = await openProfile();
  const target = await openProfile();
  try {
    // Source browser: profile, a user-authored fact, a target track and an imported resume artifact.
    await source.page.evaluate((profile) => window.electronAPI.career.saveProfile(profile as never), { ...healthcareProfile, fullName: "Moving Morgan" });
    await source.page.evaluate(() => window.electronAPI.career.createUserEvidence({
      subjectType: "role", organization: "Harbor Family Clinic", titleOrName: "Patient Services Coordinator",
      startDate: "2023-01", endDate: null, statement: "Coordinated scheduling and referrals for six providers.",
      skills: ["Patient scheduling"], methodsOrTools: [], scope: [], outcomes: [], metrics: [], credential: null,
    }));
    await source.page.goto(`${server.url}#/career-profile`);
    const chooser = source.page.waitForEvent("filechooser");
    await source.page.getByRole("button", { name: "Import resume" }).click();
    const docx = healthcareResumeDocx();
    await (await chooser).setFiles({ name: "morgan-resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx });
    await expect.poll(async () => {
      const artifacts = await source.page.evaluate(() => window.electronAPI.career.listSourceArtifacts());
      return artifacts.length === 1 ? artifacts[0].extractionState : "missing";
    }, { timeout: 30_000 }).not.toMatch(/missing|pending/);
    const before = await snapshot(source.page);
    expect(before.profile?.fullName).toBe("Moving Morgan");
    expect(before.artifacts).toEqual([{ id: before.artifacts[0].id, contentHash: sha256(docx) }]);

    await source.page.goto(`${server.url}#/settings`);
    const download = source.page.waitForEvent("download");
    await source.page.getByRole("button", { name: "Create backup" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/\.jobranger$/);
    const archivePath = path.join(os.tmpdir(), `move-${Date.now()}-${saved.suggestedFilename()}`);
    await saved.saveAs(archivePath);
    const archiveBytes = await readFile(archivePath);
    const shown = (await source.page.getByTestId("backup-created-sha256").textContent())?.replace("SHA-256 ", "").trim();
    expect(sha256(archiveBytes)).toBe(shown);

    // Target browser already has different data, which the restore must replace, not merge.
    await target.page.evaluate((profile) => window.electronAPI.career.saveProfile(profile as never), { ...healthcareProfile, fullName: "Replace Me" });
    await target.page.goto(`${server.url}#/settings`);
    const restoreChooser = target.page.waitForEvent("filechooser");
    await target.page.getByRole("button", { name: "Select backup to restore" }).click();
    await (await restoreChooser).setFiles({ name: saved.suggestedFilename(), mimeType: "application/octet-stream", buffer: archiveBytes });
    await expect(target.page.getByTestId("restore-producer")).toContainText("Sojourner web app");
    await Promise.all([target.page.waitForEvent("load"), target.page.getByRole("button", { name: "Restore and restart" }).click()]);
    await waitForRuntime(target.page);

    const after = await snapshot(target.page);
    expect(after).toEqual(before);
    // The managed artifact's bytes, not just its recorded hash, arrived intact.
    const restoredBytes = await target.page.evaluate(async (id) => {
      const artifacts = await window.electronAPI.career.listSourceArtifacts();
      const artifact = artifacts.find((item) => item.id === id)!;
      let dir = await navigator.storage.getDirectory();
      const parts = artifact.managedPath.split("/").filter(Boolean);
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return Array.from(new Uint8Array(await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer()));
    }, before.artifacts[0].id);
    expect(sha256(Uint8Array.from(restoredBytes))).toBe(sha256(docx));
    rmSync(archivePath, { force: true });
  } finally {
    await source.context.close();
    await target.context.close();
  }
});
