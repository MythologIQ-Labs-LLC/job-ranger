// Test-only golden reconciliation oracle for the synthetic 60-day scenario.
// This is not the application's production reconciler, and it does not
// authorize a Drive actor or imported Career Evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const golden = JSON.parse(readFileSync(
  new URL('./fixtures/agent-workspace/long-gap-reconciliation.v1.json', import.meta.url),
  'utf8',
));
const copy = value => structuredClone(value);

function operationBytes(event) {
  // Day and expected result are test-transport metadata, not signed/validated
  // operation bytes. Duplicate IDs with different operation contents conflict.
  const { day, expected, ...wireOperation } = event;
  return JSON.stringify(wireOperation);
}

function replayIntoDraftLedger(input, trustedCanonical) {
  const canonicalBefore = JSON.stringify(trustedCanonical);
  const seen = new Map();
  // Discover all unique operation identities before classification. A Drive
  // listing is unordered; a sibling fork must affect BOTH competing edits.
  const initialById = new Map();
  const variants = new Map();
  const siblings = new Map();
  for (const event of input) {
    if (!variants.has(event.operation_id)) variants.set(event.operation_id, new Set());
    variants.get(event.operation_id).add(operationBytes(event));
    if (initialById.has(event.operation_id)) continue;
    initialById.set(event.operation_id, event);
    if (event.previous_operation_id === null) continue;
    const forkKey = JSON.stringify([event.record_id, event.previous_operation_id]);
    if (!siblings.has(forkKey)) siblings.set(forkKey, new Set());
    siblings.get(forkKey).add(event.operation_id);
  }
  const current = new Map();
  const classified = [];
  const drafts = [];
  const staged = [];
  let inserted = 0;

  for (const event of input) {
    const key = event.operation_id;
    const bytes = operationBytes(event);
    let verdict;
    if (variants.get(key).size > 1) {
      // Even the first-seen value is unsafe: a different value with the same
      // identity means an unordered Drive listing cannot choose a winner.
      verdict = 'reject_operation_id_collision';
    } else if (seen.has(key)) {
      verdict = seen.get(key) === bytes ? 'duplicate_replay_noop' : 'reject_operation_id_collision';
    } else {
      seen.set(key, bytes);
      const highConsequence = new Set(['application_status_claim', 'evidence_change_proposal']);
      if (highConsequence.has(event.kind)) {
        verdict = event.kind === 'application_status_claim'
          ? 'stage_attestation_required' : 'stage_canonical_review';
      } else if (event.kind === 'follow_up_plan') {
        verdict = 'import_plan_proposal';
      } else if (event.kind === 'material_draft_version') {
        const stale = (event.payload.source_evidence_refs || []).some(ref =>
          ref.record_id === trustedCanonical.evidenceId &&
          ref.revision !== trustedCanonical.evidenceRevision);
        verdict = stale ? 'preserve_draft_needs_rebase' : 'import_draft_gate_not_checked';
        // Preserve draft material even when stale, but do not canonically approve it.
        drafts.push({ key, record_id: event.record_id, stale, canonical: false });
        current.set(event.record_id, key);
      } else if (event.previous_operation_id !== null &&
                 (siblings.get(JSON.stringify([event.record_id,
                   event.previous_operation_id]))?.size ?? 0) > 1) {
        // Neither branch can win simply because a Drive listing returned it
        // first. Keep both versions staged for a deliberate resolution.
        verdict = 'conflict_preserve_fork';
        drafts.push({ key, record_id: event.record_id, conflict: true, canonical: false });
      } else if (event.previous_operation_id !== null &&
                 !initialById.has(event.previous_operation_id)) {
        verdict = 'needs_parent_or_quarantine';
      } else {
        verdict = 'import_draft';
        current.set(event.record_id, key);
        drafts.push({ key, record_id: event.record_id, canonical: false });
        inserted += 1;
      }
      if (!verdict.startsWith('import_draft')) staged.push({ key, verdict });
    }
    classified.push({ id: key, verdict });
  }

  assert.equal(JSON.stringify(trustedCanonical), canonicalBefore,
    'test oracle must not mutate authoritative Career Ops data');
  return { classified, drafts, staged, inserted, seen };
}

test('golden fixture covers two independently claimed agents and a 60-day closed-UI gap', () => {
  assert.equal(golden.format, 'jr-agent-long-gap-oracle');
  assert.equal(golden.schema_version, 1);
  assert.equal(golden.simulation.day_count, 60);
  assert.equal(golden.simulation.job_ranger_closed_while_agents_work, true);
  assert.deepEqual([...new Set(golden.events.map(x => x.agent))].sort(),
    ['agent_alpha', 'agent_beta']);
  assert.equal(golden.events.length, golden.expected.event_count);
  assert.equal(new Set(golden.events.map(x => x.operation_id)).size,
    golden.expected.unique_operation_ids);
  assert.ok(golden.events.every(x => Number.isInteger(x.day) && x.day > 0 && x.day < 60));
  assert.ok(golden.events.every(x => !Object.hasOwn(x, 'approved') &&
    !Object.hasOwn(x, 'confirmed') &&
    !Object.hasOwn(x, 'permissions')));
});

test('golden dispositions preserve drafts, refuse authority elevation and survive replay', () => {
  const canonical = Object.freeze({
    evidenceId: golden.simulation.canonical_evidence_at_return.id,
    evidenceRevision: golden.simulation.canonical_evidence_at_return.revision,
    submittedApplications: golden.simulation.canonical_submitted_application_count,
  });
  const before = copy(canonical);
  const result = replayIntoDraftLedger(golden.events, canonical);
  assert.deepEqual(result.classified.map(x => x.verdict),
    golden.events.map(x => x.expected));
  assert.equal(result.inserted, golden.expected.accepted_drafts_only);
  assert.equal(result.classified.filter(x =>
    x.verdict !== 'import_draft' &&
    x.verdict !== 'duplicate_replay_noop' &&
    x.verdict !== 'reject_operation_id_collision').length,
  golden.expected.stage_or_conflict);
  assert.equal(result.classified.filter(x => x.verdict === 'duplicate_replay_noop').length,
    golden.expected.replay_noop);
  assert.equal(result.classified.filter(x => x.verdict === 'reject_operation_id_collision').length,
    golden.expected.rejected_collision);
  assert.ok(result.classified.some(x => x.verdict === 'conflict_preserve_fork'));
  assert.equal(result.drafts.filter(x => x.stale).length, 2);
  assert.ok(result.drafts.every(x => x.canonical === false));
  assert.deepEqual(canonical, before);
  assert.equal(canonical.evidenceRevision, golden.expected.canonical_evidence_revision_unchanged);
  assert.equal(canonical.submittedApplications,
    golden.expected.canonical_submitted_application_count_unchanged);
  // Same operations reappear during a second synchronization. Already-seen
  // content must produce no additional accepted draft writes.
  const secondPass = replayIntoDraftLedger([...golden.events, ...golden.events], canonical);
  assert.deepEqual(secondPass.classified.slice(0, golden.events.length),
    result.classified);
  assert.equal(secondPass.inserted, result.inserted);
  assert.ok(secondPass.classified.slice(golden.events.length).every(x =>
    x.verdict === 'duplicate_replay_noop' ||
    x.verdict === 'reject_operation_id_collision'));
});

test('duplicate-operation replay is byte-identical; collisions are not', () => {
  const first = golden.events[4];
  const replay = golden.events[9];
  const collision = golden.events[10];
  assert.equal(first.operation_id, replay.operation_id);
  assert.equal(first.operation_id, collision.operation_id);
  assert.equal(operationBytes(first), operationBytes(replay));
  assert.notEqual(operationBytes(first), operationBytes(collision));
});

test('competing edits from the same parent are both held for review', () => {
  const candidates = golden.events.filter(event =>
    event.record_id === 'note_employer_01' && event.previous_operation_id === 'op_alpha_note_create');
  assert.equal(candidates.length, 2);
  for (const event of candidates) assert.equal(event.expected, 'conflict_preserve_fork');
});

test('classification of forked operations does not depend on Drive listing order', () => {
  const canonical = Object.freeze({
    evidenceId: golden.simulation.canonical_evidence_at_return.id,
    evidenceRevision: golden.simulation.canonical_evidence_at_return.revision,
    submittedApplications: 0,
  });
  const original = replayIntoDraftLedger(golden.events, canonical);
  // Simulate reverse listing order, preserving the same complete set. Report
  // by operation ID+bytes so the deliberately conflicting duplicate is kept.
  const reversed = replayIntoDraftLedger([...golden.events].reverse(), canonical);
  const summarize = output => output.classified
    .map(x => x.id + ':' + x.verdict).sort();
  assert.deepEqual(summarize(reversed), summarize(original));
  assert.equal(reversed.inserted, original.inserted);
  assert.equal(reversed.drafts.filter(x => x.conflict).length, 2);
});

test('pure byte-identical replay is a no-op when no conflicting value exists', () => {
  const canonical = Object.freeze({ evidenceId: 'evidence_example_001', evidenceRevision: 'revision_new_002', submittedApplications: 0 });
  const clean = golden.events.filter((_, i) => i !== 10);
  const result = replayIntoDraftLedger(clean, canonical);
  assert.equal(result.classified[4].verdict, 'import_draft');
  assert.equal(result.classified[9].verdict, 'duplicate_replay_noop');
});
