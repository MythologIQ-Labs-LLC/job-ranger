import { expect, test } from "@playwright/test";
import { build } from "vite";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, projectRoot } from "./support/fixtures";

/**
 * Real browser IndexedDB concurrency qualification. This bundles the exact
 * production journal source, then serves it through an opt-in SAME-ORIGIN test
 * URL so the production CSP remains enforced. No Google requests or tokens.
 */
let server: PwaServer;
let bundled: string;
const scriptPath = "/__test_drive_journal_contract.js";

test.beforeAll(async () => {
  // Vite is already a direct project dependency. Do not add an extra
  // bundler just to run this focused test; keep the normal npm ci contract.
  const compiled = await build({
    configFile: false,
    root: projectRoot,
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: {
        entry: path.join(projectRoot, "src/pwa/drive/drive-journal-idb.ts"),
        name: "__sojournerDriveJournal",
        formats: ["iife"],
      },
    },
  }) as unknown as { output: Array<{ type: string; code?: string }> };
  const script = compiled.output.find(item => item.type === "chunk")?.code;
  if (!script) throw new Error("Drive journal browser bundle was not produced");
  bundled = script;
  server = await startPwaServer(distPwa);
});
test.afterAll(async () => { await server.close(); });

async function install(page: import("@playwright/test").Page) {
  await page.route("**" + scriptPath, route => route.fulfill({
    status: 200, contentType: "text/javascript", body: bundled,
  }));
  await page.goto(server.url);
  await page.addScriptTag({ url: new URL(scriptPath, server.url).toString() });
}

test("concurrent tabs cannot reserve separate approval IDs for the same account and resume", async ({ page }) => {
  await install(page);
  const result = await page.evaluate(async () => {
    const Constructor = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const journalA = new Constructor();
    const journalB = new Constructor();
    const common = {
      schemaVersion: 1, accountId: "googleAccount1", destinationId: "root",
      artifactId: "resumeArtifact1", artifactRevision: "1",
      bytesSha256: "a".repeat(64), fileName: "verified.pdf", mimeType: "application/pdf",
      status: "prepared", remoteId: null, verifiedSha256: null,
      updatedAt: new Date().toISOString(),
    };
    const first = { ...common, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID() };
    const second = { ...common, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID() };
    const attempts = await Promise.all([
      journalA.insertIfAbsent(first),
      journalB.insertIfAbsent(second),
    ]);
    const pending = await journalB.hasUnresolvedForArtifact(common.accountId, common.artifactId);
    const otherAccount = await journalB.hasUnresolvedForArtifact("otherAccount", common.artifactId);
    const otherResume = await journalB.hasUnresolvedForArtifact(common.accountId, "otherResume");
    return { attempts, pending, otherAccount, otherResume };
  });
  expect(result.attempts.filter(Boolean)).toHaveLength(1);
  expect(result.pending).toBe(true);
  expect(result.otherAccount).toBe(false);
  expect(result.otherResume).toBe(false);
});

test("pending status persists after navigation/reload and terminal verification permits a new consent", async ({ page }) => {
  await install(page);
  const seeded = await page.evaluate(async () => {
    const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const journal = new Journal();
    const record = {
      schemaVersion: 1, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      accountId: "googleAccount2", destinationId: "root", artifactId: "resumeArtifact2",
      artifactRevision: "1", bytesSha256: "b".repeat(64), fileName: "resume.pdf",
      mimeType: "application/pdf", status: "prepared", remoteId: null,
      verifiedSha256: null, updatedAt: new Date().toISOString(),
    };
    const reserved = await journal.insertIfAbsent(record);
    const uploading = { ...record, status: "uploading", updatedAt: new Date().toISOString() };
    const promoted = await journal.compareAndSwap(record.operationId, "prepared", uploading);
    return { record, reserved, promoted };
  });
  expect(seeded.reserved).toBe(true);
  expect(seeded.promoted).toBe(true);
  await page.reload();
  await install(page);
  const restored = await page.evaluate(async ({ record }) => {
    const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const journal = new Journal();
    const pending = await journal.hasUnresolvedForArtifact(record.accountId, record.artifactId);
    const accepted = { ...record, status: "accepted_unverified", remoteId: "remoteFileA",
      updatedAt: new Date().toISOString() };
    const moved = await journal.compareAndSwap(record.operationId, "uploading", accepted);
    const verified = { ...accepted, status: "verified", verifiedSha256: record.bytesSha256,
      updatedAt: new Date().toISOString() };
    const done = await journal.compareAndSwap(record.operationId, "accepted_unverified", verified);
    const noLongerPending = await journal.hasUnresolvedForArtifact(record.accountId, record.artifactId);
    const newApproval = await journal.insertIfAbsent({
      ...record, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    });
    return { pending, moved, done, noLongerPending, newApproval };
  }, { record: seeded.record });
  expect(restored).toEqual({
    pending: true, moved: true, done: true, noLongerPending: false, newApproval: true,
  });
});
