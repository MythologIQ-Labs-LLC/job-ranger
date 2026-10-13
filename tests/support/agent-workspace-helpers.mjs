// Builders for synthetic agent workspace batches and commit markers (#286).
import { createHash } from "node:crypto";

const encoder = new TextEncoder();
export const bytesOf = (value) => encoder.encode(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function makeOperation(fields) {
  return {
    operation_id: fields.operation_id,
    record_id: fields.record_id,
    base_revision: fields.base_revision ?? null,
    previous_operation_id: fields.previous_operation_id ?? null,
    authored_at: fields.authored_at,
    kind: fields.kind,
    payload: fields.payload,
  };
}

export function makeBatch({ batchId, actorId, createdAt, previousBatchId = null, operations, exportId, manifestSha256, workspaceId = "workspace_synthetic_01" }) {
  return {
    format: "jr-agent-operation-batch",
    schema_version: 1,
    workspace_id: workspaceId,
    batch_id: batchId,
    source_export_id: exportId,
    source_manifest_sha256: manifestSha256,
    actor_claim: { actor_id: actorId, display_name: `${actorId} (untrusted identity claim)` },
    created_at: createdAt,
    previous_batch_id: previousBatchId,
    operations,
  };
}

/** A submission as discovered in a local (or later Drive) workspace folder. */
export function makeSubmission(batch, { attachments = {}, withCommit = true, commitOverrides = {}, rawBatch = null } = {}) {
  const batchBytes = rawBatch ? bytesOf(rawBatch) : bytesOf(batch);
  const actor = batch?.actor_claim?.actor_id ?? "unknown_actor";
  const batchId = batch?.batch_id ?? "batch_unknown";
  const attachmentEntries = Object.entries(attachments).map(([path, { declared, actual, mediaType = "application/pdf" }]) => ({
    path,
    media_type: mediaType,
    bytes: declared.length,
    sha256: sha256(declared),
    actualBytes: actual,
  }));
  const commit = {
    format: "jr-agent-batch-commit",
    schema_version: 1,
    batch_id: batchId,
    batch_sha256: sha256(batchBytes),
    batch_bytes: batchBytes.length,
    attachments: attachmentEntries.map(({ path, media_type, bytes, sha256: digest }) => ({ path, media_type, bytes, sha256: digest })),
    ...commitOverrides,
  };
  return {
    location: `workspace/agents/${actor}/batches/${batchId}.json`,
    batchBytes,
    commitBytes: withCommit ? bytesOf(commit) : null,
    attachments: Object.fromEntries(attachmentEntries.filter((a) => a.actualBytes).map((a) => [a.path, a.actualBytes])),
  };
}
