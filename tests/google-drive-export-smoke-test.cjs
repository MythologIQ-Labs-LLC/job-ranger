// User-approved Drive export (#314): write-once journal, upload + remote
// verification, error classification and duplicate-free retries, against the
// real SQLite schema and an in-process fake Google. No real network.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");

const { JobScoutBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { ResumeRepository } = require("../electron-runtime/electron/src/resume-repository.cjs");
const { SqliteClient, sql } = require("../electron-runtime/electron/src/sqlite.cjs");
const drive = "../electron-runtime/electron/src/drive";
const { DriveExportService } = require(`${drive}/drive-export-service.cjs`);
const { DriveTransport } = require(`${drive}/drive-transport.cjs`);
const { GoogleDesktopAuth } = require(`${drive}/google-desktop-auth.cjs`);
const { GoogleTransport } = require(`${drive}/google-transport.cjs`);
const { DriveCredentialStore } = require(`${drive}/drive-credential-store.cjs`);
const { resolveGoogleEndpoints, GOOGLE_DRIVE_FILE_SCOPE } = require(`${drive}/google-config.cjs`);
const { validateDriveApproveRequest, validateDriveOperationId } = require(`${drive}/drive-validators.cjs`);
const { createFakeGoogle } = require("./support/fake-google-drive.cjs");

const CLIENT = { clientId: "1234567890-abcdef123.apps.googleusercontent.com", clientSecret: "GOCSPX-test-secret-value" };
const endpoints = resolveGoogleEndpoints({ env: { JOB_RANGER_GOOGLE_TEST_BASE_URL: "http://127.0.0.1:65001" }, isPackaged: false });
const sessionEncryption = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };

const CRLF = String.fromCharCode(13, 10);
const MULTIPART_TAIL = `${CRLF}--b--${CRLF}`;
function multipartHead(operationId, folderId) {
  const metadata = JSON.stringify({ name: "restart.pdf", mimeType: "application/pdf", parents: [folderId], appProperties: { jobRangerOperationId: operationId } });
  return [`--b`, `Content-Type: application/json`, ``, metadata, `--b`, `Content-Type: application/pdf`, ``, ``].join(CRLF);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function rejectsWith(promise, code, message) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${message}: got ${error.code} (${error.message})`);
    return true;
  });
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-drive-export-"));
  try {
    const backend = new JobScoutBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => {
        throw new Error("Drive export smoke test must not use the job network");
      },
    });
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    await backend.dispose();
    const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
    const repository = new ResumeRepository(sqlite);
    const now = new Date().toISOString();
    await sqlite.exec(sql`
      INSERT INTO resume_projections (id, job_id, context, page_format, status, created_at, updated_at)
      VALUES (${"projection-drive"}, ${null}, ${"private-sector"}, ${"letter"}, ${"finalized"}, ${now}, ${now});
    `);
    const resumeDirectory = path.join(tempDir, "artifacts", "resumes");
    await fs.mkdir(resumeDirectory, { recursive: true });
    let version = 0;
    async function createArtifact() {
      version += 1;
      const bytes = Buffer.from(`%PDF-1.7\n% Job Ranger drive export fixture v${version}\n${"x".repeat(200 + version)}\n%%EOF\n`);
      const managedPath = path.join(resumeDirectory, `projection-drive-v${version}.pdf`);
      await fs.writeFile(managedPath, bytes);
      const artifact = await repository.createArtifact({
        id: `resume-artifact-drive-${version}`,
        projectionId: "projection-drive",
        version,
        format: "pdf",
        managedPath,
        contentHash: sha256(bytes),
        pageCount: 1,
        truthGateResult: null,
        parseabilityResult: JSON.stringify({ passed: true }),
        relevanceReviewResult: null,
        projectionSnapshot: { projection: { contact: { fullName: "Taylor: Example/" } }, statements: [] },
        createdAt: now,
      });
      return { artifact, bytes, managedPath, hash: sha256(bytes) };
    }

    const fake = createFakeGoogle({ clientId: CLIENT.clientId });
    const transport = new GoogleTransport({ fetch: (url, init) => fake.fetch(url, init), allowedOrigins: endpoints.allowedOrigins });
    const store = new DriveCredentialStore(path.join(tempDir, "user-data"), sessionEncryption);
    const auth = new GoogleDesktopAuth({ client: CLIENT, endpoints, transport, store, openExternal: async () => undefined });
    const driveTransport = new DriveTransport({ transport, endpoints, auth, uploadTimeoutMs: 300 });
    const service = new DriveExportService({ dataDirectory: tempDir, sqlite, unavailableReason: null, auth, store, drive: driveTransport });
    await service.initialize();
    await service.initialize();
    const migration = await sqlite.queryOne("SELECT name FROM schema_migrations WHERE version = 1010;");
    assert.equal(migration.name, "google_drive_export_journal");

    // --- Not configured / not connected: clean errors, no network ---
    const unconfigured = new DriveExportService({ dataDirectory: tempDir, sqlite, unavailableReason: "missing-client-config", auth, store, drive: driveTransport });
    assert.deepEqual(await unconfigured.status(), { configured: false, reason: "missing-client-config", connected: false, credentialStorage: "none", connecting: false });
    const first = await createArtifact();
    await rejectsWith(unconfigured.prepare(first.artifact.id), "not_configured", "unconfigured prepare");
    await rejectsWith(service.approve({ artifactId: first.artifact.id, expectedSha256: first.hash }), "not_connected", "not connected");
    assert.equal(fake.state.requests.length, 0, "nothing reached Google before connecting");
    assert.equal((await service.listExports(first.artifact.id)).length, 0);

    // Connected with a session-only credential (no OS encryption on this "device").
    fake.state.refreshTokens.add("fake-refresh-seeded");
    await store.save({ refreshToken: "fake-refresh-seeded", accountEmail: "drive-tester@example.test", scope: GOOGLE_DRIVE_FILE_SCOPE, savedAt: now });
    const connected = await service.status();
    assert.equal(connected.connected, true);
    assert.equal(connected.credentialStorage, "session");
    assert.equal(connected.encryptionUnavailable, true);
    assert.equal(connected.accountEmail, "drive-tester@example.test");

    // --- Review proposal ---
    const proposal = await service.prepare(first.artifact.id);
    assert.equal(proposal.fileName, "Taylor Example - Resume v1.pdf", "file name is derived and sanitized");
    assert.equal(proposal.sizeBytes, first.bytes.length);
    assert.equal(proposal.sha256, first.hash);
    assert.equal(proposal.destination, "My Drive › Job Ranger");
    assert.equal(proposal.accountEmail, "drive-tester@example.test");
    assert.equal(proposal.formatLabel, "PDF");
    assert.equal(proposal.pageCount, 1);
    assert.equal(proposal.artifactVersion, 1);
    assert.equal(proposal.generatedFor, "General resume · Resume");
    assert.equal(fake.state.counts.uploadPosts, 0, "preparing a proposal uploads nothing");

    // --- File changed before upload: no network call ---
    const before = fake.state.requests.length;
    await rejectsWith(service.approve({ artifactId: first.artifact.id, expectedSha256: "0".repeat(64) }), "file_changed", "stale reviewed hash");
    const tampered = await createArtifact();
    await fs.writeFile(tampered.managedPath, Buffer.concat([tampered.bytes, Buffer.from("tampered")]));
    await rejectsWith(service.approve({ artifactId: tampered.artifact.id, expectedSha256: tampered.hash }), "file_changed", "bytes changed on disk");
    await rejectsWith(service.prepare(tampered.artifact.id), "file_changed", "prepare also checks the bytes");
    assert.equal(fake.state.requests.length, before, "a changed file never reaches the network");
    assert.equal((await service.listExports(tampered.artifact.id)).length, 0);

    // --- Successful upload, verified against Drive ---
    const receipt = await service.approve({ artifactId: first.artifact.id, expectedSha256: first.hash });
    assert.equal(receipt.fileName, "Taylor Example - Resume v1.pdf");
    assert.equal(receipt.sha256, first.hash);
    assert.match(receipt.webViewLink, /^https:\/\/drive\.google\.com\//);
    assert.ok(receipt.verifiedAt);
    const uploaded = fake.state.files.get(receipt.driveFileId);
    assert.deepEqual(uploaded.bytes, first.bytes, "Drive received the exact PDF bytes");
    assert.equal(uploaded.mimeType, "application/pdf");
    assert.equal(uploaded.appProperties.jobRangerOperationId, receipt.operationId);
    assert.equal(uploaded.appProperties.jobRangerArtifactId, first.artifact.id);
    assert.equal(uploaded.appProperties.jobRangerSha256, first.hash);
    const folder = fake.state.files.get(uploaded.parents[0]);
    assert.equal(folder.name, "Job Ranger");
    assert.equal(folder.appProperties.jobRanger, "folder");
    const [record] = await service.listExports(first.artifact.id);
    assert.equal(record.state, "verified");
    assert.equal(record.driveFileId, receipt.driveFileId);

    // --- Duplicate protection for an already-verified artifact ---
    const posts = fake.state.counts.uploadPosts;
    await rejectsWith(service.approve({ artifactId: first.artifact.id, expectedSha256: first.hash }), "already_exported", "second approval without explicit choice");
    assert.equal(fake.state.counts.uploadPosts, posts);
    assert.equal((await service.prepare(first.artifact.id)).verifiedExports.length, 1);
    const copy = await service.approve({ artifactId: first.artifact.id, expectedSha256: first.hash, saveAnotherCopy: true });
    assert.notEqual(copy.operationId, receipt.operationId);
    assert.equal(fake.state.counts.folderCreates, 1, "the Job Ranger folder is created once and reused");
    const again = await service.retry(receipt.operationId);
    assert.equal(again.driveFileId, receipt.driveFileId, "retrying a verified export returns its receipt");
    assert.equal(fake.state.counts.uploadPosts, posts + 1);

    // --- Timeout after the POST: unknown outcome, retry finds the file, no second POST ---
    const slow = await createArtifact();
    fake.state.faults.nextUpload = "hang";
    const hung = service.approve({ artifactId: slow.artifact.id, expectedSha256: slow.hash });
    let operationId;
    await assert.rejects(hung, (error) => {
      assert.equal(error.code, "timeout");
      operationId = error.operationId;
      return true;
    });
    assert.equal((await service.listExports(slow.artifact.id))[0].state, "unknown_remote_outcome");
    await rejectsWith(service.approve({ artifactId: slow.artifact.id, expectedSha256: slow.hash, saveAnotherCopy: true }), "export_in_progress", "an unresolved upload blocks a new one");
    const postsBeforeRetry = fake.state.counts.uploadPosts;
    const recovered = await service.retry(operationId);
    assert.equal(fake.state.counts.uploadPosts, postsBeforeRetry, "retry found the file by operation id instead of uploading again");
    assert.equal(recovered.operationId, operationId);
    assert.equal(fake.uploadedFiles().filter((file) => file.appProperties.jobRangerArtifactId === slow.artifact.id).length, 1);
    assert.equal((await service.listExports(slow.artifact.id))[0].state, "verified");

    // --- Connection dropped after the server stored the file ---
    const dropped = await createArtifact();
    fake.state.faults.nextUpload = "drop";
    await rejectsWith(service.approve({ artifactId: dropped.artifact.id, expectedSha256: dropped.hash }), "network", "dropped connection");
    const droppedRecord = (await service.listExports(dropped.artifact.id))[0];
    assert.equal(droppedRecord.state, "unknown_remote_outcome");
    const dropPosts = fake.state.counts.uploadPosts;
    await service.retry(droppedRecord.operationId);
    assert.equal(fake.state.counts.uploadPosts, dropPosts);

    // --- 5xx before anything was stored: retry finds nothing and re-POSTs with the same operation id ---
    const server = await createArtifact();
    fake.state.faults.nextUpload = "status:503:backendError";
    await rejectsWith(service.approve({ artifactId: server.artifact.id, expectedSha256: server.hash }), "server", "503");
    const serverRecord = (await service.listExports(server.artifact.id))[0];
    assert.equal(serverRecord.state, "unknown_remote_outcome", "a 5xx may have reached Drive");
    const serverPosts = fake.state.counts.uploadPosts;
    const reposted = await service.retry(serverRecord.operationId);
    assert.equal(fake.state.counts.uploadPosts, serverPosts + 1);
    assert.equal(fake.state.files.get(reposted.driveFileId).appProperties.jobRangerOperationId, serverRecord.operationId, "re-POST reuses the same operation id");

    // --- Definite rejections are failed (retryable with the same operation) ---
    const limited = await createArtifact();
    fake.state.faults.nextUpload = "status:429:rateLimitExceeded";
    await rejectsWith(service.approve({ artifactId: limited.artifact.id, expectedSha256: limited.hash }), "rate_limited", "429");
    const limitedRecord = (await service.listExports(limited.artifact.id))[0];
    assert.equal(limitedRecord.state, "failed");
    assert.equal(limitedRecord.errorCode, "rate_limited");
    assert.equal((await service.retry(limitedRecord.operationId)).operationId, limitedRecord.operationId);

    const userLimited = await createArtifact();
    fake.state.faults.nextUpload = "status:403:userRateLimitExceeded";
    await rejectsWith(service.approve({ artifactId: userLimited.artifact.id, expectedSha256: userLimited.hash }), "rate_limited", "403 userRateLimitExceeded");
    const quota = await createArtifact();
    fake.state.faults.nextUpload = "status:403:storageQuotaExceeded";
    await rejectsWith(service.approve({ artifactId: quota.artifact.id, expectedSha256: quota.hash }), "storage_quota", "quota");
    const scope = await createArtifact();
    fake.state.faults.nextUpload = "status:403:insufficientPermissions";
    await rejectsWith(service.approve({ artifactId: scope.artifact.id, expectedSha256: scope.hash }), "insufficient_scope", "scope");
    assert.equal((await service.listExports(scope.artifact.id))[0].state, "failed");

    // --- 401: the cached access token is dropped and refreshed once, then the upload succeeds ---
    const expired = await createArtifact();
    fake.state.accessTokens.clear();
    const refreshes = fake.state.counts.refreshes;
    const afterRefresh = await service.approve({ artifactId: expired.artifact.id, expectedSha256: expired.hash });
    assert.equal(fake.state.counts.refreshes, refreshes + 1);
    assert.ok(afterRefresh.driveFileId);

    // --- Remote verification ---
    const mismatch = await createArtifact();
    fake.state.faults.corruptNextUploadSize = true;
    await rejectsWith(service.approve({ artifactId: mismatch.artifact.id, expectedSha256: mismatch.hash }), "verification_failed", "size mismatch");
    const mismatchRecord = (await service.listExports(mismatch.artifact.id))[0];
    assert.equal(mismatchRecord.state, "failed");
    assert.ok(mismatchRecord.driveFileId, "the unverified remote file id is kept for the record");
    fake.state.faults.omitSha256 = true;
    const md5Only = await createArtifact();
    assert.ok((await service.approve({ artifactId: md5Only.artifact.id, expectedSha256: md5Only.hash })).driveFileId, "MD5 verifies when Drive omits SHA-256");
    fake.state.faults.omitSha256 = false;

    // --- A crash after 'uploading' was recorded: retry looks up first ---
    const crashed = await createArtifact();
    const crashedOperation = "11111111-2222-4333-8444-555555555555";
    await sqlite.exec(sql`
      INSERT INTO drive_exports (operation_id, artifact_id, content_sha256, file_name, size_bytes, state, approved_at, updated_at)
      VALUES (${crashedOperation}, ${crashed.artifact.id}, ${crashed.hash}, ${"crash.pdf"}, ${crashed.bytes.length}, ${"uploading"}, ${now}, ${now});
    `);
    assert.equal((await service.prepare(crashed.artifact.id)).pendingExport.operationId, crashedOperation);
    const crashPosts = fake.state.counts.uploadPosts;
    await service.retry(crashedOperation);
    assert.equal(fake.state.counts.uploadPosts, crashPosts + 1, "nothing was found remotely, so exactly one upload happened");

    // --- Malformed upload responses after Drive stored the file: unknown outcome, retry reconciles ---
    for (const fault of ["malformed", "missing-id"]) {
      const odd = await createArtifact();
      fake.state.faults.nextUpload = fault;
      await rejectsWith(service.approve({ artifactId: odd.artifact.id, expectedSha256: odd.hash }), "invalid_response", fault);
      const oddRecord = (await service.listExports(odd.artifact.id))[0];
      assert.equal(oddRecord.state, "unknown_remote_outcome", fault);
      const oddPosts = fake.state.counts.uploadPosts;
      await service.retry(oddRecord.operationId);
      assert.equal(fake.state.counts.uploadPosts, oddPosts, `${fault}: reconciled without a second upload`);
    }

    // --- Connection reset mid-body before Drive stored anything: retry re-POSTs the same operation ---
    const reset = await createArtifact();
    fake.state.faults.nextUpload = "reset-before-store";
    await rejectsWith(service.approve({ artifactId: reset.artifact.id, expectedSha256: reset.hash }), "network", "reset");
    const resetRecord = (await service.listExports(reset.artifact.id))[0];
    assert.equal(resetRecord.state, "unknown_remote_outcome");
    const resetReceipt = await service.retry(resetRecord.operationId);
    assert.equal(fake.uploadedFiles().filter((file) => file.appProperties.jobRangerArtifactId === reset.artifact.id).length, 1);
    assert.equal(fake.state.files.get(resetReceipt.driveFileId).appProperties.jobRangerOperationId, resetRecord.operationId);

    // --- Double click / concurrent approvals for one artifact: exactly one operation ---
    const doubled = await createArtifact();
    const doublePosts = fake.state.counts.uploadPosts;
    const outcomes = await Promise.allSettled([
      service.approve({ artifactId: doubled.artifact.id, expectedSha256: doubled.hash }),
      service.approve({ artifactId: doubled.artifact.id, expectedSha256: doubled.hash }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.find((outcome) => outcome.status === "rejected").reason.code, "export_in_progress");
    assert.equal(fake.state.counts.uploadPosts, doublePosts + 1);
    assert.equal((await service.listExports(doubled.artifact.id)).length, 1);

    // --- Drive SHA-256 readback differs from the local digest: never reported as saved ---
    const digest = await createArtifact();
    fake.state.faults.corruptNextUploadSha256 = true;
    await rejectsWith(service.approve({ artifactId: digest.artifact.id, expectedSha256: digest.hash }), "verification_failed", "sha256 mismatch");
    assert.equal((await service.listExports(digest.artifact.id))[0].state, "failed");

    // --- Crash/restart with the file already in Drive: a new service instance reconciles by operation id ---
    const restartedArtifact = await createArtifact();
    const restartOperation = "66666666-7777-4888-8999-aaaaaaaaaaaa";
    await sqlite.exec(sql`
      INSERT INTO drive_exports (operation_id, artifact_id, content_sha256, file_name, size_bytes, state, approved_at, updated_at)
      VALUES (${restartOperation}, ${restartedArtifact.artifact.id}, ${restartedArtifact.hash}, ${"restart.pdf"}, ${restartedArtifact.bytes.length}, ${"uploading"}, ${now}, ${now});
    `);
    const folderId = [...fake.state.files.values()].find((file) => file.appProperties.jobRanger === "folder").id;
    const already = fake.handle(
      "POST",
      "http://fake.test/upload/drive/v3/files?uploadType=multipart",
      { authorization: `Bearer ${await auth.getAccessToken()}`, "content-type": "multipart/related; boundary=b" },
      Buffer.concat([
        Buffer.from(multipartHead(restartOperation, folderId)),
        restartedArtifact.bytes,
        Buffer.from(MULTIPART_TAIL),
      ]),
    );
    assert.equal(already.status, 200);
    const afterRestart = new DriveExportService({ dataDirectory: tempDir, sqlite, unavailableReason: null, auth, store, drive: driveTransport });
    await afterRestart.initialize();
    const restartPosts = fake.state.counts.uploadPosts;
    const reconciled = await afterRestart.retry(restartOperation);
    assert.equal(fake.state.counts.uploadPosts, restartPosts, "never a blind re-POST after a crash");
    assert.equal(reconciled.driveFileId, JSON.parse(already.body.toString()).id);

    // --- Offline before the upload started: failed, nothing posted ---
    const offlineArtifact = await createArtifact();
    const offlinePosts = fake.state.counts.uploadPosts;
    const offlineTransport = new GoogleTransport({ fetch: async () => { throw new TypeError("fetch failed"); }, allowedOrigins: endpoints.allowedOrigins });
    const offlineService = new DriveExportService({
      dataDirectory: tempDir, sqlite, unavailableReason: null, auth, store,
      drive: new DriveTransport({ transport: offlineTransport, endpoints, auth }),
    });
    await rejectsWith(offlineService.approve({ artifactId: offlineArtifact.artifact.id, expectedSha256: offlineArtifact.hash }), "network", "offline");
    assert.equal((await service.listExports(offlineArtifact.artifact.id))[0].state, "failed", "nothing could have reached Drive");
    assert.equal(fake.state.counts.uploadPosts, offlinePosts);

    // --- Revoked refresh token: credential cleared, failure recorded before any upload ---
    const revoked = await createArtifact();
    fake.state.accessTokens.clear();
    auth.invalidateAccessToken();
    fake.state.faults.refresh = "invalid_grant";
    const revokedPosts = fake.state.counts.uploadPosts;
    await rejectsWith(service.approve({ artifactId: revoked.artifact.id, expectedSha256: revoked.hash }), "auth_expired", "revoked");
    assert.equal(fake.state.counts.uploadPosts, revokedPosts);
    assert.equal((await service.status()).connected, false);
    assert.equal((await service.listExports(revoked.artifact.id))[0].state, "failed");

    // --- Input validation and token hygiene ---
    assert.throws(() => validateDriveApproveRequest({ artifactId: "../etc", expectedSha256: first.hash }), /invalid characters/);
    assert.throws(() => validateDriveApproveRequest({ artifactId: "a", expectedSha256: "abc" }), /SHA-256/);
    assert.throws(() => validateDriveApproveRequest({ artifactId: "a", expectedSha256: first.hash, saveAnotherCopy: "yes" }), /true or false/);
    assert.throws(() => validateDriveOperationId("1; DROP TABLE drive_exports"), /operation id/);
    const journalDump = JSON.stringify(await sqlite.queryAll("SELECT * FROM drive_exports;"));
    assert.doesNotMatch(journalDump, /fake-access|fake-refresh|Bearer/, "no token is ever written to SQLite");
    const columns = (await sqlite.queryAll("PRAGMA table_info(drive_exports);")).map((column) => column.name);
    assert.deepEqual(columns, ["operation_id", "artifact_id", "content_sha256", "file_name", "size_bytes", "state", "drive_file_id", "web_view_link", "error_code", "error_message", "approved_at", "updated_at"]);

    console.log("Google Drive export smoke test passed");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
