// User-approved Drive export (#314): write-once journal, upload + remote
// verification and error classification, against the real SQLite schema and
// an in-process fake Google. Duplicate-safety and account-binding cases live in
// google-drive-export-recovery.test.cjs. No real network.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");

const { createDriveHarness, rejectsWith, ACCOUNT_A } = require("./support/drive-export-harness.cjs");
const { validateConnectFlowId, validateDriveApproveRequest, validateDriveOperationId } = require("../electron-runtime/electron/src/drive/drive-validators.cjs");
const { GoogleTransport } = require("../electron-runtime/electron/src/drive/google-transport.cjs");
const { DriveTransport } = require("../electron-runtime/electron/src/drive/drive-transport.cjs");

async function run() {
  const h = await createDriveHarness("drive-export");
  const { fake, service, sqlite, sql } = h;
  const rejects = (promise, code, message) => rejectsWith(assert, promise, code, message);
  try {
    await service.initialize();
    const migration = await sqlite.queryOne("SELECT name FROM schema_migrations WHERE version = 1010;");
    assert.equal(migration.name, "google_drive_export_journal");

    // --- Not configured / not connected: clean errors, no network ---
    const unconfigured = h.makeService({ unavailableReason: "missing-client-config" });
    assert.deepEqual(await unconfigured.status(), { configured: false, reason: "missing-client-config", connected: false, credentialStorage: "none", connecting: false });
    const first = await h.createArtifact();
    await rejects(unconfigured.prepare(first.artifact.id), "not_configured", "unconfigured prepare");
    await rejects(service.approve({ artifactId: first.artifact.id, expectedSha256: first.hash }), "not_connected", "not connected");
    assert.equal(fake.state.requests.length, 0, "nothing reached Google before connecting");
    assert.equal((await service.listExports(first.artifact.id)).length, 0);

    // Connected with a session-only credential (no OS encryption on this "device").
    await h.connectAs(ACCOUNT_A);
    const connected = await service.status();
    assert.equal(connected.connected, true);
    assert.equal(connected.credentialStorage, "session");
    assert.equal(connected.encryptionUnavailable, true);
    assert.equal(connected.accountEmail, ACCOUNT_A.email);

    // --- Review proposal ---
    const proposal = await service.prepare(first.artifact.id);
    assert.equal(proposal.fileName, "Taylor Example - Resume v1.pdf", "file name is derived and sanitized");
    assert.equal(proposal.sizeBytes, first.bytes.length);
    assert.equal(proposal.sha256, first.hash);
    assert.equal(proposal.destination, "My Drive › Job Ranger");
    assert.equal(proposal.accountEmail, ACCOUNT_A.email);
    assert.equal(proposal.accountId, ACCOUNT_A.permissionId, "the proposal names the immutable account id");
    assert.equal(proposal.formatLabel, "PDF");
    assert.equal(proposal.pageCount, 1);
    assert.equal(proposal.artifactVersion, 1);
    assert.equal(proposal.generatedFor, "General resume · Resume");
    assert.equal(fake.state.counts.uploadPosts, 0, "preparing a proposal uploads nothing");

    // --- File changed before upload: no network call ---
    const before = fake.state.requests.length;
    await rejects(service.approve({ artifactId: first.artifact.id, expectedSha256: "0".repeat(64) }), "file_changed", "stale reviewed hash");
    const tampered = await h.createArtifact();
    await fs.writeFile(tampered.managedPath, Buffer.concat([tampered.bytes, Buffer.from("tampered")]));
    await rejects(service.approve({ artifactId: tampered.artifact.id, expectedSha256: tampered.hash }), "file_changed", "bytes changed on disk");
    await rejects(service.prepare(tampered.artifact.id), "file_changed", "prepare also checks the bytes");
    assert.equal(fake.state.requests.length, before, "a changed file never reaches the network");
    assert.equal((await service.listExports(tampered.artifact.id)).length, 0);

    // --- Stale approvals are refused before any network call ---
    const staleRequests = fake.state.requests.length;
    await rejects(
      service.approve({ artifactId: first.artifact.id, expectedSha256: first.hash, expectedAccountId: "11111111111111111111" }),
      "account_mismatch",
      "approval reviewed under another account",
    );
    assert.equal(fake.state.requests.length, staleRequests);
    assert.equal((await service.listExports(first.artifact.id)).length, 0, "no operation recorded for a stale approval");

    // --- Successful upload with a reserved id, verified against Drive ---
    const receipt = await service.approve({ artifactId: first.artifact.id, expectedSha256: first.hash, expectedAccountId: proposal.accountId });
    assert.equal(receipt.fileName, "Taylor Example - Resume v1.pdf");
    assert.equal(receipt.sha256, first.hash);
    assert.equal(receipt.accountEmail, ACCOUNT_A.email);
    assert.match(receipt.webViewLink, /^https:\/\/drive\.google\.com\//);
    assert.match(receipt.driveFileId, /^reserved/, "the file was created under the id reserved with files.generateIds");
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
    assert.equal(record.accountId, ACCOUNT_A.permissionId);
    assert.equal(record.accountEmail, ACCOUNT_A.email);
    assert.equal("reservedFileId" in record, false, "journal internals are not sent to the renderer");

    // --- Duplicate protection for an already-verified artifact ---
    const posts = fake.state.counts.uploadPosts;
    await rejects(service.approve({ artifactId: first.artifact.id, expectedSha256: first.hash }), "already_exported", "second approval without explicit choice");
    assert.equal(fake.state.counts.uploadPosts, posts);
    assert.equal((await service.prepare(first.artifact.id)).verifiedExports.length, 1);
    const copy = await service.approve({ artifactId: first.artifact.id, expectedSha256: first.hash, saveAnotherCopy: true });
    assert.notEqual(copy.operationId, receipt.operationId);
    assert.equal(fake.state.counts.folderCreates, 1, "the Job Ranger folder is created once and reused");
    const again = await service.retry(receipt.operationId);
    assert.equal(again.driveFileId, receipt.driveFileId, "retrying a verified export returns its receipt");
    assert.equal(fake.state.counts.uploadPosts, posts + 1);

    // --- Definite rejections are failed and retryable with the same operation ---
    const limited = await h.createArtifact();
    fake.state.faults.nextUpload = "status:429:rateLimitExceeded";
    const limitedError = await rejects(service.approve({ artifactId: limited.artifact.id, expectedSha256: limited.hash }), "rate_limited", "429");
    assert.equal(limitedError.retryable, true);
    const limitedRecord = (await service.listExports(limited.artifact.id))[0];
    assert.equal(limitedRecord.state, "failed");
    assert.equal(limitedRecord.errorCode, "rate_limited");
    assert.equal((await service.retry(limitedRecord.operationId)).operationId, limitedRecord.operationId);

    for (const [fault, code] of [
      ["status:403:userRateLimitExceeded", "rate_limited"],
      ["status:403:storageQuotaExceeded", "storage_quota"],
      ["status:403:insufficientPermissions", "insufficient_scope"],
    ]) {
      const artifact = await h.createArtifact();
      fake.state.faults.nextUpload = fault;
      await rejects(service.approve({ artifactId: artifact.artifact.id, expectedSha256: artifact.hash }), code, fault);
      assert.equal((await service.listExports(artifact.artifact.id))[0].state, "failed", fault);
    }

    // --- 401: the cached access token is dropped and refreshed once, then the upload succeeds ---
    const expired = await h.createArtifact();
    fake.state.accessTokens.clear();
    const refreshes = fake.state.counts.refreshes;
    const afterRefresh = await service.approve({ artifactId: expired.artifact.id, expectedSha256: expired.hash });
    assert.equal(fake.state.counts.refreshes, refreshes + 1);
    assert.ok(afterRefresh.driveFileId);

    // --- MD5 verifies when Drive omits SHA-256 ---
    fake.state.faults.omitSha256 = true;
    const md5Only = await h.createArtifact();
    assert.ok((await service.approve({ artifactId: md5Only.artifact.id, expectedSha256: md5Only.hash })).driveFileId);
    fake.state.faults.omitSha256 = false;

    // --- Double click / concurrent approvals for one artifact: exactly one operation ---
    const doubled = await h.createArtifact();
    const doublePosts = fake.state.counts.uploadPosts;
    const outcomes = await Promise.allSettled([
      service.approve({ artifactId: doubled.artifact.id, expectedSha256: doubled.hash }),
      service.approve({ artifactId: doubled.artifact.id, expectedSha256: doubled.hash }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.find((outcome) => outcome.status === "rejected").reason.code, "export_in_progress");
    assert.equal(fake.state.counts.uploadPosts, doublePosts + 1);
    assert.equal((await service.listExports(doubled.artifact.id)).length, 1);

    // --- Offline before the upload started: failed, nothing posted ---
    const offlineArtifact = await h.createArtifact();
    const offlinePosts = fake.state.counts.uploadPosts;
    const offlineTransport = new GoogleTransport({ fetch: async () => { throw new TypeError("fetch failed"); }, allowedOrigins: h.transport.options.allowedOrigins });
    const offlineService = h.makeService({ drive: new DriveTransport({ transport: offlineTransport, endpoints: h.driveTransport.options.endpoints, auth: h.auth }) });
    await rejects(offlineService.approve({ artifactId: offlineArtifact.artifact.id, expectedSha256: offlineArtifact.hash }), "network", "offline");
    assert.equal((await service.listExports(offlineArtifact.artifact.id))[0].state, "failed", "nothing could have reached Drive");
    assert.equal(fake.state.counts.uploadPosts, offlinePosts);

    // --- Revoked refresh token: credential cleared, failure recorded before any upload ---
    const revoked = await h.createArtifact();
    fake.state.accessTokens.clear();
    h.auth.invalidateAccessToken();
    fake.state.faults.refresh = "invalid_grant";
    const revokedPosts = fake.state.counts.uploadPosts;
    await rejects(service.approve({ artifactId: revoked.artifact.id, expectedSha256: revoked.hash }), "auth_expired", "revoked");
    assert.equal(fake.state.counts.uploadPosts, revokedPosts);
    assert.equal((await service.status()).connected, false);
    assert.equal((await service.listExports(revoked.artifact.id))[0].state, "failed");
    fake.state.faults.refresh = null;

    // --- Input validation and token hygiene ---
    const account = ACCOUNT_A.permissionId;
    assert.throws(() => validateDriveApproveRequest({ artifactId: "../etc", expectedSha256: first.hash, expectedAccountId: account }), /invalid characters/);
    assert.throws(() => validateDriveApproveRequest({ artifactId: "a", expectedSha256: "abc", expectedAccountId: account }), /SHA-256/);
    assert.throws(() => validateDriveApproveRequest({ artifactId: "a", expectedSha256: first.hash, expectedAccountId: account, saveAnotherCopy: "yes" }), /true or false/);
    assert.throws(() => validateDriveApproveRequest({ artifactId: "a", expectedSha256: first.hash }), /reviewed Google account/, "the renderer must echo the reviewed account");
    assert.throws(() => validateConnectFlowId("not-a-flow"), /sign-in id/);
    assert.equal(validateConnectFlowId(undefined), undefined);
    assert.throws(() => validateDriveOperationId("1; DROP TABLE drive_exports"), /operation id/);
    const journalDump = JSON.stringify(await sqlite.queryAll("SELECT * FROM drive_exports;"));
    assert.doesNotMatch(journalDump, /fake-access|fake-refresh|Bearer/, "no token is ever written to SQLite");
    const columns = (await sqlite.queryAll("PRAGMA table_info(drive_exports);")).map((column) => column.name);
    assert.deepEqual(columns, [
      "operation_id", "artifact_id", "content_sha256", "file_name", "size_bytes", "state", "reserved_file_id",
      "drive_file_id", "web_view_link", "error_code", "error_message", "account_id", "account_email", "approved_at", "updated_at",
    ]);
    await assert.rejects(
      () => sqlite.exec(sql`UPDATE drive_exports SET state = ${"done"} WHERE operation_id = ${receipt.operationId};`),
      "the state CHECK constraint rejects unknown states",
    );

    console.log("Google Drive export smoke test passed");
  } finally {
    await h.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
