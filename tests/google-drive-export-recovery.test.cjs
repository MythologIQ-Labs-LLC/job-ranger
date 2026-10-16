// Drive export duplicate safety and account binding (#314 review VETO fixes):
// reserved file ids under an eventually consistent files.list, late commits,
// crashes between reservation and upload, account switches, abandon, folder
// serialization and untrusted journal links. Real SQLite, fake Google.
const assert = require("node:assert/strict");

const { createDriveHarness, rejectsWith, ACCOUNT_A, ACCOUNT_B } = require("./support/drive-export-harness.cjs");

const filesFor = (fake, artifactId) => fake.uploadedFiles().filter((file) => file.appProperties.jobRangerArtifactId === artifactId);

async function testReservedIdsPreventDuplicates(h, rejects) {
  const { fake, service, sqlite, sql, now } = h;
  // Searches miss new files for a while, as Drive's files.list can.
  fake.state.listLag = 50;

  // B1: Drive stored the file but the client timed out. A search-based retry would
  // miss it and re-POST; the reserved id is read back directly instead.
  const timedOut = await h.createArtifact();
  fake.state.faults.nextUpload = "hang";
  const error = await rejects(service.approve({ artifactId: timedOut.artifact.id, expectedSha256: timedOut.hash }), "timeout", "post-upload timeout");
  assert.equal(error.retryable, true);
  const record = (await service.listExports(timedOut.artifact.id))[0];
  assert.equal(record.state, "unknown_remote_outcome");
  const reserved = (await sqlite.queryOne(sql`SELECT reserved_file_id FROM drive_exports WHERE operation_id = ${record.operationId};`)).reserved_file_id;
  assert.ok(fake.state.files.has(reserved), "Drive committed the file under the reserved id");
  const posts = fake.state.counts.uploadPosts;
  const receipt = await service.retry(record.operationId);
  assert.equal(fake.state.counts.uploadPosts, posts, "files.get on the reserved id found it: no second upload");
  assert.equal(receipt.driveFileId, reserved);
  assert.equal(filesFor(fake, timedOut.artifact.id).length, 1);

  // B1: Google commits the original request only after the client gave up and after
  // the retry's files.get said 404. The re-POST reuses the id; Drive answers 409, and
  // the existing file is verified instead of creating a second one.
  const late = await h.createArtifact();
  fake.state.faults.nextUpload = "commit-late";
  await rejects(service.approve({ artifactId: late.artifact.id, expectedSha256: late.hash }), "timeout", "late commit");
  const lateRecord = (await service.listExports(late.artifact.id))[0];
  assert.equal(lateRecord.state, "unknown_remote_outcome");
  assert.equal(filesFor(fake, late.artifact.id).length, 0, "nothing visible yet");
  const conflicts = fake.state.counts.conflicts;
  const lateReceipt = await service.retry(lateRecord.operationId);
  assert.equal(fake.state.counts.conflicts, conflicts + 1, "the re-POST hit the reserved id and was refused with 409");
  assert.equal(filesFor(fake, late.artifact.id).length, 1, "exactly one file exists");
  assert.equal(lateReceipt.driveFileId, filesFor(fake, late.artifact.id)[0].id);

  // Connection reset before Drive stored anything: retry finds 404 and uploads with the same id.
  const reset = await h.createArtifact();
  fake.state.faults.nextUpload = "reset-before-store";
  await rejects(service.approve({ artifactId: reset.artifact.id, expectedSha256: reset.hash }), "network", "reset");
  const resetRecord = (await service.listExports(reset.artifact.id))[0];
  assert.equal(resetRecord.state, "unknown_remote_outcome");
  const resetReserved = (await sqlite.queryOne(sql`SELECT reserved_file_id FROM drive_exports WHERE operation_id = ${resetRecord.operationId};`)).reserved_file_id;
  const resetReceipt = await service.retry(resetRecord.operationId);
  assert.equal(resetReceipt.driveFileId, resetReserved, "the re-POST reused the reserved id");
  assert.equal(filesFor(fake, reset.artifact.id).length, 1);

  // 5xx, dropped connection after storing, and malformed 200 responses all reconcile without a second file.
  for (const fault of ["status:503:backendError", "5xx-after-commit", "drop", "malformed", "missing-id"]) {
    const before = fake.state.counts.uploadPosts;
    const artifact = await h.createArtifact();
    fake.state.faults.nextUpload = fault;
    await assert.rejects(service.approve({ artifactId: artifact.artifact.id, expectedSha256: artifact.hash }));
    const failed = (await service.listExports(artifact.artifact.id))[0];
    assert.equal(failed.state, "unknown_remote_outcome", fault);
    await service.retry(failed.operationId);
    assert.equal(filesFor(fake, artifact.artifact.id).length, 1, `${fault}: one file`);
    const committed = fault !== "status:503:backendError";
    assert.equal(fake.state.counts.uploadPosts, before + (committed ? 1 : 2), `${fault}: a committed upload is never posted again`);
  }

  // Crash after the reserved id was persisted but before the upload: the row is still
  // 'approved' with a reservation. Recovery reads the id (404) and uploads with it once.
  const crashed = await h.createArtifact();
  const crashedOperation = "11111111-2222-4333-8444-555555555555";
  const generated = await h.driveTransport.generateFileId();
  await sqlite.exec(sql`
    INSERT INTO drive_exports (operation_id, artifact_id, content_sha256, file_name, size_bytes, state, reserved_file_id, account_id, account_email, approved_at, updated_at)
    VALUES (${crashedOperation}, ${crashed.artifact.id}, ${crashed.hash}, ${"crash.pdf"}, ${crashed.bytes.length}, ${"approved"}, ${generated}, ${ACCOUNT_A.permissionId}, ${ACCOUNT_A.email}, ${now}, ${now});
  `);
  assert.equal((await service.prepare(crashed.artifact.id)).pendingExport.operationId, crashedOperation);
  const crashPosts = fake.state.counts.uploadPosts;
  const crashReceipt = await h.makeService().retry(crashedOperation);
  assert.equal(fake.state.counts.uploadPosts, crashPosts + 1);
  assert.equal(crashReceipt.driveFileId, generated);

  // Crash after the upload landed (row left 'uploading' with a reservation): a new
  // service instance verifies it without any upload.
  const landed = await h.createArtifact();
  fake.state.faults.nextUpload = "hang";
  await assert.rejects(service.approve({ artifactId: landed.artifact.id, expectedSha256: landed.hash }));
  const landedRecord = (await service.listExports(landed.artifact.id))[0];
  await sqlite.exec(sql`UPDATE drive_exports SET state = ${"uploading"} WHERE operation_id = ${landedRecord.operationId};`);
  const landedPosts = fake.state.counts.uploadPosts;
  await h.makeService().retry(landedRecord.operationId);
  assert.equal(fake.state.counts.uploadPosts, landedPosts, "never a blind re-POST after a crash");
  fake.state.listLag = 0;
}

async function testVerificationFailureAndAbandon(h, rejects) {
  const { fake, service, sqlite, sql } = h;
  // Minor 6: a non-matching copy is recorded with its id and link and is not retryable.
  const digest = await h.createArtifact();
  fake.state.faults.corruptNextUploadSha256 = true;
  const error = await rejects(service.approve({ artifactId: digest.artifact.id, expectedSha256: digest.hash }), "verification_failed", "sha256 mismatch");
  assert.equal(error.retryable, false);
  assert.match(error.message, /does not match your PDF exists in Google Drive/);
  const mismatch = (await service.listExports(digest.artifact.id))[0];
  assert.equal(mismatch.state, "failed");
  assert.ok(mismatch.driveFileId);
  assert.match(mismatch.webViewLink, /^https:\/\/drive\.google\.com\//);
  const posts = fake.state.counts.uploadPosts;
  await rejects(service.retry(mismatch.operationId), "verification_failed", "a mismatched copy cannot be retried as the same operation");
  assert.equal(fake.state.counts.uploadPosts, posts);
  const proposal = await service.prepare(digest.artifact.id);
  assert.equal(proposal.mismatchedCopies.length, 1);
  assert.equal(proposal.pendingExport, null);
  await rejects(service.approve({ artifactId: digest.artifact.id, expectedSha256: digest.hash }), "already_exported", "new upload must be explicit");
  await service.approve({ artifactId: digest.artifact.id, expectedSha256: digest.hash, saveAnotherCopy: true });

  // Minor 7: an unresolved attempt can be abandoned (kept as a record), which unblocks a new upload.
  const stuck = await h.createArtifact();
  fake.state.faults.nextUpload = "status:503:backendError";
  await assert.rejects(service.approve({ artifactId: stuck.artifact.id, expectedSha256: stuck.hash }));
  const pending = (await service.prepare(stuck.artifact.id)).pendingExport;
  await rejects(service.approve({ artifactId: stuck.artifact.id, expectedSha256: stuck.hash, saveAnotherCopy: true }), "export_in_progress", "pending blocks");
  const abandoned = await service.abandon(pending.operationId);
  assert.equal(abandoned.state, "abandoned");
  assert.equal(abandoned.errorCode, "server", "the original outcome is kept for the record");
  await rejects(service.retry(pending.operationId), "invalid_request", "an abandoned attempt is not retried");
  await rejects(service.abandon(pending.operationId), "invalid_request", "abandon is one-way");
  assert.ok((await service.approve({ artifactId: stuck.artifact.id, expectedSha256: stuck.hash })).driveFileId);
  const states = (await service.listExports(stuck.artifact.id)).map((record) => record.state).sort();
  assert.deepEqual(states, ["abandoned", "verified"]);
  const verified = (await service.listExports(stuck.artifact.id)).find((record) => record.state === "verified");
  await rejects(service.abandon(verified.operationId), "invalid_request", "a verified export cannot be abandoned");

  // Minor 8: a journal link restored from an untrusted archive is dropped on read.
  await sqlite.exec(sql`UPDATE drive_exports SET web_view_link = ${"javascript:alert(1)"} WHERE operation_id = ${verified.operationId};`);
  assert.equal((await service.listExports(stuck.artifact.id)).find((record) => record.state === "verified").webViewLink, null);
  await sqlite.exec(sql`UPDATE drive_exports SET web_view_link = ${"https://drive.google.com.evil.test/x"} WHERE operation_id = ${verified.operationId};`);
  assert.equal((await service.retry(verified.operationId)).webViewLink, null);
}

async function testAccountBinding(h, rejects) {
  const { fake, service } = h;
  // Exports made with account A.
  const saved = await h.createArtifact();
  await service.approve({ artifactId: saved.artifact.id, expectedSha256: saved.hash });
  const pendingArtifact = await h.createArtifact();
  fake.state.faults.nextUpload = "status:503:backendError";
  await assert.rejects(service.approve({ artifactId: pendingArtifact.artifact.id, expectedSha256: pendingArtifact.hash }));
  const pendingA = (await service.listExports(pendingArtifact.artifact.id))[0];

  // A review made with A cannot be approved after switching to B (stale renderer request).
  const reviewedWithA = await service.prepare(saved.artifact.id);

  // Reconnect as account B.
  await h.connectAs(ACCOUNT_B);
  const stalePosts = fake.state.counts.uploadPosts;
  await rejects(
    service.approve({ artifactId: saved.artifact.id, expectedSha256: saved.hash, expectedAccountId: reviewedWithA.accountId, saveAnotherCopy: true }),
    "account_mismatch",
    "approve after an account switch",
  );
  assert.equal(fake.state.counts.uploadPosts, stalePosts);
  const proposal = await service.prepare(saved.artifact.id);
  assert.equal(proposal.accountEmail, ACCOUNT_B.email);
  assert.equal(proposal.verifiedExports.length, 0, "A's copy is not shown as saved in B's Drive");
  assert.equal(proposal.otherAccountExports.length, 1);
  assert.equal(proposal.otherAccountExports[0].accountEmail, ACCOUNT_A.email);
  const inB = await service.approve({ artifactId: saved.artifact.id, expectedSha256: saved.hash });
  assert.equal(inB.accountEmail, ACCOUNT_B.email, "A's verified row did not block an export to B");
  assert.equal(fake.state.files.get(inB.driveFileId).owner, ACCOUNT_B.permissionId);

  const otherPending = await service.prepare(pendingArtifact.artifact.id);
  assert.equal(otherPending.pendingExport, null, "A's unresolved attempt does not block B");
  assert.equal(otherPending.otherAccountExports[0].operationId, pendingA.operationId);
  const posts = fake.state.counts.uploadPosts;
  const mismatch = await rejects(service.retry(pendingA.operationId), "account_mismatch", "A's attempt cannot be retried in B");
  assert.match(mismatch.message, new RegExp(ACCOUNT_A.email.replace(".", "\\.")));
  assert.equal(fake.state.counts.uploadPosts, posts, "no upload into the wrong account");
  assert.equal((await service.abandon(pendingA.operationId)).state, "abandoned", "it can be abandoned from B");
}

async function testFolderSerialization(h) {
  const { fake, service } = h;
  // Minor 9: parallel exports on an account without a folder create exactly one folder.
  const ACCOUNT_C = { email: "third@example.test", permissionId: "55555555555555555555" };
  await h.connectAs(ACCOUNT_C);
  const artifacts = [await h.createArtifact(), await h.createArtifact(), await h.createArtifact()];
  const folders = fake.state.counts.folderCreates;
  await Promise.all(artifacts.map((item) => service.approve({ artifactId: item.artifact.id, expectedSha256: item.hash })));
  assert.equal(fake.state.counts.folderCreates, folders + 1, "one Job Ranger folder for concurrent uploads");
  const folderIds = new Set(artifacts.map((item) => filesFor(fake, item.artifact.id)[0].parents[0]));
  assert.equal(folderIds.size, 1);

  // A trashed folder is forgotten and replaced; a deleted one (404 on upload) too.
  const [folderId] = folderIds;
  fake.state.files.get(folderId).trashed = true;
  const afterTrash = await h.createArtifact();
  await service.approve({ artifactId: afterTrash.artifact.id, expectedSha256: afterTrash.hash });
  const newFolder = filesFor(fake, afterTrash.artifact.id)[0].parents[0];
  assert.notEqual(newFolder, folderId);
  assert.equal(fake.state.counts.folderCreates, folders + 2);
  fake.state.files.delete(newFolder);
  const afterDelete = await h.createArtifact();
  await service.approve({ artifactId: afterDelete.artifact.id, expectedSha256: afterDelete.hash });
  assert.equal(filesFor(fake, afterDelete.artifact.id).length, 1);
  assert.equal(fake.state.counts.folderCreates, folders + 3);

  // The folder vanishes between the check and the upload (404 parent): nothing was
  // created, so the folder is rebuilt and the same reserved id is uploaded once more.
  const raced = await h.createArtifact();
  fake.state.faults.nextUpload = "status:404:notFound";
  const racedPosts = fake.state.counts.uploadPosts;
  const racedReceipt = await service.approve({ artifactId: raced.artifact.id, expectedSha256: raced.hash });
  assert.equal(fake.state.counts.uploadPosts, racedPosts + 2);
  assert.equal(filesFor(fake, raced.artifact.id).length, 1);
  assert.equal(filesFor(fake, raced.artifact.id)[0].id, racedReceipt.driveFileId);
}

async function run() {
  const h = await createDriveHarness("drive-recovery");
  const rejects = (promise, code, message) => rejectsWith(assert, promise, code, message);
  try {
    await h.connectAs(ACCOUNT_A);
    await testReservedIdsPreventDuplicates(h, rejects);
    await testVerificationFailureAndAbandon(h, rejects);
    await testAccountBinding(h, rejects);
    await testFolderSerialization(h);
    console.log("Google Drive export recovery tests passed");
  } finally {
    await h.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
