import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { advanceExportReceipt, ExportApprovalLedger, validateApprovedArtifactExport, validateExportProposal } from "../src/shared/artifact-export-approval.ts";

const now = Date.parse("2026-10-15T15:00:00.000Z");
const blob = new Blob(["verified draft"]);
const hash = createHash("sha256").update("verified draft").digest("hex");
const proposal = {
  proposalId: "prop:1", artifactId: "resume:1", artifactRevision: "rev:2",
  fileName: "Resume.pdf", mimeType: "application/pdf", bytesSha256: hash,
  byteLength: blob.size, providerId: "google-drive",
  accountId: "account:1", approvedDestinationId: "folder:1",
  destinationLabel: "Job Ranger", expiresAt: new Date(now + 60_000).toISOString(),
};
const approval = {
  kind: "explicit_export_artifact", approvalId: "approval:1", proposalId: "prop:1",
  confirmedAt: new Date(now).toISOString(), approvedDigest: hash,
  approvedAccountId: "account:1", approvedDestinationId: "folder:1",
};
const sha256 = async file => createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
const invalid = (patch, pattern) =>
  assert.throws(() => validateExportProposal({ ...proposal, ...patch }, now), pattern);

describe("Google Drive artifact export, local-only security contract", () => {
  it("accepts a bounded, immutable proposed PDF", () => {
    assert.doesNotThrow(() => validateExportProposal(proposal, now));
  });
  it("rejects path traversal, controls, wrong types, too-large and expired proposals", () => {
    invalid({ fileName: "../Resume.pdf" }, /filename/);
    invalid({ fileName: "bad\\name.pdf" }, /filename/);
    invalid({ fileName: "resume.pdf\u0000" }, /filename/);
    invalid({ fileName: "resume.txt" }, /format/);
    invalid({ mimeType: "text/html" }, /format/);
    invalid({ byteLength: 0 }, /proposal/);
    invalid({ byteLength: 60 * 1024 * 1024 }, /proposal/);
    invalid({ accountId: "" }, /proposal/);
    invalid({ approvedDestinationId: "folder/evil" }, /proposal/);
    invalid({ expiresAt: new Date(now - 1).toISOString() }, /Expired/);
    invalid({ expiresAt: new Date(now + 60 * 60_000).toISOString() }, /Expired/);
  });
  it("checks exact user-approved bytes, account, destination, digest, and freshness", async () => {
    await validateApprovedArtifactExport(proposal, approval, blob, now, sha256);
    for (const patch of [
      { approvedAccountId: "account:2" }, { approvedDestinationId: "folder:2" },
      { approvedDigest: "0".repeat(64) }, { proposalId: "prop:2" },
      { confirmedAt: new Date(now - 180_000).toISOString() },
    ]) {
      await assert.rejects(validateApprovedArtifactExport(proposal, { ...approval, ...patch }, blob, now, sha256), /approval/);
    }
    await assert.rejects(validateApprovedArtifactExport(proposal, approval, new Blob(["changed draft!"]), now, sha256), /approval|changed/);
    await assert.rejects(validateApprovedArtifactExport(proposal, approval, blob, now, async () => "f".repeat(64)), /changed/);
  });
  it("consumes approval only once per in-memory lifecycle", () => {
    const ledger = new ExportApprovalLedger();
    ledger.consume(approval);
    assert.throws(() => ledger.consume(approval), /already consumed/);
  });
  it("requires an actual remote identity and matching readback before verified status", () => {
    const receipt = { operationId: "op:1", proposalId: "prop:1", status: "prepared",
      bytesSha256: hash, remoteId: null, verifiedSha256: null };
    const uploading = advanceExportReceipt(receipt, "uploading");
    assert.throws(() => advanceExportReceipt(uploading, "verified", "file:1", hash), /transition/);
    assert.throws(() => advanceExportReceipt(uploading, "accepted_unverified"), /file ID/);
    const accepted = advanceExportReceipt(uploading, "accepted_unverified", "file:1");
    assert.throws(() => advanceExportReceipt(accepted, "verified", "file:1", "0".repeat(64)), /digest/);
    assert.throws(() => advanceExportReceipt(accepted, "verified", "file:2", hash), /identity/);
    const verified = advanceExportReceipt(accepted, "verified", "file:1", hash);
    assert.equal(verified.status, "verified");
    assert.throws(() => advanceExportReceipt(verified, "uploading"), /transition/);
  });
  it("ambiguous upload outcomes cannot automatically return to uploading", () => {
    const receipt = { operationId: "op:1", proposalId: "prop:1", status: "uploading",
      bytesSha256: hash, remoteId: null, verifiedSha256: null };
    const unknown = advanceExportReceipt(receipt, "unknown_remote_outcome");
    assert.throws(() => advanceExportReceipt(unknown, "uploading"), /reconciliation/);
  });
});
