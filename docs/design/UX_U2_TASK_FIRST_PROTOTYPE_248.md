# Job Ranger #248 | Gate U2: task-first Home and Career Direction prototype

**Status:** Reviewable **standalone HTML mockup only**, not application implementation or accepted UX direction.
**Baseline used:** 2026-10-13 main \`170b059\`, U0/U1 baseline from Claude: 84 captures/14 full pages plus 16 Agent Workspace captures, 6 journey walkthroughs. G3 Agent Workspace is separately accepted locally on integration commit \`ac6362c\`, not merged. The Markdown baseline references image files not supplied in this task; this implementation is grounded in the baseline measurements and first-party source, not claimed screenshot reinspection.
**Review artifact:** [Open the HTML source](./prototypes/248-task-first/index.html) (download/open as standalone HTML locally; it does not load application data).
**Cohort:** five distinct *fictional* fixture situations, not separate product personalities.

## What this prototype changes only visually

- Home's first meaningful content is *actionable work* from stored career evidence, applications, new jobs, and G3 agent review; source/adapter telemetry is relegated to **Search health** disclosure. This differs from \`src/pages/Dashboard.tsx\`, which starts with scrape telemetry and has no applications/evidence-review input.
- Career Direction separates a simple **About you** block (broad Career Profile intent) from **Target Tracks** (per-direction constraints/strength) and **Career Evidence** (historical facts/provenance). The current route structure remains unchanged.
- A **Focused** layout and a **Dense** counter-first layout can be compared on both screens; dense is a deliberate alternative, not the default.
- An isolated mock control switches five synthetic situations and individual target tracks. No save button calls a backend. "Simulate edit" only changes the displayed save-state message.
- On short desktops and 320/390px viewports the task/choice appears before metrics. No job-application automation or inference is added.

## Canonical contract and anti-drift mapping

| Surface/question | Real owner/API today | U2 proposal | Implementation gate |
|---|---|---|---|
| Broad career intent | \`CareerProfile\` v2, \`career.getProfile\` | Show intent and profile state compactly | Must not turn broad goals into confirmed work history |
| Multiple career directions | \`CareerTargetTrack\`, \`career.listTargetTracks\` | Direction picker preserving separate track types and names | Distinct target tracks and no merger of incompatible constraints |
| Per-direction restrictions | \`CareerSearchConstraints\` on Target Track | Render value **and strength** (required/preferred/target/unspecified) | Preserve preference semantics, unknowns, migrations and unedited records |
| Profile's legacy restrictions | \`CareerProfile.radiusMiles/minimumPay/fullTimeOnly\` | Proposed future consolidation, **not implemented** | Explicit precedence and reversible migration ADR before changing owners |
| Provisional imported evidence | \`useCareerEvidence().pending\` (\`verificationState === imported\`) | Home count and target action; review stays with evidence flow | Imported is never confirmed; link to real review area |
| Application status | \`applications.list\` | Current status and next recorded event context | No made-up deadlines, ranking, auto-apply, or inferred probability |
| Recorded milestones/reminders | \`useApplicationLifecycle\` (per application, expanded detail) | Home may display known due items in future | Read-only bounded summary contract required; never synthesize due dates |
| Agent work (G3) | G3 workspace read APIs; review/drafts/problems/history | Home shows review count, not acceptance | Import/sync never authorizes canonical writes; API only after G3 merged |
| Search operations | \`useAppContext\` jobs/companies/scrapeRuns | Keep source health reachable but below user actions | Failures must remain available, not hidden |
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
6. Readability and focus in the actual app: continue accessibility branch \`fix/248-ux-a11y-baseline\` separately, validated by Claude on Windows.

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
