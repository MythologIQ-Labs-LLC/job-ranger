const assert = require('node:assert/strict');
const {
  buildJobEvidenceCoverage,
  extractJobRequirements,
  mapRequirementToEvidence,
} = require('../electron-runtime/electron/src/requirement-mapper.cjs');
const { NEGATION_NOTE } = require('../electron-runtime/electron/src/evidence-negation.cjs');
const { CLAIM_ACTION_NOTE_PREFIX } = require('../electron-runtime/electron/src/claim-action.cjs');

function evidence(id, statement, options = {}) {
  return {
    id,
    subjectType: options.subjectType ?? 'achievement',
    organization: options.organization ?? null,
    titleOrName: options.titleOrName ?? null,
    startDate: null,
    endDate: null,
    statement,
    action: null,
    context: null,
    skills: options.skills ?? [],
    methodsOrTools: options.methodsOrTools ?? [],
    scope: [],
    outcomes: [],
    metrics: [],
    credential: options.credential ?? null,
    verificationState: options.verificationState ?? 'user-confirmed',
    confidence: 1,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  };
}

function job(id, title, description, location = 'Annapolis, MD') {
  return {
    id,
    title,
    descriptionSnippet: description,
    location,
    employmentType: 'Full-time',
  };
}

const now = '2026-09-25T12:00:00.000Z';

{
  const target = job(
    '1',
    'AI Product Engineer',
    'Must have TypeScript experience. Build production AI workflows and APIs. Python preferred.',
  );
  const requirements = extractJobRequirements(target, now);
  const coverage = buildJobEvidenceCoverage(
    target.id,
    requirements,
    [
      evidence('e-ts', 'Built production TypeScript services and APIs.', { skills: ['TypeScript'] }),
      evidence('e-ai', 'Designed AI workflow orchestration for customer-facing products.', { skills: ['AI workflows'] }),
    ],
    now,
  );
  assert.ok(coverage.totalCount >= 2, 'software job should expose requirements');
  assert.ok(coverage.supportedCount >= 1, 'software evidence should support at least one requirement');
}

{
  const target = job(
    '2',
    'Commercial HVAC Technician',
    'EPA certification required. Must troubleshoot rooftop HVAC systems. On-call rotation required.',
  );
  const requirements = extractJobRequirements(target, now);
  const coverage = buildJobEvidenceCoverage(
    target.id,
    requirements,
    [
      evidence('e-epa', 'Maintained EPA Section 608 certification for refrigerant work.', { subjectType: 'credential', skills: ['EPA Section 608'] }),
      evidence('e-rtu', 'Diagnosed and repaired commercial rooftop HVAC units.', { skills: ['HVAC troubleshooting'] }),
    ],
    now,
  );
  assert.ok(requirements.some((item) => item.kind === 'credential'), 'trade role should classify credential requirement');
  assert.ok(requirements.some((item) => item.kind === 'logistics'), 'trade role should classify on-call requirement');
  assert.ok(coverage.supportedCount >= 1, 'trade evidence should support explicit requirements');
}

{
  const target = job(
    '3',
    'Administrative Coordinator',
    'Coordinate vendor invoices and maintain office records. Experience with scheduling preferred.',
  );
  const requirements = extractJobRequirements(target, now);
  const coverage = buildJobEvidenceCoverage(
    target.id,
    requirements,
    [
      evidence('e-admin', 'Coordinated vendor invoices, calendars, and administrative records.', { skills: ['scheduling', 'vendor invoices'] }),
    ],
    now,
  );
  assert.ok(coverage.supportedCount >= 1, 'administrative evidence should map without occupation-specific logic');
}

{
  const target = job(
    '4',
    'Customer Service Representative',
    'Must communicate with customers and resolve account issues. Evening shifts may be required.',
  );
  const requirements = extractJobRequirements(target, now);
  const coverage = buildJobEvidenceCoverage(
    target.id,
    requirements,
    [
      evidence('e-service', 'Resolved customer account issues by phone and email.', {
        verificationState: 'imported',
        skills: ['customer service'],
      }),
    ],
    now,
  );
  assert.ok(
    coverage.items.some((item) => item.mapping.classification === 'ambiguous'),
    'unconfirmed imported evidence must remain ambiguous',
  );
  assert.equal(coverage.directCount, 0, 'unconfirmed evidence cannot become direct support');
}

{
  const target = job(
    '5',
    'Registered Nurse',
    'Active RN license required. Must provide patient care and medication administration. BLS certification required.',
  );
  const requirements = extractJobRequirements(target, now);
  const coverage = buildJobEvidenceCoverage(
    target.id,
    requirements,
    [
      evidence('e-rn', 'Active Registered Nurse license.', { subjectType: 'credential', skills: ['RN license'] }),
      evidence('e-bls', 'Current BLS certification.', { subjectType: 'credential', skills: ['BLS'] }),
    ],
    now,
  );
  assert.ok(requirements.filter((item) => item.kind === 'credential').length >= 2, 'credential-heavy role should preserve distinct credential requirements');
  assert.ok(coverage.supportedCount >= 1, 'confirmed credentials should map to credential requirements');
  assert.ok(coverage.items.every((item) => item.mapping.classification !== 'ambiguous' || !item.mapping.userConfirmed), 'ambiguous mappings must not self-confirm');
}

{
  const target = job('6', 'Registered Nurse', 'Active Maryland RN license required.');
  const requirements = extractJobRequirements(target, now);
  const active = evidence('e-active-rn', 'Maryland Registered Nurse license.', {
    subjectType: 'credential',
    skills: ['RN license'],
    credential: {
      issuer: 'Maryland Board of Nursing',
      jurisdiction: 'Maryland',
      status: 'active',
      expirationDate: '2027-12-31',
      credentialId: null,
    },
  });
  const coverage = buildJobEvidenceCoverage(target.id, requirements, [active], now);
  assert.ok(coverage.directCount >= 1, 'active non-expired credential should support a matching requirement');
}

for (const status of ['expired', 'inactive', 'pending']) {
  const target = job(`7-${status}`, 'Registered Nurse', 'Active Maryland RN license required.');
  const requirements = extractJobRequirements(target, now);
  const saved = evidence(`e-rn-${status}`, 'Active Maryland Registered Nurse license.', {
    subjectType: 'credential',
    skills: ['RN license'],
    credential: {
      issuer: 'Maryland Board of Nursing',
      jurisdiction: 'Maryland',
      status,
      expirationDate: null,
      credentialId: null,
    },
  });
  const coverage = buildJobEvidenceCoverage(target.id, requirements, [saved], now);
  const credentialItem = coverage.items.find((item) => item.requirement.kind === 'credential');
  assert.ok(credentialItem, `${status}: credential requirement should exist`);
  assert.equal(credentialItem.mapping.classification, 'gap', `${status}: credential standing must not establish current eligibility`);
  assert.equal(credentialItem.evidence?.id, saved.id, `${status}: invalid matching credential should remain visible as evidence for the gap`);
  assert.match(credentialItem.mapping.explanation, new RegExp(status), `${status}: mapping should explain why standing does not qualify`);
  assert.ok(!credentialItem.mapping.explanation.includes(NEGATION_NOTE), `${status}: a standing gap without negation carries no negation note`);
}

{
  const target = job('8', 'Registered Nurse', 'Active Maryland RN license required.');
  const requirements = extractJobRequirements(target, now);
  const expiredByDate = evidence('e-date-expired', 'Active Maryland Registered Nurse license.', {
    subjectType: 'credential',
    skills: ['RN license'],
    credential: {
      issuer: 'Maryland Board of Nursing',
      jurisdiction: 'Maryland',
      status: 'active',
      expirationDate: '2026-09-24',
      credentialId: null,
    },
  });
  const coverage = buildJobEvidenceCoverage(target.id, requirements, [expiredByDate], now);
  const credentialItem = coverage.items.find((item) => item.requirement.kind === 'credential');
  assert.equal(credentialItem.mapping.classification, 'gap');
  assert.match(credentialItem.mapping.explanation, /expired on 2026-09-24/);
}

{
  const target = job('9', 'Registered Nurse', 'Active Maryland RN license required.');
  const requirements = extractJobRequirements(target, now);
  const expired = evidence('e-old-rn', 'Maryland Registered Nurse license.', {
    subjectType: 'credential',
    credential: {
      issuer: 'Maryland Board of Nursing',
      jurisdiction: 'Maryland',
      status: 'expired',
      expirationDate: '2024-12-31',
      credentialId: null,
    },
  });
  const active = evidence('e-current-rn', 'Registered Nurse license for Maryland.', {
    subjectType: 'credential',
    credential: {
      issuer: 'Maryland Board of Nursing',
      jurisdiction: 'Maryland',
      status: 'active',
      expirationDate: '2027-12-31',
      credentialId: null,
    },
  });
  const coverage = buildJobEvidenceCoverage(target.id, requirements, [expired, active], now);
  const credentialItem = coverage.items.find((item) => item.requirement.kind === 'credential');
  assert.notEqual(credentialItem.mapping.classification, 'gap', 'valid current credential should be preferred over an expired textual match');
  assert.equal(credentialItem.evidence?.id, active.id);
}

// G12 (#167): negation in evidence prose. Requirements are built directly so
// short requirement text does not depend on extractJobRequirements.
function req(id, text, kind = 'must-have') {
  return { id, jobId: 'job-neg', kind, text, normalizedTerm: null, importance: 1, sourceText: text, createdAt: now };
}

function mapOne(requirementText, records, kind) {
  return mapRequirementToEvidence(req(`req-${requirementText}`, requirementText, kind), records, now);
}

{
  const result = mapOne('Approved vendor budgets.', [evidence('e-neg-1', 'Never approved the vendor budget; reviewed vendor budget drafts.')]);
  assert.equal(result.mapping.classification, 'transferable', 'negated span drops, adjacent affirmed experience stays');
  assert.ok(result.mapping.explanation.includes(NEGATION_NOTE));

  const denied = mapOne('Approved vendor budgets.', [evidence('e-neg-2', 'Never approved vendor budgets.')]);
  assert.equal(denied.mapping.classification, 'gap');
  assert.ok(denied.mapping.explanation.includes(NEGATION_NOTE), 'gap explanation says negation reduced support');

  for (const statement of ['Approved vendor budgets; did not manage payroll.', 'Approved vendor budgets, not invoices.']) {
    const kept = mapOne('Approved vendor budgets.', [evidence('e-neg-3', statement)]);
    assert.equal(kept.mapping.classification, 'direct', `negation elsewhere must not downgrade: ${statement}`);
    assert.ok(!kept.mapping.explanation.includes(NEGATION_NOTE));
  }

  const label = mapOne('Budget approval.', [evidence('e-neg-4', 'Never approved budget requests.', { skills: ['Budget approval'] })]);
  assert.equal(label.mapping.classification, 'direct', 'confirmed skill labels are not negated by statement prose');

  const unconfirmed = mapOne('Approved vendor budgets.', [evidence('e-neg-5', 'Never approved vendor budgets.', { verificationState: 'imported' })]);
  assert.equal(unconfirmed.mapping.classification, 'gap', 'a negated-only match never becomes ambiguous');

  const plainUnconfirmed = mapOne('Approved vendor budgets.', [evidence('e-neg-6', 'Approved vendor budgets.', { verificationState: 'imported' })]);
  assert.equal(plainUnconfirmed.mapping.classification, 'ambiguous');
  assert.ok(!plainUnconfirmed.mapping.explanation.includes(NEGATION_NOTE), 'no note without negation');

  const negatedA = evidence('e-neg-a', 'Never approved vendor budgets.');
  const affirmedB = evidence('e-neg-b', 'Reviewed vendor budget drafts.');
  const swap = mapOne('Approved vendor budgets.', [negatedA, affirmedB]);
  assert.equal(swap.mapping.classification, 'transferable');
  assert.equal(swap.mapping.evidenceId, affirmedB.id, 'affirmed evidence outranks negated evidence');
  assert.ok(swap.mapping.explanation.includes(NEGATION_NOTE));

  assert.equal(mapOne('Payroll and invoices.', [evidence('e-neg-7', 'Did not handle budgets, payroll, or invoices.')]).mapping.classification, 'gap');
  assert.notEqual(mapOne('Handled payroll.', [evidence('e-neg-8', 'Handled all HR functions except payroll.')]).mapping.classification, 'direct');
  assert.equal(mapOne('Python.', [evidence('e-neg-9', 'No experience with SQL, Python, or Tableau.')]).mapping.classification, 'gap');

  for (const [requirementText, statement] of [
    ['Reduce operational costs.', 'Migrated ERP with no downtime, reducing operational costs by 20%.'],
    ['Reduce hosting costs.', 'Migrated 40 servers to AWS with no downtime and reduced hosting costs 30%.'],
    ['Manage vendor contracts.', 'Managed operations including but not limited to payroll, budgets, and vendor contracts.'],
    ['Manage engineers.', 'Managed no fewer than 12 engineers.'],
  ]) {
    const kept = mapOne(requirementText, [evidence('e-neg-10', statement)]);
    assert.equal(kept.mapping.classification, 'direct', `must stay direct: ${statement}`);
    assert.ok(!kept.mapping.explanation.includes(NEGATION_NOTE), `no note: ${statement}`);
  }

  // Negation changes which record wins: confirmed R ties unconfirmed S after negation, so the outcome drops.
  const tie = mapOne('Approved vendor budget payments.', [
    evidence('e-neg-s', 'Approved vendor budget reviews.', { verificationState: 'imported' }),
    evidence('e-neg-r', 'Approved vendor budgets, not payments.'),
  ]);
  assert.equal(tie.mapping.classification, 'ambiguous');
  assert.ok(tie.mapping.explanation.includes(NEGATION_NOTE), 'the note appears when negation changed the outcome via ranking');

  const same = mapOne('Approved vendor budgets.', [
    evidence('e-neg-c', 'Approved vendor budgets.', { verificationState: 'imported' }),
    evidence('e-neg-d', 'Never approved vendor budgets.'),
  ]);
  assert.equal(same.mapping.classification, 'ambiguous', 'unconfirmed C wins with or without negation handling');
  assert.ok(!same.mapping.explanation.includes(NEGATION_NOTE), 'no note when the outcome is the same either way');

  const unusable = mapOne('Active Maryland RN license required.', [evidence('e-neg-cred', 'Never held an active Maryland Registered Nurse license.', {
    subjectType: 'credential',
    credential: { issuer: 'Maryland Board of Nursing', jurisdiction: 'Maryland', status: 'expired', expirationDate: null, credentialId: null },
  })], 'credential');
  assert.equal(unusable.mapping.classification, 'gap');
  assert.ok(!unusable.mapping.explanation.includes(NEGATION_NOTE), 'an unusable credential is a gap either way: no note');

  const pmp = mapOne('PMP certification.', [evidence('e-neg-11', 'Not yet PMP certified; exam scheduled for March.')], 'credential');
  assert.equal(pmp.mapping.classification, 'gap', 'not yet certified is not support');
  assert.ok(pmp.mapping.explanation.includes(NEGATION_NOTE));
}

// G13 (#168): evidence showing a recipient role without the claim action is not direct support.
{
  const passive = evidence('e-g13-passive', 'Was trained on safety procedures with new hires.');
  const active = evidence('e-g13-active', 'Trained new hires on safety procedures.');
  const passiveAlone = mapOne('Train new hires on safety procedures.', [passive]);
  assert.equal(passiveAlone.mapping.classification, 'transferable', 'guard: the passive record alone is capped');
  const chosen = mapOne('Train new hires on safety procedures.', [passive, active]);
  assert.equal(chosen.mapping.classification, 'direct', 'an uncapped direct record is preferred over a capped one');
  assert.equal(chosen.mapping.evidenceId, active.id);
  assert.ok(!chosen.mapping.explanation.includes(CLAIM_ACTION_NOTE_PREFIX));

  const capped = mapOne('Managed payroll for a large workforce.', [evidence('e-g13-paid', 'Was paid through payroll as part of a large workforce.')]);
  assert.equal(capped.mapping.classification, 'transferable');
  assert.equal(capped.mapping.evidenceId, 'e-g13-paid', 'the capped record stays visible as transferable evidence');
  assert.ok(capped.mapping.explanation.includes(CLAIM_ACTION_NOTE_PREFIX) && capped.mapping.explanation.includes('("managed")'));

  const nounOnly = mapOne('Payroll processing for a large workforce.', [evidence('e-g13-noun', 'Was paid through payroll processing for a large workforce.')]);
  assert.equal(nounOnly.mapping.classification, 'direct', 'no claim verb: never capped');
  assert.ok(!nounOnly.mapping.explanation.includes(CLAIM_ACTION_NOTE_PREFIX));

  const noMarker = mapOne('Develop production TypeScript services and APIs.', [evidence('e-g13-wrote', 'Wrote production TypeScript services and APIs.')]);
  assert.equal(noMarker.mapping.classification, 'direct', 'no recipient marker: out-of-family synonyms keep direct');

  const unconfirmed = mapOne('Train new hires on safety procedures.', [evidence('e-g13-unc', 'Was trained on safety procedures with new hires.', { verificationState: 'imported' })]);
  assert.equal(unconfirmed.mapping.classification, 'ambiguous', 'unconfirmed path untouched');
  assert.ok(!unconfirmed.mapping.explanation.includes(CLAIM_ACTION_NOTE_PREFIX));

  const both = mapOne('Train new hires on safety procedures.', [evidence('e-g13-g12', 'Never trained new hires on safety procedures; was trained on safety procedures.')]);
  assert.equal(both.mapping.classification, 'transferable', 'negated action plus recipient role is not direct');
  assert.ok(both.mapping.explanation.includes(NEGATION_NOTE), 'raw text (the negated active verb) would have been direct');
  assert.ok(!both.mapping.explanation.includes(CLAIM_ACTION_NOTE_PREFIX), 'affirmed score is below the direct threshold, so the cap does not apply');

  // Cap and negation together: the recipient record is capped in the affirmed pass; raw keeps the negated active verb.
  const capAndNegation = mapOne('Managed payroll for a large workforce.', [evidence('e-g13-g12b', 'Was paid through payroll as part of a large workforce; never managed payroll.')]);
  assert.equal(capAndNegation.mapping.classification, 'transferable');
  assert.ok(capAndNegation.mapping.explanation.includes(CLAIM_ACTION_NOTE_PREFIX));
}

// G11 (#183): terminal periods must not turn stop words into stray
// unmatched tokens or downgrade confirmed matching evidence.
{
  const direct = mapOne('Experience with insurance verification is required.', [
    evidence('g11-insurance', 'Experience with insurance verification is required'),
  ]);
  assert.equal(direct.mapping.classification, 'direct',
    'punctuation-only variation must not reduce true support to transferable');
  assert.equal(direct.mapping.evidenceId, 'g11-insurance');

  const extracted = extractJobRequirements(
    job('g11-job', 'Insurance Specialist', 'Experience with insurance verification is required.'), now,
  ).find((item) => item.text === 'Experience with insurance verification is required.');
  assert.ok(extracted, 'punctuated requirement must still be extracted');
  assert.equal(extracted.normalizedTerm, 'insurance verification',
    'sentence-terminal required. is a stop word, not part of the search term');
  assert.equal(extracted.sourceText, 'Experience with insurance verification is required.',
    'source wording is not rewritten by token matching');

  const unconfirmed = mapOne('Experience with insurance verification is required.', [
    evidence('g11-imported', 'Experience with insurance verification is required', {
      verificationState: 'imported',
    }),
  ]);
  assert.equal(unconfirmed.mapping.classification, 'ambiguous',
    'terminal-period fix must not self-confirm imported evidence');
  assert.equal(unconfirmed.mapping.userConfirmed, false);

  const denied = mapOne('Experience with insurance verification is required.', [
    evidence('g11-denied', 'Never performed insurance verification.'),
  ]);
  assert.notEqual(denied.mapping.classification, 'direct',
    'negated claims must not gain direct support from punctuation normalization');

  const partial = mapOne('Experience with insurance verification is required.', [
    evidence('g11-partial', 'Experience with insurance billing, not verification.'),
  ]);
  assert.notEqual(partial.mapping.classification, 'direct',
    'a semantically different activity must not be upgraded by G11');
}

// Dots inside or at the start of technology names must remain meaningful.
// The token change is deliberately NOT a global punctuation rewrite.
{
  for (const [text, statement] of [
    ['Experience with Node.js is required.', 'Built Node.js services'],
    ['Experience with .NET is required.', 'Built .NET services'],
    ['Experience with version 3.0 is required.', 'Shipped version 3.0 releases'],
    ['Experience with C++ is required.', 'Built C++ services'],
  ]) {
    const mapped = mapOne(text, [evidence('g11-tech', statement)]);
    assert.equal(mapped.mapping.classification, 'direct',
      `internal dot and symbol token preservation: ${text}`);
  }
}

console.log('requirement mapper tests passed');
