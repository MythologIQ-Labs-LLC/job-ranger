// Windows (Electron) Google Drive export: SQLite journal (migration 1010) enforcing the
// SHARED state machine, the shared transport through the main-process egress, and the
// shared DriveExportFlow as composed in drive-ipc.cts (#314). Uses the bundled sqlite3 CLI
// (SQLITE3_PATH) and the local fake Google; no real Google endpoint is contacted.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const root = path.join(__dirname, "..", "electron-runtime");
const electron = (file) => require(path.join(root, "electron", "src", file));
const shared = (file) => require(path.join(root, "src", "shared", file));
const { SqliteClient, resolveSqliteBinary } = electron("sqlite.cjs");
const { SqliteDriveExportJournal, DRIVE_EXPORT_JOURNAL_TABLE } = electron("drive/drive-export-journal.cjs");
const { createDriveEgressFetch } = electron("drive/drive-egress.cjs");
const { FEATURE_MIGRATIONS } = electron("feature-migrations.cjs");
const { DriveExportFlow } = shared("drive/drive-export-flow.js");
const { reserveExport, advanceDurableExport, EXPORT_JOURNAL_SCHEMA_VERSION } = shared("artifact-export-journal.js");
const {
  uploadApprovedDriveFile, inspectReservedDriveFile, reserveDriveFileId,
} = shared("drive/google-drive-transport.js");
const { createFakeGoogle, ROOT_ID, OPERATION_PROPERTY } = require("./support/fake-google-drive.cjs");

const PDF = Buffer.from("%PDF-1.7\nSojourner Drive export test document\n%%EOF\n");
const PDF_SHA = createHash("sha256").update(PDF).digest("hex");
const ARTIFACT = "resume-artifact-1";

let sqliteBinaryPath;
async function openJournal() {
  sqliteBinaryPath ??= await resolveSqliteBinary();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sojourner-drive-journal-"));
  const databasePath = path.join(dir, "sojourner.sqlite3");
  const db = new SqliteClient(databasePath, sqliteBinaryPath);
  const journal = new SqliteDriveExportJournal(db);
  await journal.initialize();
  return { journal, db, databasePath };
}

function record(patch = {}) {
  return {
    schemaVersion: EXPORT_JOURNAL_SCHEMA_VERSION, operationId: randomUUID(), approvalId: randomUUID(),
    accountId: "permissionTester01", destinationId: "root", artifactId: ARTIFACT, artifactRevision: "1",
    bytesSha256: PDF_SHA, fileName: "resume-v1.pdf", mimeType: "application/pdf", status: "prepared",
    reservedFileId: "reservedFileAbc123", remoteId: null, verifiedSha256: null, resolution: null,
    updatedAt: "2026-11-02T10:00:00.000Z", ...patch,
  };
}

function receipt(current, status, remoteId = null, verifiedSha256 = null, resolution = null) {
  return { operationId: current.operationId, proposalId: current.approvalId, status,
    bytesSha256: current.bytesSha256, remoteId, verifiedSha256, resolution };
}

const later = (minutes) => new Date(Date.parse("2026-11-02T10:00:00.000Z") + minutes * 60_000).toISOString();

test("migration 1010 creates the journal table once and is recorded in schema_migrations", async () => {
  const { journal, db } = await openJournal();
  await journal.initialize();
  await new SqliteDriveExportJournal(db).initialize();
  assert.equal(FEATURE_MIGRATIONS.googleDriveExportJournal.version, 1010);
  const rows = await db.queryAll("SELECT version, name FROM schema_migrations WHERE version = 1010;");
  assert.deepEqual(rows.map((row) => [Number(row.version), row.name]), [[1010, "google_drive_export_journal"]]);
  const table = await db.queryOne(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${DRIVE_EXPORT_JOURNAL_TABLE}';`);
  assert.equal(table.name, DRIVE_EXPORT_JOURNAL_TABLE);
  const columns = (await db.queryAll(`PRAGMA table_info(${DRIVE_EXPORT_JOURNAL_TABLE});`)).map((column) => column.name);
  for (const forbidden of ["token", "access_token", "refresh_token", "email", "bytes"]) {
    assert.equal(columns.some((name) => name.includes(forbidden)), false, `no ${forbidden} column`);
  }
});

test("a database that already recorded 1010 still gets the journal table", async () => {
  sqliteBinaryPath ??= await resolveSqliteBinary();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sojourner-drive-journal-"));
  const db = new SqliteClient(path.join(dir, "sojourner.sqlite3"), sqliteBinaryPath);
  await db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);" +
    "INSERT INTO schema_migrations VALUES (1010, 'google_drive_export_journal', '2026-01-01T00:00:00.000Z');");
  const journal = new SqliteDriveExportJournal(db);
  await journal.initialize();
  assert.equal(await journal.insertIfAbsent(record()), true);
});

test("the SQLite journal enforces unique operations and approvals and the shared transitions", async () => {
  const { journal } = await openJournal();
  const first = record();
  await reserveExport(journal, first);
  assert.equal(await journal.insertIfAbsent(first), false, "same operation");
  assert.equal(await journal.insertIfAbsent(record({ approvalId: first.approvalId })), false, "same approval");
  await assert.rejects(reserveExport(journal, record({ approvalId: first.approvalId })), /already associated/);
  await assert.rejects(reserveExport(journal, record({ reservedFileId: null })), /reserved Drive file ID/);

  // Illegal: prepared -> verified skips the uploading boundary.
  await assert.rejects(journal.compareAndSwap(first.operationId, "prepared",
    { ...first, status: "verified", remoteId: first.reservedFileId, verifiedSha256: PDF_SHA, updatedAt: later(1) }),
  /Invalid export transition/);
  // A remote id other than the reserved one is refused.
  const uploading = await advanceDurableExport(journal, first, receipt(first, "uploading"), later(1));
  await assert.rejects(advanceDurableExport(journal, uploading, receipt(uploading, "accepted_unverified", "someOtherFile"), later(2)),
    /reserved Drive file ID/);
  // "failed" requires evidence; "abandoned" only a user decision.
  await assert.rejects(advanceDurableExport(journal, uploading, receipt(uploading, "failed"), later(2)), /proof/);
  await assert.rejects(advanceDurableExport(journal, uploading, receipt(uploading, "abandoned", null, null, "reserved_id_absent"), later(2)),
    /explicit user decision/);
  // A stale expected status does not write.
  assert.equal(await journal.compareAndSwap(first.operationId, "prepared",
    { ...uploading, status: "unknown_remote_outcome", updatedAt: later(3) }), false);
  const accepted = await advanceDurableExport(journal, uploading, receipt(uploading, "accepted_unverified", first.reservedFileId), later(2));
  const verified = await advanceDurableExport(journal, accepted, receipt(accepted, "verified", first.reservedFileId, PDF_SHA), later(3));
  assert.equal((await journal.findOperation(first.operationId)).status, "verified");
  assert.deepEqual(await journal.findApproval(first.approvalId), verified);
  // Terminal: nothing leaves verified.
  await assert.rejects(advanceDurableExport(journal, verified, receipt(verified, "abandoned", first.reservedFileId, null, "user_abandoned"), later(4)));
});

test("two racing transitions from one row: exactly one compare-and-swap wins", async () => {
  const { journal } = await openJournal();
  const row = record();
  await reserveExport(journal, row);
  const uploading = { ...row, status: "uploading", updatedAt: later(1) };
  const cancelled = { ...row, status: "cancelled", updatedAt: later(1) };
  const results = await Promise.all([
    journal.compareAndSwap(row.operationId, "prepared", uploading),
    journal.compareAndSwap(row.operationId, "prepared", cancelled),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
});

test("unresolvedForArtifact returns only blocking or prepared rows of that account and artifact", async () => {
  const { journal } = await openJournal();
  const mine = record();
  await reserveExport(journal, mine);
  await reserveExport(journal, record({ accountId: "otherAccount" }));
  await reserveExport(journal, record({ artifactId: "other-artifact" }));
  const done = record();
  await reserveExport(journal, done);
  await advanceDurableExport(journal, done, receipt(done, "cancelled"), later(1));
  const rows = await journal.unresolvedForArtifact("permissionTester01", ARTIFACT);
  assert.deepEqual(rows.map((row) => row.operationId), [mine.operationId]);
});

function transport() {
  const google = createFakeGoogle();
  google.signInAs("drive-tester@example.test", "permissionTester01");
  const token = [...google.state.accessTokens.keys()][0] ?? (() => {
    google.state.accessTokens.set("unit-access-token", "permissionTester01");
    return "unit-access-token";
  })();
  return { google, token, http: createDriveEgressFetch({ fetch: google.fetch, timeoutMs: 300, uploadTimeoutMs: 300 }) };
}

function approved(token, reservedFileId, bytes = PDF) {
  return { accessToken: token, operationId: randomUUID().replace(/-/g, ""), name: "resume-v1.pdf",
    mimeType: "application/pdf", destinationId: "root", bytes: new Blob([bytes]), approvedSha256: PDF_SHA, reservedFileId };
}

test("transport: create carries the reserved id, a repeated create is a 409 that is verified, never duplicated", async () => {
  const { google, token, http } = transport();
  const reservedFileId = await reserveDriveFileId(token, http);
  const input = approved(token, reservedFileId);
  const first = await uploadApprovedDriveFile(input, http);
  assert.equal(first.status, "verified");
  assert.equal(first.remoteId, reservedFileId);
  assert.equal(first.openUrl, `https://drive.google.com/file/d/${reservedFileId}/view`);
  const again = await uploadApprovedDriveFile(input, http);
  assert.equal(again.status, "verified");
  assert.equal(google.state.counts.conflicts, 1);
  assert.equal(google.uploadedFiles().length, 1);
  const [file] = google.uploadedFiles();
  assert.deepEqual(file.parents, [ROOT_ID]);
  assert.equal(file.appProperties[OPERATION_PROPERTY], input.operationId);
});

test("transport: only a 404 of the reserved id proves absence", async () => {
  const { google, token, http } = transport();
  assert.equal(await inspectReservedDriveFile(token, "neverCreatedId1", http), "absent");
  google.state.faults.get = "status:503";
  assert.equal(await inspectReservedDriveFile(token, "neverCreatedId1", http), "unknown");
  google.state.faults.get = "status:403";
  assert.equal(await inspectReservedDriveFile(token, "neverCreatedId1", http), "unknown");
  google.state.faults.get = null;
  assert.equal(await inspectReservedDriveFile("not-a-valid-token", "neverCreatedId1", http), "unknown", "401 is not absence");
});

test("transport: a SHA-256 mismatch or an oversized readback is never verified", async () => {
  const { google, token, http } = transport();
  google.state.faults.nextUpload = "corrupt-bytes";
  const corrupted = await uploadApprovedDriveFile(approved(token, await reserveDriveFileId(token, http)), http);
  assert.equal(corrupted.status, "verification_failed");
  google.state.faults.nextMedia = "oversized";
  const oversized = await uploadApprovedDriveFile(approved(token, await reserveDriveFileId(token, http)), http);
  assert.equal(oversized.status, "verification_failed");
  assert.match(oversized.reason, /readback was interrupted/);
});

test("transport: a dropped or timed-out upload is an unknown outcome, never a failure", async () => {
  const { google, token, http } = transport();
  google.state.faults.nextUpload = "drop-before-store";
  assert.equal((await uploadApprovedDriveFile(approved(token, await reserveDriveFileId(token, http)), http)).status,
    "unknown_remote_outcome");
  google.state.faults.nextUpload = "hang";
  assert.equal((await uploadApprovedDriveFile(approved(token, await reserveDriveFileId(token, http)), http)).status,
    "unknown_remote_outcome");
  google.state.faults.nextUpload = "status:503";
  assert.equal((await uploadApprovedDriveFile(approved(token, await reserveDriveFileId(token, http)), http)).status,
    "unknown_remote_outcome");
  google.state.faults.nextUpload = "status:403";
  assert.equal((await uploadApprovedDriveFile(approved(token, await reserveDriveFileId(token, http)), http)).status, "rejected");
});

async function flowHarness() {
  const { journal } = await openJournal();
  const { google, token, http } = transport();
  let artifact = { artifactId: ARTIFACT, revision: "1", fileName: "resume-v1.pdf", mimeType: "application/pdf",
    contentHash: PDF_SHA, bytes: Uint8Array.from(PDF) };
  let currentToken = token;
  const flow = new DriveExportFlow({
    withToken: (work) => work(currentToken),
    journal: () => journal,
    readArtifact: async () => artifact,
    http,
  });
  return {
    flow, journal, google,
    setArtifact: (next) => { artifact = { ...artifact, ...next }; },
    useAccount: (permissionId) => {
      currentToken = `token-${permissionId}`;
      google.state.accessTokens.set(currentToken, permissionId);
    },
  };
}

test("flow: review, one-click approval, reserved-id upload and byte verification", async () => {
  const { flow, journal, google } = await flowHarness();
  const review = await flow.prepare(ARTIFACT, 1);
  assert.equal(review.digest, PDF_SHA);
  assert.equal(review.label, "drive-tester@example.test");
  const outcome = await flow.confirm(review.proposalId);
  assert.equal(outcome.status, "verified");
  await assert.rejects(flow.confirm(review.proposalId), /no longer available/, "an approval is single-use");
  const rows = await journal.listAll();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "verified");
  assert.equal(rows[0].remoteId, rows[0].reservedFileId);
  assert.equal(google.state.counts.uploadPosts, 1);
});

test("flow: an account switch between review and confirm is refused before anything is reserved", async () => {
  const { flow, journal, google, useAccount } = await flowHarness();
  const review = await flow.prepare(ARTIFACT, 1);
  useAccount("someoneElse");
  await assert.rejects(flow.confirm(review.proposalId), /Google account changed/);
  assert.equal(google.state.counts.generateIds, 0);
  assert.deepEqual(await journal.listAll(), []);
});

test("flow: a changed or stale artifact is refused at review", async () => {
  const { flow, setArtifact } = await flowHarness();
  await assert.rejects(flow.prepare(ARTIFACT, 2), /saved resume changed/);
  setArtifact({ contentHash: "0".repeat(64) });
  await assert.rejects(flow.prepare(ARTIFACT, 1), /no longer matches its verified digest/);
});

test("flow: an upload that landed but lost its response is verified through files.get, never re-posted", async () => {
  const { flow, journal, google } = await flowHarness();
  google.state.faults.nextUpload = "drop-after-store";
  const outcome = await flow.confirm((await flow.prepare(ARTIFACT, 1)).proposalId);
  assert.equal(outcome.status, "unknown_remote_outcome");
  await assert.rejects(flow.prepare(ARTIFACT, 1), /still unresolved and may already exist/);
  const reconciled = await flow.reconcile(ARTIFACT);
  assert.equal(reconciled.message, "Verified 1 prior Drive export(s).");
  assert.equal(google.state.counts.uploadPosts, 1);
  assert.equal((await journal.listAll())[0].status, "verified");
});

test("flow: an upload that never reached Drive is released only by a 404 of its reserved id", async () => {
  const { flow, journal, google } = await flowHarness();
  google.state.faults.nextUpload = "drop-before-store";
  await flow.confirm((await flow.prepare(ARTIFACT, 1)).proposalId);
  google.state.faults.get = "status:503";
  const unavailable = await flow.reconcile(ARTIFACT);
  assert.equal(unavailable.unresolved.length, 1, "a 5xx probe never clears the row");
  google.state.faults.get = null;
  const reconciled = await flow.reconcile(ARTIFACT);
  assert.match(reconciled.message, /Confirmed that 1 interrupted export\(s\) never reached Google Drive/);
  const [row] = await journal.listAll();
  assert.equal(row.status, "failed");
  assert.equal(row.resolution, "reserved_id_absent");
  assert.equal((await flow.confirm((await flow.prepare(ARTIFACT, 1)).proposalId)).status, "verified");
});

test("flow: a prepared row left by a crash blocks review until the user cancels it", async () => {
  const { flow, journal } = await flowHarness();
  const crashed = record();
  await reserveExport(journal, crashed);
  await assert.rejects(flow.prepare(ARTIFACT, 1), /unused Drive export reservation/);
  const reconciled = await flow.reconcile(ARTIFACT);
  assert.deepEqual(reconciled.prepared.map((item) => item.operationId), [crashed.operationId]);
  assert.match(reconciled.message, /can be cancelled below/);
  assert.equal(await flow.cancelPrepared(ARTIFACT, crashed.operationId),
    "Unused reservation cancelled. Re-review the PDF before any new upload.");
  assert.equal((await journal.findOperation(crashed.operationId)).status, "cancelled");
  assert.equal((await flow.confirm((await flow.prepare(ARTIFACT, 1)).proposalId)).status, "verified");
});

test("flow: an unresolvable attempt is abandoned only on request and the receipt is kept", async () => {
  const { flow, journal, google } = await flowHarness();
  google.state.faults.nextUpload = "status:503";
  await flow.confirm((await flow.prepare(ARTIFACT, 1)).proposalId);
  google.state.faults.get = "status:503";
  const [blocked] = (await flow.reconcile(ARTIFACT)).unresolved;
  await assert.rejects(flow.cancelPrepared(ARTIFACT, blocked.operationId), /no longer cancellable/);
  assert.match(await flow.abandon(ARTIFACT, blocked.operationId), /receipt is kept on this device/);
  const [row] = await journal.listAll();
  assert.equal(row.status, "abandoned");
  assert.equal(row.resolution, "user_abandoned");
});
