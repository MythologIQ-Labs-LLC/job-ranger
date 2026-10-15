# Governance Index

**Last Reviewed**: 2026-10-09

A single authoritative map of every governance artifact in this project, organized
into six freshness tiers with explicit drift contracts. A stale entry here is
itself a Tier 1 drift bug, so the index is self-policing. See
`qor/references/doctrine-governance-index.md` (ships with the installed Qor-logic-plus skills, not this repo) for the model and contracts.

## Tier 1 — Canonical Source

MUST be current at every cycle close. Drift signal: wrong version / wrong state / missing recent entries.

| Artifact | Path | Freshness marker |
|----------|------|------------------|
| Meta Ledger | `docs/META_LEDGER.md` | latest sealed entry (#27, Phase 5 seal) |
| System State | `docs/SYSTEM_STATE.md` | snapshot date 2026-10-06 |
| Concept | `docs/CONCEPT.md` | stable |
| Architecture Plan | `docs/ARCHITECTURE_PLAN.md` | stable |
| Backlog | `docs/BACKLOG.md` | open items current |
| Governance Index | `docs/GOVERNANCE_INDEX.md` | Last Reviewed date current |
| Feature Index | `docs/FEATURE_INDEX.md` | every row's status matches its cited test |
| Changelog | `CHANGELOG.md` | latest release stamped |
| README | `README.md` | badges current |

## Tier 2 — Doctrine & Policy

Stable; changes are explicit doctrine events. Drift signal: rules contradict each other or operator memory.

| Artifact | Path |
|----------|------|
| Shadow Genome | `docs/SHADOW_GENOME.md` |
| Process Shadow Genome | `docs/PROCESS_SHADOW_GENOME.md` |
| Project governance | `GOVERNANCE.md` |
| Security policy | `SECURITY.md` |
| Contributing | `CONTRIBUTING.md` |
| Code of conduct | `CODE_OF_CONDUCT.md` |
| Third-party notices | `THIRD_PARTY_NOTICES.md` |
| Branding | `docs/BRANDING.md` |
| Trademarks | `TRADEMARKS.md` |
| License history | `LICENSE_HISTORY.md` |
| Architecture decision records | `docs/adr/README.md`, `docs/adr/*.md` |

## Tier 3 — Active Initiative

Live until close; ages out at substantiate. Drift signal: shipped feature still tracked as pending.

| Artifact | Path | Opened |
|----------|------|--------|
| v1.3.0 release candidate | `docs/validation/RELEASE_CANDIDATE_V1.3.0.md` | 2026-10-06 |
| Roadmap | `docs/planning/PLAN.md` | current as of 2026-10-05 |
| Release readiness | `docs/RELEASE_READINESS.md` | ongoing |
| Product gap review | `docs/PRODUCT_GAP_REVIEW.md` | ongoing |
| Universal user story matrix | `docs/validation/UNIVERSAL_USER_STORY_MATRIX.md` | ongoing |

## Tier 4 — Per-Plan Artifact

Live for plan duration; archived at substantiate. Drift signal: plan shipped but artifact still presents as open.

Status below is quoted from the Meta Ledger. All are historical; they remain in `docs/` and are due for archival (BACKLOG H1).

| Artifact | Path | Plan |
|----------|------|------|
| Remediation plan | `docs/plan-remediation.md` | not named in the ledger; its header targets the 12 violations from ledger #2 (VETO), followed by #3 (VETO) and #4 (PASS of the final remediation plan) |
| Final remediation plan | `docs/plan-final-remediation.md` | PASS at ledger #4, implemented #5, verified #6; no SEAL entry |
| V1 remediation plan | `docs/plan-v1-remediation.md` | PASS at ledger #10, implemented #11, verified #12; no SEAL entry (ledger footer: Phase 1 "COMPLIANT") |
| Phase 2 API adapters | `docs/plan-phase2-api-adapters.md` | sealed (ledger #13–#15) |
| Phase 3 salary extraction | `docs/plan-phase3-salary-extraction.md` | sealed (ledger #16–#19) |
| Phase 4 caching & circuit breaker | `docs/plan-phase4-caching-circuit-breaker.md` | sealed (ledger #20–#23) |
| Phase 5 notifications & tray | `docs/planning/plan-phase5-notifications-tray.md`, `docs/planning/plan-phase5-notifications-tray-v2.md` | sealed (ledger #24–#27) |
| Phase 6 Windows runtime fixes | `docs/plan-qor-phase6-windows-runtime-fixes.md` | PLAN #32, VETO #33, PASS #34, implemented #35, sealed #36 |
| Phase 8 PWA reload test race | `docs/plan-qor-phase8-pwa-reload-test-race.md` | PLAN #37, VETO #38, PASS #39, implemented #40, sealed #41 |
| Phase 7 web runtime Tailwind source | `docs/plan-qor-phase7-pwa-tailwind-source.md` | PLAN #42, PASS #43, implemented #44, sealed #45 (rebased onto Phase 8; originally #37-#40) |
| Phase 9 form-control shell layer | `docs/plan-qor-phase9-input-shell-layer.md` | PLAN #46, VETO #47-#49, PASS #50, implemented #51, sealed #52 |
| Phase 10 public demo harness | `docs/plan-qor-phase10-public-demo-harness.md` | PLAN #53, VETO #54, PASS #55, implemented #56, sealed #57 |
| Phase 11 public-review README | `docs/plan-qor-phase11-public-review-readme.md` | PLAN #58, VETO #59, PASS #60, implemented #61, sealed #62 |
| Phase 12 demo video | `docs/plan-qor-phase12-demo-video.md` | PLAN #63, PASS #64, implemented #65, sealed #66 |
| Phase 13 inference contract review | `docs/plan-qor-phase13-inference-contract-review.md` | PLAN #67, VETO #68-#70, remediate, PASS #71, implemented #72, sealed #73 |
| Phase 14 inference Slice A | `docs/plan-qor-phase14-inference-slice-a.md` | PLAN #74, VETO #75, PASS #76, implemented #77, sealed #78 |
| Phase 15 mapper negation (G12) | `docs/plan-qor-phase15-mapper-negation.md` | PLAN #79, VETO #80-#83, remediate, user-approved override, PASS #84, implemented #85, sealed #86 |
| Phase 16 mapper claim action (G13) | `docs/plan-qor-phase16-mapper-claim-action.md` | PLAN #87, VETO #88-#91, remediate (gate-loop), user-approved overrides, PASS #92, implemented #93, sealed #94 |
| Phase 17 public discovery providers (#136) | `docs/plan-qor-phase17-provider-tranche.md` | iteration 2 recorded (PLAN); independent audit pending; WWR phase HELD on publisher terms |

## Tier 5 — Reference Material

Informational, slow-drift. Drift signal: factual claims diverge from current code.

| Artifact | Path |
|----------|------|
| Docs index | `docs/README.md` |
| Design records | `docs/design/*.md` |
| Research | `docs/research/*.md` |
| Validation evidence | `docs/validation/*.md` |
| Build runtime | `docs/BUILD_RUNTIME.md` |
| Distribution trust | `docs/DISTRIBUTION_TRUST.md` |
| Clean-machine trust validation | `docs/CLEAN_MACHINE_TRUST_VALIDATION.md` |
| Tester installation | `docs/TESTER_INSTALLATION.md` |
| Self-hosting guide | `docs/SELF_HOSTING.md` |
| Windows package validation | `docs/windows-package-validation.md` |
| User help | `HELP.md` |

## Tier 6 — Archived

Frozen historical record. Drift signal: none (frozen).

| Archive | Path |
|---------|------|
| Superseded desktop sources | `archive/` |

## How to add a governance artifact

1. Create the file in the same commit that registers it here.
2. Add a row to the tier whose freshness contract matches the file's lifecycle.
3. Refresh **Last Reviewed** above.

## How to retire a governance artifact

1. Move the file to the Tier 6 archive path.
2. Move its row from its live tier to Tier 6 (or delete it if superseded).
3. Refresh **Last Reviewed** above.
