import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateApplicationHandoff } from '../src/shared/application-handoff.ts';

function material(overrides = {}) {
  return {
    id: 'material-1', applicationId: 'app-1', jobId: 'job-1',
    kind: 'cover-letter', version: 1, status: 'draft',
    sections: [
      { id: 'opening', label: 'opening', text: 'Dear Hiring Team,\n\nI am applying.', evidenceIds: [], evidenceUpdatedAtById: {} },
      { id: 'evidence', label: 'evidence', text: 'I built reliable systems.', evidenceIds: ['e-1'], evidenceUpdatedAtById: { 'e-1': '2026-10-09T00:00:00Z' } },
      { id: 'closing', label: 'closing', text: 'Sincerely,\nTaylor', evidenceIds: [], evidenceUpdatedAtById: {} },
    ],
    selectedEvidenceIds: ['e-1'], staleEvidenceIds: [],
    createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z',
    ...overrides,
  };
}

test('ready copy exactly preserves the currently displayed projection text', () => {
  assert.deepEqual(evaluateApplicationHandoff(material()), {
    ready: true,
    text: 'Dear Hiring Team,\n\nI am applying.\n\nI built reliable systems.\n\nSincerely,\nTaylor',
  });
});

test('a missing persisted version cannot be copied', () => {
  assert.deepEqual(evaluateApplicationHandoff(null), { ready: false, reason: 'missing-material' });
});

test('unsupported material kinds cannot be copied as cover letters', () => {
  assert.deepEqual(evaluateApplicationHandoff(material({ kind: 'resume' })), { ready: false, reason: 'unsupported-kind' });
});

test('a stale evidence snapshot blocks reuse', () => {
  assert.deepEqual(evaluateApplicationHandoff(material({ staleEvidenceIds: ['e-1'] })), { ready: false, reason: 'stale-evidence' });
});

test('a blank or non-textual draft blocks export', () => {
  assert.deepEqual(evaluateApplicationHandoff(material({ sections: [{ id: 'x', label: 'closing', text: '  \n', evidenceIds: [], evidenceUpdatedAtById: {} }] })), { ready: false, reason: 'empty-material' });
  assert.deepEqual(evaluateApplicationHandoff(material({ sections: [] })), { ready: false, reason: 'empty-material' });
});

test('missing or broken evidence references block unsupported material', () => {
  const sample = material();
  assert.deepEqual(evaluateApplicationHandoff(material({ selectedEvidenceIds: [] })), { ready: false, reason: 'missing-evidence-links' });
  assert.deepEqual(evaluateApplicationHandoff(material({ selectedEvidenceIds: ['e-2'] })), { ready: false, reason: 'missing-evidence-links' });
  assert.deepEqual(evaluateApplicationHandoff(material({ selectedEvidenceIds: ['e-1', 'e-1'] })), { ready: false, reason: 'missing-evidence-links' });
  assert.deepEqual(evaluateApplicationHandoff(material({ selectedEvidenceIds: ['e-1', 'e-2'] })), { ready: false, reason: 'missing-evidence-links' });
  assert.deepEqual(evaluateApplicationHandoff(material({ sections: sample.sections.map(s => s.id === 'evidence' ? { ...s, evidenceUpdatedAtById: {} } : s) })), { ready: false, reason: 'missing-evidence-links' });
  assert.deepEqual(evaluateApplicationHandoff(material({ sections: sample.sections.map(s => s.id === 'evidence' ? { ...s, evidenceIds: [] } : s) })), { ready: false, reason: 'missing-evidence-links' });
  assert.deepEqual(evaluateApplicationHandoff(material({ sections: [...sample.sections, { id: 'extra', label: 'evidence', text: 'Unsupported statement', evidenceIds: ['e-2'], evidenceUpdatedAtById: { 'e-2': '2026-10-09' } }] })), { ready: false, reason: 'missing-evidence-links' });
});

test('an empty evidence timestamp cannot establish a current source', () => {
  const sample = material();
  assert.deepEqual(evaluateApplicationHandoff(material({ sections: sample.sections.map(s => s.id === 'evidence' ? { ...s, evidenceUpdatedAtById: { 'e-1': '' } } : s) })), { ready: false, reason: 'missing-evidence-links' });
});
