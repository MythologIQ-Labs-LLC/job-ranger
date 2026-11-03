// Windows storage locations (#249): Microsoft sign-in (public client, PKCE, loopback),
// migration 1011 and the crash-safe record states, the workspace change monitor, and the
// StorageService scheduler (debounce, quit flush, no concurrency, retry), retention and
// recovery. Uses the bundled sqlite3 CLI (SQLITE3_PATH) and local fakes only.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomBytes, randomUUID } = require("node:crypto");

const root = path.join(__dirname, "..", "electron-runtime", "electron", "src");
const load = (file) => require(path.join(root, file));
const { SqliteClient, resolveSqliteBinary } = load("sqlite.cjs");
const { FEATURE_MIGRATIONS } = load("feature-migrations.cjs");
const { StorageRecords, STORAGE_RECORDS_TABLE, canTransition, carryOverStatements } = load("storage/storage-records.cjs");
const { StorageConfigStore } = load("storage/storage-config.cjs");
const { StorageService, backupName, documentName } = load("storage/storage-service.cjs");
const { WorkspaceChangeMonitor, readChangeCounter } = load("storage/workspace-change-monitor.cjs");
const { MicrosoftAuth, buildMicrosoftAuthorizationUrl, grantsAppFolder } = load("storage/microsoft-auth.cjs");
const { MicrosoftCredentialStore, MICROSOFT_CREDENTIAL_FILE } = load("storage/microsoft-credential-store.cjs");
const { resolveMicrosoftClientConfig, resolveMicrosoftTestOrigin, MICROSOFT_SCOPE_PARAMETER } = load("storage/microsoft-config.cjs");
const { createStorageEgress } = load("storage/storage-egress.cjs");
const { createFakeOneDrive } = require("./support/fake-onedrive.cjs");
const { createFakeGoogleStorage } = require("./support/fake-google-storage.cjs");
const { carryOverStorageRecords } = load("storage/storage-records.cjs");

const CLIENT_ID = "6aea1e3a-0000-4000-8000-000000000001";
let sqliteBinaryPath;

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const plainEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString("base64")}`),
  decryptString: (buffer) => Buffer.from(buffer.toString().slice(4), "base64").toString(),
};

async function openRecords(observe) {
  sqliteBinaryPath ??= await resolveSqliteBinary();
  const dir = tempDir("sojourner-storage-db-");
  const databasePath = path.join(dir, "sojourner.sqlite3");
  const db = new SqliteClient(databasePath, sqliteBinaryPath);
  const records = new StorageRecords(db, observe);
  await records.initialize();
  return { db, records, databasePath, dir };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeoutMs = 10_000) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("condition not reached in time");
    await wait(20);
  }
}

// ------------------------------------------------------------------ Microsoft sign-in

function microsoftAuth(onedrive, encryption = plainEncryption) {
  const userData = tempDir("sojourner-ms-userdata-");
  const store = new MicrosoftCredentialStore(userData, encryption);
  const egress = createStorageEgress({ fetch: onedrive.fetch });
  const opened = [];
  const auth = new MicrosoftAuth({
    clientId: CLIENT_ID, store, fetch: egress.fetch,
    openExternal: async (url) => {
      opened.push(url);
      void onedrive.completeBrowserSignIn(url).catch(() => undefined);
    },
    authorizationTimeoutMs: 10_000,
  });
  return { auth, store, userData, opened };
}

test("Microsoft config: public client id from build config, test origin only when not packaged", () => {
  assert.deepEqual(resolveMicrosoftClientConfig({ env: { SOJOURNER_MICROSOFT_CLIENT_ID: CLIENT_ID.toUpperCase() }, isPackaged: false }),
    { configured: true, clientId: CLIENT_ID });
  assert.equal(resolveMicrosoftClientConfig({ env: { SOJOURNER_MICROSOFT_CLIENT_ID: "nope" }, isPackaged: false }).reason, "invalid-client-config");
  assert.equal(resolveMicrosoftClientConfig({ env: { SOJOURNER_MICROSOFT_CLIENT_ID: CLIENT_ID }, isPackaged: true, resourcesPath: null }).configured, false,
    "a packaged build ignores the environment");
  assert.deepEqual(resolveMicrosoftClientConfig({ env: {}, isPackaged: true, resourcesPath: "R",
    readTextFile: () => JSON.stringify({ clientId: CLIENT_ID }) }), { configured: true, clientId: CLIENT_ID });
  assert.equal(resolveMicrosoftClientConfig({ env: {}, isPackaged: true, resourcesPath: "R", readTextFile: () => { throw new Error("missing"); } }).configured, false);
  assert.equal(resolveMicrosoftTestOrigin({ env: { SOJOURNER_MICROSOFT_TEST_BASE_URL: "http://127.0.0.1:9" }, isPackaged: true }), null);
  assert.equal(resolveMicrosoftTestOrigin({ env: { SOJOURNER_MICROSOFT_TEST_BASE_URL: "http://127.0.0.1:9" }, isPackaged: false }), "http://127.0.0.1:9");
  assert.equal(resolveMicrosoftTestOrigin({ env: { SOJOURNER_MICROSOFT_TEST_BASE_URL: "https://evil.example" }, isPackaged: false }), null);
  assert.equal(MICROSOFT_SCOPE_PARAMETER, "Files.ReadWrite.AppFolder offline_access");
});

test("the Microsoft authorization URL uses tenant common, PKCE S256, a localhost redirect and only the app-folder scopes", () => {
  const url = new URL(buildMicrosoftAuthorizationUrl({ clientId: CLIENT_ID, redirectUri: "http://localhost:51234", codeChallenge: "c", state: "s" }));
  assert.equal(url.origin + url.pathname, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  assert.equal(url.searchParams.get("scope"), "Files.ReadWrite.AppFolder offline_access");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:51234");
  assert.equal(url.searchParams.has("client_secret"), false);
  assert.equal(grantsAppFolder("https://graph.microsoft.com/Files.ReadWrite.AppFolder"), true);
  assert.equal(grantsAppFolder("Files.ReadWrite.AppFolder offline_access"), true);
  assert.equal(grantsAppFolder("Files.Read"), false);
});

test("OneDrive sign-in: system browser, loopback code with PKCE, encrypted refresh token, rotation and disconnect", async () => {
  const onedrive = createFakeOneDrive({ clientId: CLIENT_ID });
  const { auth, store, userData, opened } = microsoftAuth(onedrive);
  const account = await auth.connect(randomUUID());
  assert.equal(account.accountId, "fakedrive0123456789");
  assert.equal(account.label, "OneDrive (personal account)");
  assert.equal(opened.length, 1);
  const params = onedrive.state.faults.lastAuthorizeParams;
  assert.match(params.redirect_uri, /^http:\/\/localhost:\d+$/);
  assert.equal(params.scope, "Files.ReadWrite.AppFolder offline_access");
  assert.equal(store.storage(), "encrypted");
  const file = fs.readFileSync(path.join(userData, MICROSOFT_CREDENTIAL_FILE)).toString();
  assert.ok(file.startsWith("enc:"), "the refresh token is written only encrypted");
  assert.doesNotMatch(file, /fake-ms-refresh/);
  const first = (await store.load()).refreshToken;
  const token = await auth.getAccessToken(true);
  assert.match(token, /^fake-ms-access-/);
  assert.notEqual((await store.load()).refreshToken, first, "Microsoft rotated the refresh token and Sojourner kept the new one");
  assert.equal(await auth.disconnect().then((value) => value.revoked), false, "no public-client revocation exists");
  assert.equal(fs.existsSync(path.join(userData, MICROSOFT_CREDENTIAL_FILE)), false);
  await assert.rejects(auth.getAccessToken(), /Connect OneDrive first/);
});

test("OneDrive sign-in is session-only without encryption, refuses a missing app-folder grant and clears a revoked grant", async () => {
  const noEncryption = { isEncryptionAvailable: () => false, encryptString: () => { throw new Error("no"); }, decryptString: () => "" };
  const onedrive = createFakeOneDrive({ clientId: CLIENT_ID });
  const { auth, store, userData } = microsoftAuth(onedrive, noEncryption);
  await auth.connect(randomUUID());
  assert.equal(store.storage(), "session");
  assert.equal(fs.existsSync(path.join(userData, MICROSOFT_CREDENTIAL_FILE)), false, "nothing is written in plaintext");
  onedrive.state.faults.refresh = "invalid_grant";
  await assert.rejects(auth.getAccessToken(true), /expired or was revoked/);
  assert.equal(await store.load(), null, "a revoked grant is forgotten");

  const narrow = createFakeOneDrive({ clientId: CLIENT_ID, grantedScope: "User.Read" });
  const narrowAuth = microsoftAuth(narrow).auth;
  await assert.rejects(narrowAuth.connect(randomUUID()), /did not grant access to Sojourner's OneDrive app folder/);

  const denied = createFakeOneDrive({ clientId: CLIENT_ID });
  denied.state.faults.denyAuthorization = true;
  await assert.rejects(microsoftAuth(denied).auth.connect(randomUUID()), /not connected because access was not granted/);
});

test("a second OneDrive sign-in while one waits is refused, and cancel ends only the named flow", async () => {
  const onedrive = createFakeOneDrive({ clientId: CLIENT_ID });
  const store = new MicrosoftCredentialStore(tempDir("sojourner-ms-"), plainEncryption);
  const auth = new MicrosoftAuth({ clientId: CLIENT_ID, store, fetch: createStorageEgress({ fetch: onedrive.fetch }).fetch,
    openExternal: async () => undefined, authorizationTimeoutMs: 10_000 });
  const flow = randomUUID();
  const pending = auth.connect(flow);
  await until(() => auth.connecting);
  await assert.rejects(auth.connect(randomUUID()), /already waiting/);
  assert.equal(auth.cancelConnect(randomUUID()), false);
  assert.equal(auth.cancelConnect(flow), true);
  await assert.rejects(pending, /cancelled/);
  const unconfigured = new MicrosoftAuth({ clientId: null, store, fetch: onedrive.fetch, openExternal: async () => undefined });
  await assert.rejects(unconfigured.connect(randomUUID()), /not set up in this build/);
});

// ------------------------------------------------------------------ migration 1011 and records

test("migration 1011 creates the records table once, without secrets, recorded in schema_migrations", async () => {
  const { db, records } = await openRecords();
  await records.initialize();
  await new StorageRecords(db).initialize();
  assert.equal(FEATURE_MIGRATIONS.storageLocationRecords.version, 1011);
  const rows = await db.queryAll("SELECT version, name FROM schema_migrations WHERE version = 1011;");
  assert.deepEqual(rows.map((row) => [Number(row.version), row.name]), [[1011, "storage_location_records"]]);
  const columns = (await db.queryAll(`PRAGMA table_info(${STORAGE_RECORDS_TABLE});`)).map((column) => column.name);
  for (const forbidden of ["token", "secret", "email", "bytes", "content"]) {
    assert.equal(columns.some((name) => name.includes(forbidden)), false, `no ${forbidden} column`);
  }
});

test("record states are crash safe: compare-and-swap transitions, never back to good from failed", async () => {
  const { records, db } = await openRecords();
  const base = { provider: "local", locationKey: "C:\\S", locationLabel: "C:\\S", remotePath: "Backups/a.sojourner",
    name: "a.sojourner", size: 10, sha256: "a".repeat(64), kind: "automatic" };
  const id = randomUUID();
  await records.insertPending({ id, ...base });
  assert.equal((await records.unresolved()).length, 1, "a crash now leaves it pending, never verified");
  assert.equal(await records.transition(id, "uploaded", "verified"), false, "wrong expected state does nothing");
  assert.equal(await records.transition(id, "pending", "uploaded", { remoteId: "a.sojourner" }), true);
  assert.equal(await records.transition(id, "pending", "uploaded"), false, "a second writer loses the race");
  assert.equal(await records.transition(id, "uploaded", "verified"), true);
  assert.equal((await records.verifiedAutomatic("local", "C:\\S")).length, 1);
  assert.equal(canTransition("failed", "verified"), false);
  assert.equal(canTransition("pending", "verified"), true, "startup recovery may confirm a finished copy");
  await assert.rejects(records.transition(id, "verified", "pending"), /Invalid storage record transition/);
  await assert.rejects(db.exec(`UPDATE ${STORAGE_RECORDS_TABLE} SET status = 'great';`), /CHECK constraint/);
});

test("restore carry-over copies the live records into a staged database (old backups included)", async () => {
  const live = await openRecords();
  await live.records.insertPending({ id: "live-record", provider: "onedrive", locationKey: "d", locationLabel: "OneDrive",
    remotePath: "Backups/x.sojourner", name: "x.sojourner", size: 1, sha256: "b".repeat(64), kind: "automatic" });
  const staged = new SqliteClient(path.join(tempDir("sojourner-staged-"), "sojourner.sqlite3"), sqliteBinaryPath);
  await staged.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
  await staged.exec(carryOverStatements(live.databasePath));
  const rows = await staged.queryAll(`SELECT id FROM ${STORAGE_RECORDS_TABLE};`);
  assert.deepEqual(rows.map((row) => row.id), ["live-record"]);
  assert.equal((await staged.queryAll("SELECT version FROM schema_migrations WHERE version = 1011;")).length, 1);
});

test("the change monitor reads the SQLite file change counter and absorbs Sojourner's own bookkeeping writes", async () => {
  const { db, databasePath } = await openRecords();
  const before = await readChangeCounter(databasePath);
  assert.equal(typeof before, "number");
  await db.queryAll("SELECT * FROM schema_migrations;");
  assert.equal(await readChangeCounter(databasePath), before, "reads do not count");
  await db.exec("CREATE TABLE workspace_edit (id INTEGER);");
  assert.equal(await readChangeCounter(databasePath), (before + 1) >>> 0);
  const monitor = new WorkspaceChangeMonitor(() => readChangeCounter(databasePath));
  assert.equal(await monitor.start(before), true, "the database changed since it was clean");
  await monitor.observe(() => db.exec("INSERT INTO workspace_edit VALUES (1);"));
  assert.equal(await monitor.poll(), false, "an observed bookkeeping write is not a workspace change");
  await db.exec("INSERT INTO workspace_edit VALUES (2);");
  assert.equal(await monitor.poll(), true);
  assert.equal(monitor.changes, 1);
  assert.equal(await readChangeCounter(path.join(tempDir("x-"), "missing.sqlite3")), null);
});

// ------------------------------------------------------------------ the service

function fakeCounter() {
  let value = 1;
  return { read: async () => value, bump: () => { value += 1; } };
}

async function service(options = {}) {
  const counter = fakeCounter();
  const monitor = new WorkspaceChangeMonitor(counter.read);
  const { records, db } = await openRecords((write) => monitor.observe(write));
  const userData = tempDir("sojourner-storage-userdata-");
  const location = path.join(tempDir("sojourner-storage-location-"), "Sojourner");
  let active = 0;
  let maxActive = 0;
  let archives = 0;
  const failures = { createArchive: options.failArchives ?? 0 };
  const backups = {
    async createArchive(archivePath) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await wait(options.archiveDelayMs ?? 5);
        if (failures.createArchive > 0) {
          failures.createArchive -= 1;
          throw new Error("disk busy");
        }
        archives += 1;
        const bytes = Buffer.concat([Buffer.from("PK-fake-archive-"), randomBytes(64)]);
        fs.writeFileSync(archivePath, bytes);
        return { manifest: {}, summary: {}, archive: { path: archivePath, fileName: path.basename(archivePath), bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex") } };
      } finally {
        active -= 1;
      }
    },
    async validateRestoreSource(selected) {
      return { bundlePath: `${selected}.validated`, manifest: {}, summary: { createdAt: "", artifactFileCount: 0, totalBytes: 1 }, warnings: [],
        validatedBytes: fs.readFileSync(selected) };
    },
  };
  const unconfigured = {
    configured: false, connecting: false, account: async () => null, getAccessToken: async () => { throw new Error("no"); },
    invalidateAccessToken: () => undefined, connect: async () => undefined, cancelConnect: () => false,
    disconnect: async () => ({ revoked: false }), credentialStorage: () => "none", credentialUnavailable: () => false,
  };
  const config = new StorageConfigStore(userData);
  const storage = new StorageService({
    enabled: true, userDataDirectory: userData, defaultLocalFolder: location, backups,
    producer: { runtime: "electron", channel: "development", appVersion: "1.3.0", buildId: "test" },
    config, records, monitor, google: options.google ?? unconfigured, googleUnavailableReason: options.google ? null : "Google is not set up.",
    microsoft: options.microsoft ?? unconfigured, microsoftUnavailableReason: options.microsoft ? null : "OneDrive is not set up.",
    egress: createStorageEgress({ fetch: options.fetch ?? (async () => { throw new Error("no network in this test"); }) }),
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    timings: { debounceMs: options.debounceMs ?? 150, maxDelayMs: 5_000, retryDelaysMs: [100, 200], pollMs: 30 },
  });
  if (options.beforeStart) await options.beforeStart(userData);
  await storage.start();
  const backupFiles = () => (fs.existsSync(path.join(location, "Backups")) ? fs.readdirSync(path.join(location, "Backups")).sort() : []);
  return { storage, counter, records, db, location, userData, config, backupFiles,
    stats: () => ({ maxActive, archives }) };
}

test("names are unique: timestamp plus a short content hash; document names are sanitized", () => {
  const at = new Date("2026-11-02T10:15:30.123Z");
  assert.equal(backupName("automatic", at, "abcdef0123456789".padEnd(64, "0")), "Sojourner-backup-automatic-2026-11-02T10-15-30Z-abcdef01.sojourner");
  assert.equal(documentName("../Résumé final (2).pdf", at), "2026-11-02T10-15-30Z-R-sum-final-2-.pdf");
  assert.match(documentName("resume-v3.pdf", at), /^[A-Za-z0-9][A-Za-z0-9._-]+$/);
});

test("an automatic backup runs after the quiet period following changes, once for a burst of changes", async () => {
  const { storage, counter, backupFiles, records, location } = await service();
  await storage.select("local");
  await until(() => backupFiles().length === 1, 5_000);
  counter.bump();
  await wait(40);
  counter.bump();
  await wait(40);
  counter.bump();
  await until(() => backupFiles().length === 2, 5_000);
  await wait(400);
  assert.equal(backupFiles().length, 2, "no further backup without further changes");
  const status = await storage.status();
  assert.equal(status.backup.pendingChanges, false);
  assert.match(status.backup.lastSuccessName, /^Sojourner-backup-automatic-/);
  const verified = await records.verifiedAutomatic("local", location);
  assert.equal(verified.length, 2);
  assert.ok(verified.every((record) => record.status === "verified"));
  storage.stop();
});

test("backups never run concurrently: Back up now waits for a running backup", async () => {
  const { storage, stats } = await service({ archiveDelayMs: 100, debounceMs: 60_000 });
  await storage.select("local");
  const results = await Promise.all([storage.backUp("manual"), storage.backUp("manual"), storage.backUp("manual")]);
  assert.equal(new Set(results.map((item) => item.name)).size, 3);
  assert.equal(stats().maxActive, 1);
  storage.stop();
});

test("a failed backup is surfaced and retried with backoff until it succeeds", async () => {
  const { storage, backupFiles } = await service({ failArchives: 2 });
  await storage.select("local");
  await until(async () => (await storage.status()).backup.lastError !== null, 5_000);
  const failing = await storage.status();
  assert.match(failing.backup.lastError, /disk busy/);
  assert.equal(failing.backup.pendingChanges, true);
  await until(async () => backupFiles().length === 1 && (await storage.status()).backup.lastError === null, 5_000);
  const recovered = await storage.status();
  assert.equal(recovered.backup.lastError, null);
  assert.equal(recovered.backup.pendingChanges, false);
  storage.stop();
});

test("quitting with unbacked changes flushes a backup first; without changes nothing runs", async () => {
  const { storage, counter, backupFiles } = await service({ debounceMs: 60_000 });
  await storage.select("local");
  assert.equal(await storage.needsQuitFlush(), true, "a new location starts with pending changes");
  await storage.backUp("manual");
  // A manual backup clears pending changes too.
  assert.equal(await storage.needsQuitFlush(), false);
  counter.bump();
  assert.equal(await storage.needsQuitFlush(), true);
  await storage.flushForQuit(5_000);
  assert.equal(backupFiles().filter((name) => name.includes("-automatic-")).length, 1);
});

test("retention keeps the newest N automatic backups and never touches manual backups, documents or foreign files", async () => {
  const { storage, counter, backupFiles, records, location, config } = await service({ debounceMs: 60_000 });
  await storage.select("local");
  await storage.setRetention(2);
  await storage.backUp("manual");
  fs.mkdirSync(path.join(location, "Documents"), { recursive: true });
  fs.writeFileSync(path.join(location, "Backups", "my-own-file.sojourner"), "not Sojourner's");
  fs.writeFileSync(path.join(location, "Documents", "notes.txt"), "mine");
  const automatic = [];
  for (let index = 0; index < 4; index += 1) {
    counter.bump();
    await storage.backUp("automatic");
    automatic.push((await config.load()).lastSuccessName);
    await wait(5);
  }
  const files = backupFiles();
  assert.ok(files.includes("my-own-file.sojourner"), "a file Sojourner did not create is kept");
  assert.equal(files.filter((name) => name.includes("-manual-")).length, 1, "manual backups are kept");
  assert.deepEqual(files.filter((name) => name.includes("-automatic-")).sort(), automatic.slice(-2).sort());
  assert.ok(fs.existsSync(path.join(location, "Documents", "notes.txt")));
  const history = await records.history();
  assert.equal(history.filter((record) => record.status === "deleted").length, 2);
  assert.ok(history.filter((record) => record.status === "deleted").every((record) => record.kind === "automatic"));
});

test("documents are copied to Documents/, verified, and not copied twice", async () => {
  const { storage, location, records } = await service({ debounceMs: 60_000 });
  await storage.select("local");
  const source = path.join(tempDir("sojourner-export-"), "resume-v1.pdf");
  fs.writeFileSync(source, "%PDF-1.7 test");
  storage.queueDocument(source, "resume-v1.pdf");
  await until(() => fs.existsSync(path.join(location, "Documents")) && fs.readdirSync(path.join(location, "Documents")).length === 1);
  storage.queueDocument(source, "resume-v1.pdf");
  await wait(300);
  assert.equal(fs.readdirSync(path.join(location, "Documents")).length, 1);
  const docs = (await records.history()).filter((record) => record.kind === "document");
  assert.equal(docs.length, 1);
  assert.equal(docs[0].status, "verified");
  const listing = await storage.list();
  assert.equal(listing.documents.length, 1);
  assert.equal(listing.documents[0].restorable, false);
  storage.stop();
});

test("startup recovery: a pending copy that finished becomes verified, one that did not becomes failed", async () => {
  const { storage, records, location, backupFiles } = await service({ debounceMs: 60_000 });
  await storage.select("local");
  await storage.backUp("manual");
  const [name] = backupFiles();
  const bytes = fs.readFileSync(path.join(location, "Backups", name));
  const finished = randomUUID();
  fs.writeFileSync(path.join(location, "Backups", "Sojourner-backup-automatic-crash-1.sojourner"), bytes);
  await records.insertPending({ id: finished, provider: "local", locationKey: location, locationLabel: location,
    remotePath: "Backups/Sojourner-backup-automatic-crash-1.sojourner", name: "Sojourner-backup-automatic-crash-1.sojourner",
    size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), kind: "automatic" });
  const lost = randomUUID();
  await records.insertPending({ id: lost, provider: "local", locationKey: location, locationLabel: location,
    remotePath: "Backups/Sojourner-backup-automatic-crash-2.sojourner", name: "Sojourner-backup-automatic-crash-2.sojourner",
    size: 5, sha256: "c".repeat(64), kind: "automatic" });
  fs.writeFileSync(path.join(location, "Backups", ".sojourner-partial-abc"), "partial");
  const listing = await storage.list();
  assert.equal(listing.backups.find((item) => item.name.endsWith("crash-1.sojourner")).restorable, false,
    "an unverified copy is never offered for restore");
  await storage.backUp("manual");
  assert.equal((await records.get(finished)).status, "verified");
  assert.equal((await records.get(lost)).status, "failed");
  assert.equal(fs.existsSync(path.join(location, "Backups", ".sojourner-partial-abc")), false);
  storage.stop();
});

test("restore from the location downloads to a temporary file, checks the recorded hash and runs archive validation", async () => {
  const { storage, location, userData, backupFiles } = await service({ debounceMs: 60_000 });
  await storage.select("local");
  await storage.backUp("manual");
  const listing = await storage.list();
  const item = listing.backups[0];
  assert.equal(item.restorable, true);
  const selection = await storage.prepareRestore(item.itemId);
  assert.deepEqual(selection.validatedBytes, fs.readFileSync(path.join(location, "Backups", backupFiles()[0])));
  assert.deepEqual(fs.readdirSync(userData).filter((name) => name.includes("storage-work")), [], "the temporary download is removed");
  // Same size, different bytes: caught by the recorded SHA-256.
  const archivePath = path.join(location, "Backups", backupFiles()[0]);
  const tampered = fs.readFileSync(archivePath);
  tampered[tampered.length - 1] ^= 0xff;
  fs.writeFileSync(archivePath, tampered);
  await assert.rejects(storage.prepareRestore(item.itemId), /changed since Sojourner verified it/);
  // A different size: no longer Sojourner's recorded copy at all.
  fs.appendFileSync(archivePath, "tampered");
  await assert.rejects(storage.prepareRestore(item.itemId), /replaced the backup Sojourner saved/);
  await assert.rejects(storage.prepareRestore("Backups:../../etc/passwd"), /no longer at the storage location/);
  await assert.rejects(storage.prepareRestore("Elsewhere:x"), /Invalid storage item/);
  storage.stop();
});

test("switching location keeps old copies and history; unconfigured clouds cannot be selected", async () => {
  const { storage, records, userData } = await service({ debounceMs: 60_000 });
  await storage.select("local");
  await storage.backUp("manual");
  await assert.rejects(storage.select("onedrive"), /not set up/);
  await assert.rejects(storage.select("google"), /not set up/);
  const second = path.join(tempDir("sojourner-second-"), "Other");
  await storage.setLocalFolder(second);
  await storage.backUp("manual");
  const history = await storage.history();
  assert.equal(history.length, 2);
  assert.equal(history.filter((entry) => entry.current).length, 1);
  assert.equal(new Set((await records.history()).map((record) => record.locationKey)).size, 2);
  await assert.rejects(storage.setLocalFolder(path.join(userData, "inside")), /outside Sojourner's own data folder/);
  const status = await storage.status();
  const onedrive = status.providers.find((provider) => provider.provider === "onedrive");
  assert.equal(onedrive.configured, false);
  assert.match(onedrive.unavailableReason, /not set up/);
  storage.stop();
});

// ------------------------------------------------------------------ security review fixes

function cloudPort(account, token) {
  return {
    configured: true, connecting: false, account: async () => account,
    getAccessToken: async () => token(), invalidateAccessToken: () => undefined,
    connect: async () => account, cancelConnect: () => false, disconnect: async () => ({ revoked: true }),
    credentialStorage: () => "encrypted", credentialUnavailable: () => false,
  };
}

test("records never store the account e-mail; history adds it at display time from the live sign-in", async () => {
  const google = createFakeGoogleStorage();
  const email = google.state.account.email;
  google.state.accessTokens.set("valid-token", google.state.account.permissionId);
  const { storage, db } = await service({
    debounceMs: 60_000, fetch: google.fetch,
    google: cloudPort({ accountId: google.state.account.permissionId, label: email }, () => "valid-token"),
  });
  await storage.select("google");
  await storage.backUp("manual");
  const rows = await db.queryAll(`SELECT * FROM ${STORAGE_RECORDS_TABLE};`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "verified");
  for (const [column, value] of Object.entries(rows[0])) {
    assert.equal(String(value).toLowerCase().includes(email.toLowerCase()), false, `${column} must not hold the account e-mail`);
  }
  assert.equal(rows[0].location_label, "Google Drive > Sojourner");
  const [entry] = await storage.history();
  assert.equal(entry.locationLabel, `Google Drive > Sojourner (${email})`);
  storage.stop();
});

test("start removes temporary archives an interrupted run left in the user-data folder", async () => {
  const { storage, userData } = await service({
    debounceMs: 60_000,
    beforeStart: async (dir) => {
      fs.mkdirSync(path.join(dir, ".sojourner-storage-work-crashed", "nested"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".sojourner-storage-work-crashed", "backup.sojourner"), randomBytes(4096));
      fs.writeFileSync(path.join(dir, ".sojourner-storage-work-abc.sojourner"), randomBytes(4096));
      fs.writeFileSync(path.join(dir, "keep-me.txt"), "not Sojourner's work file");
    },
  });
  assert.deepEqual(fs.readdirSync(userData).filter((name) => name.startsWith(".sojourner-storage-work-")), []);
  assert.ok(fs.existsSync(path.join(userData, "keep-me.txt")));
  storage.stop();
});

test("Open launches only Sojourner's own verified PDF or JSON copies, and only while they still match", async () => {
  const { storage, location } = await service({ debounceMs: 60_000 });
  await storage.select("local");
  const source = path.join(tempDir("sojourner-export-"), "resume-v2.pdf");
  fs.writeFileSync(source, "%PDF-1.7 own document");
  storage.queueDocument(source, "resume-v2.pdf");
  const documents = path.join(location, "Documents");
  await until(() => fs.existsSync(documents) && fs.readdirSync(documents).length === 1);
  fs.writeFileSync(path.join(documents, "invoice.exe"), "MZ not a document");
  fs.writeFileSync(path.join(documents, "shortcut.lnk"), "link");
  fs.writeFileSync(path.join(documents, "someone-else.pdf"), "%PDF foreign");
  const listing = await storage.list();
  const own = listing.documents.find((item) => item.name.endsWith("resume-v2.pdf"));
  assert.equal(own.openable, true);
  for (const name of ["invoice.exe", "shortcut.lnk", "someone-else.pdf"]) {
    assert.equal(listing.documents.find((item) => item.name === name).openable, false, name);
  }
  const opened = [];
  const io = { openPath: async (target) => { opened.push(target); }, chooseSavePath: async () => null };
  await storage.openDocument(own.itemId, io);
  assert.deepEqual(opened, [path.join(documents, own.name)]);
  for (const name of ["invoice.exe", "shortcut.lnk", "someone-else.pdf"]) {
    await assert.rejects(storage.openDocument(`Documents:${name}`, io), /opens only the PDF and JSON documents it copied/);
  }
  // Same size, different bytes: refused by the hash check before launching.
  fs.writeFileSync(path.join(documents, own.name), "%PDF-1.7 own documenX");
  await assert.rejects(storage.openDocument(own.itemId, io), /changed since Sojourner copied it/);
  assert.equal(opened.length, 1);
  storage.stop();
});

test("restore carry-over empties archived records when this device never used storage locations", async () => {
  sqliteBinaryPath ??= await resolveSqliteBinary();
  const liveDir = tempDir("sojourner-live-");
  const livePath = path.join(liveDir, "sojourner.sqlite3");
  const live = new SqliteClient(livePath, sqliteBinaryPath);
  await live.exec("CREATE TABLE workspace (id INTEGER);");
  const staged = await openRecords();
  await staged.records.insertPending({ id: "foreign-record", provider: "local", locationKey: "D:\\Other", locationLabel: "D:\\Other",
    remotePath: "Backups/x.sojourner", name: "x.sojourner", size: 1, sha256: "d".repeat(64), kind: "automatic" });
  await carryOverStorageRecords({ liveDatabasePath: livePath, stagedDatabasePath: staged.databasePath, sqliteBinaryPath });
  assert.deepEqual(await staged.db.queryAll(`SELECT id FROM ${STORAGE_RECORDS_TABLE};`), []);
  assert.equal(await live.queryOne(`SELECT name FROM sqlite_master WHERE name = '${STORAGE_RECORDS_TABLE}';`), null,
    "the live database is only read");
});

test("OneDrive: a file that replaced Sojourner's copy under the same name is shown unverified and is not restorable", async () => {
  const onedrive = createFakeOneDrive({ clientId: CLIENT_ID });
  onedrive.state.accessTokens.add("ms-token");
  const { storage } = await service({
    debounceMs: 60_000, fetch: onedrive.fetch,
    microsoft: cloudPort({ accountId: "fakedrive0123456789", label: "OneDrive (personal account)" }, () => "ms-token"),
  });
  await storage.select("onedrive");
  const outcome = await storage.backUp("manual");
  let listing = await storage.list();
  assert.equal(listing.backups[0].status, "verified");
  assert.equal(listing.backups[0].restorable, true);
  onedrive.state.folders.get("Backups").delete(outcome.name);
  onedrive.put("Backups", outcome.name, Buffer.from("a different file with the same name"));
  listing = await storage.list();
  assert.equal(listing.backups[0].status, "replaced");
  assert.equal(listing.backups[0].restorable, false);
  await assert.rejects(storage.prepareRestore(listing.backups[0].itemId), /replaced the backup Sojourner saved/);
  storage.stop();
});
