// TEST-ONLY synthetic transport compiler for the 60-day golden oracle.
// The fabricated export hash and actor IDs are NOT trusted import receipts.
import { createHash } from 'node:crypto';

const SHA = bytes => createHash('sha256').update(bytes).digest('hex');
const DAY_MS = 86_400_000;
const DAY_ZERO = Date.parse('2026-10-13T00:00:00Z');
const asTimestamp = day => new Date(DAY_ZERO + day * DAY_MS + 12 * 3_600_000)
  .toISOString().replace('.000Z', 'Z');

export function compileAgentBatches(oracle) {
  if (oracle.format !== 'jr-agent-long-gap-oracle' || oracle.schema_version !== 1) {
    throw new TypeError('Unsupported golden fixture version');
  }
  const firstOperationDay = new Map();
  const lastBatchByAgent = new Map();
  const output = [];
  for (const [index, event] of oracle.events.entries()) {
    if (!firstOperationDay.has(event.operation_id)) {
      firstOperationDay.set(event.operation_id, event.day);
    }
    const batchId = `batch_${String(index + 1).padStart(4, '0')}_${event.agent}`;
    const operation = {
      operation_id: event.operation_id,
      record_id: event.record_id,
      base_revision: event.base_revision,
      previous_operation_id: event.previous_operation_id,
      authored_at: asTimestamp(firstOperationDay.get(event.operation_id)),
      kind: event.kind,
      payload: structuredClone(event.payload),
    };
    const batch = {
      format: 'jr-agent-operation-batch',
      schema_version: 1,
      workspace_id: oracle.simulation.workspace_id,
      batch_id: batchId,
      source_export_id: oracle.simulation.source_export_id,
      source_manifest_sha256: 'a'.repeat(64), // SYNTHETIC; never a local trusted receipt
      actor_claim: {
        actor_id: event.agent,
        display_name: 'Synthetic agent ' + event.agent,
      },
      created_at: asTimestamp(event.day),
      previous_batch_id: lastBatchByAgent.get(event.agent) ?? null,
      operations: [operation],
    };
    const rawBatch = Buffer.from(JSON.stringify(batch) + '\n', 'utf8');
    const marker = {
      format: 'jr-agent-batch-complete',
      schema_version: 1,
      workspace_id: batch.workspace_id,
      batch_id: batchId,
      source_export_id: batch.source_export_id,
      batch_sha256: SHA(rawBatch),
      attachments: [],
    };
    lastBatchByAgent.set(event.agent, batchId);
    output.push({ event_id: index + 1, expected: event.expected, batch, rawBatch, marker });
  }
  return output;
}

export function verifySyntheticBatchBytes(batchBytes, marker) {
  // Integrity only. A matching hash never proves actor identity, local user
  // approval, canonical source authenticity or authority of an agent claim.
  return marker.format === 'jr-agent-batch-complete' &&
    marker.batch_sha256 === SHA(batchBytes);
}
