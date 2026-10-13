// Independent audit corpus (audit/286-agent-schema-adversarial-corpus @ 57a4097) translated
// onto the real v2 implementation (#286 G3, #289). The audit's semantic expectations are kept;
// only serialization changes deliberately, as recorded per case:
// - batches are jr-agent-operation-batch v2 with the trusted workspace ID and a real receipt;
// - the completion marker is jr-agent-batch-commit v1 (D01), not jr-agent-batch-complete;
// - attachments are per-draft payload.attachments matched to the marker inventory (D02),
//   not a top-level list plus attachment_sha256;
// - agent-owned revisions carry base_revision null and chain by previous_operation_id (D04);
// - the evidence proposal is an explicit "correction" with its base revision (D05).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createAgentExport,
  decodeStrictUtf8,
  operationEligibility,
  parseOperationBatch,
  parseStrictJson,
  reconcileWorkspace,
} from "../src/agent-workspace/index.ts";
import { bytesOf, makeSubmission, sha256, WORKSPACE_ID } from "./support/agent-workspace-helpers.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const corpus = read("tests/fixtures/agent-workspace/governance-vectors.v1.json");
const golden = read("tests/fixtures/agent-workspace/long-gap-reconciliation.v1.json");
const fixture = read("tests/fixtures/agent-workspace/canonical-snapshot.synthetic.json");
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------------------
// A. Strict JSON (audit tests/agent-workspace-strict-json.test.mjs) on the real parser.
{
  const rejects = (input, code) => assert.throws(() => (input instanceof Uint8Array ? parseStrictJson(decodeStrictUtf8(input)) : parseStrictJson(input)), (e) => e.code === code, `${String(input).slice(0, 40)} -> ${code}`);
  const back = String.fromCharCode(92);
  assert.deepEqual(plain(parseStrictJson('{"format":"jr-agent-operation-batch","payload":{"notes":["résumé","🎓"],"count":3,"active":false,"nullable":null}}')).payload.notes, ["résumé", "🎓"]);
  rejects('{"status":"proposed","status":"confirmed"}', "duplicate_key");
  rejects('{"agent":{"status":"proposed","status":"approved"}}', "duplicate_key");
  rejects(`{"status":"proposed","st${back}u0061tus":"approved"}`, "duplicate_key"); // escaped duplicate
  assert.deepEqual(plain(parseStrictJson('[{"id":1},{"id":2}]')), [{ id: 1 }, { id: 2 }]);
  rejects('{"x":1,}', "invalid_json");
  rejects('{"x":1 /*x*/}', "invalid_json");
  rejects(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "bom_present");
  rejects(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), "invalid_utf8");
  rejects(`"${back}ud800"`, "invalid_string");
  rejects(`"${back}udc00"`, "invalid_string");
  rejects(`"${String.fromCharCode(0xd800)}"`, "invalid_string"); // raw lone surrogate in a handed-in string
  rejects(`"${String.fromCharCode(0xdc00)}x"`, "invalid_string");
  assert.equal(parseStrictJson(`"${back}ud83c${back}udf93"`), "🎓");
  rejects("[".repeat(65) + "0" + "]".repeat(65), "depth_exceeded");
  rejects('{"bytes":1e400}', "number_out_of_range");
  rejects('{"bytes":9007199254740993}', "number_out_of_range");
  // Prototype-named keys: the parser keeps them as inert own data on prototype-free objects;
  // the closed batch format then refuses them. Either way nothing is polluted or accepted.
  const proto = parseStrictJson(`{"${back}u005f_proto__":{"approved":true}}`);
  assert.equal(Object.getPrototypeOf(proto), null);
  assert.equal({}.approved, undefined);
  const example = read("docs/design/examples/jr-agent-60-day-batch.v2.synthetic.json");
  for (const key of [`${back}u005f_proto__`, "constructor", "__proto__"]) {
    const text = JSON.stringify(example).replace('"format"', `"${key}":{"approved":true},"format"`);
    const parsed = parseOperationBatch(new TextEncoder().encode(text));
    assert.equal(parsed.ok, false, key);
    assert.ok(parsed.diagnostics.some((d) => d.code === "unknown_field"), key);
  }
  // Differential fuzz: 1,500 valid nested values parse exactly as JSON.parse does.
  let state = 0x12345678;
  const rnd = () => ((state ^= state << 13, state ^= state >>> 17, state ^= state << 5) >>> 0) / 4294967296;
  const chars = ["abc", '"', back, "\n", "🌐", "💼", "é", "✓", "/", "\t", "\b", "\r", "\0", "123", "alpha"];
  const randomString = () => Array.from({ length: Math.floor(rnd() * 12) }, () => chars[Math.floor(rnd() * chars.length)]).join("");
  const value = (depth) => {
    if (depth > 5) return rnd() > 0.5 ? randomString() : Math.floor(rnd() * 10000);
    switch (Math.floor(rnd() * 6)) {
      case 0: return rnd() > 0.5;
      case 1: return null;
      case 2: return Math.floor(rnd() * 100000);
      case 3: return randomString();
      case 4: return Array.from({ length: Math.floor(rnd() * 6) }, () => value(depth + 1));
      default: return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 7) }, (_, i) => [`key${i}${randomString()}`, value(depth + 1)]));
    }
  };
  for (let i = 0; i < 1500; i += 1) {
    const json = JSON.stringify(value(0));
    assert.equal(JSON.stringify(parseStrictJson(json)), JSON.stringify(JSON.parse(json)), `fuzz case ${i}`);
  }
}

// ---------------------------------------------------------------------------------------
// Canonical data: the synthetic fixture plus the audit's evidence_example_001.
const withAuditEvidence = (statement) => {
  const snap = structuredClone(fixture);
  const template = structuredClone(snap.evidence.find((e) => e.evidence.id === "ev_confirmed_scheduling"));
  template.evidence = { ...template.evidence, id: "evidence_example_001", statement, updatedAt: "2026-10-01T00:00:00.000Z" };
  snap.evidence.push(template);
  return snap;
};
const canonicalAtExport = withAuditEvidence("Coordinated scheduling for a fictional clinic.");
const canonicalAtReturn = withAuditEvidence("Coordinated scheduling and referrals for a fictional clinic.");
const exported = await createAgentExport(canonicalAtExport, { exportId: "ex_synthetic_first_setup", workspaceId: WORKSPACE_ID, createdAt: "2026-10-13T00:00:00Z", build: "audit-translation", scopes: ["confirmed_evidence"], selectedJobIds: [], selectedResumeIds: [], selectedCoverLetterIds: [], schemaDocuments: [] });
const receipts = [exported.receipt];
const tokenAtExport = exported.receipt.record_revisions.evidence_example_001;
assert.match(tokenAtExport, /^evrev1:/);

// ---------------------------------------------------------------------------------------
// B. Governance vectors: 31 cases on the v2 base sample.
{
  const base = read("docs/design/examples/jr-agent-60-day-batch.v2.synthetic.json");
  base.source_manifest_sha256 = exported.manifestSha256;
  base.operations[1].payload.source_evidence_refs[0].revision = tokenAtExport;
  const pdf = new Uint8Array(800).fill(0x25);
  const pdfRef = { path: "workspace/attachments/document/cover-letter.pdf", media_type: "application/pdf", bytes: 800, sha256: sha256(pdf) };
  const policy = { autoImportKinds: ["workspace_note_version", "material_draft_version"] };

  function mutate(source, item) {
    const target = structuredClone(source);
    if (item.op === "raw_duplicate_format_key") return JSON.stringify(target).replace('"format":"jr-agent-operation-batch"', '"format":"jr-agent-operation-batch","format":"jr-agent-operation-batch"');
    const keys = item.path.split("/").slice(1);
    // D02 translation: top-level attachments and attachment_sha256 become per-draft references.
    if (keys[0] === "attachments") {
      // The audit's placeholder digest "c…c" stands for the declared PDF; use its real digest.
      target.operations[1].payload.attachments = item.value.map((a) => ({ ...a, path: `workspace/${a.path}`, ...(a.sha256 === "c".repeat(64) ? { sha256: pdfRef.sha256 } : {}) }));
      return target;
    }
    if (keys.at(-1) === "attachment_sha256") {
      if (!target.operations[1].payload.attachments) target.operations[1].payload.attachments = [{ ...pdfRef, sha256: item.value }];
      return target;
    }
    let parent = target;
    for (const key of keys.slice(0, -1)) parent = parent[key];
    const key = keys.at(-1);
    if (item.op === "remove") delete parent[key];
    else parent[key] = item.op === "replace_repeat" ? item.value.repeat(item.count) : item.value;
    return target;
  }

  const run = async (batch, { attachments = {}, withMarker = true } = {}) => {
    const submission = makeSubmission(typeof batch === "string" ? null : batch, { rawBatch: typeof batch === "string" ? batch : null, attachments, withCommit: withMarker });
    if (typeof batch === "string") submission.location = `workspace/agents/${base.actor_claim.actor_id}/batches/${base.batch_id}.json`;
    return reconcileWorkspace({ workspaceId: WORKSPACE_ID, receipts, canonical: canonicalAtExport, policy, ledger: null, submissions: [submission] });
  };
  const outcome = (r, index, sourceBatch) => r.report.operations.find((o) => o.operation_id === sourceBatch.operations[index].operation_id)?.outcome;
  const nothingImportedBeyond = (r, allowed) => r.drafts.every((d) => allowed.includes(d.operation_id));
  const baseline = await run(base);
  assert.equal(baseline.report.batches[0].status, "accepted");

  const expectations = {
    "valid-baseline-mixed": async (b, r) => {
      assert.equal(outcome(r, 0, b), "imported_draft");
      assert.equal(outcome(r, 1, b), "imported_draft");
      assert.equal(outcome(r, 2, b), "staged_for_review", "a valid submitted claim is only staged");
    },
    "untrusted-instruction-as-data": async (b, r) => {
      assert.equal(outcome(r, 0, b), "imported_draft");
      assert.ok(r.drafts.every((d) => d.authority === "agent_draft" && d.gate_status === "not_checked"), "inert draft, no elevation");
    },
    "claimed-other-agent-identity": async (b, r) => {
      assert.equal(r.report.batches[0].actor_claim, "trusted_job_ranger_operator");
      assert.ok([...r.drafts, ...r.staged].every((d) => d.authority === "agent_draft" || d.authority === "agent_proposal"), "a claimed identity grants nothing");
      assert.equal(outcome(r, 2, b), "staged_for_review");
    },
    "fake-but-structurally-valid-manifest": async (_b, r) => {
      assert.equal(r.report.batches[0].status, "rejected");
      assert.ok(r.report.batches[0].reasons.includes("source_manifest_mismatch"));
    },
    "unknown-canonical-evidence-revision": async (b, r) => {
      assert.equal(outcome(r, 1, b), "needs_rebase");
      assert.ok(r.staged.some((s) => s.operation_id === b.operations[1].operation_id), "text preserved");
    },
    "duplicate-op-id-in-batch": async (_b, r) => {
      assert.equal(r.report.batches[0].status, "rejected");
      assert.ok(r.report.batches[0].reasons.includes("duplicate_operation_id"));
    },
    "impossible-predecessor": async (b, r) => {
      assert.equal(outcome(r, 0, b), "pending_predecessor");
      assert.ok(nothingImportedBeyond(r, [b.operations[1].operation_id]));
    },
    "same-record-double-root": async (b, r) => {
      // Two roots of one record (here also two kinds): neither silently overwrites the other.
      for (const i of [0, 1]) assert.equal(outcome(r, i, b), "rejected");
      assert.equal(r.quarantine.filter((q) => q.kind === "operation").length, 2, "both writes preserved");
    },
    "future-clock-skew": async (b, r) => {
      assert.deepEqual(r.report.operations.map((o) => [o.operation_id, o.outcome]), baseline.report.operations.map((o) => [o.operation_id, o.outcome]), "wall-clock time never changes the outcome");
      void b;
    },
    "application-status-claim": async (b, r) => {
      assert.equal(outcome(r, 2, b), "staged_for_review");
      assert.ok(!r.drafts.some((d) => d.kind === "application_status_claim"));
    },
    "safe-attachment-reference": async (_b, r) => {
      // Declared, schema-valid PDF but no bytes uploaded: held, never imported.
      assert.equal(r.report.batches[0].status, "incomplete");
      assert.ok(r.report.batches[0].reasons.includes("attachment_missing"));
      assert.equal(r.drafts.length, 0);
    },
    "orphan-material-attachment": async (_b, r) => {
      assert.equal(r.report.batches[0].status, "rejected");
      assert.ok(r.report.batches[0].reasons.includes("attachment_reference_mismatch"));
    },
  };
  // Cases whose serialization changes with the v2 layout, and how.
  const translated = {
    "attachment-name-conflict": "v2 refuses two references to one path structurally (duplicate_item); the audit expected a reconcile-time rejection. Both outcomes refuse the batch.",
    "duplicate-op-id-in-batch": "The executable validator refuses duplicate operation IDs while parsing; JSON Schema alone cannot.",
    "safe-attachment-reference": "Marker inventory carries the declared digest; bytes are absent.",
  };

  let checked = 0;
  for (const c of corpus.cases) {
    const batch = c.mutations.reduce((acc, m) => mutate(acc, m), base);
    const bytes = typeof batch === "string" ? new TextEncoder().encode(batch) : bytesOf(batch);
    const parsed = parseOperationBatch(bytes);
    const structural = c.expect_structure === "reject" || c.id === "attachment-name-conflict" || c.id === "duplicate-op-id-in-batch";
    if (structural) {
      assert.equal(parsed.ok, false, `${c.id}: must be refused structurally (${translated[c.id] ?? c.reason})`);
      // The reconciler refuses the same bytes and preserves them in quarantine.
      const r = await run(batch);
      assert.equal(r.report.batches[0].status, "rejected", c.id);
      assert.equal(r.drafts.length + r.staged.length, 0, c.id);
      assert.ok(r.quarantine.some((q) => q.kind === "batch" && q.bytes?.length), `${c.id}: bytes preserved`);
    } else {
      assert.equal(parsed.ok, true, `${c.id}: ${JSON.stringify(parsed.diagnostics)}`);
      const declaredOnly = c.id === "safe-attachment-reference";
      const attachments = declaredOnly ? { [pdfRef.path]: { declared: pdf, actual: null } } : {};
      const r = await run(batch, { attachments });
      assert.ok(expectations[c.id], `${c.id}: no translated expectation`);
      await expectations[c.id](batch, r);
    }
    checked += 1;
  }
  assert.equal(checked, 31);
  assert.equal(corpus.cases.length, 31);
}

// ---------------------------------------------------------------------------------------
// C. 60-day long-gap oracle on the real reconciler: 256 listing permutations and 64 split
// discoveries across two persisted syncs (restart between them).
const day = (n) => new Date(Date.parse("2026-10-13T12:00:00Z") + n * 86_400_000).toISOString().replace(".000Z", "Z");
function compile(events) {
  const lastBatch = new Map();
  const firstDay = new Map();
  return events.map((event, index) => {
    if (!firstDay.has(event.operation_id)) firstDay.set(event.operation_id, event.day);
    const payload = structuredClone(event.payload);
    let baseRevision = null; // D04: agent-owned and claims chain by predecessor only
    for (const ref of payload.source_evidence_refs ?? []) if (ref.revision === "revision_initial_001") ref.revision = tokenAtExport;
    if (event.kind === "evidence_change_proposal") {
      payload.proposal_kind = "correction"; // D05: the audit proposal changes existing evidence
      baseRevision = tokenAtExport;
    }
    const operation = { operation_id: event.operation_id, record_id: event.record_id, base_revision: baseRevision, previous_operation_id: event.previous_operation_id, authored_at: day(firstDay.get(event.operation_id)), kind: event.kind, payload };
    const batch = {
      format: "jr-agent-operation-batch", schema_version: 2, workspace_id: WORKSPACE_ID, batch_id: `batch_${String(index + 1).padStart(4, "0")}_${event.agent}`,
      source_export_id: exported.receipt.export_id, source_manifest_sha256: exported.manifestSha256,
      actor_claim: { actor_id: event.agent, display_name: `Synthetic agent ${event.agent}` }, created_at: day(event.day),
      previous_batch_id: lastBatch.get(event.agent) ?? null, operations: [operation],
    };
    lastBatch.set(event.agent, batch.batch_id);
    return { event, batch, submission: makeSubmission(batch) };
  });
}
{
  const compiled = compile(golden.events);
  assert.equal(compiled.length, golden.expected.event_count);
  const policy = { autoImportKinds: ["workspace_note_version", "opportunity_annotation", "material_draft_version"] };
  const canonicalBefore = JSON.stringify(canonicalAtReturn);
  const reconcile = (submissions, ledger) => reconcileWorkspace({ workspaceId: WORKSPACE_ID, receipts, canonical: canonicalAtReturn, policy, ledger, submissions });
  const persist = (ledger) => JSON.parse(JSON.stringify(ledger));
  const allVariants = new Set(compiled.map(({ batch }) => `${batch.operations[0].operation_id}`));

  const effective = (ledger) => Object.fromEntries(Object.entries(ledger.operations).map(([id, e]) => [id, {
    eligible: operationEligibility(ledger, id).eligible,
    contest: e.contest,
    variants: e.variants,
    cls: e.outcome === "needs_rebase" ? "needs_rebase" : ["application_status_claim", "evidence_change_proposal"].includes(e.kind) ? "review" : "draft",
  }]).sort(([a], [b]) => (a < b ? -1 : 1)));

  // Oracle verdicts, checked against the real outcome.
  const verify = (ledger, preserved, label) => {
    const eff = effective(ledger);
    for (const { event } of compiled) {
      const e = eff[event.operation_id];
      assert.ok(e, `${label}: ${event.operation_id} must be recorded`);
      switch (event.expected) {
        case "import_draft": assert.equal(e.eligible, true, `${label}: ${event.operation_id}`); break;
        case "conflict_preserve_fork": assert.ok(!e.eligible && e.contest.includes("fork"), `${label}: ${event.operation_id} fork`); break;
        case "preserve_draft_needs_rebase": assert.equal(e.cls, "needs_rebase", `${label}: ${event.operation_id}`); break;
        case "reject_operation_id_collision": assert.ok(!e.eligible && e.contest.includes("operation_id_conflict") && e.variants.length === 2, `${label}: collision`); break;
        case "import_plan_proposal": assert.ok(!e.eligible && e.cls === "draft", `${label}: plan staged`); break;
        case "stage_attestation_required":
        case "stage_canonical_review": assert.ok(!e.eligible && e.cls !== "draft", `${label}: ${event.operation_id} consequential`); break;
        default: assert.fail(`unmapped verdict ${event.expected}`);
      }
    }
    assert.equal(Object.values(eff).filter((e) => e.eligible).length, golden.expected.accepted_drafts_only, `${label}: accepted drafts`);
    // No valid agent work is lost: every distinct (operation, content) pair was preserved somewhere.
    const submitted = new Set(compiled.map(({ batch }) => `${batch.operations[0].operation_id}|${JSON.stringify(batch.operations[0])}`));
    assert.equal(preserved.size, submitted.size, `${label}: preserved variants`);
    void allVariants;
  };
  const collect = (preserved, result) => {
    for (const x of [...result.drafts, ...result.staged]) preserved.add(`${x.operation_id}|${JSON.stringify({ operation_id: x.operation_id, record_id: x.record_id, base_revision: x.base_revision, previous_operation_id: x.previous_operation_id, authored_at: x.authored_at, kind: x.kind, payload: x.payload })}`);
    for (const x of result.contested) preserved.add(`${x.operation_id}|${JSON.stringify(x.operation)}`);
  };

  const single = await reconcile(compiled.map((c) => c.submission), null);
  const singlePreserved = new Set();
  collect(singlePreserved, single);
  verify(single.ledger, singlePreserved, "single run");
  assert.equal(single.report.duplicates.length, 1, "byte-identical replay is a no-op duplicate");
  const reference = JSON.stringify(effective(single.ledger));

  let state = 0x286f00d;
  const rand = () => ((state ^= state << 13, state ^= state >>> 17, state ^= state << 5) >>> 0) / 4294967296;
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const r = await reconcile(shuffle(compiled.map((c) => c.submission)), null);
    assert.equal(JSON.stringify(effective(r.ledger)), reference, `listing permutation ${attempt}`);
    assert.deepEqual(r.report, single.report, `report permutation ${attempt}`);
  }
  // Split discovery: some files are listed on the first sync, all on the second, with a
  // restart (persisted ledger) between. Late conflicts must reach the same final state.
  let lateDowngrades = 0;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const order = shuffle(compiled.map((c) => c.submission));
    const cut = 1 + Math.floor(rand() * (order.length - 1));
    const first = await reconcile(order.slice(0, cut), null);
    const second = await reconcile(shuffle(order), persist(first.ledger));
    const preserved = new Set();
    collect(preserved, first);
    collect(preserved, second);
    verify(second.ledger, preserved, `split ${attempt}`);
    // Same effective eligibility and contest state as a single complete sync.
    const eff = effective(second.ledger);
    const ref = JSON.parse(reference);
    for (const id of Object.keys(ref)) {
      assert.equal(eff[id].eligible, ref[id].eligible, `split ${attempt}: ${id} eligibility`);
      assert.deepEqual(eff[id].variants, ref[id].variants, `split ${attempt}: ${id} variants`);
      assert.deepEqual(eff[id].contest.filter((c) => c !== "ancestor_contested"), ref[id].contest.filter((c) => c !== "ancestor_contested"), `split ${attempt}: ${id} contest`);
    }
    // No operation is ever imported twice across the restart.
    const imported = [...first.drafts, ...second.drafts].map((d) => d.operation_id);
    assert.equal(new Set(imported).size, imported.length, `split ${attempt}: duplicate import`);
    lateDowngrades += second.downgrades.length;
    // A third identical sync is a no-op.
    const third = await reconcile(order, persist(second.ledger));
    assert.deepEqual(third.ledger, second.ledger);
    assert.equal(third.drafts.length, 0);
  }
  assert.ok(lateDowngrades > 0, "some split orders exercise late downgrades (#289)");
  assert.equal(JSON.stringify(canonicalAtReturn), canonicalBefore, "canonical data never changes");
}

// ---------------------------------------------------------------------------------------
// D. Batch generator: broken or partial transfers never pass the completion-marker check.
{
  const compiled = compile(golden.events.slice(0, 3));
  const reconcileOne = (submission) => reconcileWorkspace({ workspaceId: WORKSPACE_ID, receipts, canonical: canonicalAtExport, policy: { autoImportKinds: ["workspace_note_version"] }, ledger: null, submissions: [submission] });
  for (const { batch, submission } of compiled.slice(0, 1)) {
    const truncated = { ...submission, batchBytes: submission.batchBytes.subarray(0, -1) };
    const changed = { ...submission, batchBytes: new TextEncoder().encode(new TextDecoder().decode(submission.batchBytes).replace("Employer research", "Employer research!")) };
    const marker = JSON.parse(new TextDecoder().decode(submission.commitBytes));
    const wrongDigest = { ...submission, commitBytes: bytesOf({ ...marker, batch_sha256: "0".repeat(64) }) };
    const oldName = { ...submission, commitBytes: bytesOf({ ...marker, format: "jr-agent-batch-complete" }) };
    const fake = { ...submission, commitBytes: bytesOf({ ...marker, format: "fake-complete" }) };
    for (const [label, s, reason] of [["truncated", truncated, null], ["changed", changed, "commit_marker_mismatch"], ["wrong digest", wrongDigest, "commit_marker_mismatch"], ["audit marker name", oldName, "commit_marker_invalid"], ["fake format", fake, "commit_marker_invalid"]]) {
      const r = await reconcileOne(s);
      assert.notEqual(r.report.batches[0].status, "accepted", `${label} must not be accepted`);
      if (reason) assert.ok(r.report.batches[0].reasons.includes(reason), `${label}: ${r.report.batches[0].reasons}`);
      assert.equal(r.drafts.length, 0, label);
    }
    const ok = await reconcileOne(submission);
    assert.equal(ok.report.batches[0].status, "accepted");
    void batch;
  }
  // Status claims and evidence corrections stay proposals, never confirmations.
  const claim = compile(golden.events).find((c) => c.event.kind === "application_status_claim");
  assert.ok(!Object.hasOwn(claim.batch.operations[0].payload, "confirmed"));
}

console.log("agent-workspace audit translation tests passed (strict JSON, 31 governance vectors, 256 permutations, 64 split syncs, marker negatives)");
