# Plan: Phase 17 - Public discovery provider tranche: Himalayas (authorized scope) and We Work Remotely (HELD) (#136)

**change_class**: feature

**doc_tier**: standard

**terms**:
- term: provider eligibility text
  home: electron/src/source-discovery.cts

**boundaries**:
- limitations: desktop runtime only for Himalayas (the publisher sends no CORS header); at most 3 role searches per discovery; role-title matching is substring/token based and is not a relevance model
- non_goals: We Work Remotely enablement or release; PWA access to either provider; pagination; location as a hard filter; employer monitoring from provider links
- exclusions: no proxy, credential, scraping, application submission, new dependency or change to `SourceDiscoveryProviderId`

**pr_target**: main

**risk_grade**: L2 (untrusted network JSON on the acquisition boundary; no new authority)

**iteration**: 4

## Iteration history

- Iteration 1 (`docs/plans/136-provider-expansion.md`, commit `9965119`) was never recorded or audited. It cited a nonexistent `qortara` CLI, lived outside the governed plan path, and lacked the canonical sections.
- Iteration 2 (META_LEDGER Entry #95) was VETOed at Entry #96 by an independent fresh-context judge, with findings V1-V10. Iteration 3 closes each finding:
  - V1: the time-zone format is defined (LD3), so the existing `UTC-05:00` assertions remain valid.
  - V2: the E2E row no longer claims to check the link target. The host check is a unit assertion.
  - V3: see Delivery path.
  - V4: Candidate scope lists the full candidate diff, and LD5 now cites the candidate.
  - V5: see the Phase 0 refactor.
  - V6: corrected to 149.
  - V7: reject-branch tests added.
  - V8: LD7 response byte caps.
  - V9: compile-first CI order, and named red assertions.
  - V10: ASCII literal.
- Iteration 3 (Entry #97) was VETOed at Entry #98 by a second, separate fresh-context judge. That judge confirmed V1-V8 and V10 closed and V9 partial, and raised N1-N4. Iteration 4 closes them:
  - N1 / V9: Phase 1 tests are split into red-first and regression-lock groups. The split was determined empirically against the compiled candidate, and the `main` evidence is stated truthfully.
  - N2: the PWA claim is dropped; web-skip coverage is a named unit test.
  - N3: LD3 adds a time-zone list length rule and a 37-entry red-first test.
  - N4: Phase 0 adds an exact-output golden test, with a duplicate fixture and a low limit.

The installed governance runtime is `qor-logic-plus 3.8.0`. No `qortara` executable exists on this host, and `MythologIQ-Labs-LLC/qortara-logic` states that no runtime has been migrated into it yet.

## Provenance of existing code (binding disclosure)

Draft branches `wip/136-himalayas-discovery-unqualified` (head `e22d49b`) and `wip/136-wwr-rss-unqualified` (head `0c77dfc`) were written **before** any plan was recorded or audited. No gate authorized them. Iteration-1 commits `fd19d24` and `9965119` were written after those branches existed and describe their behaviour. A PASS on this plan does not retroactively authorize the candidate commits.

The Himalayas candidate becomes authorized code only through this plan. Every candidate file is listed under Candidate scope and is reviewed as part of the Phase 0-1 diff. Implementation records three pieces of evidence:
- baseline evidence: on the compiled `main` baseline, `tests/himalayas-discovery.test.cjs` cannot run. It exits non-zero with `MODULE_NOT_FOUND` for `electron-runtime/electron/src/himalayas-discovery.cjs` at line 2. That is recorded as-is and is NOT represented as named-assertion red or as red-first evidence;
- red-first evidence only for the Phase 1 **red-first** group, where each assertion fails by name on the compiled Phase 0 head before the Phase 1 source change. The **regression-lock** group already passes on the candidate and is recorded passing before and after;
- an intent lock taken before any new source edit.

The WWR branch remains an unauthorized candidate (Phase 2 is HELD).

## Open Questions

None block Phases 0-1. Phase 2 is held on a publisher-terms question that the audit cannot resolve.

## Locked Decisions (grep evidence against exact refs)

Baseline `main` = `b78d06c8a05e80f93b0eaf1de9bb89e9bd95b26c`; merge-base of the candidates = `ebfd7c9abb0468bf8aef01442781ecfd60f5477a`; Himalayas candidate = `e22d49b1321839ccd5096a96c5b9ce7de103df2e`; WWR candidate = `0c77dfccaf91c6f7a337ac2c511a0116ff9b0a6a`.

- **LD1 - provider contract unchanged.** `git show b78d06c:src/shared/source-discovery.ts | grep -nE 'SourceDiscoveryProviderId ='` -> `3:export type SourceDiscoveryProviderId = "public-job-feeds";`. Himalayas candidates use `providerName: "Himalayas"`, `canMonitor: false` and `applyUrl: null`, and their `opportunityUrl` host is `himalayas.app`.
- **LD2 - Himalayas `pubDate` is epoch seconds.** A live search on 2026-10-10 returned integer `pubDate: 1789962228` (= 2026-09-21T03:43:48Z) on all 15 items. The candidate code: `git show e22d49b:electron/src/himalayas-discovery.cts | grep -n 'new Date(value)'` -> `44:  const parsed = new Date(value);`. The candidate fixture: `git show e22d49b:tests/himalayas-discovery.test.cjs | grep -n 'pubDate: 1791504000000'` -> `20:  pubDate: 1791504000000,`. Decision:
  - a finite number < 1e12 is seconds; a finite number >= 1e12 is milliseconds;
  - a string goes through `Date.parse`;
  - a result before 2000-01-01T00:00:00Z or more than 1 day after now becomes `null`;
  - anything else becomes `null`.
- **LD3 - time-zone format.** Live values are numbers (from -11 to 14, up to 37 per listing). The candidate fixture uses the string `"UTC-05:00"`: `git show e22d49b:tests/himalayas-discovery.test.cjs | grep -n 'timezoneRestrictions: \["UTC-05:00"\]'` -> `17:  timezoneRestrictions: ["UTC-05:00"],`. The candidate rejects numbers: `git show e22d49b:electron/src/himalayas-discovery.cts | grep -n 'shortText(part, 80)'` -> `35:    const text = shortText(part, 80);`. Decision: an entry is accepted only if it is EITHER
  - a finite number n with -12 <= n <= 14, normalized to `UTC-5` / `UTC+3.5` / `UTC+0` (sign always shown, no padding); OR
  - a string matching `^UTC[+-](0[0-9]|1[0-4]):(00|30|45)$`, kept verbatim.

  Any other entry (an out-of-range number, `NaN`, `"EST"`, `"-5"`) makes the whole list `null`. Length rule: a list of 0-50 entries is accepted. The live maximum is 37: one listing carried exactly `[-11, -10, -9.5, -9, -8, -7, -6, -5, -4, -3.5, -3, -2, -1, 0, 1, 2, 3, 3.5, 4, 4.5, 5, 5.5, 5.75, 6, 6.5, 7, 8, 8.75, 9, 9.5, 10, 10.5, 11, 12, 12.75, 13, 14]`. A list longer than 50 is `null`. Rendering follows the LD4 rule.
- **LD4 - location lists.** The candidate drops lists longer than 12: `git show e22d49b:electron/src/himalayas-discovery.cts | grep -n 'value.length > 12'` -> `32:  if (value.length > 12) return null;`. The longest live list observed on 2026-10-10 (310 jobs across 20 searches) has 149 entries: a Zensai EMEA listing, which the candidate shows as "eligibility unspecified". Decision: accept up to 250 entries, each a string of 1-80 characters after trimming; any other shape becomes `null`. Rendering for both location and time-zone lists:
  - 3 or fewer entries are joined with `, `;
  - longer lists show the first 3 entries, then `and N more`;
  - an empty location list renders `countries unrestricted`, and `Worldwide remote` appears only when both lists are present and empty;
  - a `null` location list renders `Remote {MIDDOT} eligibility unspecified`. Notation: in this plan `{MIDDOT}` stands for the single character U+00B7 MIDDLE DOT, the separator the existing code emits; test literals contain the real character.
- **LD5 - desktop-only Himalayas.** Live GET and OPTIONS requests with `Origin: http://localhost:5173` returned no `Access-Control-Allow-Origin` (2026-10-10). The candidate passes the runtime kind: `git show e22d49b:electron/src/core-ipc.cts | grep -n 'runtimeKind: runtime.kind'` -> `93:      runtimeKind: runtime.kind,`. On `main` the provider receives no runtime kind (`git show b78d06c:electron/src/core-ipc.cts | grep -c runtimeKind` -> `0`). The web runtime skips Himalayas with an explicit warning.
- **LD6 - result cap and fairness.** `git show b78d06c:electron/src/source-discovery-validator.cts | grep -n 'Math.min(40'` -> `39:  const limit = Math.min(40, Math.max(1, rawLimit));`. The candidate's per-provider round-robin interleaving before the cap is retained.
- **LD7 - JSON response byte caps.** The candidate reads JSON bodies without a bound: `git show e22d49b:electron/src/source-discovery-fetch.cts | grep -n 'response.json()'` -> `26:        return (await response.json()) as T;`. Decision: `fetchDiscoveryJson<T>(url, fetchImpl, maxBytes)` takes a **required** `maxBytes`. The body is read as a counted stream. If it exceeds `maxBytes`, the reader is cancelled (`reader.cancel()`) and the call throws `discovery response too large`. Otherwise the body is decoded as fatal UTF-8 and then passed to `JSON.parse`. Each cap is at least about 3x the size observed live on 2026-10-10:
  - Remote OK: 4 MiB (observed 559,053 B);
  - Arbeitnow: 8 MiB (observed 2,598,240 B);
  - Himalayas: 1 MiB per search (observed maximum 156,220 B).

## Candidate scope (full Phase 0-1 diff that will reach `main`)

Relative to merge-base `ebfd7c9`, the Himalayas candidate `e22d49b` changes the files below. All of them are in scope and reviewed:
- `electron/src/himalayas-discovery.cts` (new)
- `tests/himalayas-discovery.test.cjs` (new)
- `electron/src/source-discovery.cts`
- `electron/src/source-discovery-provider.cts` (runtime kind in the provider context)
- `electron/src/core-ipc.cts` (passes `runtime.kind`)
- `package.json` (registers `tests/himalayas-discovery.test.cjs` in `test` and `test:unit`)
- `tests/e2e/source-discovery.spec.ts` (Himalayas fixture card)
- `HELP.md`
- `docs/validation/source-discovery-tranche-2-candidate.md`
- `docs/GOVERNANCE_INDEX.md`
- `docs/plans/136-provider-expansion.md` (removed by this plan)

## Delivery path

1. On `wip/136-himalayas-discovery-unqualified` (PR #233), merge `feature/136-provider-tranche-governed-plan`, which carries this plan and its gate artifacts.
2. Merge `origin/main` into it. The only conflict is in `package.json` `test`/`test:unit`. The resolution keeps every main entry (`tests/linkedin-reconciliation.test.mjs`, `tests/linkedin-post-content.test.mjs`) and adds `tests/himalayas-discovery.test.cjs`.
3. Retarget PR #233's base from `feature/136-provider-tranche-governed-plan` to `main`. This makes the `main`-targeted workflows, including Electron E2E, run on the exact head. PR #233 stays a draft. Merging to `main` requires the Phase 17 seal and an explicit operator decision.
4. While the Phase 2 HOLD stands, PR #238 (WWR) must NOT be merged into PR #233's branch, and its commits must not reach `main`. Validation-only PR #239 is never merged.

## Phase 0: Behaviour-preserving refactor (Razor)

### Affected Files

- `tests/source-discovery-provider.test.cjs`, `tests/himalayas-discovery.test.cjs` - existing assertions unchanged, run before and after the refactor
- `tests/source-discovery-golden.test.cjs` (new) - written and committed before any Phase 0 source move; the exact-output lock described under Unit Tests
- `package.json` - registers `tests/source-discovery-golden.test.cjs` in `test` and `test:unit`
- `electron/src/public-feed-adapters.cts` (new) - moved verbatim: the Remote OK and Arbeitnow response types, `remoteOkCandidates` and `arbeitnowCandidates`, so `source-discovery.cts` stays well under 250 lines
- `electron/src/source-discovery-text.cts` (new) - moved verbatim: `STOP_WORDS`, `stableId`, `normalize`, `meaningfulTokens`, `roleMatchScore`, `cleanHtml`, `snippet`, `toIsoFromEpoch`
- `electron/src/source-discovery-monitoring.cts` (new) - moved: `STRUCTURED_MONITORABLE_TYPES`, `isAggregatorUrl`, `firstPathSegment`, `sourceIdentity`, `canonicalSourceUrl`, `monitoringCandidate`. The three identical "not monitorable" returns in `monitoringCandidate` become one `NOT_MONITORABLE` constant, taking it from 64 lines to under 40.
- `electron/src/himalayas-discovery.cts` - receives `himalayasLocation`, `himalayasCandidates` and `himalayasQuery` from `source-discovery.cts`
- `electron/src/source-discovery.cts` - keeps the endpoints, `DiscoveryContext`, `balanceProviderResults` and orchestration. `discoverPublicJobFeeds` (92 lines) is split into five functions, each under 40 lines:
  - `fetchProviderPayloads`
  - `settleRemoteOk`, `settleArbeitnow` and `settleHimalayas`, each returning `{ candidates, warnings, succeeded }`
  - `finalizeCandidates`, which balances, then dedupes, then caps, in that order

### Changes

No behaviour change. The only importer of `source-discovery.cjs` is `electron/src/source-discovery-provider.cts:8`, plus the two tests, and the export surface (`discoverPublicJobFeeds`) is unchanged. Targets: every touched file under 250 lines and every function under 40 lines (Section 4 Razor). The file-size check in CI Commands enforces the first target.

### Unit Tests

- `tests/source-discovery-golden.test.cjs` - calls `discoverPublicJobFeeds` with a fake `fetchImpl`, `limit: 4`, `runtimeKind: "desktop"` and a fixed `now`. Fixture:
  - Remote OK: 3 matching rows, two of which share employer, title and URL (an exact duplicate);
  - Arbeitnow: 2 matching rows;
  - Himalayas: 2 matching jobs for the first role, and HTTP 429 for the second role.
  It asserts `assert.deepStrictEqual` on the full ordered candidate list (every field) and on the full ordered `warnings` array. The expected literals are the candidate's actual output at `e22d49b`, captured once before any move. If `finalizeCandidates` drops dedupe, caps before deduping, reorders candidates, or changes or reorders warnings, the test fails.
- `tests/source-discovery-provider.test.cjs` and `tests/himalayas-discovery.test.cjs` - both full suites pass unchanged before and after the refactor.

## Phase 1: Himalayas defect closure (authorized scope on PR #233)

### Affected Files

- `tests/himalayas-discovery.test.cjs` - written first. It adds the LD2, LD3, LD4 and LD7 assertions below. Its fake `fetchImpl` routes by exact `new URL(u).hostname` equality instead of `u.includes(host)`, which closes CodeQL `js/incomplete-url-substring-sanitization` at lines 58, 59 and 128.
- `tests/source-discovery-provider.test.cjs` - fake routers that use substring routing move to exact-hostname equality
- `electron/src/himalayas-discovery.cts` - `publicationDate` (LD2); `restrictionList` split into `locationList` (LD4) and `timezoneList` (LD3); list rendering (LD4)
- `electron/src/source-discovery-fetch.cts` - `fetchDiscoveryJson` becomes streamed and capped, and cancels on overflow (LD7)
- `electron/src/source-discovery.cts` - passes the LD7 caps at its three `fetchDiscoveryJson` call sites, which are the only callers

### Unit Tests (each invokes the unit and asserts its output)

The red/green classification below was measured on 2026-10-10 by running each input through the compiled candidate normalizer, which is byte-identical at `e22d49b` and `0c77dfc`.

**Red-first group.** These fail by name on the Phase 0 head before the Phase 1 source change and pass after it. Candidate output is shown in brackets.

`tests/himalayas-discovery.test.cjs`, via `normalizeHimalayasResponse`, unless a test says it goes through `discoverPublicJobFeeds`:
- `pubDate: 1789962228` -> `publishedAt === "2026-09-21T03:43:48.000Z"` [candidate: `1970-01-21T17:12:42.228Z`]
- `pubDate: 946684799` (1999-12-31) -> `null` [candidate: a 1970 date]
- `pubDate: 4102444800` (2100) -> `null` [candidate: a 1970 date]
- `timezoneRestrictions: [-5, 3.5, 0]` -> `["UTC-5", "UTC+3.5", "UTC+0"]`, and the matching discovery candidate's `location` equals `Remote {MIDDOT} United States {MIDDOT} UTC-5, UTC+3.5, UTC+0 time zone` [candidate: `null`]
- `timezoneRestrictions: ["EST"]` -> `null` [candidate: `["EST"]`]
- `timezoneRestrictions: ["-5"]` -> `null` [candidate: `["-5"]`]
- `timezoneRestrictions: [-11, -10, -9.5, -9, -8, -7, -6, -5, -4, -3.5, -3, -2, -1, 0, 1, 2, 3, 3.5, 4, 4.5, 5, 5.5, 5.75, 6, 6.5, 7, 8, 8.75, 9, 9.5, 10, 10.5, 11, 12, 12.75, 13, 14]` (37 entries, the live maximum) -> a 37-entry list starting `["UTC-11", "UTC-10", "UTC-9.5"`. The matching discovery candidate's `location` contains `UTC-11, UTC-10, UTC-9.5 and 34 more time zone` [candidate: `null`]
- 51 entries (the 37 above plus 14 repeats of `0`) -> `null` (length rule)
- a 149-entry location list -> the candidate's `location` starts with `Remote {MIDDOT} `, then the first 3 entries joined by `, `; it contains ` and 146 more` and does not contain `Worldwide` [candidate: eligibility unspecified]
- via `discoverPublicJobFeeds`, a fake Himalayas response streaming 1 MiB + 1 byte -> no Himalayas candidates, plus a warning matching `/Himalayas search unavailable: .*too large/`. The Remote OK fixture candidate is still returned, and the fake stream observes `cancel()`.

`tests/source-discovery-provider.test.cjs`:
- Remote OK at 4 MiB + 1 byte -> warning `/Remote OK was unavailable: .*too large/`; the Arbeitnow candidates are still returned
- Arbeitnow at 8 MiB + 1 byte -> warning `/Arbeitnow was unavailable: .*too large/`; the Remote OK candidates are still returned

**Regression-lock group.** These already pass on the candidate. They must pass before and after Phase 1 and are not claimed as red-first.
- `pubDate: 1791504000000` -> `new Date(1791504000000).toISOString()`
- `pubDate: "not a date"` -> `null`
- `timezoneRestrictions` of `[15]`, `[-13]` and `[NaN]` -> `null` each
- `["UTC-05:00"]` stays `["UTC-05:00"]` (existing line 75); its exact location is `Remote {MIDDOT} United States {MIDDOT} UTC-05:00 time zone` (existing line 103)
- a 251-entry location list, and a list containing an 81-char entry -> `locationRestrictions === null`, with location `Remote {MIDDOT} eligibility unspecified`

The existing candidate assertions (attribution, unsafe URL rejection, duplicate GUIDs, 429 and malformed-payload isolation, web skip, result-cap starvation) pass with no edits beyond the router change.

## Phase 2: We Work Remotely RSS - HELD (no implementation authorized by this plan)

A PASS on this plan does **not** authorize merging, enabling or distributing WWR. Disposition: **HOLD pending written publisher clarification**.
- `https://weworkremotely.com/remote-job-rss-feed` (read 2026-10-10): "Anyone can use the feed, all we ask is that you attribute the links back to We Work Remotely."
- `https://weworkremotely.com/api-terms-and-guidelines` (read 2026-10-10) prohibits using "the API, or any We Work Remotely data" to build "A job advertising or job search service". It states "Scraping, copying, saving, or storing our data is strictly prohibited", and that "the onus is on you to contact us".

The technical qualification of `0c77dfc` is recorded in `docs/validation/source-discovery-tranche-2-candidate.md` as evidence only, with the raw adversarial output saved. Defects for a future re-plan:
- **W1**: country lists longer than 300 characters are dropped (4 of 89 live items).
- **W2**: the 1 MiB cap rejects a 100-item feed at the p90 item size (1,260,453 B). The proposed 2 MiB cap accepts 100 items at the maximum observed item size (1,821,953 B) and rejects 200 such items (3,643,753 B).
- **W3**: the overflow path calls `releaseLock` without `cancel`.
- **W4**: the web warning wrongly calls CORS "unverified"; the live feed sends `Access-Control-Allow-Origin: *`.
- **CodeQL**: substring host routing in `tests/wwr-discovery.test.cjs`.

## Phase 3: Evidence and documentation

### Affected Files

- `docs/validation/source-discovery-tranche-2-candidate.md` - the LD2-LD5 and LD7 live findings; the coverage measurement (method and per-track results), labelled live versus synthetic; the WWR HOLD and its qualification evidence
- `HELP.md` - Himalayas availability (desktop only) and attribution; no claim that WWR is available
- `docs/FEATURE_INDEX.md` - the FX016 evidence column adds `tests/himalayas-discovery.test.cjs`
- `docs/GOVERNANCE_INDEX.md` - Tier 4 row for this plan

### Unit Tests

- `tests/e2e/source-discovery.spec.ts` - the existing candidate test, which must pass. The Electron flow shows a card with "Found via Himalayas", the exact eligibility text `Remote {MIDDOT} United States {MIDDOT} UTC-05:00 time zone`, and "Opportunity only", with zero "Approve & monitor source" buttons on that card.

## Feature Inventory Touches

| entry_id | operation | test_path | test_descriptor |
| --- | --- | --- | --- |
| FX016 | MODIFIED | tests/himalayas-discovery.test.cjs | discoverPublicJobFeeds with a Himalayas fixture returns a Himalayas-attributed candidate with canMonitor false, a himalayas.app opportunityUrl, LD3/LD4 eligibility text and the seconds-epoch publishedAt |
| FX016 | MODIFIED | tests/e2e/source-discovery.spec.ts | Electron UI renders the Himalayas card with Found via Himalayas, its eligibility text, Opportunity only, and no monitor approval button |

## Definition of Done

### Deliverable: Himalayas provider (Phases 0-1)

- **D1**: Desktop discovery adds attributed Himalayas opportunities with truthful dates and eligibility, bounded response sizes, and explicit degradation on web and on failure.
- **D2**:
  - `normalizeHimalayasResponse(raw: unknown): HimalayasNormalizedJob[]` and `himalayasCandidates` live in `electron/src/himalayas-discovery.cts`.
  - `fetchDiscoveryJson<T>(url: string, fetchImpl: typeof fetch, maxBytes: number): Promise<T>`.
  - No change to `src/shared/source-discovery.ts`.
  - Every touched source file is under 250 lines and every function under 40 lines.
- **D3**:
  - META_LEDGER GATE PASS, IMPLEMENT and SEAL entries for Phase 17.
  - An intent lock before the Phase 1 source edits.
  - The GOVERNANCE_INDEX row updated.
  - PR #233 retargeted to `main` and still a draft.
- **D4**:
  - After `npm run desktop:compile`, `node tests/himalayas-discovery.test.cjs` and `node tests/source-discovery-provider.test.cjs` each pass twice.
  - The recorded red output (Phase 0 head) names each red-first assertion, and the regression-lock group is recorded passing on both heads.
  - `node tests/source-discovery-golden.test.cjs` passes on the candidate before Phase 0, and again after Phases 0 and 1.
  - `npm run test:e2e` passes the source-discovery spec.
  - CodeQL on the PR #233 head reports no `js/incomplete-url-substring-sanitization` alert in `tests/himalayas-discovery.test.cjs`.

### Deliverable: WWR disposition (Phase 2)

- **D1**: The HOLD is recorded with both quoted sources and the qualification evidence.
- **D2**: none.
- **D3**: The HOLD is stated in issue #136 and PR #238. PR #238 stays a draft and is not merged into PR #233's branch.
- **D4.d**: No runtime verification applies to unauthorized code. **Follow-up phase**: re-plan after written WWR clarification.

## CI Commands

- `npm run desktop:compile` - must run first; the node tests load the compiled `electron-runtime/`
- `npm run typecheck` - TypeScript (web and electron)
- `node tests/himalayas-discovery.test.cjs` - provider contract (run twice)
- `node tests/source-discovery-provider.test.cjs` - provider isolation, approval and caps (run twice)
- `node tests/source-discovery-golden.test.cjs` - Phase 0 exact-output lock (run twice)
- `node -e "for (const f of ['electron/src/source-discovery.cts','electron/src/source-discovery-text.cts','electron/src/source-discovery-monitoring.cts','electron/src/himalayas-discovery.cts','electron/src/source-discovery-fetch.cts','electron/src/public-feed-adapters.cts']) { const n = require('fs').readFileSync(f, 'utf8').split('\n').length; if (n > 250) { console.error(f, n); process.exit(1); } }"` - Razor file-size check
- `npm run repo:health` - typecheck, builds and the full `npm test` suite
- `npm run test:pwa:e2e` - web runtime regression suite. It has no Himalayas-specific spec. Web-skip coverage comes from the existing unit test in `tests/himalayas-discovery.test.cjs`: a `runtimeKind: "web"` discovery makes no Himalayas request and returns the CORS warning.
- `npm run test:e2e` - Electron E2E, including the source-discovery spec
- `npm run test:release-upgrade` - release upgrade verification
- `qor-logic-plus scripts prompt_injection_canaries --files docs/ARCHITECTURE_PLAN.md docs/META_LEDGER.md docs/CONCEPT.md docs/plan-qor-phase17-provider-tranche.md` - governance canaries
- `qor-logic-plus verify-ledger` - ledger chain

## CI Coverage Exemptions

- `python scripts/generate-resume-parser-fixtures.py` - resume-parser benchmark workflows; unaffected by discovery providers
