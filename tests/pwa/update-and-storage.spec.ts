import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, healthcareProfile, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
let roots: { current: string; next: string; broken: string };
let currentBuild: string;
let nextBuild: string;

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

async function makeVariant(target: string, buildId: string, corruptAsset: boolean): Promise<void> {
  await cp(distPwa, target, { recursive: true });
  const indexPath = path.join(target, "index.html");
  const index = (await readFile(indexPath, "utf8")).replace(currentBuild, buildId);
  await writeFile(indexPath, index);
  let sw = (await readFile(path.join(target, "sw.js"), "utf8")).replaceAll(currentBuild, buildId);
  const originalIndexHash = sha256(await readFile(path.join(distPwa, "index.html")));
  sw = sw.replace(originalIndexHash, sha256(index));
  await writeFile(path.join(target, "sw.js"), sw);
  if (corruptAsset) {
    // Deployed bytes no longer match the build manifest (e.g. a partial or tampered deploy).
    const manifestPath = path.join(target, "manifest.webmanifest");
    await writeFile(manifestPath, `${await readFile(manifestPath, "utf8")}\n`);
  }
}

test.beforeAll(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "job-ranger-sw-"));
  currentBuild = JSON.parse(await readFile(path.join(distPwa, "build-info.json"), "utf8")).buildId;
  nextBuild = `${currentBuild}.next`;
  roots = { current: path.join(base, "current"), next: path.join(base, "next"), broken: path.join(base, "broken") };
  await cp(distPwa, roots.current, { recursive: true });
  await makeVariant(roots.next, nextBuild, false);
  await makeVariant(roots.broken, `${currentBuild}.broken`, true);
  server = await startPwaServer(roots.current);
});

test.afterAll(async () => {
  await server.close();
  // Windows can briefly hold a served font open after the browser and server close (EBUSY).
  await rm(path.dirname(roots.current), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const buildMeta = (page: import("@playwright/test").Page) =>
  page.locator('meta[name="job-ranger-build"]').getAttribute("content");

test("service worker updates are verified, user-confirmed, recoverable, and never touch career data", async ({ page }) => {
  server.setRoot(roots.current);
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.evaluate((profile) => window.electronAPI.career.saveProfile(profile), healthcareProfile);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await waitForRuntime(page);
  expect(await buildMeta(page)).toBe(currentBuild);

  // 1. A deployment whose bytes do not match its build manifest is refused.
  server.setRoot(roots.broken);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await expect(page.getByTestId("pwa-update-error")).toBeVisible();
  await expect(page.getByTestId("pwa-update-ready")).toHaveCount(0);
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName).toBe("Morgan Rivera");
  // Withdraw the broken deployment before reloading: the reload triggers the
  // browser's own service-worker update check, which must not see it.
  server.setRoot(roots.current);
  await page.reload();
  await waitForRuntime(page);
  expect(await buildMeta(page)).toBe(currentBuild);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.installing || registration?.waiting);
      }),
    )
    .toBe(false);

  // 2. A valid new version installs in the background and waits for the user.
  server.setRoot(roots.next);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await expect(page.getByTestId("pwa-update-ready")).toBeVisible();
  expect(await buildMeta(page)).toBe(currentBuild);
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Reload to update" }).click()]);
  await waitForRuntime(page);
  expect(await buildMeta(page)).toBe(nextBuild);
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName).toBe("Morgan Rivera");
  const caches = await page.evaluate(() => window.caches.keys());
  expect(caches).toEqual([`job-ranger-shell-${nextBuild}`]);

  // 3. Shell repair clears only the shell and keeps career data.
  await page.goto(`${server.url}#/settings`);
  await Promise.all([page.waitForEvent("load"), page.getByTestId("repair-app-shell").click()]);
  await waitForRuntime(page);
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName).toBe("Morgan Rivera");
});

test("storage quota exhaustion fails visibly and leaves durable data consistent", async ({ page, context }) => {
  server.setRoot(roots.current);
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.evaluate((profile) => window.electronAPI.career.saveProfile(profile), healthcareProfile);
  const before = await page.evaluate(() => window.electronAPI.career.listSourceArtifacts());

  const origin = new URL(server.url).origin;
  const cdp = await context.newCDPSession(page);
  const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);
  await cdp.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: usage + 16 * 1024 });

  const outcome = await page.evaluate(async () => {
    try {
      await window.electronAPI.career.importPastedText({
        label: "Large history",
        text: Array.from({ length: 4000 }, (_, index) => `Line ${index}: coordinated clinic scheduling and referrals.`).join("\n"),
      });
      return "saved";
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(outcome).toMatch(/storage is full|Browser storage/i);
  await expect(page.getByTestId("pwa-storage-error")).toBeVisible();

  await cdp.send("Storage.overrideQuotaForOrigin", { origin });
  await page.reload();
  await waitForRuntime(page);
  expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName).toBe("Morgan Rivera");
  const after = await page.evaluate(() => window.electronAPI.career.listSourceArtifacts());
  expect(after.length).toBe(before.length);
  // The database still works normally once space is available again.
  const retried = await page.evaluate(() =>
    window.electronAPI.career.importPastedText({ label: "After quota", text: "Experience\nFront Desk Lead\n- Verified insurance eligibility." }),
  );
  expect(retried.artifact.byteSize).toBeGreaterThan(0);
});
