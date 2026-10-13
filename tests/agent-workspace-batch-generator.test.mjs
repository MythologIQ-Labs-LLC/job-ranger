import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileAgentBatches, verifySyntheticBatchBytes } from './support/build-agent-workspace-batches.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/agent-workspace/long-gap-reconciliation.v1.json', import.meta.url), 'utf8'));
const compiled = compileAgentBatches(fixture);

test('each day-60 event is a bounded, versioned, self-contained operation batch', () => {
  assert.equal(compiled.length, 11);
  const batchIds = new Set();
  const agents = new Map();
  for (const item of compiled) {
    const b = item.batch;
    assert.equal(b.format, 'jr-agent-operation-batch');
    assert.equal(b.schema_version, 1);
    assert.equal(b.workspace_id, fixture.simulation.workspace_id);
    assert.equal(b.source_export_id, fixture.simulation.source_export_id);
    assert.equal(b.source_manifest_sha256, 'a'.repeat(64));
    assert.match(b.batch_id, /^batch_[A-Za-z0-9_-]+$/);
    assert.ok(!batchIds.has(b.batch_id));
    batchIds.add(b.batch_id);
    assert.equal(b.operations.length, 1);
    const op = b.operations[0];
    assert.equal(op.kind, fixture.events[item.event_id - 1].kind);
    assert.equal(op.operation_id, fixture.events[item.event_id - 1].operation_id);
    assert.equal(b.previous_batch_id, agents.get(b.actor_claim.actor_id) ?? null);
    agents.set(b.actor_claim.actor_id, b.batch_id);
    assert.equal(item.marker.batch_id, b.batch_id);
    assert.equal(item.marker.source_export_id, b.source_export_id);
    assert.ok(verifySyntheticBatchBytes(item.rawBatch, item.marker));
  }
});

test('replay and collision use same operation identity but different content when relevant', () => {
  const [original, replay, collision] = [compiled[4], compiled[9], compiled[10]]
    .map(item => item.batch.operations[0]);
  assert.deepEqual(original, replay);
  assert.equal(original.operation_id, collision.operation_id);
  assert.notDeepEqual(original, collision);
});

test('broken or partially transferred packets never pass the completion-marker byte check', () => {
  for (const item of compiled) {
    assert.equal(verifySyntheticBatchBytes(item.rawBatch.subarray(0, -1), item.marker), false);
    assert.equal(verifySyntheticBatchBytes(Buffer.from(item.rawBatch.toString().replace('agent_', 'agent_changed_')), item.marker), false);
    assert.equal(verifySyntheticBatchBytes(item.rawBatch, { ...item.marker, batch_sha256: '0'.repeat(64) }), false);
  }
  assert.equal(verifySyntheticBatchBytes(compiled[0].rawBatch, { ...compiled[0].marker, format: 'fake-complete' }), false);
});

test('claimed status and evidence corrections stay proposed, not canonically confirmed', () => {
  const claim = compiled.find(x => x.batch.operations[0].kind === 'application_status_claim');
  const evidence = compiled.find(x => x.batch.operations[0].kind === 'evidence_change_proposal');
  assert.equal(claim.expected, 'stage_attestation_required');
  assert.equal(evidence.expected, 'stage_canonical_review');
  assert.equal(claim.batch.operations[0].payload.claimed_status, 'submitted');
  assert.ok(!Object.hasOwn(claim.batch.operations[0].payload, 'confirmed'));
  assert.ok(compiled.every(x => !Object.hasOwn(x.batch, 'permission_grant')));
});
