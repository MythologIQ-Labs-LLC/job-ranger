# Universal User Stories

**Implementation program:** #81 — completed  
**Contract status:** normative and maintained

## Purpose

Sojourner should work across materially different career paths without requiring the product to know what a “normal” career looks like.

The product contract is expressed through **user stories**. Career archetypes and synthetic personas are validation fixtures only. They exist to expose hidden assumptions, not to define separate versions of Sojourner.

The original implementation issues (#82 through #88) are now historical ownership/provenance. Future changes to these stories should be tracked through new issues rather than reopening completed tranche issues merely to reuse their numbers.

## North-star user story

> **US-0:** As a job seeker, I want Sojourner to adapt to the way my career works without requiring me to understand how Sojourner works.

## Governing rules

1. Career Profile owns broad intent/preferences, not factual career history.
2. Target Tracks own per-direction search intent and constraint strength.
3. Career Evidence owns factual career history and provenance.
4. Applications own the search lifecycle.
5. Parsers, discovery providers, and inference providers may propose information; they do not establish factual truth.
6. Core workflows remain useful without inference.
7. Unknown information remains unknown rather than becoming an arbitrary negative or positive signal.
8. Hard constraints and preferences have different semantics.
9. Occupation-specific concepts may extend the universal core through bounded vocabularies/rules, but must not fork the product into occupation-specific applications.
10. Universality must not be implemented as an unbounded entity/attribute/value schema that erases meaning.
11. Consequential external actions remain under user authority.

## User-story catalog

### Start from whatever I have

#### US-1 — Resume-first onboarding

As a job seeker with an existing resume, I want to import it so Sojourner can build an initial evidence set without making me retype my career history.

Implementation provenance: #82 plus the Career Evidence import architecture from #59.

#### US-2 — No-resume onboarding

As a job seeker without a resume, I want to describe my background incrementally so I can use Sojourner without first creating a traditional resume.

Implementation provenance: #82/#84.

#### US-3 — Goal-first onboarding

As a user who knows what I want but has not entered my history yet, I want to start with target work and constraints so Sojourner can begin helping immediately.

Implementation provenance: #82/#83.

### Describe what I want

#### US-4 — Multiple career targets

As a job seeker pursuing more than one career direction, I want separate target tracks so Sojourner does not mix incompatible goals.

Implementation provenance: #83.

#### US-5 — Hard constraints vs preferences

As a job seeker, I want to distinguish requirements from preferences so Sojourner does not reject a good opportunity because of something I merely prefer.

Implementation provenance: #83.

#### US-6 — Employment arrangements

As a user, I want to specify acceptable work arrangements without Sojourner assuming permanent salaried full-time employment.

Implementation provenance: #83.

### Represent what I can actually prove

#### US-7 — Nontraditional experience

As someone whose experience is not entirely conventional employment, I want legitimate projects, freelance work, open-source work, volunteer work, military/service experience, portfolios, and other evidence to participate in matching.

Implementation provenance: #84.

#### US-8 — Credentials that matter

As someone in a credentialed field, I want licenses, certifications, clearances, registrations, and eligibility facts represented explicitly rather than flattened into generic skills.

Implementation provenance: #84.

#### US-9 — Evidence provenance

As a user, I want every factual claim to remain traceable to its source and authority state.

Implementation provenance: #84 and the Career Evidence contracts under #59.

#### US-10 — Correct my record

As a user, I want to edit, merge, reject, supersede, and confirm evidence when the imported record is incomplete, duplicated, or wrong.

Implementation provenance: #84 and Career Evidence review/lineage behavior.

### Find opportunities

#### US-11 — Find employers and sources for me

As a user who knows the kind of work I want but not which companies hire for it, I want Sojourner to discover likely employers and opportunity sources.

Implementation provenance: #85.

#### US-12 — Search beyond employer career pages

As a user, I want Sojourner to discover opportunities from relevant source classes without requiring me to understand ATS vendors or career-page URLs.

Implementation provenance: #85.

#### US-13 — Trust discovered sources

As a user, I want to review and approve discovered sources before Sojourner begins monitoring them.

Implementation provenance: #85.

### Decide what deserves attention

#### US-14 — Explain eligibility

As a user, I want to know whether I appear eligible for an opportunity and what requirement could block me.

Implementation provenance: #86.

#### US-15 — Explain evidence coverage

As a user, I want to see which requirements my evidence directly supports, which are transferable, which are ambiguous, and which remain gaps.

Implementation provenance: #86 and R2 requirement/evidence mapping.

#### US-16 — Explain career alignment

As a user, I want to know whether an opportunity advances the career direction represented by the selected target track.

Implementation provenance: #86.

#### US-17 — Explain preference alignment

As a user, I want to understand alignment with compensation, geography, work mode, schedule, employment arrangement, and other preferences/constraints I supplied.

Implementation provenance: #83/#86.

#### US-18 — Show uncertainty

As a user, I want Sojourner to distinguish known match, known mismatch, missing information, and uncertain interpretation.

Implementation provenance: #86.

### Pursue opportunities truthfully

#### US-19 — Tailor my resume

As a user, I want Sojourner to emphasize relevant verified experience for a specific opportunity without introducing unsupported claims.

Implementation provenance: #64/#88.

#### US-20 — Explain resume changes

As a user, I want to see what changed between resume versions and why.

Implementation provenance: #64/#88.

#### US-21 — Create application materials

As a user, I want Sojourner to help create application materials from confirmed Career Evidence.

Implementation provenance: #65/#88.

#### US-22 — Preserve what I submitted

As a user, I want the exact resume and application materials associated with an Application so I know what the employer received.

Implementation provenance: #65/#88.

### Manage the search

#### US-23 — Track applications

As a user, I want to track each opportunity through interest, application, interview, offer, rejection, withdrawal, and other outcomes.

Implementation provenance: base Applications workflow plus #65/#88.

#### US-24 — Track people and events

As a user, I want to record recruiters, hiring managers, interviews, deadlines, follow-ups, and important dates.

Implementation provenance: #65/#88.

#### US-25 — Remind me when action is needed

As a user, I want reminders for follow-ups, interviews, application deadlines, and other meaningful events.

Implementation provenance: #65/#88.

#### US-26 — Prepare me for interviews

As a user, I want interview preparation grounded in the actual job, confirmed Career Evidence, and exact submitted materials.

Implementation provenance: #65/#88.

### Learn from the search

#### US-27 — Show recurring gaps

As a user, I want to see requirements that repeatedly appear in jobs I want but that my confirmed evidence does not support.

Implementation provenance: #65/#88.

#### US-28 — Show what is working

As a user, I want to see which target tracks, opportunity types, sources, and approaches correlate with downstream progress in my actual application history.

Implementation provenance: #65/#88.

#### US-29 — Help me reconsider strategy

As a user whose search is not producing downstream progress, I want Sojourner to surface evidence-based strategy signals without inventing causal certainty or reducing the search to activity quotas.

Implementation provenance: #65/#88.

#### US-30 — Preserve my career history over time

As a user, I want Sojourner to maintain an increasingly complete Career Evidence record rather than reconstructing my history from each new resume.

Implementation provenance: Career Evidence architecture, portability, and #88 reconciliation.

## Universal opportunity assessment

Sojourner does not reduce every opportunity to one opaque universal percentage.

The user-facing assessment separates at least:

- **eligibility/blockers**;
- **evidence coverage**;
- **career-track alignment**;
- **preference/constraint alignment**;
- **unknowns/uncertainty**.

A compact summary is acceptable, but users must be able to inspect the evidence, requirement, constraint, or source limitation behind the conclusion.

## Progressive onboarding

First-run setup supports three valid entry paths:

1. **resume-first** — import an existing artifact and review proposed evidence;
2. **evidence-first/manual** — enter relevant background incrementally without a resume;
3. **goal-first** — define target work and initial constraints, then add evidence later.

Partial profiles are valid product states. Sojourner becomes more useful as information is added rather than refusing to work until a large form is complete.

## Target tracks and constraint semantics

A user may pursue materially different directions at the same time.

A Target Track may contain role concepts, compensation, geography, work mode, employment arrangement, schedule, and other supported preferences.

Preferences distinguish:

- **required** — violating this makes the opportunity unacceptable unless the user changes the requirement;
- **preferred** — meaningful but not automatically disqualifying;
- **target** — aspirational value such as target compensation rather than a hard floor.

Capabilities such as travel, relocation, or sponsorship remain bounded/deferred unless repeated validation shows they deserve first-class core fields.

## Validation model

The implementation program established a version-controlled cross-career validation matrix and synthetic fixtures covering materially different career contexts, including:

- hourly/local work;
- skilled trades;
- licensed healthcare;
- technical/portfolio-heavy work;
- recent graduate/first job;
- senior executive/confidential search;
- career change/transferable skills;
- federal/government employment;
- contract/freelance work;
- return-to-work/nonlinear history;
- military transition.

These are validation fixtures, not target-market segments or separate product modes.

Future changes that materially affect US-0 through US-30 should update the validation matrix and representative fixtures rather than assuming the completed program can never regress.

## Program completion

The original #81 program is complete.

Completion established that:

- every US-0 through US-30 story is implemented by the current product contract or explicitly bounded/deferred with rationale;
- the validation matrix is version-controlled;
- cross-career fixtures exercise materially different employment/evidence patterns;
- current roadmap/system documentation reflects the resulting architecture.

This document remains normative after program closure. Completing the implementation program did not freeze product evolution; it established the baseline future work must preserve.
