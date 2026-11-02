import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { advanceExportReceipt } from "../src/shared/artifact-export-approval.ts";
import {
  advanceDurableExport, blocksFreshArtifactExport, checkJournalTransition, recoveryDecision,
  reserveExport, upgradeJournalRecord, validateJournalRecord,
} from "../electron-runtime/src/shared/artifact-export-journal.js";

const sha = createHash("sha256").update("resume").digest("hex");
const instant = "2026-10-15T15:00:00.000Z";
const record = {
  schemaVersion: 2, operationId: "op:1", approvalId: "approval:1",
  accountId: "account:1", destinationId: "folder:1", artifactId: "resume:1",
  artifactRevision: "rev:1", bytesSha256: sha, fileName: "resume.pdf",
  mimeType: "application/pdf", status: "prepared", reservedFileId: "reservedFile1",
  remoteId: null, verifiedSha256: null, resolution: null, updatedAt: instant,
};
/** A schema-v1 row as PR #315 wrote it before reserved file IDs existed. */
const v1 = (patch = {}) => {
  const { reservedFileId: _r, resolution: _s, ...rest } = record;
  return { ...rest, schemaVersion: 1, ...patch };
};
/** In-memory store that, like the IndexedDB store, enforces checkJournalTransition. */
function store() {
  const operations = new Map();
  return {
    operations,
    async insertIfAbsent(r) {
      if (operations.has(r.operationId) || [...operations.values()].some(v => v.approvalId === r.approvalId)) return false;
      operations.set(r.operationId, structuredClone(r));
      return true;
    },
    async compareAndSwap(id, expected, next) {
      const raw = operations.get(id);
      if (!raw) return false;
      const old = upgradeJournalRecord(raw);
      if (old.status !== expected) return false;
      try { checkJournalTransition(old, next); } catch { return false; }
      operations.set(id, structuredClone(next));
      return true;
    },
    async findOperation(id) { return operations.has(id) ? upgradeJournalRecord(operations.get(id)) : null; },
    async findApproval(id) {
      const raw = [...operations.values()].find(v => v.approvalId === id);
      return raw ? upgradeJournalRecord(raw) : null;
    },
  };
}
const receipt = (r, status, remoteId = null, observed = null, resolution = null) =>
  advanceExportReceipt({
    operationId: r.operationId, proposalId: "prop:1", status: r.status,
    bytesSha256: r.bytesSha256, remoteId: r.remoteId, verifiedSha256: r.verifiedSha256,
  }, status, remoteId, observed, resolution);
const at = (seconds) => new Date(Date.parse(instant) + seconds * 1000).toISOString();

describe("durable artifact export journal contract", () => {
  it("a POST Google definitively rejected is recorded failed and does not block a new approval (#315 M1)", async () => {
    const db = store();
    await reserveExport(db, record);
    const uploading = await advanceDurableExport(db, record, receipt(record, "uploading"), at(1));
    assert.equal(blocksFreshArtifactExport(uploading, record.accountId, record.artifactId), true, "an in-flight upload blocks");
    const failed = await advanceDurableExport(db, uploading, receipt(uploading, "failed", null, null, "provider_rejected"), at(2));
    assert.equal(failed.status, "failed");
    assert.equal(failed.resolution, "provider_rejected");
    assert.equal(blocksFreshArtifactExport(failed, record.accountId, record.artifactId), false, "a definitive rejection must not block forever");
    await reserveExport(db, { ...record, operationId: "op:retry", approvalId: "approval:retry", reservedFileId: "reservedFile2" });
  });

  it("an ambiguous POST is cleared only by a confirmed 404 of its reserved Drive file ID", async () => {
    const db = store();
    await reserveExport(db, record);
    const uploading = await advanceDurableExport(db, record, receipt(record, "uploading"), at(1));
    const unknown = await advanceDurableExport(db, uploading, receipt(uploading, "unknown_remote_outcome"), at(2));
    assert.equal(blocksFreshArtifactExport(unknown, record.accountId, record.artifactId), true);
    assert.deepEqual(recoveryDecision(unknown), {
      action: "reconcile_remote", remoteId: null, reservedFileId: "reservedFile1",
      reason: "Read the reserved Drive file ID before any new POST.",
    });
    // A provider rejection cannot explain an ambiguous outcome after the fact.
    assert.throws(() => receipt(unknown, "failed", null, null, "provider_rejected"), /proof/);
    await assert.rejects(advanceDurableExport(db, unknown, {
      operationId: unknown.operationId, proposalId: "prop:1", status: "failed",
      bytesSha256: unknown.bytesSha256, remoteId: null, verifiedSha256: null, resolution: null,
    }, at(3)), /proof/);
    // Storage refuses a forged direct write too.
    assert.equal(await db.compareAndSwap(unknown.operationId, "unknown_remote_outcome",
      { ...unknown, status: "failed", resolution: "provider_rejected", updatedAt: at(3) }), false);
    const failed = await advanceDurableExport(db, unknown,
      receipt(unknown, "failed", null, null, "reserved_id_absent"), at(3));
    assert.equal(failed.resolution, "reserved_id_absent");
    assert.equal(failed.reservedFileId, "reservedFile1");
    assert.equal(blocksFreshArtifactExport(failed, record.accountId, record.artifactId), false);
    assert.equal(recoveryDecision(failed).action, "no_upload");
    // The crash-before-POST case: a row left in "uploading" is cleared the same way.
    const crash = { ...record, operationId: "op:crash", approvalId: "approval:crash", reservedFileId: "reservedFile3" };
    await reserveExport(db, crash);
    const stuck = await advanceDurableExport(db, crash, receipt(crash, "uploading"), at(1));
    const cleared = await advanceDurableExport(db, stuck, receipt(stuck, "failed", null, null, "reserved_id_absent"), at(2));
    assert.equal(cleared.status, "failed");
  });

  it("a found reserved file is verified under the reserved ID only", async () => {
    const db = store();
    await reserveExport(db, record);
    const uploading = await advanceDurableExport(db, record, receipt(record, "uploading"), at(1));
    const unknown = await advanceDurableExport(db, uploading, receipt(uploading, "unknown_remote_outcome"), at(2));
    await assert.rejects(advanceDurableExport(db, unknown, receipt(unknown, "accepted_unverified", "otherFile"), at(3)), /reserved Drive file ID/);
    const accepted = await advanceDurableExport(db, unknown, receipt(unknown, "accepted_unverified", "reservedFile1"), at(3));
    const verified = await advanceDurableExport(db, accepted, receipt(accepted, "verified", "reservedFile1", sha), at(4));
    assert.equal(verified.status, "verified");
    assert.equal(recoveryDecision(verified).action, "complete");
  });

  it("an upload cannot start without a journaled reserved Drive file ID", async () => {
    await assert.rejects(reserveExport(store(), { ...record, reservedFileId: null }), /reserved Drive file ID/);
    // An upgraded v1 prepared row (no reservation) may be cancelled but never uploaded.
    const db = store();
    const legacy = v1();
    db.operations.set(legacy.operationId, legacy);
    const upgraded = await db.findOperation(legacy.operationId);
    assert.equal(upgraded.reservedFileId, null);
    await assert.rejects(advanceDurableExport(db, upgraded, receipt(upgraded, "uploading"), at(1)), /Reserve and journal/);
    assert.equal(await db.compareAndSwap(legacy.operationId, "prepared", { ...upgraded, status: "uploading", updatedAt: at(1) }), false);
    const cancelled = await advanceDurableExport(db, upgraded, receipt(upgraded, "cancelled"), at(1));
    assert.equal(cancelled.schemaVersion, 2);
    assert.equal(db.operations.get(legacy.operationId).schemaVersion, 2, "a v1 row is rewritten as v2 on its next transition");
  });

  it("v1 rows still load, keep blocking, and are cleared only by explicit abandonment", async () => {
    for (const status of ["prepared", "uploading", "unknown_remote_outcome"]) {
      const upgraded = upgradeJournalRecord(v1({ status }));
      assert.equal(upgraded.schemaVersion, 2);
      assert.equal(upgraded.reservedFileId, null);
      assert.equal(upgraded.resolution, null);
      assert.equal(blocksFreshArtifactExport(upgraded, record.accountId, record.artifactId), true, status);
    }
    const accepted = upgradeJournalRecord(v1({ status: "accepted_unverified", remoteId: "legacyFile" }));
    assert.equal(accepted.remoteId, "legacyFile");
    const verified = upgradeJournalRecord(v1({ status: "verified", remoteId: "legacyFile", verifiedSha256: sha }));
    assert.equal(blocksFreshArtifactExport(verified, record.accountId, record.artifactId), false);
    // v1 "failed" was only ever written for a definitive provider rejection.
    assert.equal(upgradeJournalRecord(v1({ status: "failed" })).resolution, "provider_rejected");
    assert.equal(upgradeJournalRecord(v1({ status: "cancelled" })).resolution, null);
    // Corrupt or mixed rows fail closed.
    assert.throws(() => upgradeJournalRecord(v1({ status: "garbage" })), /Invalid durable/);
    assert.throws(() => upgradeJournalRecord({ ...v1(), reservedFileId: "x" }), /Invalid durable/);
    assert.throws(() => upgradeJournalRecord({ ...record, schemaVersion: 3 }), /Invalid durable/);
    assert.throws(() => upgradeJournalRecord(null), /Invalid durable/);

    const db = store();
    const legacy = v1({ status: "unknown_remote_outcome" });
    db.operations.set(legacy.operationId, legacy);
    const loaded = await db.findOperation(legacy.operationId);
    // Without a reserved ID nothing can prove absence: failed is refused.
    await assert.rejects(advanceDurableExport(db, loaded, receipt(loaded, "failed", null, null, "reserved_id_absent"), at(1)),
      /reserved Drive file ID can prove/);
    assert.equal(await db.compareAndSwap(legacy.operationId, "unknown_remote_outcome",
      { ...loaded, status: "failed", resolution: "reserved_id_absent", updatedAt: at(1) }), false);
    assert.throws(() => receipt(loaded, "abandoned"), /explicit user/);
    assert.equal(await db.compareAndSwap(legacy.operationId, "unknown_remote_outcome",
      { ...loaded, status: "abandoned", resolution: null, updatedAt: at(1) }), false);
    const abandoned = await advanceDurableExport(db, loaded, receipt(loaded, "abandoned", null, null, "user_abandoned"), at(1));
    assert.equal(abandoned.status, "abandoned");
    assert.equal(abandoned.resolution, "user_abandoned");
    assert.equal(blocksFreshArtifactExport(abandoned, record.accountId, record.artifactId), false);
    assert.equal(recoveryDecision(abandoned).action, "no_upload");
    assert.throws(() => receipt(abandoned, "verified", "x", sha), /transition/);
    assert.equal(await db.compareAndSwap(legacy.operationId, "abandoned",
      { ...abandoned, status: "cancelled", resolution: null, updatedAt: at(2) }), false);
  });

  it("rejects forged completed states, mismatched resolutions and malformed identifiers", () => {
    assert.doesNotThrow(() => validateJournalRecord(record));
    assert.throws(() => validateJournalRecord({ ...record, schemaVersion: 1 }), /Invalid durable/, "v1 must go through upgradeJournalRecord");
    assert.throws(() => validateJournalRecord({ ...record, status: "verified" }), /matching remote readback/);
    assert.throws(() => validateJournalRecord({ ...record, verifiedSha256: sha }), /Only a verified/);
    assert.throws(() => validateJournalRecord({ ...record, status: "accepted_unverified", remoteId: "reservedFile1", verifiedSha256: sha }), /Only a verified/);
    assert.throws(() => validateJournalRecord({ ...record, remoteId: "folder/escape" }), /Invalid durable/);
    assert.throws(() => validateJournalRecord({ ...record, reservedFileId: "a:b" }), /Invalid durable/);
    assert.throws(() => validateJournalRecord({ ...record, updatedAt: "yesterday" }), /Invalid durable/);
    assert.throws(() => validateJournalRecord({ ...record, status: "accepted_unverified", remoteId: "other" }), /reserved Drive file ID/);
    assert.throws(() => validateJournalRecord({ ...record, status: "failed" }), /resolution disagree/);
    assert.throws(() => validateJournalRecord({ ...record, status: "failed", resolution: "user_abandoned" }), /resolution disagree/);
    assert.throws(() => validateJournalRecord({ ...record, status: "abandoned" }), /resolution disagree/);
    assert.throws(() => validateJournalRecord({ ...record, status: "cancelled", resolution: "provider_rejected" }), /resolution disagree/);
    assert.throws(() => validateJournalRecord({ ...record, resolution: "bogus" }), /Invalid durable/);
    assert.throws(() => validateJournalRecord({ ...record, status: "failed", resolution: "reserved_id_absent", reservedFileId: null }), /can prove/);
    assert.doesNotThrow(() => validateJournalRecord({ ...record, status: "abandoned", resolution: "user_abandoned" }));
  });

  it("the reserved file ID and identity are immutable across transitions", () => {
    const uploading = { ...record, status: "uploading", updatedAt: at(1) };
    assert.doesNotThrow(() => checkJournalTransition(record, uploading));
    assert.throws(() => checkJournalTransition(record, { ...uploading, reservedFileId: "swapped" }), /identity/);
    assert.throws(() => checkJournalTransition(record, { ...uploading, fileName: "other.pdf" }), /identity/);
    assert.throws(() => checkJournalTransition(record, { ...uploading, updatedAt: "2026-10-15T14:00:00.000Z" }), /timestamp/);
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
    const uploading = await advanceDurableExport(db, record, receipt(record, "uploading"), at(1));
    await assert.rejects(advanceDurableExport(db, record, receipt(record, "uploading"), at(2)), /Concurrent/);
    const accepted = await advanceDurableExport(db, uploading, receipt(uploading, "accepted_unverified", "reservedFile1"), at(3));
    assert.equal(recoveryDecision(accepted).action, "reconcile_remote");
    const verified = await advanceDurableExport(db, accepted, receipt(accepted, "verified", "reservedFile1", sha), at(4));
    assert.equal(recoveryDecision(verified).action, "complete");
  });

  it("cancels only a prepared reservation and refuses racing upload transitions", async () => {
    const db = store();
    await reserveExport(db, record);
    const uploading = await advanceDurableExport(db, record, receipt(record, "uploading"), at(1));
    await assert.rejects(advanceDurableExport(db, record, receipt(record, "cancelled"), at(2)), /Concurrent/);
    assert.equal((await db.findOperation(record.operationId)).status, "uploading");
    assert.throws(() => receipt(uploading, "cancelled"), /Invalid export transition/);
    await assert.rejects(
      advanceDurableExport(db, uploading, {
        operationId: uploading.operationId, proposalId: "prop:1", status: "cancelled",
        bytesSha256: uploading.bytesSha256, remoteId: null, verifiedSha256: null,
      }, at(2)), /Invalid export transition/,
    );
    const unused = { ...record, operationId: "unused:2", approvalId: "approval:2", reservedFileId: "reservedFile9" };
    await reserveExport(db, unused);
    const cancelled = await advanceDurableExport(db, unused, receipt(unused, "cancelled"), at(1));
    assert.equal(cancelled.status, "cancelled");
    assert.equal(blocksFreshArtifactExport(cancelled, unused.accountId, unused.artifactId), false);
    await assert.rejects(advanceDurableExport(db, unused, receipt(unused, "uploading"), at(2)), /Concurrent/);
  });

  it("never retries blindly after an ambiguous upload", async () => {
    const db = store();
    await reserveExport(db, record);
    const uploading = await advanceDurableExport(db, record, receipt(record, "uploading"), at(1));
    const unknown = await advanceDurableExport(db, uploading, receipt(uploading, "unknown_remote_outcome"), at(2));
    assert.deepEqual(recoveryDecision(unknown).action, "reconcile_remote");
    await assert.rejects(advanceDurableExport(db, unknown, {
      ...receipt(record, "uploading"), status: "uploading",
    }, at(3)), /Invalid export transition/);
  });

  it("blocks new same-artifact approvals after a crash, but not unrelated exports", () => {
    for (const status of ["prepared", "uploading", "accepted_unverified",
      "unknown_remote_outcome", "verification_failed"]) {
      const remoteId = status === "accepted_unverified" || status === "verification_failed"
        ? "reservedFile1" : null;
      const pending = { ...record, status, remoteId };
      assert.equal(blocksFreshArtifactExport(pending, record.accountId, record.artifactId), true, status);
      assert.equal(blocksFreshArtifactExport(pending, "account:other", record.artifactId),
        false, "another Google account must not be blocked");
      assert.equal(blocksFreshArtifactExport(pending, record.accountId, "resume:other"),
        false, "another saved resume must not be blocked");
      assert.equal(blocksFreshArtifactExport(
        { ...pending, artifactRevision: "rev:2" }, record.accountId, record.artifactId,
      ), true, "a changed revision does not erase remote uncertainty");
    }
    for (const [status, resolution] of [["cancelled", null], ["failed", "provider_rejected"],
      ["failed", "reserved_id_absent"], ["abandoned", "user_abandoned"]]) {
      assert.equal(blocksFreshArtifactExport(
        { ...record, status, resolution }, record.accountId, record.artifactId,
      ), false, "definitive local terminal result does not block a fresh consent");
    }
    assert.equal(blocksFreshArtifactExport(
      { ...record, status: "verified", remoteId: "reservedFile1", verifiedSha256: sha },
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
