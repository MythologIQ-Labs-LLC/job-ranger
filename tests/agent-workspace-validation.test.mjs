// Agent workspace (#286): closed, versioned operation-batch validation with useful diagnostics.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseOperationBatch, parseCommitMarker, LIMITS } from "../src/agent-workspace/index.ts";
import { bytesOf, makeBatch, makeOperation } from "./support/agent-workspace-helpers.mjs";

const example = readFileSync(new URL("../docs/design/examples/jr-agent-60-day-batch.synthetic.json", import.meta.url));
const ok = parseOperationBatch(new Uint8Array(example));
assert.equal(ok.ok, true, JSON.stringify(ok.diagnostics));
assert.equal(ok.batch.operations.length, 3);

const codes = (result) => result.ok ? [] : result.diagnostics.map((d) => d.code);
const expectCode = (input, code, message) => {
  const result = parseOperationBatch(typeof input === "string" ? bytesOf(input) : input instanceof Uint8Array ? input : bytesOf(input));
  assert.equal(result.ok, false, `${message}: expected rejection`);
  assert.ok(codes(result).includes(code), `${message}: expected ${code}, got ${codes(result).join(", ")}`);
  assert.ok(result.diagnostics.every((d) => typeof d.message === "string" && d.message.length > 0 && typeof d.path === "string"));
};

const base = () => makeBatch({
  batchId: "batch_valid_001",
  actorId: "agent_alpha",
  createdAt: "2026-10-20T10:00:00Z",
  exportId: "ex_synthetic_day0",
  manifestSha256: "a".repeat(64),
  operations: [makeOperation({
    operation_id: "op_valid_001",
    record_id: "agent_note_valid",
    authored_at: "2026-10-20T09:00:00Z",
    kind: "workspace_note_version",
    payload: { title: "Note", body: "Body" },
  })],
});
assert.equal(parseOperationBatch(bytesOf(base())).ok, true);

expectCode('{"format":"jr-agent-operation-batch","format":"x"}', "duplicate_key", "duplicate JSON keys");
expectCode(new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf(base())]), "bom_present", "UTF-8 BOM");
expectCode(new Uint8Array([...bytesOf(base()).slice(0, 20), 0xc3, 0x28, ...bytesOf(base()).slice(20)]), "invalid_utf8", "invalid UTF-8");
expectCode("{not json", "invalid_json", "malformed JSON");
expectCode("[]", "invalid_type", "non-object envelope");
expectCode({ ...base(), schema_version: 2 }, "unsupported_schema_version", "future major version");
expectCode({ ...base(), format: "jr-agent-proposal" }, "unsupported_format", "wrong format");
expectCode({ ...base(), approved: true }, "unknown_field", "unknown top-level field");
{
  const batch = base();
  batch.operations[0].user_approved = true;
  expectCode(batch, "unknown_field", "self-asserted approval on an operation");
}
{
  const batch = base();
  batch.operations[0] = makeOperation({ operation_id: "op_gate_001", record_id: "agent_material_x", authored_at: "2026-10-20T09:00:00Z", kind: "material_draft_version", payload: { material_kind: "resume", title: "R", body: "B", source_evidence_refs: [], gate_status: "pass" } });
  expectCode(batch, "invalid_value", "agent-asserted Truth Gate PASS");
}
{
  const batch = base();
  batch.operations[0].kind = "delete_record";
  expectCode(batch, "unknown_kind", "unsupported operation kind");
}
{
  const batch = base();
  batch.operations[0].kind = "application_status_claim";
  batch.operations[0].payload = { application_id: "app_harbor_001", claimed_status: "verified_submitted", reported_context: "x" };
  expectCode(batch, "invalid_value", "status outside the claim enum");
}
{
  const batch = base();
  batch.operations[0].payload.body = "x".repeat(50001);
  expectCode(batch, "too_long", "oversized field");
}
{
  const batch = base();
  delete batch.operations[0].payload.title;
  expectCode(batch, "missing_field", "missing required field");
}
{
  const batch = base();
  batch.operations[0].operation_id = "op with spaces";
  expectCode(batch, "invalid_format", "bad operation id");
}
{
  const batch = base();
  batch.created_at = "2026-10-20 10:00:00Z";
  expectCode(batch, "invalid_format", "non-UTC timestamp");
}
{
  const batch = base();
  batch.operations[0].payload.source_links = ["javascript:alert(1)"];
  expectCode(batch, "invalid_format", "non-https link");
}
{
  const batch = base();
  batch.operations.push({ ...batch.operations[0] });
  expectCode(batch, "duplicate_operation_id", "duplicate operation IDs inside one batch");
}
{
  const batch = base();
  batch.operations = Array.from({ length: 101 }, (_, i) => ({ ...batch.operations[0], operation_id: `op_many_${i}` }));
  expectCode(batch, "too_many_items", "more than 100 operations");
}
expectCode({ ...base(), operations: [] }, "too_few_items", "empty batch");
expectCode(new Uint8Array(LIMITS.maxBatchBytes + 1).fill(0x20), "too_large", "oversized batch file");
expectCode("[".repeat(100) + "]".repeat(100), "depth_exceeded", "excessive nesting");
{
  const batch = base();
  batch.workspace_id = 7;
  expectCode(batch, "invalid_type", "wrong field type");
}
for (const kind of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
  const batch = base();
  batch.operations[0].kind = kind;
  expectCode(batch, "unknown_kind", `prototype-named kind ${kind}`);
}
expectCode(JSON.stringify(base()).replace('"title"', '"__proto__":{"polluted":1},"title"'), "unknown_field", "__proto__ key in a payload");
assert.equal({}.polluted, undefined, "Object.prototype is never modified");

// Commit markers bind the batch bytes and declared attachments.
const marker = parseCommitMarker(bytesOf({ format: "jr-agent-batch-commit", schema_version: 1, batch_id: "batch_valid_001", batch_sha256: "b".repeat(64), batch_bytes: 10, attachments: [{ path: "workspace/attachments/abc/draft.pdf", media_type: "application/pdf", bytes: 5, sha256: "c".repeat(64) }] }));
assert.equal(marker.ok, true, JSON.stringify(marker.diagnostics));
for (const badPath of ["../escape.pdf", "workspace/attachments/../../x.pdf", "/abs.pdf", "workspace\\attachments\\x.pdf", "workspace/attachments/x.exe", "workspace/attachments/%2e%2e/x.pdf"]) {
  const bad = parseCommitMarker(bytesOf({ format: "jr-agent-batch-commit", schema_version: 1, batch_id: "batch_valid_001", batch_sha256: "b".repeat(64), batch_bytes: 10, attachments: [{ path: badPath, media_type: "application/pdf", bytes: 5, sha256: "c".repeat(64) }] }));
  assert.equal(bad.ok, false, `attachment path ${badPath} must be rejected`);
}
const html = parseCommitMarker(bytesOf({ format: "jr-agent-batch-commit", schema_version: 1, batch_id: "batch_valid_001", batch_sha256: "b".repeat(64), batch_bytes: 10, attachments: [{ path: "workspace/attachments/abc/x.html", media_type: "text/html", bytes: 5, sha256: "c".repeat(64) }] }));
assert.equal(html.ok, false, "executable/HTML attachment types are rejected");

console.log("agent-workspace validation tests passed");
