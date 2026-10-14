# Job Ranger #248 | Gate U2: task-first Home and Career Direction prototype

**Status:** Reviewable **standalone HTML mockup only**, not application implementation or accepted UX direction.
**Baseline used:** 2026-10-13 main `170b059`, U0/U1 baseline from Claude: 84 captures/14 full pages plus 16 Agent Workspace captures, 6 journey walkthroughs. G3 Agent Workspace is separately accepted locally on integration commit `ac6362c`, not merged. The Markdown baseline references image files not supplied in this task; this implementation is grounded in the baseline measurements and first-party source, not claimed screenshot reinspection.
**Review artifact:** [Open the HTML source](./prototypes/248-task-first/index.html) (download/open as standalone HTML locally; it does not load application data).
**Cohort:** five distinct *fictional* fixture situations, not separate product personalities.

## What this prototype changes only visually

- Home's first meaningful content is *actionable work* from stored career evidence, applications, new jobs, and G3 agent review; source/adapter telemetry is relegated to **Search health** disclosure. This differs from `src/pages/Dashboard.tsx`, which starts with scrape telemetry and has no applications/evidence-review input.
- Career Direction separates a simple **About you** block (broad Career Profile intent) from **Target Tracks** (per-direction constraints/strength) and **Career Evidence** (historical facts/provenance). The current route structure remains unchanged.
- A **Focused** layout and a **Dense** counter-first layout can be compared on both screens; dense is a deliberate alternative, not the default.
- An isolated mock control switches five synthetic situations and individual target tracks. No save button calls a backend. "Simulate edit" only changes the displayed save-state message.
- On short desktops and 320/390px viewports the task/choice appears before metrics. No job-application automation or inference is added.

## Canonical contract and anti-drift mapping

| Surface/question | Real owner/API today | U2 proposal | Implementation gate |
|---|---|---|---|
| Broad career intent | `CareerProfile` v2, `career.getProfile` | Show intent and profile state compactly | Must not turn broad goals into confirmed work history |
| Multiple career directions | `CareerTargetTrack`, `career.listTargetTracks` | Direction picker preserving separate track types and names | Distinct target tracks and no merger of incompatible constraints |
| Per-direction restrictions | `CareerSearchConstraints` on Target Track | Render value **and strength** (required/preferred/target/unspecified) | Preserve preference semantics, unknowns, migrations and unedited records |
| Profile's legacy restrictions | `CareerProfile.radiusMiles/minimumPay/fullTimeOnly` | Proposed future consolidation, **not implemented** | Explicit precedence and reversible migration ADR before changing owners |
| Provisional imported evidence | `useCareerEvidence().pending` (`verificationState === imported`) | Home count and target action; review stays with evidence flow | Imported is never confirmed; link to real review area |
| Application status | `applications.list` | Current status and next recorded event context | No made-up deadlines, ranking, auto-apply, or inferred probability |
| Recorded milestones/reminders | `useApplicationLifecycle` (per application, expanded detail) | Home may display known due items in future | Read-only bounded summary contract required; never synthesize due dates |
| Agent work (G3) | G3 workspace read APIs; review/drafts/problems/history | Home shows review count, not acceptance | Import/sync never authorizes canonical writes; API only after G3 merged |
| Search operations | `useAppContext` jobs/companies/scrapeRuns | Keep source health reachable but below user actions | Failures must remain available, not hidden |
| Dense browsing | Find Jobs and Applications existing routes | Optional dense mode for large volumes later | Must test high-volume synthetic fixtures before choosing |
 
## Decision queue logic *proposed*, not shipped

Only generate an actionable item when its own canonical read owner returns supporting state. Prototype urgency is **not** a predictive fit score. Example priority: explicit recorded due follow-up > pending evidence review > contested agent work > applications with recorded next action > new jobs > source setup. The included HTML approximates an order from the fictional fixture; it does **not** claim to implement a production selector.

Missing data is never rendered as a due/late/failed state. Keep a clear empty or "unknown" state. Never infer review success from importing or syncing.

## Primary tests to run before agreeing on U2

1. Open standalone HTML at 1440×900, 1280×580, 390×780 and 320×700; switch each of 5 careers across Home and Career Direction; check no horizontal overflow and visible controls.
2. Confirm keyboard navigation, focus return, compact first-screen primary task, meaningful labels and mobile nav semantics; use at least one real screen reader (NVDA/VoiceOver) before Gate U3.
3. Compare A against B for goal-first, resume-first, evidence-first and multi-direction changes. B may win for heavy users, but the supplied baseline has only 1 job and 1 application.
4. Validate with larger synthetic volumes (10/50+ applications, many pending evidence items); no real applicant information.
5. Before code: settle whether broad Career Profile preferences are defaults or distinct from Target Track constraints; then define migration, save-state/error-state and rollback contract. No silent overwrite.
6. Readability and focus in the actual app: continue accessibility branch `fix/248-ux-a11y-baseline` separately, validated by Claude on Windows.

## Decision-surface extension: Find Jobs, Applications, Agent Workspace

**Reviewable mock:** [Find Jobs / Applications / G3 Agent Workspace](./prototypes/248-task-first/decision-surfaces.html). This is a standalone, offline HTML prototype. Unlike the first Home and Career Direction mock, it compares the primary downstream decision surfaces at **1, 12, and 50 synthetic records** and five career scenarios. These are not UI changes in the running product.

### Find Jobs

- A focused list and a dense table share the **four separate** assessment dimensions: eligibility, Career Evidence coverage, career alignment, and constraints/preferences. Unknown information remains **unknown**, not a score penalty.
- The "Why?" control moves focus to a persistent explanation panel, replacing the proposed ~1,900px inline expansion. A production panel must retain requirement-level evidence, job/source completeness, citations and all caveats available in the current `JobEvidenceCoveragePanel`, not the simplified fictional summary in this mock.
- Target Track selection remains a read of `career.listTargetTracks()`. The current `Jobs.tsx` track and prepare-resume actions remain separate; **nothing in the mock tracks, prepares, or submits an application**.

### Applications

- Compare focused status grouping with a dense status table using the existing contract `TrackedApplication.status` (`interested`, `applied`, `interview`, `offer`, `rejected`, `withdrawn`).
- Display a next action only when an actual application event/reminder exists; no guess that an "applied" record is due for follow-up. Fictional recorded date text is labeled fictional.
- "Remove" appears in a secondary disclosure with its destructive action disabled in the prototype. Any real implementation must retain `Applications.tsx`'s **unsaved status/notes navigation blocker**, save status announcements, current ConfirmDialog, and locally retained lifecycle, submitted documents, and interview preparation.
- The prototype is **read-only and deliberately cannot simulate canonical status changes**.

### G3 Agent Workspace

- Show the decision inbox **before** the folder sync/export controls, and distinguish review, drafts, problems and history. Actual G3 review-state membership in `AgentWorkspace.tsx` includes proposal, contested, needs_rebase, staged and pending; this mock uses one fictional instance of several states, not a replacement state machine.
- Side-by-side comparison of conflicting note versions is a **presentation-only proposal**: show two distinct retained versions, provenance and contradictory content in one view. The actual implementation may need bounded read support and diff semantics beyond current `AgentItemReview.tsx`'s "View this version" switching.
- Agent status claims must be rechecked against the canonical application and explicitly confirmed by the user in the existing application workflow. Agent evidence changes **cannot** be accepted into canonical Career Evidence by this screen. Unreviewed material drafts have no Truth Gate or Parseability Gate result.
- Problems must never invent the affected resume/record from a held batch that lacks that metadata. Display the known quarantine reason plus conditional recovery, and mark unknown affected work as unknown.
- No remote agent credentials, OAuth, background sync, canonical mutation, unprompted lifecycle status changes, or automatic uploads are introduced.

### U2 regression and acceptance gate

Added [six isolated browser smoke tests](../../tests/ux-248-decision-surfaces.test.mjs): five personas, both layouts, volume changes, keyboard focus on explanation/review, protected destructive affordances, side-by-side conflicts, empty history, and 320/390/1280×580/1440 viewport reflow.

Run locally, after dependencies and Playwright Chromium are available:

```bash
node --test tests/ux-248-task-first-prototype.test.mjs tests/ux-248-decision-surfaces.test.mjs
```

**Not executed yet on this exact branch.** Embedded JavaScript syntax and GitHub source-readback checks pass. Browser evidence, screen reader observation, timings and screenshots are still needed before choosing U2 or moving to U3 production components.

**Gate decision to review:** A focused layout appears better aligned with the measured U0/U1 first-screen failures, but dense comparison must remain possible and needs actual 50+ item visual review. Do not let UI simplification hide provenance, user authority, unknowns, unsaved changes, or real error states.


## Out of scope

- No route changes, automatic evidence acceptance, agent promotion, inference requirement, synced backend, deployment, new demo, or billing.
- Home's proposal count is not a merged production query; it requires cross-domain read models and loading/error controls.
- This prototype does **not** settle visual styling, screen reader compatibility, agent inbox redesign, or data authority migrations.

## Suggested Gate U2 review questions

- In first use and after resume import, can a person see a specific next action within the first screen?
- Does Home show *career progress*, even if no job source has been configured?
- Can someone understand which settings apply to which direction without duplicating/rewriting data?
- Can someone leave fields unknown without being punished?
- Are the application's original routes and authority rules preserved?

Only after this review should U3 production component design start. #248 remains the umbrella issue.
