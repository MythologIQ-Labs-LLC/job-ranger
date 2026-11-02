import { expect, test, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { DRIVE_E2E_HELPER_ORIGIN, distPwaDriveE2e, waitForRuntime } from "./support/fixtures";

/**
 * Component-level qualification of GoogleDriveResumeExport (#314 M2) in a real
 * browser, against a Drive-CONFIGURED production build (npm run build:pwa:drive-e2e,
 * output dist-pwa-drive-e2e/; the default dist-pwa/ stays unconfigured).
 *
 * The isolated OAuth helper popup (https://helper.test) is routed and answers with the
 * helper response contract (oauth-helper-response-contract.ts). Every
 * www.googleapis.com request is answered by an in-memory fake Drive. No real Google
 * endpoint is contacted, and the production CSP and COOP headers stay enforced.
 * The verified PDF is produced by the real browser worker and ResumeService.
 */
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN = "drive-e2e-access-token";
const ACCOUNT_A = "permissionAccountA";
const ACCOUNT_B = "permissionAccountB";
const ROOT_ID = "rootFolderOpaque1";
const OPERATION_PROPERTY = "sojournerExportOperation";
const JOURNAL_DB = "job-ranger.drive-artifact-export-journal.v1";

let server: PwaServer;

test.beforeAll(async () => {
  const index = path.join(distPwaDriveE2e, "index.html");
  if (!existsSync(index)) {
    throw new Error("dist-pwa-drive-e2e/ is missing. Run `npm run build:pwa:drive-e2e` (part of npm run test:pwa:e2e).");
  }
  // Refuse to run against an unconfigured or differently configured build.
  const html = readFileSync(index, "utf8");
  if (!html.includes("https://www.googleapis.com/upload/drive/v3/")) {
    throw new Error("dist-pwa-drive-e2e/ was not built with the Drive helper origin configured.");
  }
  server = await startPwaServer(distPwaDriveE2e, {
    googleOAuthEnabled: true, isolatedGoogleOAuthOrigin: DRIVE_E2E_HELPER_ORIGIN,
  });
});
test.afterAll(async () => { if (server) await server.close(); });

interface FakeFile {
  id: string; name: string; mimeType: string; parents: string[];
  appProperties: Record<string, string>; bytes: Buffer;
}

/** In-memory Drive v3 subset with failure injection. Requires the helper-issued token. */
class FakeDrive {
  account = ACCOUNT_A;
  uploadMode: "ok" | "server_error" | "abort_before_create" | "abort_after_create" = "ok";
  rootMode: "ok" | "forbidden" = "ok";
  getMode: "ok" | "server_error" = "ok";
  readonly files = new Map<string, FakeFile>();
  readonly reserved: string[] = [];
  posts = 0;
  readonly unexpected: string[] = [];

  private cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
  private json(route: Route, status: number, body: unknown) {
    return route.fulfill({ status, headers: { ...this.cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: this.cors });
    if (request.headers()["authorization"] !== `Bearer ${TOKEN}`) return this.json(route, 401, { error: { code: 401 } });
    const pathname = url.pathname;
    if (request.method() === "GET" && pathname === "/drive/v3/about") {
      return this.json(route, 200, { user: { permissionId: this.account, emailAddress: `${this.account}@example.org`, displayName: "Morgan Rivera", me: true } });
    }
    if (request.method() === "GET" && pathname === "/drive/v3/files/generateIds") {
      if (url.searchParams.get("count") !== "1" || url.searchParams.get("space") !== "drive" || url.searchParams.get("type") !== "files") {
        this.unexpected.push(request.url());
        return this.json(route, 400, {});
      }
      const id = `reservedDriveFile${this.reserved.length + 1}x${Math.random().toString(36).slice(2, 10)}`;
      this.reserved.push(id);
      return this.json(route, 200, { kind: "drive#generatedIds", space: "drive", ids: [id] });
    }
    if (request.method() === "GET" && pathname === "/drive/v3/files/root") {
      return this.rootMode === "ok"
        ? this.json(route, 200, { id: ROOT_ID, mimeType: "application/vnd.google-apps.folder" })
        : this.json(route, 403, { error: { code: 403 } });
    }
    if (request.method() === "POST" && pathname === "/upload/drive/v3/files") return this.create(route, request);
    if (request.method() === "GET" && pathname === "/drive/v3/files") {
      // appProperties search (schema-v1 fallback only).
      const query = url.searchParams.get("q") ?? "";
      const matches = [...this.files.values()].filter(file =>
        query.includes(`value='${file.appProperties[OPERATION_PROPERTY]}'`));
      return this.json(route, 200, { files: matches.map(file => ({ id: file.id, appProperties: file.appProperties })) });
    }
    const fileMatch = /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (request.method() === "GET" && fileMatch) {
      if (this.getMode === "server_error") return this.json(route, 503, { error: { code: 503 } });
      const file = this.files.get(fileMatch[1]);
      if (!file) return this.json(route, 404, { error: { code: 404, message: "File not found" } });
      if (url.searchParams.get("alt") === "media") {
        return route.fulfill({ status: 200, headers: { ...this.cors, "content-type": file.mimeType }, body: file.bytes });
      }
      return this.json(route, 200, { id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents,
        size: String(file.bytes.length), appProperties: file.appProperties });
    }
    this.unexpected.push(`${request.method()} ${request.url()}`);
    return this.json(route, 404, {});
  }

  private async create(route: Route, request: Request): Promise<void> {
    this.posts++;
    const type = request.headers()["content-type"] ?? "";
    const boundary = /boundary=([^;]+)$/.exec(type)?.[1];
    const body = request.postDataBuffer();
    if (!boundary || !body) { this.unexpected.push("malformed multipart"); return this.json(route, 400, {}); }
    const headerEnd = (from: number) => body.indexOf("\r\n\r\n", from) + 4;
    const firstStart = headerEnd(0);
    const secondDelimiter = body.indexOf(`\r\n--${boundary}\r\n`, firstStart);
    const metadata = JSON.parse(body.subarray(firstStart, secondDelimiter).toString("utf8"));
    const bytesStart = headerEnd(secondDelimiter + 2);
    const bytesEnd = body.lastIndexOf(`\r\n--${boundary}--`);
    const bytes = Buffer.from(body.subarray(bytesStart, bytesEnd));
    if (this.uploadMode === "server_error") return this.json(route, 503, { error: { code: 503 } });
    if (this.uploadMode === "abort_before_create") return route.abort("connectionfailed");
    if (typeof metadata.id !== "string" || !this.reserved.includes(metadata.id)) {
      this.unexpected.push(`create without a reserved id: ${metadata.id}`);
      return this.json(route, 400, {});
    }
    if (this.files.has(metadata.id)) return this.json(route, 409, { error: { code: 409, message: "A file already exists with the provided ID." } });
    this.files.set(metadata.id, { id: metadata.id, name: metadata.name, mimeType: metadata.mimeType,
      parents: metadata.parents, appProperties: metadata.appProperties, bytes });
    if (this.uploadMode === "abort_after_create") return route.abort("connectionfailed");
    return this.json(route, 200, { id: metadata.id, name: metadata.name });
  }
}

/** Routed stand-in for the isolated helper: replies once per the helper response contract. */
function helperPage(appOrigin: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Helper</title><script>
    const nonce = new URLSearchParams(location.hash.slice(1)).get("nonce");
    history.replaceState(null, "", location.pathname);
    window.opener.postMessage({ version: 1, type: "sojourner.drive-oauth.response", nonce,
      scope: ${JSON.stringify(SCOPE)}, accessToken: ${JSON.stringify(TOKEN)}, expiresIn: 3600 },
      ${JSON.stringify(appOrigin)});
  </script>`;
}

interface Harness { drive: FakeDrive; google: string[]; tokenInUrl: string[] }

async function install(context: BrowserContext): Promise<Harness> {
  const drive = new FakeDrive();
  const google: string[] = [];
  const tokenInUrl: string[] = [];
  const appOrigin = new URL(server.url).origin;
  await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await context.route(url => url.origin === DRIVE_E2E_HELPER_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: helperPage(appOrigin) }));
  await context.route(url => url.hostname === "www.googleapis.com", route => drive.handle(route));
  context.on("request", request => {
    const url = new URL(request.url());
    if (url.hostname === "accounts.google.com" || url.hostname.endsWith(".gstatic.com") ||
        url.hostname === "oauth2.googleapis.com" || url.hostname === "apis.google.com") google.push(request.url());
    if (request.url().includes(TOKEN)) tokenInUrl.push(request.url());
  });
  return { drive, google, tokenInUrl };
}

/** A real Truth-Gated resume exported to a verified PDF through the browser worker. */
async function seedVerifiedPdf(page: Page): Promise<{ artifactId: string; contentHash: string }> {
  await page.goto(server.url);
  await waitForRuntime(page);
  return page.evaluate(async () => {
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
    if (!resume.truthGate.passed) throw new Error("Truth Gate did not pass");
    const exported = await api.resume.exportPdf({ projectionId: resume.projection.id });
    if (!exported.parseabilityGate.passed) throw new Error("Parseability Gate did not pass");
    return { artifactId: exported.artifact.id, contentHash: exported.artifact.contentHash };
  });
}

async function openDriveExport(page: Page) {
  await page.goto(server.url + "#/resume");
  await waitForRuntime(page);
  await page.getByRole("button", { name: /ATS-safe standard/ }).first().click();
  const panel = page.getByTestId("drive-resume-export");
  await expect(panel).toBeVisible();
  return panel;
}

async function authorize(page: Page) {
  const panel = page.getByTestId("drive-resume-export");
  const popup = page.waitForEvent("popup");
  await panel.getByRole("button", { name: "Authorize Drive" }).click();
  await popup;
  await expect(panel.getByText("Google Drive access authorized. No document was uploaded.")).toBeVisible();
}

async function review(page: Page) {
  const panel = page.getByTestId("drive-resume-export");
  await panel.getByRole("button", { name: "Review PDF for Drive" }).click();
}

async function journalRows(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some(db => db.name === name)) return [];
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction("exports", "readonly").objectStore("exports").getAll();
        request.onsuccess = () => { db.close(); resolve(request.result); };
        request.onerror = () => { db.close(); reject(request.error); };
      };
      open.onerror = () => reject(open.error);
    });
  }, JOURNAL_DB);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectNoGoogleSignIn(harness: Harness) {
  expect(harness.google, "the Career Ops origin never contacts Google sign-in").toEqual([]);
  expect(harness.tokenInUrl, "the access token never appears in a URL").toEqual([]);
  expect(harness.drive.unexpected).toEqual([]);
}

test("the configured main origin serves no Google sign-in allowance and loads none", async ({ page, context }) => {
  const harness = await install(context);
  const response = await page.goto(server.url + "#/resume");
  await waitForRuntime(page);
  const header = (await response!.allHeaders())["content-security-policy"];
  const meta = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  for (const csp of [header, meta]) {
    expect(csp).toContain("https://www.googleapis.com/upload/drive/v3/");
    expect(csp).not.toContain("accounts.google.com");
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval';/);
  }
  expect((await response!.allHeaders())["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  expect(await page.evaluate(() => Boolean((window as unknown as { google?: unknown }).google))).toBe(false);
  expectNoGoogleSignIn(harness);
});

test("authorize, review, confirm: the reserved Drive file is created once and verified with its link", async ({ page, context }) => {
  const harness = await install(context);
  const seeded = await seedVerifiedPdf(page);
  const panel = await openDriveExport(page);
  await authorize(page);
  await review(page);
  const reviewPanel = panel.getByTestId("drive-export-review");
  await expect(reviewPanel).toContainText(`${ACCOUNT_A}@example.org`);
  await expect(reviewPanel).toContainText("My Drive (top level)");
  await expect(reviewPanel).toContainText(seeded.contentHash);
  expect(harness.drive.posts).toBe(0);
  await reviewPanel.getByRole("button", { name: "Confirm and upload this PDF" }).click();
  await expect(panel.getByText("Drive document verified against the approved bytes.")).toBeVisible();

  expect(harness.drive.posts).toBe(1);
  expect(harness.drive.reserved).toHaveLength(1);
  const [reservedId] = harness.drive.reserved;
  const file = harness.drive.files.get(reservedId)!;
  expect(file).toBeTruthy();
  expect(sha256(file.bytes)).toBe(seeded.contentHash);
  expect(file.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(file.parents).toEqual([ROOT_ID]);
  expect(file.mimeType).toBe("application/pdf");
  const link = panel.getByRole("link", { name: "Open in Google Drive" });
  await expect(link).toHaveAttribute("href", `https://drive.google.com/file/d/${reservedId}/view`);

  const rows = await journalRows(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ schemaVersion: 2, status: "verified", reservedFileId: reservedId,
    remoteId: reservedId, verifiedSha256: seeded.contentHash, accountId: ACCOUNT_A,
    artifactId: seeded.artifactId, resolution: null });
  expect(file.appProperties[OPERATION_PROPERTY]).toBe(rows[0].operationId);
  expect(JSON.stringify(rows)).not.toContain(TOKEN);
  expectNoGoogleSignIn(harness);
});

test("a Google account switch between review and confirm is refused before anything is reserved or sent", async ({ page, context }) => {
  const harness = await install(context);
  await seedVerifiedPdf(page);
  const panel = await openDriveExport(page);
  await authorize(page);
  await review(page);
  await expect(panel.getByTestId("drive-export-review")).toBeVisible();
  harness.drive.account = ACCOUNT_B;
  await panel.getByRole("button", { name: "Confirm and upload this PDF" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Google account changed after the export preview. Review the destination again.");
  expect(harness.drive.posts).toBe(0);
  expect(harness.drive.reserved).toEqual([]);
  expect(await journalRows(page)).toEqual([]);
  expectNoGoogleSignIn(harness);
});

test("a 5xx upload ends blocked, and stays blocked across reload and an unavailable Drive check", async ({ page, context }) => {
  const harness = await install(context);
  await seedVerifiedPdf(page);
  let panel = await openDriveExport(page);
  await authorize(page);
  await review(page);
  harness.drive.uploadMode = "server_error";
  await panel.getByRole("button", { name: "Confirm and upload this PDF" }).click();
  await expect(panel.getByRole("alert")).toContainText("The upload is not verified. Google Drive did not confirm whether it created the file.");
  expect(harness.drive.posts).toBe(1);
  expect((await journalRows(page)).map(row => row.status)).toEqual(["unknown_remote_outcome"]);

  await page.reload();
  panel = await openDriveExport(page);
  await authorize(page);
  await review(page);
  await expect(panel.getByRole("alert")).toContainText("still unresolved and may already exist in Google Drive");
  await expect(panel.getByTestId("drive-export-review")).toHaveCount(0);

  // A Drive outage is not proof of absence: nothing is cleared.
  harness.drive.getMode = "server_error";
  await panel.getByRole("button", { name: "Check prior Drive exports" }).click();
  await expect(panel.getByText(/1 uncertain operation\(s\) remain blocked/)).toBeVisible();
  await expect(panel.getByTestId("drive-unresolved-recovery")).toContainText("outcome unknown");
  await review(page);
  await expect(panel.getByRole("alert")).toContainText("still unresolved");
  expect(harness.drive.posts).toBe(1);
  expect((await journalRows(page)).map(row => row.status)).toEqual(["unknown_remote_outcome"]);
  expectNoGoogleSignIn(harness);
});

test("after reload, a prepared reservation is explained, can be cancelled, and a fresh review uploads", async ({ page, context }) => {
  const harness = await install(context);
  await seedVerifiedPdf(page);
  let panel = await openDriveExport(page);
  await authorize(page);
  await review(page);
  harness.drive.rootMode = "forbidden";
  await panel.getByRole("button", { name: "Confirm and upload this PDF" }).click();
  await expect(panel.getByRole("alert")).toContainText("The upload did not begin. The unused reservation remains saved.");
  expect(harness.drive.posts).toBe(0);
  const [prepared] = await journalRows(page);
  expect(prepared).toMatchObject({ status: "prepared", reservedFileId: harness.drive.reserved[0] });

  await page.reload();
  panel = await openDriveExport(page);
  await authorize(page);
  await review(page);
  const message = panel.getByRole("alert");
  await expect(message).toContainText("An unused Drive export reservation from an earlier attempt is still saved. Nothing was uploaded for it.");
  await expect(message).not.toContainText("Check Google Drive");
  await panel.getByRole("button", { name: "Check prior Drive exports" }).click();
  const recovery = panel.getByTestId("drive-prepared-recovery");
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: "Cancel unused reservation" }).click();
  await expect(panel.getByText("Unused reservation cancelled. Re-review the PDF before any new upload.")).toBeVisible();

  harness.drive.rootMode = "ok";
  await review(page);
  await panel.getByRole("button", { name: "Confirm and upload this PDF" }).click();
  await expect(panel.getByText("Drive document verified against the approved bytes.")).toBeVisible();
  expect(harness.drive.posts).toBe(1);
  expect((await journalRows(page)).map(row => row.status).sort()).toEqual(["cancelled", "verified"]);
  expectNoGoogleSignIn(harness);
});

test("an upload interrupted before Drive created anything is released by a 404 of its reserved ID", async ({ page, context }) => {
  const harness = await install(context);
  await seedVerifiedPdf(page);
  const panel = await openDriveExport(page);
  await authorize(page);
  await review(page);
  harness.drive.uploadMode = "abort_before_create";
  await panel.getByRole("button", { name: "Confirm and upload this PDF" }).click();
  await expect(panel.getByRole("alert")).toContainText("The upload connection was interrupted.");
  expect(harness.drive.files.size).toBe(0);
  const [interrupted] = await journalRows(page);
  expect(interrupted).toMatchObject({ status: "unknown_remote_outcome", reservedFileId: harness.drive.reserved[0] });

  await panel.getByRole("button", { name: "Check prior Drive exports" }).click();
  await expect(panel.getByText(/Confirmed that 1 interrupted export\(s\) never reached Google Drive/)).toBeVisible();
  await expect(panel.getByTestId("drive-unresolved-recovery")).toHaveCount(0);
  const [released] = await journalRows(page);
  expect(released).toMatchObject({ status: "failed", resolution: "reserved_id_absent", reservedFileId: harness.drive.reserved[0] });

  harness.drive.uploadMode = "ok";
  await review(page);
  await panel.getByRole("button", { name: "Confirm and upload this PDF" }).click();
  await expect(panel.getByText("Drive document verified against the approved bytes.")).toBeVisible();
  expect(harness.drive.reserved).toHaveLength(2);
  expect([...harness.drive.files.keys()]).toEqual([harness.drive.reserved[1]]);
  expectNoGoogleSignIn(harness);
});

test("an interrupted upload that did land is verified through its reserved ID, never duplicated", async ({ page, context }) => {
  const harness = await install(context);
  const seeded = await seedVerifiedPdf(page);
  const panel = await openDriveExport(page);
  await authorize(page);
  await review(page);
  harness.drive.uploadMode = "abort_after_create";
  await panel.getByRole("button", { name: "Confirm and upload this PDF" }).click();
  await expect(panel.getByRole("alert")).toContainText("The upload connection was interrupted.");
  await panel.getByRole("button", { name: "Check prior Drive exports" }).click();
  await expect(panel.getByText("Verified 1 prior Drive export(s).")).toBeVisible();
  const [row] = await journalRows(page);
  expect(row).toMatchObject({ status: "verified", remoteId: harness.drive.reserved[0], verifiedSha256: seeded.contentHash });
  expect(harness.drive.posts).toBe(1);
  expect(harness.drive.files.size).toBe(1);
  expectNoGoogleSignIn(harness);
});

test("an unresolvable pre-reservation (v1) export is abandoned only after an explicit warning", async ({ page, context }) => {
  const harness = await install(context);
  const seeded = await seedVerifiedPdf(page);
  const panel = await openDriveExport(page);
  await authorize(page);
  // Opening a review creates the production journal database; then cancel it.
  await review(page);
  await panel.getByRole("button", { name: "Cancel export" }).click();
  // A schema-v1 row written by the #315 candidate before reserved file IDs existed.
  await page.evaluate(async ({ name, row }) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onsuccess = () => {
        const tx = open.result.transaction("exports", "readwrite");
        tx.objectStore("exports").put(row);
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, { name: JOURNAL_DB, row: {
    schemaVersion: 1, operationId: "legacy-operation-1", approvalId: "legacy-approval-1",
    accountId: ACCOUNT_A, destinationId: "root", artifactId: seeded.artifactId, artifactRevision: "1",
    bytesSha256: seeded.contentHash, fileName: "legacy-resume.pdf", mimeType: "application/pdf",
    status: "uploading", remoteId: null, verifiedSha256: null, updatedAt: new Date(Date.now() - 60_000).toISOString(),
  } });
  await review(page);
  await expect(panel.getByRole("alert")).toContainText("still unresolved");

  await panel.getByRole("button", { name: "Check prior Drive exports" }).click();
  const unresolved = panel.getByTestId("drive-unresolved-recovery");
  await expect(unresolved).toContainText("legacy-resume.pdf");
  await expect(panel.getByTestId("drive-abandon-warning")).toHaveCount(0);
  await unresolved.getByRole("button", { name: "Abandon this attempt…" }).click();
  const warning = panel.getByTestId("drive-abandon-warning");
  await expect(warning).toContainText("cannot tell whether Google Drive already holds a copy");
  await expect(warning).toContainText("a new export may create a second copy");
  // Backing out keeps it blocked.
  await warning.getByRole("button", { name: "Keep it blocked" }).click();
  await expect(warning).toHaveCount(0);
  expect((await journalRows(page)).find(row => row.operationId === "legacy-operation-1")).toMatchObject({ status: "uploading" });

  await unresolved.getByRole("button", { name: "Abandon this attempt…" }).click();
  await panel.getByTestId("drive-abandon-warning").getByRole("button", { name: "Abandon attempt" }).click();
  await expect(panel.getByText(/Attempt abandoned\. Its receipt is kept on this device\./)).toBeVisible();
  expect((await journalRows(page)).find(row => row.operationId === "legacy-operation-1"))
    .toMatchObject({ schemaVersion: 2, status: "abandoned", resolution: "user_abandoned", reservedFileId: null });

  await review(page);
  await expect(panel.getByTestId("drive-export-review")).toBeVisible();
  expect(harness.drive.posts).toBe(0);
  expectNoGoogleSignIn(harness);
});
