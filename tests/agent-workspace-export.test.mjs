// Agent workspace (#285/#286): deterministic, selective, receipt-backed local export.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createAgentExport,
  parseStrictJson,
  decodeStrictUtf8,
  validateExportManifest,
  verifyExportPacket,
  AgentWorkspaceError,
} from "../src/agent-workspace/index.ts";

const fixtureUrl = new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url);
const schemaDir = new URL("../docs/design/schemas/", import.meta.url);
const deepFreeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
const loadSnapshot = () => JSON.parse(readFileSync(fixtureUrl, "utf8"));
const schemaDocuments = [
  "jr-agent-operation-batch-v1.schema.json",
  "jr-agent-proposal-v1.schema.json",
].map((name) => ({ path: `schema/${name}`, text: readFileSync(new URL(name, schemaDir), "utf8") }));

const request = {
  exportId: "ex_synthetic_day0",
  createdAt: "2026-10-13T16:30:00Z",
  build: "test-build-0001",
  scopes: ["tracks", "confirmed_evidence", "selected_opportunities", "resume_templates", "selected_resumes", "selected_cover_letters"],
  selectedJobIds: ["job_selected_001"],
  selectedResumeIds: ["resume_ops_001"],
  selectedCoverLetterIds: ["material_cl_001"],
  schemaDocuments,
};

// --- strict JSON primitives ---------------------------------------------------
assert.throws(() => parseStrictJson('{"a":1,"a":2}'), (e) => e instanceof AgentWorkspaceError && e.code === "duplicate_key");
assert.throws(() => parseStrictJson('{"a":1,}'), (e) => e.code === "invalid_json");
assert.throws(() => parseStrictJson("[".repeat(80) + "]".repeat(80)), (e) => e.code === "depth_exceeded");
assert.throws(() => parseStrictJson('{"n": 9007199254740993}'), (e) => e.code === "number_out_of_range");
assert.throws(() => decodeStrictUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), (e) => e.code === "bom_present");
assert.throws(() => decodeStrictUtf8(new Uint8Array([0x7b, 0xff, 0x7d])), (e) => e.code === "invalid_utf8");
const polluted = parseStrictJson('{"__proto__": {"polluted": true}}');
assert.equal(Object.getPrototypeOf(polluted), null, "parsed objects carry no prototype");
assert.equal({}.polluted, undefined, "Object.prototype is never modified");

// --- export determinism and purity -------------------------------------------
const snapshot = deepFreeze(loadSnapshot());
const before = JSON.stringify(snapshot);
const first = await createAgentExport(snapshot, request);
const second = await createAgentExport(snapshot, request);
assert.equal(JSON.stringify(snapshot), before, "exporter never modifies canonical data");
assert.equal(first.manifestSha256, second.manifestSha256, "same canonical input yields the same manifest digest");
assert.deepEqual([...first.manifestBytes], [...second.manifestBytes]);

// --- manifest structure and file integrity ------------------------------------
const manifest = parseStrictJson(decodeStrictUtf8(first.manifestBytes));
assert.deepEqual(validateExportManifest(manifest), [], "generated manifest satisfies the closed v1 envelope");
assert.equal(manifest.export_id, "ex_synthetic_day0");
assert.equal(manifest.source_revision, "local-rev-2026-10-13-0001");
assert.ok(manifest.selection.excluded_by_default.includes("application_private_notes"));
assert.ok(manifest.selection.excluded_by_default.includes("credentials"));
assert.ok(manifest.files.every((f) => f.bytes > 0 && /^[a-f0-9]{64}$/.test(f.sha256)));
const byPath = new Map(first.files.map((f) => [f.path, f]));
assert.deepEqual(manifest.files.map((f) => f.path), [...byPath.keys()].sort());
assert.deepEqual(await verifyExportPacket({ manifestBytes: first.manifestBytes, files: byPath, receipt: first.receipt }), []);

// Receipt: locally trusted record of what was exported.
assert.equal(first.receipt.format, "jr-agent-export-receipt");
assert.equal(first.receipt.manifest_sha256, first.manifestSha256);
assert.equal(first.receipt.record_revisions.ev_confirmed_scheduling, "2026-09-02T12:00:00.000Z");
assert.equal(first.receipt.record_revisions.ev_imported_unreviewed, undefined);

// Tampering is detected against the local receipt, not the remote manifest's own claims.
const tamperedFiles = new Map(byPath);
const evidenceFile = byPath.get("data/confirmed-evidence.json");
const flipped = new Uint8Array(evidenceFile.bytes);
flipped[flipped.length - 3] ^= 1;
tamperedFiles.set(evidenceFile.path, { ...evidenceFile, bytes: flipped });
assert.ok((await verifyExportPacket({ manifestBytes: first.manifestBytes, files: tamperedFiles, receipt: first.receipt }))
  .some((d) => d.code === "file_digest_mismatch" && d.path === "data/confirmed-evidence.json"));
const forgedManifest = new TextEncoder().encode(decodeStrictUtf8(first.manifestBytes).replace("test-build-0001", "test-build-9999"));
assert.ok((await verifyExportPacket({ manifestBytes: forgedManifest, files: byPath, receipt: first.receipt }))
  .some((d) => d.code === "manifest_digest_mismatch"));
const missingFiles = new Map(byPath);
missingFiles.delete("data/selected-opportunities.json");
assert.ok((await verifyExportPacket({ manifestBytes: first.manifestBytes, files: missingFiles, receipt: first.receipt }))
  .some((d) => d.code === "file_missing"));

// --- minimisation: only selected, authoritative-or-labelled content -----------
const text = (path) => decodeStrictUtf8(byPath.get(path).bytes);
const json = (path) => parseStrictJson(text(path));
const everything = first.files.map((f) => new TextDecoder().decode(f.bytes)).join("\n");
for (const forbidden of ["PRIVATE:", "synthetic.person@example.invalid", "+1-555-0100", "Synthetic Person", "job_unselected_002", "ev_imported_unreviewed", "ev_rejected_claim", "Licensed registered nurse", "radiusMiles", "radius_miles", "fullName", "full_name"]) {
  assert.ok(!everything.includes(forbidden), `export must not contain ${forbidden}`);
}

const evidence = json("data/confirmed-evidence.json");
assert.equal(evidence.record_type, "confirmed_evidence_collection");
assert.deepEqual(evidence.records.map((r) => [r.record_id, r.authority_state]), [
  ["ev_authored_insurance", "user_authored"],
  ["ev_confirmed_scheduling", "confirmed"],
]);
const scheduling = evidence.records.find((r) => r.record_id === "ev_confirmed_scheduling");
assert.equal(scheduling.revision, "2026-09-02T12:00:00.000Z");
assert.equal(scheduling.provenance.sources[0].source_artifact_id, "artifact_resume_2025");
assert.equal(scheduling.provenance.sources[0].relation, "extracted");

const opportunities = json("data/selected-opportunities.json");
assert.deepEqual(opportunities.records.map((r) => r.record_id), ["job_selected_001"]);
assert.equal(opportunities.records[0].authority_state, "observed_external");
assert.equal(opportunities.records[0].content_trust, "untrusted_external_text");
assert.ok(opportunities.records[0].data.description_snippet.includes("IGNORE PREVIOUS INSTRUCTIONS"), "untrusted text is carried as data, labelled, never acted on");

const tracks = json("data/target-tracks.json");
assert.deepEqual(tracks.records.map((r) => r.record_id), ["track_ops_001"]);
assert.equal(tracks.records[0].authority_state, "user_defined");

const resumes = json("data/selected-resumes.json");
assert.equal(resumes.records[0].record_id, "resume_ops_001");
assert.equal(resumes.records[0].data.contact, undefined, "resume contact identity is excluded by default");
assert.deepEqual(resumes.records[0].data.statements[0].evidence_refs, [{ record_id: "ev_confirmed_scheduling", revision: "2026-09-02T12:00:00.000Z" }]);
const gates = json("data/gate-reports.json");
assert.deepEqual(gates.records.map((r) => [r.record_id, r.data.truth_gate.passed, r.data.parseability_gate.passed]), [["gate_resume_ops_001", true, true]]);
assert.equal(gates.records[0].authority_state, "job_ranger_deterministic_result");

const letters = json("data/selected-cover-letters.json");
assert.equal(letters.records[0].record_id, "material_cl_001");
assert.equal(letters.records[0].stale, false);
assert.deepEqual(letters.records[0].data.sections[1].evidence_refs, [{ record_id: "ev_confirmed_scheduling", revision: "2026-09-02T12:00:00.000Z" }]);

const templates = json("data/resume-templates.json");
assert.deepEqual(templates.records.map((r) => r.record_id), ["ats-compact-v1", "ats-standard-v1"]);

for (const record of [...evidence.records, ...opportunities.records, ...tracks.records, ...resumes.records, ...letters.records]) {
  for (const key of ["record_id", "record_type", "schema_version", "revision", "authority_state", "provenance"]) {
    assert.ok(key in record, `${record.record_id} carries ${key}`);
  }
}

const guide = text("materials/agent-guide.md");
assert.ok(guide.includes("NOT CHECKED"));
assert.ok(guide.includes("ex_synthetic_day0"));
assert.ok(byPath.has("schema/jr-agent-operation-batch-v1.schema.json"));
assert.equal(byPath.get("schema/jr-agent-operation-batch-v1.schema.json").role, "schema");

// Generated JSON is UTF-8 without BOM, LF only, newline-terminated.
for (const file of first.files.filter((f) => f.mediaType === "application/json")) {
  const decoded = decodeStrictUtf8(file.bytes);
  assert.ok(!decoded.includes("\r") && decoded.endsWith("\n"), `${file.path} uses LF`);
}

// --- selection is explicit -----------------------------------------------------
const narrow = await createAgentExport(snapshot, { ...request, exportId: "ex_synthetic_narrow", scopes: ["confirmed_evidence"], selectedJobIds: [], selectedResumeIds: [], selectedCoverLetterIds: [] });
const narrowPaths = narrow.files.map((f) => f.path);
assert.ok(narrowPaths.includes("data/confirmed-evidence.json"));
assert.ok(!narrowPaths.some((p) => p.includes("opportunities") || p.includes("resumes") || p.includes("cover-letters") || p.includes("tracks")));
await assert.rejects(createAgentExport(snapshot, { ...request, selectedJobIds: ["job_does_not_exist"] }), (e) => e.code === "unknown_selection");
await assert.rejects(createAgentExport(snapshot, { ...request, exportId: "not-an-export-id" }), (e) => e.code === "invalid_export_id");

console.log("agent-workspace export tests passed");
