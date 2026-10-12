# Universal User Story Validation Matrix

Parent program: #81  
Validation framework: #87

## Purpose

This matrix maps the normative Universal User Stories to materially different synthetic career contexts and records the final program disposition. It is a validation artifact, not market segmentation and not a collection of occupation-specific product modes.

A story is not considered universal because a TypeScript interface accepts optional strings. Validation combines the governed cross-career production-logic fixtures from #87 with story-specific persistence, validator, smoke, and representative Electron E2E coverage from each owning issue.

The matrix does **not** claim that every UI path was replayed ten times under ten cosmetic personas. The ten fixtures exist to pressure the shared domain rules and expose hidden career-shape assumptions; representative Electron paths prove that the consumer workflow reaches those same production boundaries.

## Fixture codes

| Code | Context | Primary pressure on the product |
| --- | --- | --- |
| `HL` | Hourly/local worker | hourly compensation, commute, schedule, local discovery |
| `TR` | Skilled trades | credentials/licenses, geography, hands-on experience |
| `HC` | Licensed healthcare | jurisdictional credentials, shifts, eligibility |
| `TE` | Technical/portfolio-heavy | projects, open source, portfolio evidence |
| `GR` | Recent graduate/first job | sparse employment history, education/projects |
| `EX` | Senior executive/confidential search | multiple tracks, seniority, discretion, compensation |
| `CC` | Career changer | transferable evidence, adjacent/stretch roles |
| `FG` | Federal/government applicant | eligibility, grade/process differences, specialized artifacts |
| `CF` | Contractor/freelancer | engagements, project evidence, non-permanent arrangements |
| `RT` | Return-to-work/nonlinear history | timeline gaps without negative inference, mixed evidence |

The governed fixture set covers all ten contexts above and is versioned under `docs/validation/`. The production regression harness exercises requirement extraction, requirement-to-evidence mapping, and selected-track opportunity assessment. Fixture findings have already caused production remediation rather than fixture-specific hacks, including the on-call negation correction and later schedule/credential/evidence-model work.

## Final disposition vocabulary

- `validated` - the story is implemented, its authority boundaries are preserved, and its owning issue records automated and/or representative Electron validation.
- `validated with explicit deferrals` - the universal story is complete, while narrower provider/field/format expansions are intentionally deferred with rationale and do not invalidate the core story.
- `deferred` - the story itself is not implemented and has a linked rationale. No final program row remains in this state.

## Final story matrix

All rows apply to the shared governed contexts `HL, TR, HC, TE, GR, EX, CC, FG, CF, RT` unless a narrower capability is explicitly documented as deferred.

| Story | Owner | Final disposition | Primary completion evidence |
| --- | --- | --- | --- |
| US-0 Adapt to the way my career works | #81 / #87 | validated | #82-#88 complete; governed ten-context fixtures; shared Career Evidence, Target Track, Opportunity, Application, and lifecycle boundaries |
| US-1 Resume-first onboarding | #82 | validated | PRs #90, #93, #99; native file-dialog Electron E2E; imported evidence remains review-required |
| US-2 No-resume onboarding | #82 | validated | PRs #90, #93; stepwise `user-authored` Career Evidence without requiring a resume chronology |
| US-3 Goal-first onboarding | #82 / #83 | validated | PR #99; durable target track plus explicit constraints without requiring completed evidence history |
| US-4 Multiple career targets | #83 | validated | PRs #92, #99, #100; durable named Target Tracks and explicit selected-track assessment |
| US-5 Hard constraints vs preferences | #83 | validated with explicit deferrals | required/preferred/target semantics complete; travel/relocation/sponsorship expansions deferred in #83 until repeated actionable evidence exists |
| US-6 Employment arrangements | #83 | validated | full-time, part-time, contract, temporary, internship, freelance, seasonal, other; schedule support added after fixture evidence |
| US-7 Nontraditional experience | #84 | validated | PRs #93, #103, #104; project, education, portfolio/reference, military-transition, nonlinear-history coverage through the same Career Evidence boundary |
| US-8 Credentials that matter | #84 | validated | structured issuer/jurisdiction/status/expiration/identifier; standing-aware deterministic matching |
| US-9 Evidence provenance | #84 / #59 | validated | source artifacts, extraction snapshots, verification state, bounded references, lineage, immutable submitted artifacts |
| US-10 Correct my record | #84 / #59 | validated | confirm/edit/reject/merge/supersede operations preserve history and authority transitions |
| US-11 Find employers/sources for me | #85 | validated with explicit deferrals | PRs #106, #107; selected-track discovery without ATS URL knowledge; additional provider classes remain evidence-backed expansions |
| US-12 Search beyond employer career pages | #85 | validated with explicit deferrals | provider-neutral discovery plus public-feed providers and existing acquisition families; USAJOBS hosted/credential access tradeoff explicitly deferred |
| US-13 Trust discovered sources | #85 | validated | explicit user approval before monitoring; unsupported/aggregator links remain opportunity-only |
| US-14 Explain eligibility | #86 | validated | PR #100; likely/unclear/blocker reasoning from collected requirements rather than hiring probability |
| US-15 Explain evidence coverage | #86 / #62 | validated | direct/transferable/ambiguous/gap mapping from confirmed Career Evidence |
| US-16 Explain career alignment | #86 | validated | assessment against explicitly selected Target Track rather than blended global intent |
| US-17 Explain preference alignment | #86 / #83 | validated with explicit deferrals | compensation, geography, work mode, schedule, employment arrangement, on-call, industry where represented; unmodeled concepts remain unknown/deferred rather than guessed |
| US-18 Show uncertainty | #86 | validated | missing listing data, extraction limitations, ambiguous mappings, and unknowns remain explicit and are not converted into score padding |
| US-19 Tailor my resume | #64 | validated | PR #76 and deterministic tailoring tests; only supported confirmed evidence may become factual resume claims |
| US-20 Explain resume changes | #64 | validated | version comparison/provenance and tailoring preview explain evidence selection and changes |
| US-21 Create application materials | #65 | validated | PR #111; versioned evidence-linked deterministic cover-letter projections with stale-evidence detection |
| US-22 Preserve what I submitted | #65 / #63 | validated | immutable/versioned resume artifacts linked to Applications and used by downstream interview preparation |
| US-23 Track applications | #65 | validated | durable application lifecycle state through outcomes without autonomous submission |
| US-24 Track people and events | #65 | validated | PR #108; durable contacts, interviews, deadlines, follow-ups, offers, and other milestones |
| US-25 Remind me when action is needed | #65 | validated | PR #108; native reminder timestamps and reversible completion state on lifecycle events |
| US-26 Prepare me for interviews | #65 | validated | PR #109; actual job + current evidence + exact submitted artifact, with gaps and historical/current claims distinguished |
| US-27 Show recurring gaps | #65 | validated | PR #113; repeated unsupported/ambiguous requirements synthesized while direct/transferable support suppresses false gaps |
| US-28 Show what is working | #65 / #88 | validated | PR #113; observed outcomes grouped by target track, source, source class, and opportunity category from saved lifecycle state |
| US-29 Help me reconsider strategy | #65 / #88 | validated | PR #113; minimum-sample guards and explicit observation/recommendation/caveat separation; no causal claims or activity quotas |
| US-30 Preserve my career history over time | #59 / #65 | validated with explicit deferrals | canonical Career Evidence persistence, versioned artifacts, PR #112 backup/restore, PR #114 JSON Resume adapter; OCR/DOCX explicitly deferred rather than becoming competing truth paths |

## Validation evidence by story family

### US-1 through US-3: onboarding

#82 closed complete after PRs #90, #93, and #99. Electron coverage includes resume-first through the native open-file dialog, no-resume/manual evidence entry, goal-first setup, invalid required-state behavior, partial setup, and restart persistence.

### US-4 through US-6: intent and constraints

#83 closed complete after the Target Track, selected-track assessment, governed fixture, and schedule tranches. The implementation distinguishes required/preferred/target semantics rather than magic weighting. Cross-career findings were used to decide which concepts earned core representation and which did not.

### US-7 through US-10: factual career history

#84 closed complete after direct user-authored evidence, structured credentials, portfolio/work-sample references, supersession lineage, and cross-career regression work. The implementation never infers negative meaning from employment gaps and does not create occupation-specific schema forks.

### US-11 through US-13: discovery and trust

#85 closed complete after PRs #106 and #107. Discovery begins from user intent rather than ATS knowledge, failures/partial coverage are visible, and monitoring requires explicit approval. Provider expansion remains modular and evidence-backed.

### US-14 through US-18: opportunity assessment

#86 closed complete after PR #100. The product removed the opaque universal fit percentage in favor of separate eligibility, evidence coverage, career alignment, preference alignment, blockers, and unknowns. The governed fixtures exercise materially different compensation, credential, arrangement, and career-history shapes through the production assessment logic.

### US-19 through US-30: truthful pursuit and search learning

R4/#64 completed deterministic tailoring and version explanation. R5/#65 completed the remainder across PRs #108-#114: lifecycle, submitted artifacts, interview preparation, Career Stories, application materials, backup/restore, structured offers, repeated-gap/outcome/strategy learning, and JSON Resume interoperability.

The search-learning read model remains descriptive. It cannot establish labor-market truth, silently edit Career Evidence, rewrite Target Tracks, or turn application counts into a success game.

## Explicit non-blocking deferrals

The following are deliberate evidence-based scope decisions, not hidden incomplete universal stories:

- additional discovery provider classes, including an official USAJOBS integration, await a consumer-compatible access model or measured coverage need (#85);
- travel tolerance, relocation, sponsorship/work-authorization, and broader employer exclusions await repeated cross-context evidence and reliable opportunity data (#83);
- OCR remains deferred because current import handles DOCX, text-bearing PDF, text, and paste, while image-only OCR has not demonstrated enough critical-path demand to justify local packaging cost or a new remote privacy boundary (#65, `docs/design/R5_PORTABILITY_SCOPE_DECISIONS.md`);
- DOCX output remains deferred because deterministic ATS-safe PDF plus structured JSON Resume interoperability currently cover the validated artifact needs without another renderer/parseability stack (#65, `docs/design/R5_PORTABILITY_SCOPE_DECISIONS.md`);
- optional remote inference remains non-blocking and may only return evidence-linked proposals if later product evidence promotes it into scope (#64/#59).

## Governing invariants retained

1. Career Evidence remains factual authority.
2. Goal is not evidence.
3. Preference is not automatically a hard constraint.
4. Parser/inference output is a proposal until user authority establishes fact.
5. User approval is required before discovered sources become monitored.
6. Job Ranger does not autonomously submit applications.
7. A single opaque fit percentage is not product truth.
8. Core workflows remain usable without inference.
9. Factual application artifacts trace to confirmed Career Evidence.
10. Search learning does not silently mutate strategy or factual history.
11. Occupation-specific knowledge does not fork the universal core.
12. Missing data stays unknown rather than being filled with confidence theater.

## Completion

The Universal User Stories program has current implementation and validation evidence for US-0 through US-30, with narrower expansions explicitly deferred where evidence does not justify core scope. The governed synthetic fixtures, production-logic regression suite, story-specific smoke/validator tests, and representative Electron E2E paths remain the standing regression contract after #81 closes.


## QOR Harden B1/B4: UI-driven acceptance beyond production-logic fixtures

The final dispositions above reflect the **original universal-story implementation program**. They do not mean every story has been completed end-to-end entirely through visible user interface controls. In particular, the existing `tests/pwa/career-ops.spec.ts` used read/write application runtime API calls for most workflow creation and state changes. The difference between a working domain backend and a usable interface is a release-quality boundary, not a cosmetic testing preference.

**Current acceptance candidate:** [#214](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/214), `tests/pwa/resume-first-ui-journey.spec.ts`. Its scoped healthcare-operations fixture crosses US-1, US-4, US-9/10, US-13–15, US-18/19, US-22/23, and US-30 through the actual onboarding, Career Profile, Target Tracks, Companies, Find Jobs, Applications and Resume UI. All user-side mutations are visible UI actions; internal APIs are used only for read-only authority checks. The exact steps, expected state and limitations are documented in [QOR_HARDEN_B1_RESUME_FIRST_UI_2026-10-09.md](./QOR_HARDEN_B1_RESUME_FIRST_UI_2026-10-09.md).

| UI journey | Synthetic context | Acceptance evidence | Scope disposition |
| --- | --- | --- | --- |
| Resume-first, imported and human-approved evidence through verified application resume | HC: healthcare operations | Playwright browser `tests/pwa/resume-first-ui-journey.spec.ts`; CI result on owning PR #214 required | One cross-story browser journey; **not** completion of B1/B4 |
| Resume-first native file picker and restart | Cross-career representative desktop fixture | Existing `tests/e2e/onboarding.spec.ts`; native Electron file-dialog boundary | Native import path only, not entire user journey |
| Full domain and PDF byte/parseability pipeline | HC: healthcare operations | Existing `tests/pwa/career-ops.spec.ts` with canonical API setup and selective UI steps | Backend invariants, **not** equivalent to UI-driven completion |
| No-resume and goal-first end-to-end UI | HL/GR/RT and other materially distinct contexts | Not yet added to the B1 journey suite | **Open** |
| Career changer multi-track UI and review | CC and transition contexts | Future separately scoped B1 story; don't infer additional requirements until clarified | **Open** |
| Evidence correction/rejection/merge and truthful resume statement editing | Cross-career | Existing focused tests, comprehensive UI journey not yet recorded | **Open** |
| Backup/restore, interrupted edits, installation and accessibility UX | Desktop and browser | Dedicated resilience/AX/drill matrices required | **Open** |

**Evidence promotion rule:** Do not mark an individual UI journey as passing until the owning final-head Linux and Windows PWA jobs pass its test. Passing this single journey may close its bounded issue, but it does not close B1, B2, B3, B4 or QOR Harden #194. Preserve career universality without generating fictitious persona-specific product modes.
