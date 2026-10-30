// #194 / #303 durability in the real browser: a reload during large writes never leaves a damaged
// or partial workspace (each write is one atomic OPFS commit), and a damaged database file is
// refused at startup without being overwritten, so nothing that could still be recovered is lost.
import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, healthcareProfile, waitForRuntime } from "./support/fixtures";

test.setTimeout(15 * 60_000);
let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

const WORDS = "patient scheduling referral coordination insurance verification clinic operations".split(" ");
function listings(count: number, offset: number) {
  return { jobs: Array.from({ length: count }, (_, i) => ({ id: 8_000_000 + offset + i, title: `Synthetic ${offset + i}`, absolute_url: `https://boards.greenhouse.io/probe/jobs/${offset + i}`, location: { name: "Baltimore, MD" }, updated_at: "2026-10-01T12:00:00-04:00", content: `&lt;p&gt;${Array.from({ length: 3000 }, (_, k) => WORDS[(k * 7 + i) % WORDS.length]).join(" ")}&lt;/p&gt;` })) };
}

async function seedLarge(page: Page, batches: number) {
  for (let b = 0; b < batches; b += 1) {
    const body = JSON.stringify(listings(200, b * 200));
    await page.context().unroute("https://boards-api.greenhouse.io/**");
    await page.context().route("https://boards-api.greenhouse.io/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body }));
    const source = await page.evaluate((slug) => window.electronAPI.companies.create({ name: `Probe ${slug}`, url: `https://boards.greenhouse.io/probe-${slug}`, frequencyMinutes: 1440, isActive: false }), b);
    const run = await page.evaluate((id) => window.electronAPI.companies.runScrape(id), source.id);
    expect(run.status).toBe("success");
  }
}

async function dbPath(page: Page) { return page.evaluate(async () => (await window.electronAPI.system.getStatus()).databasePath); }

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

/** Leaves the app (stopping its worker), then edits the OPFS database file from a same-origin page. */
async function editDatabase(page: Page, file: string, mode: "garbage" | "truncate") {
  await page.goto(`${server.url}/manifest.webmanifest`);
  await page.waitForTimeout(500);
  return page.evaluate(async ([p, m]) => {
    let dir = await navigator.storage.getDirectory();
    const parts = p.split("/").filter(Boolean);
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const handle = await dir.getFileHandle(parts[parts.length - 1]);
    const original = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    const writable = await handle.createWritable();
    if (m === "garbage") await writable.write(new TextEncoder().encode("this is not a database"));
    else await writable.write(original.subarray(0, Math.floor(original.length / 2)));
    await writable.close();
    return { before: original.length, after: (await handle.getFile()).size };
  }, [file, mode] as const);
}

for (const mode of ["garbage", "truncate"] as const) {
  test(`a damaged database (${mode}) is refused at startup and left exactly as found`, async () => {
    const profile = mkdtempSync(path.join(os.tmpdir(), "sj-durability-"));
    const context = await chromium.launchPersistentContext(profile, { executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined });
    try {
      await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(server.url); await waitForRuntime(page);
      await page.evaluate((p) => window.electronAPI.career.saveProfile(p as never), { ...healthcareProfile, fullName: "Durability User" });
      const file = await dbPath(page);
      const sizes = await editDatabase(page, file, mode);
      expect(sizes.after).toBeLessThan(sizes.before);
      const damaged = await fileDigest(page, file);
      await page.goto(server.url);
      const error = page.getByTestId("pwa-boot-error");
      await expect(error).toBeVisible({ timeout: 30_000 });
      await expect(error).toContainText(mode === "garbage" ? /not a database/ : /malformed/);
      await expect(page.getByText("Your saved data has not been modified.")).toBeVisible();
      await expect(page.locator("#main-content")).toHaveCount(0);
      // Nothing replaced or "repaired" the file: whatever is in it can still be recovered.
      expect(await fileDigest(page, file)).toBe(damaged);
    } finally { await context.close(); try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ } }
  });
}

test("reload during large writes never leaves a damaged or partial workspace", async () => {
  const profile = mkdtempSync(path.join(os.tmpdir(), "sj-durability-"));
  const context = await chromium.launchPersistentContext(profile, { executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined });
  try {
    await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(server.url); await waitForRuntime(page);
    await page.evaluate((p) => window.electronAPI.career.saveProfile(p as never), { ...healthcareProfile, fullName: "Name 0" });
    await seedLarge(page, 2);
    const jobs = await page.evaluate(async () => (await window.electronAPI.jobs.list()).length);
    const results: string[] = [];
    for (let i = 1; i <= 8; i += 1) {
      const before = await page.evaluate(async () => (await window.electronAPI.career.getProfile())?.fullName);
      void page.evaluate((p) => window.electronAPI.career.saveProfile(p as never), { ...healthcareProfile, fullName: `Name ${i}` }).catch(() => undefined);
      await page.waitForTimeout(5 + i * 12);
      await page.reload(); await waitForRuntime(page);
      const after = await page.evaluate(async () => (await window.electronAPI.career.getProfile())?.fullName);
      const count = await page.evaluate(async () => (await window.electronAPI.jobs.list()).length);
      results.push(`${i}: before=${before} after=${after} jobs=${count}/${jobs}`);
      expect([before, `Name ${i}`]).toContain(after);
      expect(count).toBe(jobs);
    }
    test.info().annotations.push({ type: "reloads", description: results.join("; ") });
  } finally { await context.close(); try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ } }
});
