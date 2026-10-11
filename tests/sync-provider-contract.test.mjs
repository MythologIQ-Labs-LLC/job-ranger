import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertApprovedSnapshotUpload,
  assertApprovedSnapshotPrune,
  assertSnapshotListQuery,
} from "../src/shared/snapshot-sync.ts";

const SHA = "a".repeat(64);
const now = "2026-10-11T16:00:00.000Z";
const archivedAt = "2026-10-09T16:00:00.000Z";

function upload() {
  return {
    snapshot: {
      fileName: "job-ranger-2026-10-11.jobranger",
      bytes: new Blob(["archive contents"]),
      sha256Hex: SHA,
      sourceCreatedAt: archivedAt,
      validated: true,
      format: { id: "job-ranger-portable-archive", version: 1 },
    },
    approval: {
      kind: "explicit_share_snapshot",
      transactionId: "tx:0001",
      confirmedAt: now,
      approvedSha256Hex: SHA,
      approvedByteLength: 16,
      disclosureVersion: "drive-snapshot-v1",
      destinationLabel: "Job Ranger backups in my Google Drive",
    },
  };
}

function prune() {
  const selected = [
    { providerId: "google-drive", remoteId: "id_1", parentFolderId: "folder-A", name: "a.jobranger", byteLength: 5, createdAt: now, sha256Hex: SHA, verified: true },
    { providerId: "google-drive", remoteId: "id_2", parentFolderId: "folder-A", name: "b.jobranger", byteLength: 5, createdAt: now, sha256Hex: SHA, verified: true },
  ];
  return {
    preview: { folderId: "folder-A", selected, observedAt: now },
    approval: {
      kind: "explicit_delete_these_snapshots",
      transactionId: "tx:0002",
      confirmedAt: now,
      approvedFolderId: "folder-A",
      approvedRemoteIds: ["id_1", "id_2"],
    },
  };
}

test("valid selected archive and exact separate human approval satisfy structural guard", () => {
  const request = upload();
  request.approval.approvedByteLength = request.snapshot.bytes.size;
  assert.doesNotThrow(() => assertApprovedSnapshotUpload(request, Date.parse(now)));
});

test("new agent snapshot format remains intentionally possible until issue 255 chooses one", () => {
  const request = upload();
  request.snapshot.fileName = "job-ranger-agent-2026-10-11.json";
  request.snapshot.format = { id: "candidate-agent-format", version: 1 };
  request.approval.approvedByteLength = request.snapshot.bytes.size;
  assert.doesNotThrow(() => assertApprovedSnapshotUpload(request, Date.parse(now)));
});

test("upload consent is bound to exact source digest and byte count", () => {
  const request = upload();
  request.approval.approvedByteLength = request.snapshot.bytes.size;
  for (const mutation of [
    (r) => { r.snapshot.sha256Hex = "b".repeat(64); },
    (r) => { r.approval.approvedSha256Hex = "b".repeat(64); },
    (r) => { r.approval.approvedByteLength += 1; },
    (r) => { r.approval.kind = "not_approved"; },
    (r) => { r.approval.transactionId = ""; },
    (r) => { r.approval.destinationLabel = " "; },
    (r) => { r.snapshot.validated = false; },
    (r) => { r.snapshot.bytes = new Blob([]); },
    (r) => { r.snapshot.fileName = "../private.jobranger"; },
    (r) => { r.snapshot.fileName = "bad\\name.jobranger"; },
    (r) => { r.snapshot.sourceCreatedAt = "2026-02-30T12:00:00Z"; },
    (r) => { r.snapshot.format.version = 0; },
    (r) => { r.snapshot.format.id = " "; },
  ]) {
    const modified = upload();
    modified.approval.approvedByteLength = modified.snapshot.bytes.size;
    mutation(modified);
    assert.throws(() => assertApprovedSnapshotUpload(modified, Date.parse(now)));
  }
});

test("only exact selected, same-parent remote snapshots may be pruned", () => {
  assert.doesNotThrow(() => assertApprovedSnapshotPrune(prune(), Date.parse(now)));
  for (const mutation of [
    (r) => { r.approval.kind = "not_approved"; },
    (r) => { r.approval.approvedFolderId = "folder-B"; },
    (r) => { r.preview.selected[1].parentFolderId = "folder-B"; },
    (r) => { r.approval.approvedRemoteIds.push("id_3"); },
    (r) => { r.approval.approvedRemoteIds[1] = "id_other"; },
    (r) => { r.preview.selected[1].remoteId = "id_1"; },
    (r) => { r.preview.selected = []; },
    (r) => { r.preview.observedAt = "not a time"; },
    (r) => { r.approval.transactionId = ""; },
  ]) {
    const modified = prune();
    mutation(modified);
    assert.throws(() => assertApprovedSnapshotPrune(modified, Date.parse(now)));
  }
});

test("approval is time-bound and cannot be replayed later or from the future", () => {
  const x = upload();
  x.approval.approvedByteLength = x.snapshot.bytes.size;
  assert.throws(() => assertApprovedSnapshotUpload(x, Date.parse(now) + 5 * 60_000 + 1), /fresh approval/i);
  assert.throws(() => assertApprovedSnapshotUpload(x, Date.parse(now) - 1), /fresh approval/i);
});

test("prune needs both a fresh preview and a fresh user decision, in that order", () => {
  const x = prune();
  assert.throws(() => assertApprovedSnapshotPrune(x, Date.parse(now) + 5 * 60_000 + 1), /approval/i);
  x.preview.observedAt = "2026-10-11T16:00:01.000Z";
  assert.throws(() => assertApprovedSnapshotPrune(x, Date.parse(now) + 1000), /approval/i);
});

test("provider listing is bounded and requires opaque cursor validation", () => {
  assert.doesNotThrow(() => assertSnapshotListQuery({ limit: 100, nextPageToken: null }));
  assert.doesNotThrow(() => assertSnapshotListQuery({ limit: 1, nextPageToken: "opaque:cursor" }));
  for (const query of [
    { limit: 0, nextPageToken: null },
    { limit: 101, nextPageToken: null },
    { limit: 0.5, nextPageToken: null },
    { limit: 5, nextPageToken: "" },
    { limit: 5, nextPageToken: "x".repeat(2049) },
  ]) {
    assert.throws(() => assertSnapshotListQuery(query));
  }
});
