# Job Ranger UX elevation discovery and decision brief (#248)

**Status:** Design proposal only; **not approved** and not an implementation spec.
**Reference:** `main` at `170b059` (2026-10-13). G3 Agent Workspace is an independently reviewed **unmerged** branch (`impl/286-g3-agent-workspace` at `5f1673a`; review `cd04074`). G4 Google Drive is still a plan. Previously implemented UX code exists as **unmerged prototypes** (`ux/248-dashboard-visual-elevation` at `d90d157`, `ux/248-find-jobs-elevation` at `c5e2e0f`). None of those prototypes establishes an approved visual direction.

## 1. Decision to make

**"UI elevation" means making Job Ranger easier to understand, learn, navigate, and trust while completing real career tasks**, not embellishing cards, headings or colors. Visual polish is one tool; information architecture, cognitive effort, state communication, accessibility and workflow completion are equally important. Continue building and reviewing correctness/safety work independently, but **pause broad UI expansion until the owner reviews this plan and representative actual-app mockups**.

**Recommended direction: calm, task-focused workspace with optional dense views.** A decisive next step and inspectable evidence should outrank scrape telemetry and marketing copy. A career tool should neither become an analytics cockpit nor hide consequential details just to look clean.

## 2. Grounded starting point

Source reviewed:
- `src/components/Sidebar.tsx` and `docs/design/GROUPED_NAVIGATION_271.md`: four top-level links, expandable My Career and Search Tools, two utility links; existing fixed sidebar and independent content scrolling already have targeted tests. Do not undo this with a speculative new IA.
- `src/App.tsx`: 14 established destination routes in `main`; G3 adds Agent Workspace under My Career on a separate branch.
- `src/pages/Dashboard.tsx`: metrics and search-source stories dominate the home experience even though a user's decision may be elsewhere.
- `src/pages/Jobs.tsx`: collection filters, track-specific assessment and source-completeness evidence coexist; do not merge "eligibility", "coverage", "alignment" and "unknown" into a single fake fit score.
- `src/pages/TargetTracks.tsx`, `EvidenceEntry.tsx`: extensive editable, semantically important forms. Entry burden and cross-page wayfinding need closer study.
- `src/pages/Applications.tsx`: multiple panels per application; needs progressive disclosure while preserving statuses, contacts, saved artifacts, unsaved-edit warnings and confirmation steps.
- `src/pages/PersonalBrand.tsx`: large four-step compose → record publication → observe → compare workflow; useful steps, but dense when not all are relevant at once.
- `src/pages/AgentWorkspace.tsx` (G3 branch): needs review / drafts / problems / history; deliberate agent authority separation must be visually legible.
- `docs/design/UNIVERSAL_USER_STORIES.md`: US-0 through US-30 and resume-first, evidence-first and goal-first entry paths. **Use these stories as UX acceptance inputs**, not a single software-engineer persona.

Existing first-party image references (verify against their recording SHA before treating them as current):
`docs/assets/screenshots/career-direction.png`,
`docs/assets/screenshots/opportunity-assessment.png`,
`docs/assets/screenshots/deliberate-application.png`,
`docs/assets/demo/job-ranger-demo.webm`.
The screenshot files were located in GitHub, **not visually accepted or inspected** in this design session. Browser captures of the actual current PWA/Electron are mandatory before UI decisions.

Prior quantified concern in #248: shared hero introductions use ~42–54% of a 1280×580 first screen and ~52–76% at 390×780; a scoped compact treatment was already merged into main. Do not assume visual whitespace is still the primary problem without new captures.

## 3. Key journeys to test before design approval

| Journey | User wants to do | Most important outcome | Trust/accessibility failure to avoid |
| --- | --- | --- | --- |
| New: goal-first | Set a viable direction without evidence/resume upfront | First target track, next action clear | Rejecting incomplete profiles as invalid |
| New: resume-first | Import history, check tentative extraction | Proposed versus confirmed facts unmistakable | Auto-accepting unsupported experience |
| New: evidence-first | Enter nontraditional experience gradually | A small, safely persisted fact | One giant mandatory form |
| Review work | Find an opportunity, inspect what is known, decide | Shortlist or dismiss with reasons | Hiding unknowns or treating a score as truth |
| Act intentionally | Track a job, tailor verified materials, note submitted artifacts | Application with accurate next action | Auto-application, disappearing unsaved changes |
| Maintain momentum | Revisit interviews, follow-ups and stale applications | Actionable queue, not vanity counts | No clear priority or due/overdue meaning |
| Return after agent work | Import exported agent work, inspect conflicts, decide | Review a trustworthy grouped inbox | Ambiguous "synced" or agent-authored truth |
| Learn and adjust | Compare outcomes by tracked career directions | Evidence-backed correction to search strategy | Unsupported causal/probabilistic claims |
| Narrow mobile | Complete all above at 320–390 px | Same authority and evidence access | Hidden controls, overflow, focus traps |

Validate with at least five contrasting synthetic backgrounds from `UNIVERSAL_USER_STORIES.md`, including entry-level, licensed, nontraditional, career changer and contractor. No real personal data in mockups or demo.

## 4. Proposed interaction architecture (conceptual, not a route rewrite)

**Five user questions drive the interface:**
1. Where am I? Home shows unfinished work and status, not simply counts.
2. What am I aiming for? Career Profile + separate Target Tracks, with clear saved/unsaved states.
3. What can I substantiate? Career Evidence and sources, with confirmed/pending/unsupported visually and verbally distinguished.
4. Is this opportunity worth my time? Find Jobs preserves source quality, eligibility, evidence, career alignment, preferences, and unknowns as separate dimensions.
5. What do I do next? Applications, exact materials, reminders, follow-ups, and agent-review decisions remain user-owned.

**Do not rename/rehome routes yet.** Test wayfinding using the current grouped navigation against a proposed task-centered alternative, then decide if any consolidation measurably helps. A view tab or detail disclosure may reduce overwhelm **only if authoritative caveats and action consequences remain in view**.

## 5. Two *wireframe concepts* for discussion (not rendered mockups)

### A. Recommended: Focused workspace

```text
┌───────────────────┬─────────────────────────────────────────────┐
│ Job Ranger        │ Today                                       │
│ Home              │ [2 decisions waiting] [Next scheduled step]│
│ Find Jobs         │                                             │
│ Applications      │ Continue where you left off                 │
│ Personal Brand    │ > Review 3 promising jobs                   │
│ ▼ My Career       │ > Confirm 1 pending evidence fact           │
│ ▼ Search Tools    │ > Resolve 1 conflicting agent draft         │
│                   │                                             │
│ Settings · Help   │ Your directions | Recent outcomes           │
└───────────────────┴─────────────────────────────────────────────┘
```
All numbers above are illustrative placeholders, **not actual product data**. Items appear only when canonical stored state supports them. No agent-derived task becomes mandatory.

### B. Alternate: Information-dense workspace

```text
┌───────────────────┬─────────────────────────────────────────────┐
│ Nav               │ Jobs | Stages | Sources | Activity          │
│                   │ Filters / track / source completeness       │
│                   │ Decision queue: opportunity assessment     │
│                   │ Applications and next steps                 │
└───────────────────┴─────────────────────────────────────────────┘
```
Risk: surfaces high information volume before explaining relevance; can recreate the existing scroll and decision burden. Offer density as a preference only after actual task trials.

**Agent Workspace sub-view:** Start with `Needs your decision`, `Safe drafts`, `Problems`, `History`. For contested variants, show who/what/when (actor label remains "unverified"), differences, authoritative source context, and explicit acknowledgement before Keep. Never auto-promote evidence/materials; staging limitations stay visible.

## 6. Consolidation hypotheses to challenge

- Home's scrape metrics are operational diagnostics rather than central career progress: retain diagnostics but lead with next actionable work.
- Long introductory panels cost vertical room, particularly on short screens: compact rather than conceal key truth statements.
- Career Evidence and Target Tracks can be edited in focused sections with persistent status, but must preserve revision history and constraint strength.
- Opportunity assessment should show an always-visible compact summary and accessible evidence/unknown detail, not an invented percentage.
- Applications should offer a status-oriented list with a focused detail view; unsaved edit blocker and delete confirmation must remain exactly effective.
- Personal Brand's four-step workflow may use step navigation with completed/current/unavailable states; do not imply every post has been published.
- Agent Workspace should distinguish transport state, reconciliation outcome, and **user authority**; syncing is not accepting.

These are **hypotheses**. No route removals, automatic state transitions, hidden evidence, material schema changes or visual-only success claims are authorized.

## 7. Design system to establish before more code

- Semantic typography scale (one page heading, concise section headings, readable body and metadata), progressive spacing, content width and responsive layout; no per-page ad hoc token sprawl.
- Shared surfaces for task queues, opportunity cards, evidence state, caution/unknown, timeline, empty/loading/error, inline recoverability and pending-save state.
- Existing theme tokens remain baseline. Contrast and focus must be validated for each supported theme rather than assumed.
- Standard action hierarchy: one clear action, secondary actions, irreversible decisions explicitly separated.
- Truth vocabulary: **confirmed, proposed, unknown, contested, staged, blocked, failed**, with text always available (color/icon never sole indicator).
- Progressive disclosure preserves necessary eligibility/provenance/uncertainty and action consequences.
- Reduced motion, keyboard focus/skip/escape, screen-reader labels, magnification/reflow, no keyboard traps, appropriate touch targets.

## 8. Evaluation protocol and approval gates

**Gate U0, baseline:** Build exact `main` and exact existing UI prototypes locally. Collect representative synthetic states, including empty, loading, populated, error, save-pending, rejection, conflict, and long/unusual names. Capture actual first-party screenshots at 1440×900, 1280×580, 390×780, 320×700 across every supported theme. Include actual interaction recordings for 5+ journeys; do not accept a polished screenshot as functional evidence. Measure visible action distance, navigation cost, layout overflow, lost-focus incidents, comprehension of trust states and task completion.

**Gate U1, compare:** Prepare annotated existing-state screenshots, black-and-white low-fi mocks of Focused vs Dense direction on Home, Find Jobs, Career Direction, Applications and G3 Agent Workspace; add semantic accessibility notes and a proposed shared component inventory. Ask owner to approve the conceptual information architecture, action hierarchy and density preference. This is **design approval**, not implementation approval.

**Gate U2, usability/accessibility:** Test chosen concept at normal and short desktop, mobile and 200%/400% zoom. Target WCAG 2.2 AA, with keyboard-only, assistive technology checks where available, visible focus, clear errors, 24 px minimum target requirements with a 44 px preferred touch target, sufficient text/non-text contrast and no motion dependence. Record actual defects rather than asserting compliance from code or automated tooling alone.

**Gate U3, bounded implementation:** Only then reconcile or discard prototypes `d90d157`/`c5e2e0f`; implement shared tokens/components first, then journey slices on isolated branches. Test authority/state regression and usability, not just appearance. Independent review required before integration. Do not weaken the local-first deterministic baseline.

**Gate U4, demo freeze:** Once integration, accessibility, feature boundaries and visuals are accepted, freeze a release SHA. Claude may run the repository's synthetic-data `npm run demo:record` and `npm run demo:screenshots`, inspect footage/captions/keyboard focus in real browsers, and produce a 60–90-second honest walkthrough. Show G3 only if merged and functional. Show Google Drive only if G4 is actually operational. No screenshots/video invented or manually edited to imply product behaviors.

## 9. Priorities and explicit decisions before redesign

**Now:** #296 SQLite fix acceptance; G3 base reconciliation; #297 NUL readback fidelity; preserve existing UX prototype branches without merging or adding broader UI changes. No new demo yet.

**Proposed UX approval choice:** Focused workspace by default, with optional dense viewing for experienced users. Prototype Home, Find Jobs and Agent Workspace first because they expose the career-decision and agent-governance story. Preserve existing route paths during design evaluation.

**Decisions to bring to owner after U0/U1 evidence:**
1. Confirm task-first / focused default vs dense default.
2. Approve or reject proposed navigation consolidation after actual journey comparison.
3. Approve the selected component/typography/status language after rendered first-party mocks.

**Out of scope until decided:** full-screen visual rewrite, theme replacement, renaming product concepts, route migration, turning assistant work into authoritative truth, hidden consequential claims, G4 marketing, any demo refresh before release qualification.
