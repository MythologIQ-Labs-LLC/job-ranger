# Search Learning and Offer State

Issue: #65
User stories: US-27, US-28, US-29

## Purpose

Sojourner can learn from the user's own saved search history without pretending that a small local sample is the labor market and without allowing analytics to mutate Career Evidence or search intent.

The governing relationship is:

`Saved opportunities + explicit target context + requirement mappings + application lifecycle/outcomes -> observations -> optional strategy suggestions`

Never:

`observations -> silent profile/evidence/target-track mutation`

## Explicit application context

An application may be assigned to one target track by the user. Sojourner does not infer this association from the job title, because a single title can participate in different career directions and a user may intentionally pursue adjacent or stretch work.

Unassigned applications remain visible as unassigned in analysis. Missing context is not repaired by guessing.

## Offer state

Offer details are first-class local application state rather than generic notes hidden inside an event. The bounded record supports:

- status;
- base pay, pay basis, and currency;
- bonus or variable-compensation notes;
- equity notes;
- benefits/other terms;
- start date;
- response deadline;
- negotiation notes.

Offer state belongs to the application lifecycle. It is not Career Evidence and does not prove compensation history or establish facts about the user's career.

## Repeated-gap analysis

A requirement participates in recurring-gap analysis only when:

1. it belongs to a tracked application's saved job;
2. it is a must-have, preferred, or credential requirement;
3. no saved requirement mapping classifies it as `direct` or `transferable` support.

`ambiguous`, `gap`, or unmapped requirements remain unsupported observations. Repeated gaps are grouped by normalized term when available and otherwise by bounded requirement text.

A recurring gap means only: Sojourner repeatedly observed a requirement for which the current saved evidence mapping does not show support. It does not prove the user lacks the capability. The user may need to add/confirm existing evidence, build the capability, or pursue different opportunities.

## Outcome observations

Search Insights uses saved application/lifecycle state only. It may group observed counts by:

- explicitly assigned target track;
- source type;
- deterministic source class;
- saved opportunity employment category.

The current `Applied` count is explicitly the number of applications whose current status is `applied`. Sojourner does not reconstruct a historical applied-stage event that was never stored.

Interview activity is observed when the application is currently at interview/offer or has a saved interview event. Offer activity is observed when the application is currently at offer or has an offer event/structured offer record.

These counts are local search history, not market benchmarks.

## Strategy signals

Strategy signals must separate three things in the user interface and data contract:

1. **observation**: what the saved data shows;
2. **possible next step**: a user-controlled action worth considering;
3. **caveat**: the observation does not establish causation or external market truth.

Minimum sample guards prevent false precision:

- fewer than three tracked applications produces an insufficient-history signal;
- lack-of-interview feedback is not suggested until at least five tracked applications exist;
- interview-without-offer feedback requires at least three observed interview applications;
- source-pattern comparisons require at least three applications in each compared source group;
- recurring-gap strategy feedback requires the same gap across at least three applications.

Sojourner does not recommend arbitrary application-volume quotas. It does not claim that a source, resume, target track, or behavior caused an observed result.

## Authority boundary

Search learning may propose that the user inspect or reconsider:

- evidence completeness;
- opportunity selection;
- target-track alignment;
- source mix;
- interview preparation;
- submitted materials.

It may not:

- edit or create Career Evidence;
- change target-track constraints or assignment automatically;
- change application status;
- infer missing lifecycle events as facts;
- transform correlations into causal claims;
- compare the user against invented external benchmarks.

## Validation

Repository health must prove:

- target-track association is explicit and persists;
- unassigned applications remain unassigned;
- offer details persist and cascade with their application;
- direct/transferable mappings suppress false repeated gaps;
- an unsupported requirement repeated across applications is surfaced;
- grouped outcomes use saved target/source/opportunity data;
- strategy signals include causality caveats and sample thresholds;
- no learning operation mutates Career Evidence or target tracks.
