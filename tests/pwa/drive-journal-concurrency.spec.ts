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
  }) as unknown as { output: Array<{ type: string; code?: string }> } | Array<{ output: Array<{ type: string; code?: string }> }>;
  const outputs = Array.isArray(compiled) ? compiled : [compiled];
  const script = outputs.flatMap(item => item.output).find(item => item.type === "chunk")?.code;
  if (!script) throw new Error("Drive journal browser bundle was not produced");
  bundled = script;
  server = await startPwaServer(distPwa);
});
test.afterAll(async () => { if (server) await server.close(); });

async function install(page: import("@playwright/test").Page) {
  await page.route("**" + scriptPath, route => route.fulfill({
    status: 200, contentType: "text/javascript", body: bundled,
  }));
  // Insert a parser-created same-origin script rather than dynamically assigning
  // script.src. The production Trusted Types policy remains enforced.
  await page.route(server.url, async route => {
    const response = await route.fetch();
    const html = await response.text();
    if (!html.includes("</head>")) throw new Error("Expected PWA document head");
    await route.fulfill({
      response,
      body: html.replace("</head>", `<script src="${scriptPath}"></script></head>`),
    });
  });
  await page.goto(server.url);
  await page.waitForFunction(() => Boolean((window as any).__sojournerDriveJournal?.BrowserDriveExportJournal));
}

test("concurrent tabs cannot reserve separate approval IDs for the same account and resume", async ({ page }) => {
  const second = await page.context().newPage();
  try {
    await Promise.all([install(page), install(second)]);
    const common = {
      schemaVersion: 2, accountId: "googleAccount1", destinationId: "root",
      artifactId: "resumeArtifact1", artifactRevision: "1",
      bytesSha256: "a".repeat(64), fileName: "verified.pdf", mimeType: "application/pdf",
      status: "prepared", remoteId: null, verifiedSha256: null, reservedFileId: "reservedConcurrent1",
      resolution: null, updatedAt: new Date().toISOString(),
    };
    const attempts = await Promise.all([page, second].map(tab => tab.evaluate(async common => {
      const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
      const journal = new Journal();
      return journal.insertIfAbsent({
        ...common, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      });
    }, common)));
    const observed = await second.evaluate(async common => {
      const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
      const journal = new Journal();
      return {
        pending: await journal.hasUnresolvedForArtifact(common.accountId, common.artifactId),
        otherAccount: await journal.hasUnresolvedForArtifact("otherAccount", common.artifactId),
        otherResume: await journal.hasUnresolvedForArtifact(common.accountId, "otherResume"),
      };
    }, common);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(observed).toEqual({ pending: true, otherAccount: false, otherResume: false });
  } finally {
    await second.close();
  }
});

test("pending status persists after navigation/reload and terminal verification permits a new consent", async ({ page }) => {
  await install(page);
  const seeded = await page.evaluate(async () => {
    const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const journal = new Journal();
    const record = {
      schemaVersion: 2, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      accountId: "googleAccount2", destinationId: "root", artifactId: "resumeArtifact2",
      artifactRevision: "1", bytesSha256: "b".repeat(64), fileName: "resume.pdf",
      mimeType: "application/pdf", status: "prepared", remoteId: null, reservedFileId: crypto.randomUUID().replaceAll("-", ""),
      verifiedSha256: null, resolution: null, updatedAt: new Date().toISOString(),
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
    const accepted = { ...record, status: "accepted_unverified", remoteId: record.reservedFileId,
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

test("unused receipt cancellation is atomic and cannot erase an upload begun in another tab", async ({ page }) => {
  await install(page);
  const result = await page.evaluate(async () => {
    const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const a = new Journal();
    const b = new Journal();
    const prepared = {
      schemaVersion: 2, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      accountId: "cancelAccount", destinationId: "root", artifactId: "cancelArtifact",
      artifactRevision: "1", bytesSha256: "c".repeat(64), fileName: "resume.pdf",
      mimeType: "application/pdf", status: "prepared", remoteId: null, reservedFileId: crypto.randomUUID().replaceAll("-", ""),
      verifiedSha256: null, resolution: null, updatedAt: new Date().toISOString(),
    };
    const reserved = await a.insertIfAbsent(prepared);
    const uploading = { ...prepared, status: "uploading", updatedAt: new Date().toISOString() };
    const promoted = await b.compareAndSwap(prepared.operationId, "prepared", uploading);
    const cancelled = await a.compareAndSwap(prepared.operationId, "prepared",
      { ...prepared, status: "cancelled", updatedAt: new Date().toISOString() });
    const stored = await a.findOperation(prepared.operationId);
    const pending = await a.unresolvedForArtifact(prepared.accountId, prepared.artifactId);
    return { reserved, promoted, cancelled, storedStatus: stored?.status,
      pendingStatuses: pending.map((entry: { status: string }) => entry.status) };
  });
  expect(result).toEqual({
    reserved: true, promoted: true, cancelled: false, storedStatus: "uploading",
    pendingStatuses: ["uploading"],
  });
});
test("cancelled unused receipt survives reload and releases its artifact reservation", async ({ page }) => {
  await install(page);
  const setup = await page.evaluate(async () => {
    const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const journal = new Journal();
    const record = {
      schemaVersion: 2, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      accountId: "cancelAccount2", destinationId: "root", artifactId: "cancelArtifact2",
      artifactRevision: "1", bytesSha256: "d".repeat(64), fileName: "resume.pdf",
      mimeType: "application/pdf", status: "prepared", remoteId: null, reservedFileId: crypto.randomUUID().replaceAll("-", ""),
      verifiedSha256: null, resolution: null, updatedAt: new Date().toISOString(),
    };
    const reserved = await journal.insertIfAbsent(record);
    const cancelled = await journal.compareAndSwap(record.operationId, "prepared",
      { ...record, status: "cancelled", updatedAt: new Date().toISOString() });
    return { record, reserved, cancelled };
  });
  expect(setup.reserved).toBe(true);
  expect(setup.cancelled).toBe(true);
  await page.reload();
  await install(page);
  const recovered = await page.evaluate(async (record) => {
    const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const journal = new Journal();
    const stored = await journal.findOperation(record.operationId);
    const blocked = await journal.hasUnresolvedForArtifact(record.accountId, record.artifactId);
    const fresh = await journal.insertIfAbsent({
      ...record, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    });
    return { status: stored?.status, blocked, fresh };
  }, setup.record);
  expect(recovered).toEqual({ status: "cancelled", blocked: false, fresh: true });
});

test("durable storage rejects an illegal uploading to cancelled transition", async ({ page }) => {
  await install(page);
  const result = await page.evaluate(async () => {
    const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const journal = new Journal();
    const prepared = {
      schemaVersion: 2, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      accountId: "storageAccount", destinationId: "root", artifactId: "storageArtifact",
      artifactRevision: "1", bytesSha256: "e".repeat(64), fileName: "resume.pdf",
      mimeType: "application/pdf", status: "prepared", remoteId: null, reservedFileId: crypto.randomUUID().replaceAll("-", ""),
      verifiedSha256: null, resolution: null, updatedAt: new Date().toISOString(),
    };
    await journal.insertIfAbsent(prepared);
    const uploading = { ...prepared, status: "uploading", updatedAt: new Date().toISOString() };
    await journal.compareAndSwap(prepared.operationId, "prepared", uploading);
    const accepted = await journal.compareAndSwap(prepared.operationId, "uploading",
      { ...uploading, status: "cancelled", updatedAt: new Date().toISOString() });
    const skippedVerification = await journal.compareAndSwap(prepared.operationId, "uploading",
      { ...uploading, status: "verified", remoteId: prepared.reservedFileId,
        verifiedSha256: prepared.bytesSha256, updatedAt: new Date().toISOString() });
    const stored = await journal.findOperation(prepared.operationId);
    const stillBlocked = await journal.hasUnresolvedForArtifact(prepared.accountId, prepared.artifactId);
    return { accepted, skippedVerification, status: stored?.status, stillBlocked };
  });
  expect(result).toEqual({ accepted: false, skippedVerification: false,
    status: "uploading", stillBlocked: true });
});

test("schema-v1 rows written before reserved file IDs still load, keep blocking, and need explicit abandonment", async ({ page }) => {
  await install(page);
  const result = await page.evaluate(async () => {
    const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const journal = new Journal();
    await journal.findOperation("warmup"); // creates the database exactly as production does
    const legacy = {
      schemaVersion: 1, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      accountId: "legacyAccount", destinationId: "root", artifactId: "legacyArtifact",
      artifactRevision: "1", bytesSha256: "f".repeat(64), fileName: "resume.pdf",
      mimeType: "application/pdf", status: "unknown_remote_outcome", remoteId: null,
      verifiedSha256: null, updatedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    // Write the raw v1 row directly, as the #315 candidate stored it.
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("job-ranger.drive-artifact-export-journal.v1", 1);
      open.onsuccess = () => {
        const tx = open.result.transaction("exports", "readwrite");
        tx.objectStore("exports").put(legacy);
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    const loaded = await journal.findOperation(legacy.operationId);
    const blocked = await journal.hasUnresolvedForArtifact(legacy.accountId, legacy.artifactId);
    const freshRefused = await journal.insertIfAbsent({
      ...loaded, schemaVersion: 2, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      status: "prepared", reservedFileId: "freshReserved", updatedAt: new Date().toISOString(),
    });
    // Nothing can prove a v1 upload absent: failed is refused even with a claimed 404.
    const forgedFailed = await journal.compareAndSwap(legacy.operationId, "unknown_remote_outcome",
      { ...loaded, status: "failed", resolution: "reserved_id_absent", updatedAt: new Date().toISOString() });
    const unexplainedAbandon = await journal.compareAndSwap(legacy.operationId, "unknown_remote_outcome",
      { ...loaded, status: "abandoned", resolution: null, updatedAt: new Date().toISOString() });
    const abandoned = await journal.compareAndSwap(legacy.operationId, "unknown_remote_outcome",
      { ...loaded, status: "abandoned", resolution: "user_abandoned", updatedAt: new Date().toISOString() });
    const stored = await journal.findOperation(legacy.operationId);
    const unblocked = await journal.hasUnresolvedForArtifact(legacy.accountId, legacy.artifactId);
    return { loadedVersion: loaded.schemaVersion, loadedReserved: loaded.reservedFileId, blocked, freshRefused,
      forgedFailed, unexplainedAbandon, abandoned, storedStatus: stored.status, storedVersion: stored.schemaVersion,
      storedResolution: stored.resolution, unblocked };
  });
  expect(result).toEqual({
    loadedVersion: 2, loadedReserved: null, blocked: true, freshRefused: false,
    forgedFailed: false, unexplainedAbandon: false, abandoned: true, storedStatus: "abandoned",
    storedVersion: 2, storedResolution: "user_abandoned", unblocked: false,
  });
});

test("durable storage clears an ambiguous upload only with reserved-ID absence evidence", async ({ page }) => {
  await install(page);
  const result = await page.evaluate(async () => {
    const Journal = (window as any).__sojournerDriveJournal.BrowserDriveExportJournal;
    const journal = new Journal();
    const prepared = {
      schemaVersion: 2, operationId: crypto.randomUUID(), approvalId: crypto.randomUUID(),
      accountId: "reservedAccount", destinationId: "root", artifactId: "reservedArtifact",
      artifactRevision: "1", bytesSha256: "9".repeat(64), fileName: "resume.pdf",
      mimeType: "application/pdf", status: "prepared", remoteId: null, reservedFileId: "reservedIdA",
      verifiedSha256: null, resolution: null, updatedAt: new Date().toISOString(),
    };
    const unreserved = await journal.insertIfAbsent({ ...prepared, operationId: crypto.randomUUID(),
      approvalId: crypto.randomUUID(), reservedFileId: null }).catch(() => "refused");
    await journal.insertIfAbsent(prepared);
    const uploading = { ...prepared, status: "uploading", updatedAt: new Date().toISOString() };
    await journal.compareAndSwap(prepared.operationId, "prepared", uploading);
    const unknown = { ...uploading, status: "unknown_remote_outcome", updatedAt: new Date().toISOString() };
    await journal.compareAndSwap(prepared.operationId, "uploading", unknown);
    const swapped = await journal.compareAndSwap(prepared.operationId, "unknown_remote_outcome",
      { ...unknown, status: "failed", resolution: "reserved_id_absent", reservedFileId: "otherId",
        updatedAt: new Date().toISOString() });
    const rejectedClaim = await journal.compareAndSwap(prepared.operationId, "unknown_remote_outcome",
      { ...unknown, status: "failed", resolution: "provider_rejected", updatedAt: new Date().toISOString() });
    const stillBlocked = await journal.hasUnresolvedForArtifact(prepared.accountId, prepared.artifactId);
    const proven = await journal.compareAndSwap(prepared.operationId, "unknown_remote_outcome",
      { ...unknown, status: "failed", resolution: "reserved_id_absent", updatedAt: new Date().toISOString() });
    const unblocked = !(await journal.hasUnresolvedForArtifact(prepared.accountId, prepared.artifactId));
    return { unreserved, swapped, rejectedClaim, stillBlocked, proven, unblocked };
  });
  expect(result).toEqual({ unreserved: "refused", swapped: false, rejectedClaim: false,
    stillBlocked: true, proven: true, unblocked: true });
});
