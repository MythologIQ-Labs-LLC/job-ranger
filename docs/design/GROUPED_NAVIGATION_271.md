# Job Ranger grouped sidebar prototype (#271)

**Status:** review-only UI prototype on `ux/271-grouped-sidebar-navigation`, based on development `main` at `296cac2f55cacc95a564c4c18dbd35033af2a9a2`. **Not merged or released.** Parent visual refinement: [#248](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/248). Offline Help is separately tracked by [#185](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/185).

## First-party evidence and problem

The current sidebar is a single list of **13 destinations** with equal visual weight. Its permanent explanatory footer consumes substantial vertical space, while each link has generous padding. The existing desktop shell already fixes the left sidebar in a viewport-sized frame and scrolls the main content independently; **that frame is not a defect and should not be redesigned as fixed positioning**. See `src/components/Sidebar.tsx`, `src/index.css`, `tests/pwa/sidebar-scroll.spec.ts`, and first-party screenshots at `docs/assets/screenshots/career-direction.png` and `deliberate-application.png` (the screenshots may precede recently added features).

The problem is prioritization, not simply cosmetic density. All destinations do not deserve equal always-visible space.

## Navigation decisions (prototype)

| Always-visible | Expandable My Career | Expandable Search Tools | Pinned utility |
| --- | --- | --- | --- |
| Home, Find Jobs, Applications, Personal Brand | Career Profile, Target Tracks, Career Evidence, Career Stories, Resume | Companies, Filters, Search Insights | Settings |

- Keep each existing route exactly. This is purely a navigation presentation change. The hash router and unsaved-edit blocker remain authoritative.
- Only one supporting group expands at a time. A direct link or browser-history navigation auto-expands the group containing the active route. Top-level routes collapse supporting groups.
- Use native buttons for groups with `aria-expanded`, `aria-controls`, a chevron and clear focus rings. Only actual destination links receive `aria-current="page"`.
- Allow the user to expand or collapse groups voluntarily while remaining on the current page. Expanded state is ephemeral, not persisted as new personal data.
- Compact the footer to a direct Settings link. Do **not** add a Help link until #185 ships a working offline `/help` route.
- Mobile retains the existing hamburger menu. Expanded menu exposes both navigation groups and Settings; a destination link closes the menu.
- Preserve green/dark-forest sidebar, warm app surfaces, and the rest of the Job Ranger identity. No generic admin-dashboard redesign.
- The design does not classify tools as less valuable, hide features permanently or depend on user profiling, inference or telemetry.

## Test and demo impact

A valid grouped navigation makes nested links hidden until their group opens. Existing browser and demo helpers that assume all links are perpetually visible must open the proper group before clicking. Prototype updates include the navigation/scroll Playwright tests, Electron e2e helper, unsaved-navigation tests, resume-first PWA journey, evidence-coverage test and filmed demo navigation.

**Static route inventory review:** 13 unique sidebar destination hrefs exactly match the 13 existing navigable non-onboarding routes, with no missing or extra destinations. This is **not** a production build or browser PASS.

## Remaining qualification before opening a PR

1. Run `npm ci`, `npm run typecheck`, `npm run build`, `npm run build:pwa` or the actual repository scripts as applicable. Do not assume command names; inspect `package.json`.
2. Run focused Playwright: `tests/pwa/sidebar-scroll.spec.ts`, `tests/pwa/resume-first-ui-journey.spec.ts`, `tests/pwa/unsaved-application-navigation.spec.ts`, and affected Electron/demo suites if available. Inspect failures as UX regressions, not a request to weaken tests.
3. Validate initial load, page history, active-link semantics, single-open group state, Settings footer, 320px/390px mobile, 580px/900px desktop, keyboard-only access, touch sizes, and short viewport scroll. Inspect all shipping themes, focus rings and accessibility.
4. Capture actual before/after screenshots from the running PWA. The existing first-party screenshots are baseline evidence, not proof of the new UI.
5. Independent UX/accessibility review and owner preview. Explicit merge approval required. Avoid triggering broad hosted Actions prematurely.

## Broader UI refinement (#248)

Once navigation hierarchy is qualified, consider a **separate incremental visual-elevation pass**, not a full rewrite: reduce oversized repeating page hero sections, establish clearer page-level primary actions, normalize card densities and text hierarchy, and audit small-screen content readability. Maintain Career Evidence provenance and deliberate-application controls visibly; no decorative simplification that hides important facts. This prototype does **not** authorize that broader work.
