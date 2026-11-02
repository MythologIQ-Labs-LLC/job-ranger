const assert = require('node:assert/strict');

function track(overrides = {}) {
  return {
    id: overrides.id ?? 'track-primary',
    name: overrides.name ?? 'Primary search',
    relation: overrides.relation ?? 'target',
    roleTitles: overrides.roleTitles ?? ['Administrative Coordinator'],
    seniority: overrides.seniority ?? null,
    direction: overrides.direction ?? null,
    constraints: {
      geography: overrides.geography ?? { locations: [], radiusMiles: null, strength: 'preferred' },
      workModes: overrides.workModes ?? { values: [], strength: 'preferred' },
      employmentArrangements: overrides.employmentArrangements ?? { values: [], strength: 'preferred' },
      schedules: overrides.schedules ?? { values: [], strength: 'preferred' },
      compensation: overrides.compensation ?? { floor: null, target: null, basis: 'annual', floorStrength: 'preferred' },
      onCall: overrides.onCall ?? { value: 'either', strength: 'preferred' },
      industries: overrides.industries ?? { values: [], strength: 'preferred' },
    },
    origin: 'user',
    isActive: true,
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  };
}

function job(overrides = {}) {
  return {
    id: overrides.id ?? 'job-1',
    title: overrides.title ?? 'Administrative Coordinator',
    location: overrides.location ?? 'Annapolis, MD',
    employmentType: overrides.employmentType ?? 'Full-time',
    descriptionSnippet: overrides.descriptionSnippet ?? 'Coordinate vendor schedules and maintain office records.',
    salaryMin: overrides.salaryMin ?? null,
    salaryText: overrides.salaryText ?? null,
    sourceType: overrides.sourceType ?? 'greenhouse',
  };
}

function requirement(id, kind, text, classification, evidence = null) {
  return {
    requirement: {
      id,
      jobId: 'job-1',
      kind,
      text,
      normalizedTerm: text.toLowerCase(),
      importance: 1,
      sourceText: text,
      createdAt: '2026-10-02T00:00:00.000Z',
    },
    mapping: {
      id: `map-${id}`,
      jobRequirementId: id,
      evidenceId: evidence?.id ?? null,
      classification,
      explanation: `${classification} mapping`,
      createdBy: 'deterministic',
      userConfirmed: classification === 'direct' || classification === 'transferable',
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    },
    evidence,
  };
}

function coverage(items) {
  const directCount = items.filter((item) => item.mapping.classification === 'direct').length;
  const transferableCount = items.filter((item) => item.mapping.classification === 'transferable').length;
  const ambiguousCount = items.filter((item) => item.mapping.classification === 'ambiguous').length;
  const gapCount = items.filter((item) => item.mapping.classification === 'gap').length;
  return {
    jobId: 'job-1',
    items,
    directCount,
    transferableCount,
    ambiguousCount,
    gapCount,
    supportedCount: directCount + transferableCount,
    totalCount: items.length,
    generatedAt: '2026-10-02T00:00:00.000Z',
  };
}

(async () => {
  const { buildOpportunityAssessment } = await import('../electron-runtime/src/shared/opportunity-assessment.js');
  const now = '2026-10-02T12:00:00.000Z';

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Administrative Coordinator', location: 'Remote - Annapolis, MD', descriptionSnippet: 'Remote role. Must coordinate vendor schedules.' }),
      track({ workModes: { values: ['remote'], strength: 'required' } }),
      coverage([requirement('r1', 'must-have', 'Must coordinate vendor schedules.', 'direct', { id: 'e1' })]),
      now,
    );
    assert.equal(result.eligibility.status, 'likely');
    assert.equal(result.careerAlignment.status, 'aligned');
    assert.equal(result.preferenceAlignment.status, 'aligned');
    assert.equal(result.evidenceCoverage.status, 'strong');
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Commercial HVAC Technician', location: 'Baltimore, MD', descriptionSnippet: 'On-site service role.', employmentType: 'Full-time' }),
      track({ roleTitles: ['Commercial HVAC Technician'], workModes: { values: ['remote'], strength: 'required' } }),
      coverage([requirement('r2', 'responsibility', 'Repair commercial HVAC systems.', 'direct', { id: 'e2' })]),
      now,
    );
    assert.equal(result.preferenceAlignment.status, 'misaligned');
    assert.equal(result.eligibility.status, 'unlikely');
    assert.ok(result.eligibility.blockers.some((item) => item.includes('Work mode is listed as on-site')));
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Registered Nurse', salaryMin: null, salaryText: null, descriptionSnippet: 'Active RN license required.' }),
      track({ roleTitles: ['Registered Nurse'], compensation: { floor: 45, target: null, basis: 'hourly', floorStrength: 'required' } }),
      coverage([requirement('r3', 'credential', 'Active RN license required.', 'direct', { id: 'e3' })]),
      now,
    );
    assert.equal(result.eligibility.status, 'unclear');
    assert.ok(result.preferenceAlignment.unknowns.some((item) => item.includes('does not provide enough pay detail')));
  }

  // The pay basis is read from salary text in its usual short forms (#216).
  for (const salaryText of ['$40 per hour', '$40/hr', '$40 per hr']) {
    const result = buildOpportunityAssessment(
      job({ title: 'Registered Nurse', salaryMin: 40, salaryMax: 40, salaryText, descriptionSnippet: 'Active RN license required.' }),
      track({ roleTitles: ['Registered Nurse'], compensation: { floor: 45, target: null, basis: 'hourly', floorStrength: 'required' } }),
      coverage([requirement('r3', 'credential', 'Active RN license required.', 'direct', { id: 'e3' })]),
      now,
    );
    assert.equal(result.eligibility.status, 'unlikely', `${salaryText} is compared with the hourly floor`);
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Registered Nurse', descriptionSnippet: 'Active RN license required.' }),
      track({ roleTitles: ['Registered Nurse'] }),
      coverage([requirement('r4', 'credential', 'Active RN license required.', 'ambiguous', { id: 'e4' })]),
      now,
    );
    assert.equal(result.eligibility.status, 'unclear');
    assert.equal(result.evidenceCoverage.status, 'limited');
    assert.ok(result.eligibility.potentialBlockers.some((item) => item.includes('support needs confirmation')));
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Customer Success Manager', descriptionSnippet: 'Lead customer onboarding programs.' }),
      track({ roleTitles: ['Customer Success Manager'] }),
      coverage([requirement('r5', 'responsibility', 'Lead customer onboarding programs.', 'transferable', { id: 'e5' })]),
      now,
    );
    assert.equal(result.eligibility.status, 'likely');
    assert.equal(result.evidenceCoverage.transferableCount, 1);
    assert.equal(result.evidenceCoverage.status, 'strong');
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Warehouse Supervisor', location: 'Baltimore, MD', descriptionSnippet: 'Lead warehouse operations and inventory control.' }),
      track({ roleTitles: ['Warehouse Supervisor'], workModes: { values: ['on-site'], strength: 'required' } }),
      coverage([requirement('r6', 'responsibility', 'Lead warehouse operations.', 'direct', { id: 'e6' })]),
      now,
    );
    assert.equal(result.eligibility.status, 'unclear');
    assert.equal(result.preferenceAlignment.status, 'mixed');
    assert.ok(result.preferenceAlignment.unknowns.some((item) => item.includes('does not explicitly identify a work mode')));
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Registered Nurse', descriptionSnippet: 'Full-time night shift. Active RN license required.' }),
      track({ roleTitles: ['Registered Nurse'], schedules: { values: ['night'], strength: 'required' } }),
      coverage([requirement('r-schedule-match', 'credential', 'Active RN license required.', 'direct', { id: 'e-schedule-match' })]),
      now,
    );
    assert.equal(result.preferenceAlignment.status, 'aligned');
    assert.equal(result.eligibility.status, 'likely');
    assert.ok(result.preferenceAlignment.matches.some((item) => item.includes('night')));
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Warehouse Supervisor', descriptionSnippet: 'This position works the night shift.' }),
      track({ roleTitles: ['Warehouse Supervisor'], schedules: { values: ['day'], strength: 'required' } }),
      coverage([requirement('r-schedule-miss', 'responsibility', 'Lead warehouse operations.', 'direct', { id: 'e-schedule-miss' })]),
      now,
    );
    assert.equal(result.preferenceAlignment.status, 'misaligned');
    assert.equal(result.eligibility.status, 'unlikely');
    assert.ok(result.eligibility.blockers.some((item) => item.includes('night')));
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Clinic Coordinator', descriptionSnippet: 'Day or evening shift openings are available.' }),
      track({ roleTitles: ['Clinic Coordinator'], schedules: { values: ['day'], strength: 'required' } }),
      coverage([requirement('r-schedule-partial', 'responsibility', 'Coordinate clinic operations.', 'direct', { id: 'e-schedule-partial' })]),
      now,
    );
    assert.equal(result.preferenceAlignment.status, 'mixed');
    assert.equal(result.eligibility.status, 'unclear');
    assert.ok(result.preferenceAlignment.unknowns.some((item) => item.includes('only some overlap')));
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Software Engineer', descriptionSnippet: 'Build production services and APIs.' }),
      track({ roleTitles: ['Customer Success Manager'] }),
      coverage([]),
      now,
    );
    assert.equal(result.eligibility.status, 'unclear');
    assert.equal(result.careerAlignment.status, 'misaligned');
    assert.equal(result.evidenceCoverage.status, 'unknown');
    assert.ok(result.unknowns.some((item) => item.includes('No explicit job requirements')));
  }

  {
    const result = buildOpportunityAssessment(
      job({ title: 'Operations Coordinator', location: '', sourceType: 'generic-html' }),
      track({ roleTitles: ['Operations Coordinator'], geography: { locations: ['Annapolis, MD'], radiusMiles: 25, strength: 'required' } }),
      coverage([]),
      now,
    );
    assert.equal(result.eligibility.status, 'unclear');
    assert.ok(result.preferenceAlignment.unknowns.some((item) => item.includes('does not provide enough location detail')));
    assert.ok(result.unknowns.some((item) => item.includes('may not expose every requirement or field')));
  }

  {
    const negatedOnCallDescriptions = [
      'Hybrid role with no on-call requirement.',
      'Hybrid role. On-call is not required.',
      'Hybrid role. This is not an on-call role.',
      'Hybrid role with no regular on-call rotation.',
    ];
    for (const descriptionSnippet of negatedOnCallDescriptions) {
      const result = buildOpportunityAssessment(
        job({ title: 'Operations Coordinator', descriptionSnippet }),
        track({
          roleTitles: ['Operations Coordinator'],
          onCall: { value: 'no', strength: 'required' },
        }),
        coverage([requirement('r-oncall-negated', 'responsibility', 'Coordinate operations.', 'direct', { id: 'e-oncall' })]),
        now,
      );
      assert.equal(result.preferenceAlignment.status, 'aligned', descriptionSnippet);
      assert.equal(result.eligibility.status, 'likely', descriptionSnippet);
      assert.ok(
        result.preferenceAlignment.matches.some((item) => item.includes('not required')),
        descriptionSnippet,
      );
    }
  }

  console.log('opportunity assessment tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
