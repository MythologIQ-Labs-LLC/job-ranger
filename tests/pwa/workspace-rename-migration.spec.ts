// Sojourner rename (#339): a browser workspace created by a build released as Job Ranger opens in
// the renamed build with every record intact, and the legacy copy is left exactly as it was.
//
// The legacy workspace comes from one of two sources:
// - SOJOURNER_LEGACY_PWA_DIST=<dist-pwa of a pre-rename build> (for example built from
//   origin/release/v1.0.0-alpha.1-prep): that real build creates the workspace through its UI runtime;
// - otherwise the renamed build creates the records and the test rewrites them into the exact
//   legacy layout (root, database file name, absolute managed-artifact paths, storage keys).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, distPwaDemo, healthcareProfile, waitForRuntime } from "./support/fixtures";
import { WasmSqliteEngine } from "../../src/pwa/runtime/wasm-sqlite-engine";
import {
  DATABASE_FILE_NAME,
  LEGACY_DATABASE_FILE_NAME,
  LEGACY_RUNTIME_LOCK_NAME,
  LEGACY_USER_DATA_DIRECTORY,
  USER_DATA_DIRECTORY,
} from "../../src/pwa/runtime/protocol";
import { MIGRATION_IN_PROGRESS_FILE, MIGRATION_RECORD_FILE } from "../../src/pwa/runtime/workspace-migration";
import { LEGACY_STORAGE_KEY_PREFIX, STORAGE_KEYS_MIGRATED_KEY } from "../../src/browser-storage-migration";

test.setTimeout(5 * 60_000);

const LEGACY_DIST = process.env.SOJOURNER_LEGACY_PWA_DIST?.trim() || "";
const NEW_ROOT = USER_DATA_DIRECTORY.slice(1);
const LEGACY_ROOT = LEGACY_USER_DATA_DIRECTORY.slice(1);
const ONBOARDING = "onboarding.dismissed.v1";

type Tree = Record<string, { size: number; sha256: string }>;

/** Every file below an OPFS directory: relative path -> size and SHA-256 (from a same-origin page). */
async function opfsTree(page: Page, root: string): Promise<Tree> {
  return page.evaluate(async (rootName) => {
    const result: Record<string, { size: number; sha256: string }> = {};
    let top: FileSystemDirectoryHandle;
    try {
      top = await (await navigator.storage.getDirectory()).getDirectoryHandle(rootName);
    } catch {
      return result;
    }
    const walk = async (directory: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of (directory as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "directory") await walk(handle as FileSystemDirectoryHandle, relative);
        else {
          const bytes = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer();
          const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
          result[relative] = { size: bytes.byteLength, sha256: digest };
        }
      }
    };
    await walk(top, "");
    return result;
  }, root);
}

/** Reads (base64) or writes OPFS files from a same-origin page. */
async function readOpfsFiles(page: Page, root: string): Promise<Record<string, string>> {
  return page.evaluate(async (rootName) => {
    const result: Record<string, string> = {};
    const top = await (await navigator.storage.getDirectory()).getDirectoryHandle(rootName);
    const walk = async (directory: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of (directory as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "directory") await walk(handle as FileSystemDirectoryHandle, relative);
        else {
          const bytes = new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          result[relative] = btoa(binary);
        }
      }
    };
    await walk(top, "");
    return result;
  }, root);
}

async function writeOpfsFiles(page: Page, root: string, files: Record<string, string>): Promise<void> {
  await page.evaluate(async ([rootName, entries]) => {
    const storage = await navigator.storage.getDirectory();
    for (const [relative, base64] of Object.entries(entries)) {
      let directory = await storage.getDirectoryHandle(rootName, { create: true });
      const parts = relative.split("/");
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const writable = await (await directory.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await writable.write(bytes);
      await writable.close();
    }
  }, [root, files] as const);
}

async function removeOpfsRoot(page: Page, root: string): Promise<void> {
  await page.evaluate(async (rootName) => {
    await (await navigator.storage.getDirectory()).removeEntry(rootName, { recursive: true }).catch(() => undefined);
  }, root);
}

/** Leaves the app (its worker stops and releases the Web Locks) for a same-origin static page. */
async function leaveApp(page: Page, server: PwaServer): Promise<void> {
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
  });
  await page.goto(`${server.url}manifest.webmanifest`);
  await page.waitForTimeout(500);
}

interface Records {
  evidenceId: string;
  artifactId: string;
  companyName: string;
}

/** Records written through the runtime's public API (the same on the legacy and the renamed build). */
async function createRecords(page: Page): Promise<Records> {
  return page.evaluate(async (profile) => {
    const api = window.electronAPI;
    await api.career.saveProfile({ ...profile, fullName: "Legacy Morgan" } as never);
    const evidence = await api.career.createUserEvidence({
      subjectType: "achievement", organization: "Harbor Family Clinic", titleOrName: "Referral backlog",
      startDate: "2025-01", endDate: null, statement: "Cleared a 300-referral backlog before the rename.",
      skills: [], methodsOrTools: [], scope: [], outcomes: [], metrics: [], credential: null,
    } as never);
    const company = await api.companies.create({
      name: "Harbor Health", url: "https://boards.greenhouse.io/harbor-health", frequencyMinutes: 1440, isActive: false,
    } as never);
    const imported = await api.career.importPastedText({
      label: "Pre-rename background",
      text: "Experience\nPatient Services Coordinator, Harbor Family Clinic\n- Verified insurance eligibility before visits.",
    } as never);
    return { evidenceId: evidence.id, artifactId: imported.artifact.id, companyName: company.name };
  }, healthcareProfile);
}

async function expectRecords(page: Page, records: Records): Promise<void> {
  const state = await page.evaluate(async () => {
    const api = window.electronAPI;
    const [profile, evidence, companies, artifacts, status] = await Promise.all([
      api.career.getProfile(),
      api.career.listEvidence(),
      api.companies.list(),
      api.career.listSourceArtifacts(),
      api.system.getStatus(),
    ]);
    return {
      profileName: profile?.fullName ?? null,
      evidenceIds: evidence.map((item) => item.evidence.id),
      companies: companies.map((company) => company.name),
      artifacts: artifacts.map((artifact) => ({ id: artifact.id, managedPath: artifact.managedPath })),
      databasePath: status.databasePath,
    };
  });
  expect(state.profileName).toBe("Legacy Morgan");
  expect(state.evidenceIds).toContain(records.evidenceId);
  expect(state.companies).toContain(records.companyName);
  const artifact = state.artifacts.find((item) => item.id === records.artifactId);
  expect(artifact?.managedPath.startsWith(`${USER_DATA_DIRECTORY}/data/artifacts/`)).toBe(true);
  expect(state.databasePath).toBe(`${USER_DATA_DIRECTORY}/data/${DATABASE_FILE_NAME}`);
}

/** Rewrites a renamed-build workspace into the legacy layout: legacy database name and artifact paths. */
async function toLegacyLayout(files: Record<string, string>): Promise<Record<string, string>> {
  const work = await mkdtemp(path.join(os.tmpdir(), "sojourner-legacy-layout-"));
  try {
    const databaseFile = path.join(work, "workspace.sqlite3");
    await writeFile(databaseFile, Buffer.from(files[`data/${DATABASE_FILE_NAME}`], "base64"));
    const sqlite3 = await sqlite3InitModule({ print: () => undefined, printErr: () => undefined });
    const engine = new WasmSqliteEngine({ sqlite3, fs: { readFile, writeFile, mkdir: async () => undefined, stat: (await import("node:fs/promises")).stat }, dirname: path.dirname });
    const from = `${USER_DATA_DIRECTORY}/data/`;
    const to = `${LEGACY_USER_DATA_DIRECTORY}/data/`;
    await engine.transaction(databaseFile, ["source_artifacts", "resume_artifacts"].map((table) =>
      `UPDATE ${table} SET managed_path = '${to}' || substr(managed_path, ${from.length + 1}) WHERE substr(managed_path, 1, ${from.length}) = '${from}';`));
    engine.closeAll();
    const legacy: Record<string, string> = {};
    for (const [relative, base64] of Object.entries(files)) {
      if (relative === `data/${DATABASE_FILE_NAME}`) legacy[`data/${LEGACY_DATABASE_FILE_NAME}`] = (await readFile(databaseFile)).toString("base64");
      else if (!relative.startsWith(".sojourner-")) legacy[relative] = base64;
    }
    return legacy;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** A legacy workspace in a fresh browser context, created by the legacy build or synthesized. */
async function legacyWorkspace(context: BrowserContext, server: PwaServer): Promise<{ page: Page; records: Records }> {
  const page = await context.newPage();
  if (LEGACY_DIST) {
    server.setRoot(LEGACY_DIST);
    await page.goto(server.url);
    await waitForRuntime(page);
    const records = await createRecords(page);
    await leaveApp(page, server);
    server.setRoot(distPwa);
    return { page, records };
  }
  await page.goto(server.url);
  await waitForRuntime(page);
  const records = await createRecords(page);
  await leaveApp(page, server);
  const legacy = await toLegacyLayout(await readOpfsFiles(page, NEW_ROOT));
  await removeOpfsRoot(page, NEW_ROOT);
  await writeOpfsFiles(page, LEGACY_ROOT, legacy);
  await page.evaluate(([prefix, key, marker]) => {
    for (const name of Object.keys(localStorage)) if (!name.startsWith(prefix)) localStorage.removeItem(name);
    localStorage.removeItem(marker);
    localStorage.setItem(`${prefix}${key}`, "true");
  }, [LEGACY_STORAGE_KEY_PREFIX, ONBOARDING, STORAGE_KEYS_MIGRATED_KEY] as const);
  return { page, records };
}

let server: PwaServer;
test.beforeAll(async () => {
  if (LEGACY_DIST && !existsSync(path.join(LEGACY_DIST, "index.html"))) throw new Error(`SOJOURNER_LEGACY_PWA_DIST has no build: ${LEGACY_DIST}`);
  server = await startPwaServer(distPwa);
});
test.afterAll(async () => { await server.close(); });

test(`a workspace created before the rename opens in the renamed build, intact, and the legacy copy is untouched (${LEGACY_DIST ? "legacy build" : "synthesized legacy layout"})`, async ({ browser }) => {
  const context = await browser.newContext();
  try {
    // The legacy build's own preference key: the renamed build must carry it over.
    await context.addInitScript(([prefix, key]) => localStorage.setItem(`${prefix}${key}`, "true"), [LEGACY_STORAGE_KEY_PREFIX, ONBOARDING] as const);
    const { page, records } = await legacyWorkspace(context, server);
    const legacyBefore = await opfsTree(page, LEGACY_ROOT);
    expect(Object.keys(legacyBefore)).toContain(`data/${LEGACY_DATABASE_FILE_NAME}`);
    expect(Object.keys(legacyBefore).some((name) => name.startsWith("data/artifacts/"))).toBe(true);
    expect(await opfsTree(page, NEW_ROOT)).toEqual({});

    // First start of the renamed build: migrate, then open.
    await page.goto(server.url);
    await waitForRuntime(page);
    await expect(page.getByTestId("pwa-boot-error")).toHaveCount(0);
    await expectRecords(page, records);
    const storage = await page.evaluate(([prefix, key, marker]) => ({
      current: localStorage.getItem(`sojourner.${key}`),
      legacy: localStorage.getItem(`${prefix}${key}`),
      marker: localStorage.getItem(marker),
    }), [LEGACY_STORAGE_KEY_PREFIX, ONBOARDING, STORAGE_KEYS_MIGRATED_KEY] as const);
    expect(storage).toEqual({ current: "true", legacy: "true", marker: expect.any(String) });

    // Every managed artifact is inside the new workspace: a full backup (which refuses any artifact
    // outside the data directory) succeeds.
    await page.goto(`${server.url}#/settings`);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Create backup" }).click();
    expect((await download).suggestedFilename()).toMatch(/^sojourner-backup-/);

    // Changes go to the new workspace only; the legacy copy is byte-for-byte what the legacy build left.
    await page.evaluate((profile) => window.electronAPI.career.saveProfile({ ...profile, fullName: "Legacy Morgan" } as never), healthcareProfile);
    await page.evaluate(() => window.electronAPI.career.createUserEvidence({
      subjectType: "achievement", organization: "Sojourner", titleOrName: "After the rename",
      startDate: "2026-11", endDate: null, statement: "Written after the migration.",
      skills: [], methodsOrTools: [], scope: [], outcomes: [], metrics: [], credential: null,
    } as never));
    await leaveApp(page, server);
    expect(await opfsTree(page, LEGACY_ROOT)).toEqual(legacyBefore);
    const migrated = await opfsTree(page, NEW_ROOT);
    expect(Object.keys(migrated)).toContain(`data/${DATABASE_FILE_NAME}`);
    expect(Object.keys(migrated)).not.toContain(`data/${LEGACY_DATABASE_FILE_NAME}`);
    expect(Object.keys(migrated)).toContain(MIGRATION_RECORD_FILE);
    expect(Object.keys(migrated)).not.toContain(MIGRATION_IN_PROGRESS_FILE);
    for (const [name, file] of Object.entries(legacyBefore)) {
      if (name.startsWith("data/artifacts/")) expect(migrated[name], name).toEqual(file);
    }

    // A later start opens the migrated workspace again; nothing is copied a second time.
    await page.goto(server.url);
    await waitForRuntime(page);
    await expectRecords(page, records);
    const statements = await page.evaluate(async () => (await window.electronAPI.career.listEvidence()).map((item) => item.evidence.statement));
    expect(statements).toContain("Written after the migration.");
    await leaveApp(page, server);
    expect((await opfsTree(page, NEW_ROOT))[MIGRATION_RECORD_FILE]).toEqual(migrated[MIGRATION_RECORD_FILE]);
    expect(await opfsTree(page, LEGACY_ROOT)).toEqual(legacyBefore);
  } finally {
    await context.close();
  }
});

test("a legacy workspace that cannot be copied intact stays the workspace in use, untouched, with no partial copy", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await context.addInitScript(([prefix, key]) => localStorage.setItem(`${prefix}${key}`, "true"), [LEGACY_STORAGE_KEY_PREFIX, ONBOARDING] as const);
    const page = await context.newPage();
    await page.goto(`${server.url}manifest.webmanifest`);
    // A damaged legacy database fails the copy's integrity check.
    await writeOpfsFiles(page, LEGACY_ROOT, {
      [`data/${LEGACY_DATABASE_FILE_NAME}`]: Buffer.from("this is not a database").toString("base64"),
      "data/artifacts/sources/a1/source.txt": Buffer.from("resume text").toString("base64"),
    });
    const legacyBefore = await opfsTree(page, LEGACY_ROOT);

    await page.goto(server.url);
    // The session runs from the legacy root: its damaged database is reported (and offered a
    // restore) exactly as before the rename, and nothing replaced or "repaired" it.
    const error = page.getByTestId("pwa-boot-error");
    await expect(error).toBeVisible({ timeout: 60_000 });
    await expect(error).toContainText(/not a database/);
    await expect(page.getByTestId("pwa-recovery-restore")).toBeVisible();
    await leaveApp(page, server);
    expect(await opfsTree(page, NEW_ROOT)).toEqual({});
    expect(await opfsTree(page, LEGACY_ROOT)).toEqual(legacyBefore);
  } finally {
    await context.close();
  }
});

test("a tab still running the legacy build keeps the renamed build waiting (one writer across the rename)", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const legacyTab = await context.newPage();
    await legacyTab.goto(`${server.url}manifest.webmanifest`);
    // Exactly what a legacy build's runtime worker holds for its whole lifetime.
    await legacyTab.evaluate((name) => {
      void navigator.locks.request(name, { mode: "exclusive" }, () => new Promise(() => undefined));
    }, LEGACY_RUNTIME_LOCK_NAME);
    const renamed = await context.newPage();
    await renamed.goto(server.url);
    await expect(renamed.getByText("Sojourner is open in another tab or window")).toBeVisible({ timeout: 60_000 });
    await legacyTab.close();
    await waitForRuntime(renamed);
    expect((await renamed.evaluate(() => window.electronAPI.getRuntimeInfo())).kind).toBe("web");
  } finally {
    await context.close();
  }
});

test("the demo never runs over (or migrates) a real legacy workspace on its origin", async ({ browser }) => {
  const demoServer = await startPwaServer(distPwaDemo);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${demoServer.url}manifest.webmanifest`);
    await writeOpfsFiles(page, LEGACY_ROOT, { [`data/${LEGACY_DATABASE_FILE_NAME}`]: Buffer.from("SQLite format 3\u0000real").toString("base64") });
    const legacyBefore = await opfsTree(page, LEGACY_ROOT);
    await page.goto(demoServer.url);
    await expect(page.getByTestId("pwa-boot-error")).toHaveText(
      "This site holds a Sojourner workspace that is not a demo; the demo will not erase it.",
      { timeout: 60_000 },
    );
    await leaveApp(page, demoServer);
    expect(await opfsTree(page, LEGACY_ROOT)).toEqual(legacyBefore);
    expect(await opfsTree(page, NEW_ROOT)).toEqual({});
  } finally {
    await context.close();
    await demoServer.close();
  }
});
