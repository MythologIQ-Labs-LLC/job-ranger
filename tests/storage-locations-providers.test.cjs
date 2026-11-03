// Windows storage locations (#249): the storage egress allowlist, and each provider
// (This computer, Google Drive through the fake Google, OneDrive through the fake
// Microsoft Graph). No real network endpoint is contacted.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomBytes, randomUUID } = require("node:crypto");

const root = path.join(__dirname, "..", "electron-runtime", "electron", "src");
const load = (file) => require(path.join(root, file));
const {
  allowedStorageRequest, createStorageEgress, isMicrosoftContentUrl, STORAGE_EGRESS_RULES,
} = load("storage/storage-egress.cjs");
const { LocalFolderProvider, validateLocalFolder, PARTIAL_PREFIX, authorizedRequest } = load("storage/storage-provider.cjs");
const { GoogleStorageProvider, GOOGLE_MULTIPART_LIMIT } = load("storage/google-storage-provider.cjs");
const { OneDriveProvider, ONEDRIVE_SIMPLE_UPLOAD_LIMIT, sessionGrantMs } = load("storage/onedrive-provider.cjs");
const { startOAuthLoopback } = load("storage/oauth-loopback.cjs");
const { createFakeGoogleStorage } = require("./support/fake-google-storage.cjs");
const { createFakeOneDrive } = require("./support/fake-onedrive.cjs");

const fastRetry = { attempts: 4, baseDelayMs: 1, maxDelayMs: 5 };

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sampleFile(size, directory = tempDir("sojourner-storage-src-")) {
  const filePath = path.join(directory, `sample-${size}.bin`);
  const bytes = randomBytes(size);
  fs.writeFileSync(filePath, bytes);
  return { filePath, size, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}

function request(file, overrides = {}) {
  const journal = [];
  return {
    journal,
    value: {
      folder: "Backups", name: `Sojourner-backup-automatic-test-${randomUUID().slice(0, 8)}.sojourner`,
      filePath: file.filePath, size: file.size, sha256: file.sha256, kind: "automatic", recordId: randomUUID(),
      beforeSend: async (ref) => { journal.push(ref); },
      ...overrides,
    },
  };
}

// ------------------------------------------------------------------ egress

test("the storage egress allows only Google storage calls, the Microsoft token endpoint and the Graph app folder", () => {
  const allowed = [
    ["https://www.googleapis.com/drive/v3/files?q=x", "GET"],
    ["https://www.googleapis.com/drive/v3/files", "POST"],
    ["https://www.googleapis.com/drive/v3/files/abc_123", "DELETE"],
    ["https://www.googleapis.com/drive/v3/files/generateIds?count=1", "GET"],
    ["https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", "POST"],
    ["https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x", "PUT"],
    ["https://login.microsoftonline.com/common/oauth2/v2.0/token", "POST"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot", "GET"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot/children", "POST"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups", "GET"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups:/children?$top=200", "GET"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Documents/a.pdf", "GET"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups/a.sojourner", "DELETE"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups/a.sojourner:/content", "PUT"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups/a.sojourner:/createUploadSession", "POST"],
  ];
  for (const [url, method] of allowed) assert.equal(allowedStorageRequest(new URL(url), method), true, `${method} ${url}`);
  const refused = [
    ["https://login.microsoftonline.com/common/oauth2/v2.0/authorize", "GET"],
    ["https://login.microsoftonline.com/common/oauth2/v2.0/logout", "POST"],
    ["https://login.microsoftonline.com/organizations/oauth2/v2.0/token", "POST"],
    ["https://login.microsoftonline.com/common/oauth2/v2.0/token", "GET"],
    ["https://graph.microsoft.com/v1.0/me", "GET"],
    ["https://graph.microsoft.com/v1.0/me/drive/root/children", "GET"],
    ["https://graph.microsoft.com/v1.0/me/drive/items/abc/content", "GET"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/documents", "GET"],
    ["https://graph.microsoft.com/v1.0/me/revokeSignInSessions", "POST"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Other/a.txt", "GET"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups/../x:/content", "PUT"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups/a%2F..%2Fb:/content", "PUT"],
    ["https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups/a.sojourner", "PATCH"],
    ["https://graph.microsoft.com/beta/me/drive/special/approot", "GET"],
    ["http://graph.microsoft.com/v1.0/me/drive/special/approot", "GET"],
    ["https://user:pw@graph.microsoft.com/v1.0/me/drive/special/approot", "GET"],
    ["https://www.googleapis.com/drive/v3/about", "GET"],
    ["https://www.googleapis.com/drive/v3/files/abc/permissions", "POST"],
    ["https://oauth2.googleapis.com/token", "POST"],
    ["https://accounts.google.com/o/oauth2/v2/auth", "GET"],
    ["https://example.com/drive/v3/files", "GET"],
  ];
  for (const [url, method] of refused) assert.equal(allowedStorageRequest(new URL(url), method), false, `${method} ${url}`);
  assert.ok(STORAGE_EGRESS_RULES.every((rule) => rule.origin.startsWith("https://")));
  assert.equal(isMicrosoftContentUrl(new URL("https://public.dm.files.1drv.com/x")), true);
  assert.equal(isMicrosoftContentUrl(new URL("https://contoso-my.sharepoint.com/x")), true);
  assert.equal(isMicrosoftContentUrl(new URL("https://1drv.com.evil.example/x")), false);
  assert.equal(isMicrosoftContentUrl(new URL("http://public.files.1drv.com/x")), false);
  assert.equal(isMicrosoftContentUrl(new URL("https://public.files.1drv.com:8443/x")), false);
});

test("the egress refuses redirects, ungranted content URLs, tokens on content URLs and oversized JSON", async () => {
  const calls = [];
  const egress = createStorageEgress({
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (String(url).includes("redirect")) return new Response(null, { status: 302, headers: { Location: "https://evil.example" } });
      if (String(url).includes("big")) return new Response("x".repeat(2 * 1024 * 1024), { status: 200 });
      return new Response("{}", { status: 200 });
    },
  });
  await assert.rejects(egress.fetch("https://evil.example/x"), /refused to contact/);
  const content = "https://upload.fake.1drv.com/up/session1";
  await assert.rejects(egress.fetch(content, { method: "PUT" }), /refused to contact/);
  assert.throws(() => egress.grant("https://evil.example/up", "PUT", 1), /outside its content domains/);
  egress.grant(content, "PUT", 1);
  await assert.rejects(egress.fetch(content, { method: "GET" }), /refused/);
  await assert.rejects(egress.fetch(content, { method: "PUT", headers: { Authorization: "Bearer x" } }), /never sends a sign-in token/);
  egress.grant(content, "PUT", 1);
  const ok = await egress.fetch(content, { method: "PUT", body: "x" });
  assert.equal(ok.status, 200);
  await assert.rejects(egress.fetch(content, { method: "PUT", body: "x" }), /refused/, "a grant is single use");
  await assert.rejects(egress.fetch("https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups:/children?redirect=1"), /redirect/);
  await assert.rejects(egress.fetch("https://graph.microsoft.com/v1.0/me/drive/special/approot:/Backups:/children?big=1"), /larger response/);
  assert.ok(calls.every((call) => call.init.redirect === "error"));
});

test("the egress maps every origin to the loopback test origins only when they are given", async () => {
  const targets = [];
  const egress = createStorageEgress({
    fetch: async (url) => { targets.push(String(url)); return new Response("{}", { status: 200 }); },
    googleTestOrigin: "http://127.0.0.1:1111",
    microsoftTestOrigin: "http://127.0.0.1:2222",
  });
  await egress.fetch("https://www.googleapis.com/drive/v3/files?q=1");
  await egress.fetch("https://graph.microsoft.com/v1.0/me/drive/special/approot");
  await egress.fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", { method: "POST" });
  egress.grant("https://download.fake.1drv.com/dl/abc", "GET", 1);
  await egress.fetch("https://download.fake.1drv.com/dl/abc");
  assert.deepEqual(targets, [
    "http://127.0.0.1:1111/drive/v3/files?q=1",
    "http://127.0.0.1:2222/v1.0/me/drive/special/approot",
    "http://127.0.0.1:2222/common/oauth2/v2.0/token",
    "http://127.0.0.1:2222/dl/abc",
  ]);
});

test("authorizedRequest refreshes once on 401 and retries 429 and 5xx with backoff", async () => {
  const statuses = [401, 429, 503, 200];
  const tokens = [];
  let invalidated = 0;
  const response = await authorizedRequest({
    token: async (force) => (force ? "fresh" : "stale"),
    invalidate: () => { invalidated += 1; },
    send: async (token) => { tokens.push(token); return new Response(null, { status: statuses.shift() }); },
    policy: fastRetry,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(tokens, ["stale", "fresh", "fresh", "fresh"]);
  assert.equal(invalidated, 1);
  const exhausted = await authorizedRequest({
    token: async () => "t", invalidate: () => undefined,
    send: async () => new Response(null, { status: 503 }), policy: fastRetry,
  });
  assert.equal(exhausted.status, 503, "a persistent outage is returned, not retried forever");
});

// ------------------------------------------------------------------ This computer

test("This computer copies through a temporary file, verifies by hash and never overwrites", async () => {
  const userData = tempDir("sojourner-userdata-");
  const folder = await validateLocalFolder(path.join(tempDir("sojourner-location-"), "Sojourner"), userData);
  await assert.rejects(validateLocalFolder(path.join(userData, "data", "x"), userData), /outside Sojourner's own data folder/);
  await assert.rejects(validateLocalFolder("relative/path", userData), /Choose a folder/);
  const provider = new LocalFolderProvider(folder);
  const file = sampleFile(300_000);
  const upload = request(file);
  const ref = await provider.upload(upload.value);
  assert.deepEqual(upload.journal, [ref], "the reference is journaled before copying");
  assert.equal(ref.remotePath, `Backups/${upload.value.name}`);
  assert.deepEqual(fs.readFileSync(path.join(folder, "Backups", upload.value.name)), file.bytes);
  assert.equal(await provider.verify(ref, file), true);
  assert.equal(await provider.verify(ref, { ...file, sha256: "0".repeat(64) }), false);
  await assert.rejects(provider.upload(request(file, { name: upload.value.name }).value), /already exists/);
  assert.deepEqual(fs.readdirSync(path.join(folder, "Backups")), [upload.value.name], "no partial file is left behind");

  const listed = await provider.list("Backups");
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].size, file.size);
  const resolved = await provider.resolve("Backups", upload.value.name);
  assert.equal(await provider.resolve("Backups", "../escape.sojourner"), null);
  const target = path.join(tempDir("sojourner-download-"), "copy.sojourner");
  assert.deepEqual(await provider.download(resolved, target, 10_000_000), { size: file.size, sha256: file.sha256 });

  fs.writeFileSync(path.join(folder, "Backups", `${PARTIAL_PREFIX}leftover`), "partial");
  await provider.removePartials();
  assert.deepEqual(fs.readdirSync(path.join(folder, "Backups")), [upload.value.name]);

  fs.appendFileSync(path.join(folder, "Backups", upload.value.name), "changed");
  assert.equal(await provider.remove(ref, file), "mismatch", "a file changed outside Sojourner is kept");
  fs.writeFileSync(path.join(folder, "Backups", upload.value.name), file.bytes);
  assert.equal(await provider.remove(ref, file), "deleted");
  assert.equal(await provider.remove(ref, file), "absent");
  assert.equal(await provider.probe(ref), "absent");
});

test("a copy whose source changes while copying is refused and leaves nothing behind", async () => {
  const folder = await validateLocalFolder(path.join(tempDir("sojourner-location-"), "S"), tempDir("sojourner-userdata-"));
  const provider = new LocalFolderProvider(folder);
  const file = sampleFile(10_000);
  await assert.rejects(provider.upload(request(file, { sha256: "f".repeat(64) }).value), /changed while it was being copied/);
  assert.deepEqual(fs.readdirSync(path.join(folder, "Backups")), []);
});

// ------------------------------------------------------------------ Google Drive

function googleProvider(google, overrides = {}) {
  const permissionId = google.state.account.permissionId;
  google.state.accessTokens.set("valid-token", permissionId);
  let saved = null;
  const egress = createStorageEgress({ fetch: google.fetch });
  const provider = new GoogleStorageProvider({
    token: async (force) => (force ? "valid-token" : overrides.initialToken ?? "valid-token"),
    invalidate: () => undefined,
    accountId: permissionId,
    accountLabel: "drive-tester@example.test",
    fetch: egress.fetch,
    folders: null,
    saveFolders: async (folders) => { saved = folders; },
    retry: fastRetry,
    ...overrides.options,
  });
  return { provider, savedFolders: () => saved };
}

test("Google Drive creates the Sojourner folder once and uploads small files with a reserved id", async () => {
  const google = createFakeGoogleStorage();
  const { provider, savedFolders } = googleProvider(google);
  const file = sampleFile(200_000);
  const upload = request(file);
  const ref = await provider.upload(upload.value);
  assert.equal(upload.journal[0].remoteId, ref.remoteId, "the reserved id is journaled before the POST");
  assert.ok(google.state.reservedIds.has(ref.remoteId));
  assert.equal(google.state.storage.counts.multipart, 1);
  const folders = savedFolders();
  assert.ok(folders.rootId && folders.Backups && folders.Documents);
  assert.equal(google.state.storage.counts.folderCreates, 3);
  const stored = google.state.files.get(ref.remoteId);
  assert.deepEqual(stored.parents, [folders.Backups]);
  assert.equal(stored.appProperties.sojournerStorageRecord, upload.value.recordId);
  assert.equal(await provider.verify(ref, { ...file, recordId: upload.value.recordId }), true);
  assert.equal(await provider.verify(ref, { ...file, recordId: randomUUID() }), false, "the record marker must match");

  // A second provider (new session) finds the folders instead of creating new ones.
  const again = new GoogleStorageProvider({
    token: async () => "valid-token", invalidate: () => undefined, accountId: google.state.account.permissionId,
    accountLabel: "x", fetch: createStorageEgress({ fetch: google.fetch }).fetch, folders: null,
    saveFolders: async () => undefined, retry: fastRetry,
  });
  const listed = await again.list("Backups");
  assert.equal(google.state.storage.counts.folderCreates, 3);
  assert.deepEqual(listed.entries.map((entry) => entry.remoteId), [ref.remoteId]);
  assert.equal(listed.entries[0].recordMarker, upload.value.recordId);
});

test("Google Drive uploads large files through a resumable session (308 Resume Incomplete) and verifies them", async () => {
  const google = createFakeGoogleStorage();
  const { provider } = googleProvider(google);
  const file = sampleFile(GOOGLE_MULTIPART_LIMIT + 9 * 1024 * 1024);
  const upload = request(file);
  const ref = await provider.upload(upload.value);
  assert.equal(google.state.storage.counts.resumableStarts, 1);
  assert.equal(google.state.storage.counts.chunks, 2);
  assert.deepEqual(google.state.files.get(ref.remoteId).bytes, file.bytes);
  assert.equal(await provider.verify(ref, file), true);
  const target = path.join(tempDir("sojourner-download-"), "restore.sojourner");
  const entry = await provider.resolve("Backups", ref.remoteId);
  assert.deepEqual(await provider.download(entry, target, 100 * 1024 * 1024), { size: file.size, sha256: file.sha256 });
});

test("Google Drive verification catches corrupted bytes; a retried create cannot duplicate", async () => {
  const google = createFakeGoogleStorage();
  const { provider } = googleProvider(google);
  const file = sampleFile(50_000);
  google.state.storage.faults.nextUpload = "corrupt";
  const corrupt = await provider.upload(request(file).value);
  assert.equal(await provider.verify(corrupt, file), false);
  // A 503 on the create is retried with the same reserved id; the file exists once.
  google.state.storage.faults.upload.push("status:503");
  const retried = await provider.upload(request(file).value);
  assert.equal([...google.state.files.values()].filter((item) => item.id === retried.remoteId).length, 1);
  assert.equal(await provider.verify(retried, file), true);
});

test("Google Drive refreshes on 401, lists, refuses foreign handles and deletes only the recorded file", async () => {
  const google = createFakeGoogleStorage();
  const { provider } = googleProvider(google, { initialToken: "expired-token" });
  const file = sampleFile(10_000);
  const ref = await provider.upload(request(file).value);
  assert.ok(google.state.requests.length > 0);
  assert.equal(await provider.resolve("Documents", ref.remoteId), null, "a backup is not a document");
  assert.equal(await provider.remove(ref, { size: file.size + 1, sha256: file.sha256 }), "mismatch");
  assert.equal(await provider.remove(ref, file), "deleted");
  assert.equal(await provider.remove(ref, file), "absent");
  assert.equal(await provider.probe(ref), "absent");
});

// ------------------------------------------------------------------ OneDrive

function oneDriveProvider(onedrive) {
  const egress = createStorageEgress({ fetch: onedrive.fetch });
  let token = "fake-ms-access-initial";
  onedrive.state.accessTokens.add(token);
  let refreshes = 0;
  const provider = new OneDriveProvider({
    token: async (force) => {
      if (force) {
        refreshes += 1;
        token = `fake-ms-access-${refreshes}`;
        onedrive.state.accessTokens.add(token);
      }
      return token;
    },
    invalidate: () => undefined,
    accountId: "fakedrive0123456789",
    accountLabel: "OneDrive (personal account)",
    egress,
    retry: fastRetry,
  });
  return { provider, refreshes: () => refreshes };
}

test("OneDrive creates Backups/ and Documents/ in the app folder and uploads small files with one PUT", async () => {
  const onedrive = createFakeOneDrive();
  const { provider } = oneDriveProvider(onedrive);
  const file = sampleFile(100_000);
  const upload = request(file);
  const ref = await provider.upload(upload.value);
  assert.deepEqual(upload.journal, [{ remoteId: null, remotePath: `Backups/${upload.value.name}` }]);
  assert.deepEqual([...onedrive.state.folders.keys()].sort(), ["Backups", "Documents"]);
  assert.equal(onedrive.state.counts.simplePuts, 1);
  assert.match(ref.remoteId, /^item/);
  assert.equal(await provider.verify(ref, file), true);
  const graphPaths = onedrive.state.requests.filter((item) => item.path.startsWith("/v1.0/")).map((item) => item.path);
  assert.ok(graphPaths.every((item) => item.startsWith("/v1.0/me/drive/special/approot")), "only the app folder is addressed");
  const downloads = onedrive.state.requests.filter((item) => item.path.startsWith("/dl/"));
  assert.ok(downloads.length > 0 && downloads.every((item) => !item.authorization), "no token goes to the download host");
  // conflictBehavior=fail: an existing name is never replaced; the existing item is verified instead.
  const again = await provider.upload(request(file, { name: upload.value.name }).value);
  assert.equal(again.remoteId, ref.remoteId);
  assert.equal(onedrive.files("Backups").length, 1);
});

test("OneDrive uses an upload session for large files, retries a failed chunk and never sends the token there", async () => {
  const onedrive = createFakeOneDrive();
  const { provider } = oneDriveProvider(onedrive);
  const file = sampleFile(ONEDRIVE_SIMPLE_UPLOAD_LIMIT + 3 * 1024 * 1024);
  onedrive.state.faults.chunk.push("status:503");
  const ref = await provider.upload(request(file).value);
  assert.equal(onedrive.state.counts.sessions, 1);
  assert.equal(onedrive.state.counts.chunks, 3, "two chunks plus one retried after 503");
  const uploads = onedrive.state.requests.filter((item) => item.path.startsWith("/up/"));
  assert.ok(uploads.every((item) => !item.authorization));
  assert.equal(await provider.verify(ref, file), true);
  const target = path.join(tempDir("sojourner-download-"), "restore.sojourner");
  const entry = await provider.resolve("Backups", path.basename(ref.remotePath));
  assert.deepEqual(await provider.download(entry, target, 100 * 1024 * 1024), { size: file.size, sha256: file.sha256 });
});

test("OneDrive refreshes on 401, retries 429 and 5xx, lists, verifies and deletes", async () => {
  const onedrive = createFakeOneDrive();
  const { provider, refreshes } = oneDriveProvider(onedrive);
  const file = sampleFile(20_000);
  const ref = await provider.upload(request(file).value);
  onedrive.state.faults.expireAccess = true;
  onedrive.state.faults.graph.push("status:429", "status:503");
  const listed = await provider.list("Backups");
  assert.equal(refreshes(), 1, "one refresh after 401");
  assert.deepEqual(listed.entries.map((entry) => entry.remoteId), [ref.remoteId]);
  assert.equal(listed.truncated, false);
  onedrive.state.faults.nextUpload = "corrupt";
  const corrupt = await provider.upload(request(file).value);
  assert.equal(await provider.verify(corrupt, file), false);
  assert.equal(await provider.remove(ref, { size: 1, sha256: file.sha256 }), "mismatch");
  assert.equal(await provider.remove(ref, file), "deleted");
  assert.equal(await provider.remove(ref, file), "absent");
  assert.equal(await provider.probe(ref), "absent");
  onedrive.state.faults.graph.push("status:503", "status:503", "status:503", "status:503");
  await assert.rejects(provider.list("Backups"), /could not complete/);
});

// ------------------------------------------------------------------ security review fixes

test("a slow OneDrive upload session stays open: the grant is renewed after every accepted chunk", async () => {
  const onedrive = createFakeOneDrive();
  let clock = Date.now();
  // Every chunk takes 50 minutes on this "slow link"; the first grant alone lasts about 60.
  const slowFetch = async (url, init) => {
    const response = await onedrive.fetch(url, init);
    if (String(url).includes("/up/")) clock += 50 * 60_000;
    return response;
  };
  const egress = createStorageEgress({ fetch: slowFetch, now: () => clock });
  onedrive.state.accessTokens.add("ms-token");
  const provider = new OneDriveProvider({
    token: async () => "ms-token", invalidate: () => undefined, accountId: "fakedrive0123456789",
    accountLabel: "OneDrive", egress, retry: fastRetry,
  });
  const file = sampleFile(2 * 5 * 1024 * 1024 + 1024);
  const ref = await provider.upload(request(file).value);
  assert.equal(onedrive.state.counts.chunks, 3);
  assert.equal(await provider.verify(ref, file), true);
  assert.equal(sessionGrantMs(new Date(Date.now() + 48 * 3_600_000).toISOString()), 24 * 3_600_000, "bounded to a day");
  assert.equal(sessionGrantMs(new Date(Date.now() - 1000).toISOString()), 15 * 60_000, "never shorter than 15 minutes");
  assert.equal(sessionGrantMs(undefined), 60 * 60_000);
});

test("the OneDrive listing follows app-folder pages and returns the newest backups first", async () => {
  const onedrive = createFakeOneDrive();
  const { provider } = oneDriveProvider(onedrive);
  await provider.ensureFolders();
  for (let index = 0; index < 450; index += 1) {
    onedrive.put("Backups", `Sojourner-backup-automatic-${String(index).padStart(4, "0")}.sojourner`, Buffer.from(String(index)));
  }
  const listed = await provider.list("Backups");
  assert.equal(listed.entries.length, 450);
  assert.equal(listed.truncated, false);
  assert.equal(listed.entries[0].name, "Sojourner-backup-automatic-0449.sojourner", "newest first");
  onedrive.state.faults.foreignNextLink = true;
  const foreign = await provider.list("Backups");
  assert.equal(foreign.entries.length, 200, "a next page outside the app folder is not followed");
  assert.equal(foreign.truncated, true);
  assert.ok(onedrive.state.requests.every((item) => !item.path.includes("/items/")));
});

test("a folder reached through a junction into the user-data folder is refused", async (t) => {
  const userData = tempDir("sojourner-userdata-");
  fs.mkdirSync(path.join(userData, "data"), { recursive: true });
  const outside = tempDir("sojourner-junction-");
  const link = path.join(outside, "looks-outside");
  try {
    fs.symlinkSync(path.join(userData, "data"), link, "junction");
  } catch {
    t.skip("junctions or symbolic links are not available here");
    return;
  }
  await assert.rejects(validateLocalFolder(path.join(link, "Sojourner"), userData), /outside Sojourner's own data folder/);
  await assert.rejects(validateLocalFolder(link, userData), /outside Sojourner's own data folder/);
  assert.equal(fs.existsSync(path.join(userData, "data", "Sojourner")), false, "nothing is created inside the data folder");
  // A real folder elsewhere is accepted.
  assert.ok(await validateLocalFolder(path.join(outside, "Real", "Sojourner"), userData));
});

test("the sign-in receiver never runs IPv4-only while another program holds [::1] on its port", async (t) => {
  const http = require("node:http");
  const squatter = http.createServer((_request, response) => response.end("squatter"));
  try {
    await new Promise((resolve, reject) => {
      squatter.once("error", reject);
      squatter.listen({ port: 0, host: "::1" }, resolve);
    });
  } catch {
    t.skip("no IPv6 loopback on this machine");
    return;
  }
  const squatted = squatter.address().port;
  try {
    const loopback = await startOAuthLoopback({ expectedState: "s", timeoutMs: 5_000, providerName: "OneDrive", testPorts: [squatted] });
    const port = Number(new URL(loopback.redirectUri).port);
    assert.notEqual(port, squatted, "a fresh port pair was chosen");
    assert.match(loopback.redirectUri, /^http:\/\/localhost:\d+$/);
    const answer = await fetch(`http://[::1]:${port}/?state=s&code=abc`);
    assert.equal(answer.status, 200, "the IPv6 side belongs to Sojourner's receiver");
    assert.equal(await loopback.code, "abc");
  } finally {
    squatter.close();
  }
});
