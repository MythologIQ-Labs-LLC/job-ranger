# RFC: Human source-review gate for structural economic context

**Status:** Proposed for review; design only  
**Date:** 2026-10-09  
**Parent:** [#217](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/217)  
**Implementation gate:** [#221](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/221)  
**Existing deterministic contract:** `src/shared/structural-signals.ts` (PR #220)

## Decision requested

Before any external market data enters a user-facing Job Ranger pathway, require a separate human-verification record for *source identity*, *claim fidelity*, *methods*, and *quotation/reuse rights*. The current `reviewState: "reviewed"` field is self-described metadata, not proof of any of these conditions. **Do not reinterpret or silently promote that enum.**

This RFC defines a review packet and fail-closed display eligibility policy, **not** a provider, web retriever, scoring system, database migration, or permission to present reviewed claims to users. First acceptance must use fictional, locally bundled synthetic examples only. No production UI is authorized by this RFC alone.

## Authority separation

Four independent questions must remain distinguishable:

1. **Is the citation resolvable and genuinely from the claimed publisher?** Human reviewer verifies original publisher domain and/or official document identity through an independent channel, and records how. HTTPS and a title are insufficient.
2. **Does the source actually make the summarized claim?** Reviewer checks context, time, measurements, denominator, sample and whether an estimate or projection was recast as an observation.
3. **May Job Ranger reproduce the excerpt?** Human review of the actual license, publisher terms or specific permission; link-only unless permission is established. This is a rights check, not a statement that link-only content is independently accurate.
4. **Is the claim usable as bounded context?** Reviewer confirms matching geography, sector, business model and observed period; limitations and counterevidence remain visible. Passing a review **never** authenticates a prediction or an individual's prospects.

A claim with no sufficient source proof remains quarantined. Disputes and withdrawals override earlier favorable reviews. Contradictory, verified observations must coexist; reviewers cannot choose a winner by deletion.

## Proposed review packet (not persisted yet)

A proposed **session-only** packet references a validated `StructuralSignal.id` and the exact reviewed input digest. It must include:

| Field | Meaning / acceptance |
| --- | --- |
| signalId, sourceDigest | Stable signal identifier plus digest of canonical source/claim fields; mismatch invalidates the review |
| reviewerAttestation | Explicit human action and review date; no automatic or inferred attestation |
| publisherVerification | Verified / unresolved / contradicted; method and non-sensitive verification reference required for verified |
| fidelityVerification | Faithful / misleading / unconfirmed; observation-versus-projection and original methodology verified |
| rightsVerification | Link-only / excerpt-permitted / unresolved; basis recorded, no quotation while unresolved |
| scopeVerification | Matching / partial / out-of-scope, plus reviewer rationale for geography, industry and model |
| lifecycle | Pending / reviewed-for-context / disputed / withdrawn; changed source digest resets to pending |
| methodologicalCautions | Bounded, plain-language limitations, including sample and date |
| counterSignalIds | Validated IDs preserved even when review complete |
| decisionRecord | Timestamp supplied by explicit caller, reviewer reason and packet policy version |

**Do not collect** user names, browsing history, personal salary, family circumstances, resume excerpts or career evidence in a source-review packet. Human attestation is not a user identity registry. Review notes must not contain arbitrary HTML or unbounded source passages.

## Conservative display matrix

| Situation | Allow in future synthetic UX prototype? | Production authority |
| --- | --- | --- |
| No signal or no source evidence | Show “Evidence unavailable” and open questions | None |
| URL passes shape validation, no human check | Display only in explicitly labeled isolated review workbench | None |
| Identity verified, claim fidelity unresolved | Review workbench only, no factual statement | None |
| Claim verified but quotation rights unclear | Paraphrase only if separately approved; otherwise link-only in review workbench | None |
| Human-reviewed observation, exact scope, limits documented | Candidate for **future** contextual display after UX authorization | Context, never prediction |
| Reviewed projection or inference-proposed scenario | Clearly labeled hypothesis in future prototype only | Hypothesis only |
| Stale, contradictory, disputed or withdrawn claim | Keep caution and counterevidence visible; withdrawn never represented as current evidence | None as unqualified evidence |
| Task exposure offered as company or industry extinction proof | Reject causal promotion regardless of other flags | None |

All scenarios remain `authority: "hypothesis-only"`. No score, ranking, automation-proof badge, confidence percentage, employer closure prediction, or automatic pathway recommendation.

## Session-only prototype decision

**Recommended:** a separate, opt-in, synthetic-only review workbench within the existing app architecture, **after** design review and explicit authorization. Do not attach it to the default career journey, allow session contents to persist, or create shadow `localStorage` databases. It should render two or more parallel outcomes with the originating signal, counterevidence, dates, geographic applicability, rights state and specific unresolved questions. The workbench must clearly label all cases fictional and must not hydrate production Track state.

**Not approved:** live feed, scraping, automated source verification, saving review packets, inference, business-disappearance alerts, or production decision recommendations.

## Adversarial acceptance plan

All examples are fictional fixtures, not researched market facts.

1. **Source spoofing:** matching title on a lookalike HTTPS host stays unresolved. A valid URL does not pass publisher verification.
2. **Misquotation:** a source reporting exposure of tasks cannot validate disappearance of firms. Reject the claim even if other metadata is reviewed.
3. **Date mutation:** source claim, publisher, dates, scope, reuse basis or excerpt changes after attestation invalidate its digest-bound review.
4. **Competing outcomes:** SaaS consolidation and small-firm entry appear side by side with opposing observations intact; no hidden winner.
5. **Scope divergence:** national study does not become a local forecast; healthcare licensing, trades and local service constraints remain explicit.
6. **Stale and withdrawn:** an old or retracted observation cannot silently appear current.
7. **Rights:** license unclear means no direct excerpt; do not pretend source review grants quotation rights.
8. **No evidence:** show unknown, not low risk or high risk.
9. **Stay employed:** user may leave the exploration unchanged, with no coercion or mutation to Target Tracks.
10. **Financial isolation:** the Stage A income scratchpad remains optional, unsaved, user-authored; no claims or numbers flow to it from scenarios.
11. **Inference attempt:** a model-proposed packet cannot assert human verification or alter Career Evidence or the resume Truth Gate.
12. **Lifecycle and platform:** refresh clears prototype state; keyboard/screen-reader checks and PWA/Electron parity are required before any display PR merges.

Test fail-closed behavior first, then review human comprehension through representative tasks. Unit-green is not permission to call a user-facing workflow useful.

## Required subsequent decisions

- Approve or reject synthetic-only UX prototype, including exact route/entry point, accessibility acceptance and copy.
- Decide whether independent source authentication will ever be supported in-app or remain an offline human process.
- Before live network access: provider terms/licensing, allowlisting, DNS rebinding and SSRF protection, secrets, budgets, retries and audit boundaries.
- Before durable records: canonical SQLite owner, schema migration, PWA/Electron parity, backup/restore, portable export, deletion, retention and rollback.
- Before a production claim display: third-party source recheck, recency, correction/withdrawal flow, counterevidence policy and human comprehension evidence.

## Exit criteria for #221 design gate

Complete **design** when the packet contract, authority table, source rights rule, contradiction preservation, synthetic UX acceptance tests, privacy decision and explicit prototype yes/no decision are reviewed. Do **not** close #217 on that basis. Whole-product release readiness remains **INCONCLUSIVE**, independent of contract CI success.
