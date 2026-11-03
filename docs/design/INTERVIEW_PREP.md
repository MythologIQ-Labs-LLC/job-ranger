# Evidence-grounded interview preparation

Issue: #65

## Purpose

Interview preparation is a read-only projection over existing Sojourner authorities. It helps the user prepare to discuss a tracked opportunity without inventing career facts or forgetting what the employer actually received.

The preparation view composes three sources:

1. the saved tracked job and its extracted requirements;
2. confirmed/user-authored Career Evidence and the existing requirement-to-evidence mapping boundary;
3. the immutable snapshot of the latest resume artifact recorded as `submitted` for the application.

No new factual truth store is introduced.

## Key distinction

Confirmed evidence and submitted evidence are not the same thing.

A Career Evidence fact may legitimately support a requirement even when it did not appear on the resume sent to the employer. Career Evidence may also be corrected after an application is submitted. Interview prep therefore preserves three submission relationships for the evidence currently supporting a requirement:

- `exact`: the current evidence record itself was linked to a statement in the submitted artifact;
- `superseded`: an explicit predecessor of the current evidence record was linked to a submitted statement, so the employer saw an earlier claim while the current Career Evidence record has since changed;
- `none`: neither the current evidence record nor one of its explicit superseded predecessors appeared in the submitted artifact.

The immutable artifact snapshot remains authoritative for the exact wording Sojourner knows the employer received. Career Evidence remains authoritative for the user's current factual record. Evidence lineage connects those authorities without rewriting either one.

When evidence was not submitted, Sojourner explicitly tells the user to treat it as additional context rather than implying the employer already saw it. When a submitted predecessor has since been superseded, Sojourner shows both the earlier submitted wording and the current evidence, and prompts the user to explain the current record accurately rather than repeat outdated wording.

## Requirement preparation

Each extracted requirement retains the existing deterministic classification:

- direct;
- transferable;
- ambiguous;
- gap.

The preparation cue is derived from that classification, current Career Evidence, submission relationship, and immutable submitted artifact. It does not predict an interview question, hiring probability, or recruiter reaction.

A gap remains a gap. Sojourner tells the user to decide how to address it honestly rather than fabricating a substitute experience.

## Submitted-artifact selection

When more than one resume artifact is recorded as `submitted` for an application, interview prep uses the most recently recorded submission. Ordering is deterministic: recorded time, artifact version, artifact creation time, then artifact ID.

If the newest submitted artifact snapshot is unreadable, Sojourner warns rather than silently substituting an older artifact and pretending that older file was the latest submission.

## Missing-context behavior

Preparation fails honestly rather than guessing:

- if the original tracked job record is missing, requirement-specific prep is unavailable;
- if no exact submitted artifact is linked, Career Evidence may still be used but Sojourner cannot claim what the employer saw;
- if an artifact snapshot is unreadable, the submitted-resume portion is omitted and a warning is shown;
- if no explicit requirements can be extracted, coverage remains unknown.

## Inference boundary

No inference provider is required for this feature.

A future optional inference provider may propose better practice questions or evidence-bound phrasing, but it may not:

- establish new Career Evidence;
- rewrite a gap into support;
- change whether evidence or one of its predecessors was actually submitted;
- erase the distinction between current evidence and earlier submitted wording;
- claim that a predicted question will be asked;
- generate unsupported STAR stories as factual career history.

## Validation

Repository health proves:

- preparation is grounded in a real tracked job;
- exact submitted artifact snapshot/version is identified;
- submitted evidence and confirmed-but-not-submitted evidence remain distinct;
- a submitted evidence record that is later superseded remains visible as the employer-facing earlier claim while its successor remains current Career Evidence;
- missing artifact/job state produces warnings rather than invented context;
- gaps/ambiguity remain visible.

Electron E2E proves the ordinary consumer view displays the exact submitted claim, additional confirmed evidence, and their different submission states without a fit percentage or hiring-probability claim.
