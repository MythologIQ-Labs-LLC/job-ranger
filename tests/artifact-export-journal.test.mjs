import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { advanceExportReceipt } from "../src/shared/artifact-export-approval.ts";
import { advanceDurableExport, blocksFreshArtifactExport, recoveryDecision, reserveExport, validateJournalRecord } from "../electron-runtime/src/shared/artifact-export-journal.js";

const sha = createHash("sha256").update("resume").digest("hex");
const instant = "2026-10-15T15:00:00.000Z";
const record = {
  schemaVersion: 1, operationId: "op:1", approvalId: "approval:1",
  accountId: "account:1", destinationId: "folder:1", artifactId: "resume:1",
  artifactRevision: "rev:1", bytesSha256: sha, fileName: "resume.pdf",
  mimeType: "application/pdf", status: "prepared", remoteId: null,
  verifiedSha256: null, updatedAt: instant,
};
function store() {
  const operations = new Map();
  return {
    async insertIfAbsent(r) {
      if (operations.has(r.operationId) || [...operations.values()].some(v => v.approvalId === r.approvalId)) return false;
      operations.set(r.operationId, structuredClone(r));
      return true;
    },
    async compareAndSwap(id, expected, next) {
      const old = operations.get(id);
      if (!old || old.status !== expected) return false;
      operations.set(id, structuredClone(next));
      return true;
    },
    async findOperation(id) { return operations.get(id) ?? null; },
    async findApproval(id) { return [...operations.values()].find(v => v.approvalId === id) ?? null; },
  };
}
const receipt = (r, status, remoteId = null, observed = null) =>
  advanceExportReceipt({
    operationId: r.operationId, proposalId: "prop:1", status: r.status,
    bytesSha256: r.bytesSha256, remoteId: r.remoteId, verifiedSha256: r.verifiedSha256,
  }, status, remoteId, observed);

describe("durable artifact export journal contract", () => {
  it("rejects forged completed states and malformed identifiers", () => {
    assert.doesNotThrow(() => validateJournalRecord(record));
    assert.throws(() => validateJournalRecord({ ...record, status: "verified" }), /matching remote readback/);
    assert.throws(() => validateJournalRecord({ ...record, verifiedSha256: sha }), /Only a verified/);
    assert.throws(() => validateJournalRecord({ ...record, status: "accepted_unverified", remoteId: "file:1", verifiedSha256: sha }), /Only a verified/);
    assert.throws(() => validateJournalRecord({ ...record, remoteId: "folder/escape" }), /Invalid durable/);
    assert.throws(() => validateJournalRecord({ ...record, updatedAt: "yesterday" }), /Invalid durable/);
  });
  it("reserves approval and operation once and never uploads on duplicate", async () => {
    const db = store();
    await reserveExport(db, record);
    await assert.rejects(reserveExport(db, record), /already associated/);
    await assert.rejects(reserveExport(db, { ...record, operationId: "op:2" }), /already associated/);
  });
  it("requires atomic compare-and-swap on each state advancement", async () => {
    const db = store();
    await reserveExport(db, record);
    const uploading = await advanceDurableExport(db, record, receipt(record, "uploading"), "2026-10-15T15:00:01.000Z");
    await assert.rejects(
      advanceDurableExport(db, record, receipt(record, "uploading"), "2026-10-15T15:00:02.000Z"), /Concurrent/,
    );
    const accepted = await advanceDurableExport(db, uploading, receipt(uploading, "accepted_unverified", "file:1"), "2026-10-15T15:00:03.000Z");
    assert.equal(recoveryDecision(accepted).action, "reconcile_remote");
    const verified = await advanceDurableExport(db, accepted, receipt(accepted, "verified", "file:1", sha), "2026-10-15T15:00:04.000Z");
    assert.equal(recoveryDecision(verified).action, "complete");
  });
  it("never retries blindly after an ambiguous upload", async () => {
    const db = store();
    await reserveExport(db, record);
    const uploading = await advanceDurableExport(db, record, receipt(record, "uploading"), "2026-10-15T15:00:01.000Z");
    const unknown = await advanceDurableExport(db, uploading, receipt(uploading, "unknown_remote_outcome"), "2026-10-15T15:00:02.000Z");
    assert.deepEqual(recoveryDecision(unknown).action, "reconcile_remote");
    await assert.rejects(advanceDurableExport(db, unknown, {
      ...receipt(record, "uploading"), status: "uploading",
    }, "2026-10-15T15:00:03.000Z"), /Invalid export transition/);
  });
  it("blocks new same-artifact approvals after a crash, but not unrelated exports", () => {
    for (const status of ["prepared", "uploading", "accepted_unverified",
      "unknown_remote_outcome", "verification_failed"]) {
      const remoteId = status === "accepted_unverified" || status === "verification_failed"
        ? "googleFile:1" : null;
      const pending = { ...record, status, remoteId };
      assert.equal(blocksFreshArtifactExport(pending, record.accountId, record.artifactId),
        true, status);
      assert.equal(blocksFreshArtifactExport(pending, "account:other", record.artifactId),
        false, "another Google account must not be blocked");
      assert.equal(blocksFreshArtifactExport(pending, record.accountId, "resume:other"),
        false, "another saved resume must not be blocked");
      assert.equal(blocksFreshArtifactExport(
        { ...pending, artifactRevision: "rev:2" }, record.accountId, record.artifactId,
      ), true, "a changed revision does not erase remote uncertainty");
    }
    for (const status of ["cancelled", "failed"]) {
      assert.equal(blocksFreshArtifactExport(
        { ...record, status }, record.accountId, record.artifactId,
      ), false, "definitive local terminal result does not block a fresh consent");
    }
    assert.equal(blocksFreshArtifactExport(
      { ...record, status: "verified", remoteId: "googleFile:1", verifiedSha256: sha },
      record.accountId, record.artifactId,
    ), false, "a verified past upload allows a separately approved new copy");
    assert.throws(() => blocksFreshArtifactExport(
      { ...record, status: "garbage" }, record.accountId, record.artifactId,
    ), /Invalid durable/, "corrupted journal must fail closed");
  });

  it("rejects stale timestamps and missing persisted transactions", async () => {
    const db = store();
    await assert.rejects(advanceDurableExport(db, record, receipt(record, "uploading"), instant), /Concurrent/);
    await reserveExport(db, record);
    await assert.rejects(advanceDurableExport(db, record, receipt(record, "uploading"), "2026-10-15T14:59:59.000Z"), /timestamp/);
  });
});
