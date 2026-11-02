# RFC: Economic pathways under structural market change

**Status:** Stage A bounded implementation candidate; storage and evidence ingestion deferred  
**Date:** 2026-10-09  
**Owner:** Job Ranger / QOR  
**Discovery:** [#217](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/217)

## 1. Problem and limits of prediction

A conventional career change means a different role or employer in an otherwise recognizable labor market. Structural economic transition may instead mean that the **business model supporting a role** becomes less viable, an entire supply chain changes, or an employer category contracts. Moving to another firm with the same business model might preserve a person's exposure rather than diversify it. Conversely, AI may augment jobs, reduce startup costs, enable smaller competitors or reinforce incumbents. Job Ranger cannot know which outcome will prevail.

**Evidence context, not predictions:**

- OECD (2025), *Artificial intelligence and competitive dynamics in downstream markets*: AI can lower minimum efficient scale and barriers to entry, but data/compute access, interoperability and vertical integration can also favor concentration; results vary with sector and adoption. https://www.oecd.org/en/publications/artificial-intelligence-and-competitive-dynamics-in-downstream-markets_ccf0624a-en/full-report/component-3.html
- ILO (2025), *How might generative AI impact different occupations?*: task-level potential automation is not a forecast of employer disappearance or of any individual's future earnings. https://www.ilo.org/resource/article/how-might-generative-ai-impact-different-occupations
- Stanford Digital Economy Lab (August 12, 2026), revised *Canaries in the Coal Mine*: observed young-worker gaps in highly AI-exposed occupations coexist with **no detected broad economy-wide displacement** in those data. https://digitaleconomy.stanford.edu/news/canariesaug26/

Do **not** claim that the research establishes a timeline for company failure, inevitable universal unemployment, any individual's economic prospects, or a reliable "automation-proof" occupation. Market signals must eventually be dated, source-linked, and presented with their limits and contrary hypotheses.

## 2. User stories (economic pathways, not new career-specific modes)

- **A: Correlated employer risk.** A worker can distinguish task reconfiguration, employer-model disruption and industry demand change, and compare independent alternative paths instead of assuming a title change is sufficient.
- **B: Income bridge.** Someone who must cover essential expenses soon can consider a viable short-term option without being forced to make a decade-long retraining bet.
- **C: Sector switch.** A person can consider an unrelated occupation, see credential/time/expense barriers, and continue to use only confirmed Career Evidence for factual claims.
- **D: Self-directed work.** A person who chooses contracting, fractional or self-employed work can examine user-provided revenue assumptions, startup costs, benefits and uncertainty without being told to become an entrepreneur.
- **E: Blended livelihood.** A person considers a combination of income sources and recognizes that multiple engagements can share the same customer/demand risk.
- **F: Stay put.** Maintaining current work while gathering evidence is a valid pathway, not a failure of courage.

These are **pathway dimensions** available to anyone. No dedicated "career changer" product instance or stereotyped persona defaults.

## 3. Authority boundaries

| Information | Source of authority | Permitted effect |
| --- | --- | --- |
| Historical skills, employment and accomplishments | Existing canonical Career Evidence and user confirmation | May support resume claims only under existing Truth Gate |
| Target roles, availability and employer-search constraints | Existing Career Profile and Target Track | Governs existing job assessment, discovery and applications |
| Hypothetical income, costs and delay estimates | **Explicit current user input**, scoped to exploration | Arithmetic and missing-data prompts ONLY; never factual career claims |
| Market and industry forecasts | None in Stage A | **Must not** affect default scores, probabilities or career data |
| Later external market observations | Signed-off, dated, source-identified observations (future contract) | Context only until independently supported; uncertainty and counterevidence visible |
| Optional future inference | Separate governed inference contract (not implemented) | Can propose hypotheses, never change verified facts, user constraints or decisions |

**No cross-contamination:** a scenario is not evidence that the person can perform the work. Entering "$5,000/month" is not proof of demand or revenue.

## 4. Architectural alternatives

1. **Extend Target Track with scenario finance fields.** Lowest number of modules, but conflates *role/employer search intent* with cross-industry self-employment and financial planning, and requires a schema/backup/restore migration. **Reject for Stage A.**
2. **Create durable Economic Pathway domain now.** Future candidate if the workflow demonstrates value. Requires versioned SQLite records, schema validation, backup/restore/portable export, secure deletion, migration, evidence provenance and contract parity in Electron and PWA. **Defer until requirements and UX acceptance are validated.**
3. **Pure, deterministic comparator and optional UI scratchpad alongside Target Tracks.** No extra persistence or authority; tests can prove logic, clarity and defaults, and the current app continues to work without it. **Accept for Stage A.**

Reasons not to build a separate module: existing Target Tracks already support arrangements including part-time, contract and freelance; a separate catalog can increase onboarding friction; economic projections can mislead without verified demand; financial notes are sensitive. Stage A tests whether a **small optional comparison** adds value before expanding the data model.

## 5. Stage A calculation contract (implemented in this slice)

**Inputs:** user-provided minimum sustainable *monthly* income, transition evaluation horizon in months, plus up to two manually entered candidate pathways with an explicit kind, *optional* monthly income estimate, upfront cost, months to first income, and monthly benefits/operating-cost allowance.

**No defaults for income or costs.** Missing means unknown, not $0, not "bad", not "good". Zero is a valid deliberate estimate but remains user-supplied, not a guarantee. Horizon is the user's chosen evaluation window, not an estimate of when structural change will occur.

**Outputs:**
- `monthlyNetEstimate = expectedMonthlyGross - expectedMonthlyRecurringCosts`, only if both user values are supplied;
- `monthlyGap = monthlyNetEstimate - minimumMonthlyIncome`, only if all three are present;
- `withinHorizon = monthsToFirstIncome <= evaluationHorizon`, only when both supplied;
- `upfrontCosts` displayed separately, **not silently amortized or treated as monthly costs**;
- `missingFields` and `reviewQuestions` are deterministic and explicit: source of customers, liquidity, time to first income, benefits and credential/permit requirements require independent verification.
- Never output a probability, priority score, "survival %" or an "AI-safe" badge. Negative estimates should remain visible without judging the person.

All monetary values are in the **user-selected currency only**; no FX conversions. Inputs bounded to finite safe nonnegative values, months integers, blank remains null; reject impossible/overflow numbers. Each candidate's `kind` is a human-authored description, not a recommendation.

**Presentation:** optional "Explore other ways to earn" section on Target Tracks. No baseline change to role selection or assessment. CLEAR notice "Not saved" and "Estimates are hypothetical, not verified income or financial advice." Nothing goes to external services. This is a scratchpad; refreshing discards it intentionally. No persistent localStorage shadow store.

## 6. Future durable contract: decision gate

Before adding persistence, obtain approval for:
- Record ownership and versioning: `PathwayScenario{ id, kind, name, status, createdAt, updatedAt, currency, assumptions, provenanceRefs, limits }` and a distinct `IncomeRequirement` not derived from CV or job title.
- Stable SQLite authority in Electron/PWA parity, schema migration, backup/restore, private archive, encrypted storage suitability and explicit deletion.
- User-confirmed source links: title, URL, publication/retrieval time, excerpt/hash where licensed, confidence/evidence category, contradictory signals, revoked/outdated status. **A link alone never authenticates a claim.**
- Deterministic refusal of unsupported "market demand" estimates and controlled inference governance; no new default model dependency.
- Multi-path transition tests including "stay employed", unrelated sector, retraining bridge, freelance with real cost and income unknown, family constraints, and a deliberately impossible combination.
- UX evidence that the added comparison improves user decision-making without causing panic, unjustified optimism or a false sense of financial precision.

## 7. Qualification and no-go criteria

Stage A complete iff:
1. Core comparator validates nonnegative, finite explicit assumptions; correctly distinguishes blank from zero; overflow/errors cannot produce an apparently legitimate number.
2. Pure no-inference evaluations are deterministic regardless of career title, current employer, imported resume evidence or absent API.
3. Users can enter and compare two paths, including immediate paid employment versus later independent work, and see unknowns instead of rankings.
4. Existing Target Track create/save/delete and all other routes stay untouched. Browser UI tests cover unknown input, typed assumptions, computed gap and refresh **discard warning**; available keyboard labels checked.
5. Local tests followed by a single consolidated exact-head CI qualification; no automatic scoring/forecast, new schema, network calls or Truth Gate changes.

**Whole-product release readiness remains INCONCLUSIVE.** Stage A does not assert that the future economy has a particular shape or that the new pathway model has been proven useful to users.
