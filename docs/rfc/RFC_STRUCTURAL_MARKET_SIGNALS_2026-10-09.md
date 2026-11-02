# RFC: Structural market signals and competing hypotheses

**Status:** Contract-first implementation, no ingestion, display, scoring or persistence authorized  
**Date:** 2026-10-09  
**Issue:** [#219](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/219)  
**Parent:** [#217](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/217) and [Economic Pathways RFC](./RFC_ECONOMIC_PATHWAYS_2026-10-09.md)  
**Implemented contract:** `src/shared/structural-signals.ts`  
**Adversarial test:** `tests/structural-signals.test.mjs`

## Decision

Build the deterministic, read-only *context contract* first. Do not add a persistent structural-signal store, automated sector forecast, industry rank, risk badge, external data source integration, network fetch, or AI scoring. This is a validation boundary for **untrusted proposals**. It neither authenticates sources nor adjudicates whether a source's claims are true.

The broader user story concerns cases where labor market disruption also affects **employer economics, competitive structure and industry demand**, not merely the tasks of a single role. A task can be automated while its firm thrives; a firm can decline while demand for the underlying human capability persists; an industry can grow while its employment structure changes. A causal leap between these layers is prohibited.

| Layer | Examples of signals that may eventually be considered | Forbidden inference |
| --- | --- | --- |
| **Task** | Exposed or augmented tasks, occupation-level work redesign | "X% automatable tasks" ⇒ X% workers or companies eliminated |
| **Business model** | Observed competitive entry, employer closure, changing cost structure, consolidation | One employer closure ⇒ an entire sector is obsolete |
| **Industry** | Observed demand, actual measured sector employment, dated regulations | One forecast or one industry study ⇒ inevitable local labor-market outcome |

Alternative outcomes remain parallel: **augmentation, substitution, new entry, consolidation, slow adoption, and unknown**. Each is explicitly a `ScenarioHypothesis`, never an established prediction. No sorting by arbitrary confidence or numerical risk.

## Record definitions

`StructuralSignal` contains:

- Stable non-identifying ID, explicit causal `layer`, event type and `claimKind` (`observation` versus `projection`).
- A bounded **summary of the claim** and source citation: HTTPS URL, publication title, named publisher, publication date, retrieval date, reuse rights, optional **short permission-backed** quotation, and its declared reuse basis.
- Exact stated **geographies, industries and affected business models**, not guessed geographic hierarchies or inferred synonyms.
- For observations only, a start/end `observedPeriod` ending no later than publication. Projections must not have a fabricated observed period.
- Bounded methodology-limitations list; explicit `reviewState` (`unreviewed`, `reviewed`, `disputed`, `withdrawn`); `origin` (`user-entered`, `research-collection`, `inference-proposed`); and contradiction-linked signal IDs.

`ScenarioHypothesis` contains a titled, human-readable hypothesis, one of six possible outcomes, one causal layer, proposal date, origin, review state, source signal IDs and explicitly competing scenario IDs.

A `reviewed` state is **metadata only**, not proof that the organization, author, methodology, published claim, license, or real-world prediction is correct. An inference-produced proposal is **never implicitly promoted to reviewed**. Future governance must verify sources through a separate controlled human process before permitting any expanded use.

## Validation boundary

`validateStructuralContext(unknown)` rejects malformed input and copies the accepted fields into an intentionally narrow contract. It rejects:

- Unexpected fields, including accidental personal profile or salary fields; duplicates and missing/self-referential evidence links.
- Bad or future proposal dates, impossible calendar days, source retrieved before published, observed periods after publication, or forecasts mislabeled as observations.
- Non-HTTPS, credential-bearing, loopback/local-address, fragment-bearing citation URLs. **This is inert string validation, not a safe web fetch policy:** no network retrieval is implemented.
- Unlicensed quoted text, uncertain reuse-rights treated as a license, oversized fields and excessive records.
- Inference-origin signals or scenarios asserting that a review has occurred without separate independent review.

`assessStructuralContext(unknown)` returns only **deterministic context and cautions**. The caller supplies `asOf`; no current-time lookup, provider call or local-storage access occurs. A signal is `out-of-scope`, `partial-scope` or `matching-scope` based on exact user-selected market labels. For example, a United States-wide study is **not silently mapped** to a Maryland-specific opportunity. Lack of business-model coverage produces a partial match rather than a false match.

`recency` is based on the **end of observed period**, not simply the download date; projections use publication date and remain projections. At more than `MAX_CONTEXT_AGE_DAYS = 540` the record is flagged `stale`, but **old research is not thereby proven false**. An item published or retrieved after the requested as-of date is `not-yet-available`. Contradiction links are symmetric at assessment time, whether declared by one or both sources. Neither claim is auto-selected.

`contextualSignalIds` are narrow candidate references meeting all metadata constraints: observed (not forecast), same causal layer, fully matched market scope, non-stale, reviewed metadata, no recorded counter-signal, and known citation rights. **The mere presence of a candidate never means the scenario is verified.** The scenario assessment always has `authority: "hypothesis-only"`, with explicit cautions, including for one perfectly scoped observation.

### Adversarial fixtures

Fixtures are **fictional**, not public market evidence. `tests/structural-signals.test.mjs` covers:

- SaaS middleware: new smaller entrants and market consolidation explicitly contradict each other; no automatic winner.
- Observed task exposure cannot be promoted into business-model extinction.
- Different industry, region, or undefined business model does not silently match.
- Dated retrospective research, stale observation, future retrieval, observed period later than publication, forecast vs observation.
- Review withheld, dispute, withdrawal, inference-produced proposals and unknown rights.
- Citation identity, unlicensed quotation, contradictory references, duplicate IDs and unexpected personal data.
- Non-prescriptive hypotheses: stay employed, explore a local trade, or independent services with **no trustworthy market signal**, all remain hypotheses rather than recommendations.

Follow-on evidence should use truly different regulated-healthcare and skilled-trade fixture scopes, not career-specific modes or invented labor demand statistics.

## Privacy, source rights and externalization

Only market context may appear in this future source contract. **Do not attach personal wage requirements, family circumstances, medical history, career proof, secret employer notes or user identity.** The current Stage A income comparison remains an ephemeral, user-controlled scratchpad and cannot be enriched automatically from these claims. Do not treat snippets as freely reusable, and record limitations even when the source appears authoritative.

No persistent authority is created. Future approval requires:

1. Human source/reuse-rights verification and correction path; terms/license review before any actual external retrieval, quotation or redistribution.
2. A concrete public data-provider policy, network allowlist and anti-SSRF/rebinding boundaries. URL validation here cannot substitute for connection-level protections.
3. Dated record lifecycle, conflict adjudication without erasing counterevidence, stale-data handling, opt-in collection, revocation, and deletion/retention rules.
4. SQLite/PWA parity, schema migration, encrypted-storage suitability, backup/restore, portable archive and version rollback; no hidden renderer-local shadow database.
5. Independent inference governance: an AI hypothesis is **unreviewed** and cannot rewrite a signal, claim verification, infer career facts, change a Target Track, decide that someone should retrain, or submit an application.
6. User studies covering an immediate-income bridge, choosing to remain employed, unrelated-industry transition, self-employment by choice, and contradictory/unavailable signals.

## Acceptance and release posture

- Only add the pure contract, deterministic runtime validator, adversarial unit suite, and documentation for this slice.
- Keep existing Career Evidence, Truth Gate, career matching, source monitoring, PWA/Electron adapters and Target Tracks unchanged.
- Use one consolidated exact-head CI run. All required checks, including Windows packaged build and both browser suites, must pass before merging.
- Issue #219 may close for **contract acceptance** only; market intelligence, durable evidence and user-visible guidance remain separately gated. Parent discovery #217 stays open.
- **Whole-product ship verdict: INCONCLUSIVE.**

## Supporting research (context, not claims about a specific career)

- OECD (2025), *Artificial intelligence and competitive dynamics in downstream markets*: lower entry costs and concentration can occur in different settings. https://www.oecd.org/en/publications/artificial-intelligence-and-competitive-dynamics-in-downstream-markets_ccf0624a-en.html
- ILO (2025), *Generative AI and jobs: A 2025 update*: task exposure should not be equated with observed company closure. https://www.ilo.org/publications/generative-ai-and-jobs-2025-update
- Stanford Digital Economy Lab (August 2026), revised *Canaries in the Coal Mine*: occupation-linked observational findings are not a firm-level forecast. https://digitaleconomy.stanford.edu/news/canariesaug26/
