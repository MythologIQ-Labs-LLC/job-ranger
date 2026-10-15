# Job Ranger grouped sidebar navigation (#271)

**Status:** candidate on `ux/271-grouped-sidebar-navigation`, based on `main` at `296cac2f55cacc95a564c4c18dbd35033af2a9a2`. It merges [PR #186](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/186) (offline Help, [#185](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/185)), so **#186 must merge first**. **Not merged or released.** Parent visual refinement issue: [#248](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/248).

## First-party evidence and problem

The previous sidebar was a single list of **13 destinations**, all with equal visual weight. Its permanent explanatory footer took up substantial vertical space.

The existing desktop shell already fixes the left sidebar in a viewport-sized frame and scrolls the main content independently. **That frame is not a defect and was kept.** See `src/components/Sidebar.tsx`, `src/index.css` and `tests/pwa/sidebar-scroll.spec.ts`.

Measured on `main` (`296cac2`) in the running web app across 3 themes × 4 viewports × 3 routes:

- **Settings below the fold:** Settings was outside the viewport in **18 of 36** views. This affected every 320 px and every 1280×580 view.
- **Small menu button:** the mobile menu button was **46×38 px**.

## Navigation decisions

| Always visible | Expandable My Career | Expandable Search Tools | Pinned utility |
| --- | --- | --- | --- |
| Home, Find Jobs, Applications, Personal Brand | Career Profile, Target Tracks, Career Evidence, Career Stories, Resume | Companies, Filters, Search Insights | Settings, Help |

- **Routes unchanged:** every existing route is kept exactly, and `/help` comes from #186. All **14** destinations are reachable, and the hash router and unsaved-edit blocker remain authoritative.
- **Group behavior:**
  - Only one supporting group is expanded at a time.
  - A direct link or a browser-history navigation expands the group that contains the active route.
  - Top-level routes collapse the supporting groups.
  - On short screens, the sidebar scrolls itself (never the page content) so that the active nested page is visible.
- **Group buttons:** groups are native buttons with `aria-expanded`, `aria-controls`, a chevron and visible focus rings. Only actual destination links receive `aria-current="page"`.
- **Utility area:** the footer is a compact utility navigation landmark containing Settings and Help.
- **Mobile:** the existing menu button is kept, now at least 44×44 px. The expanded menu shows the primary, grouped and utility navigation, and choosing a destination closes it.
- **Identity:** the existing themes and Job Ranger identity are kept. Nothing is profiled, inferred, persisted or permanently hidden.

## Test and demo impact

Nested links stay hidden until their group opens. The following helpers and tests now open the correct group before clicking:

- the shared Electron `navigateTo` helper (`tests/e2e/electron-app.ts`);
- the app, resume-tailoring and evidence-coverage Electron specs;
- the unsaved-navigation and resume-first web specs;
- the filmed demo story.

`help.spec.ts` now finds Help in the utility navigation landmark. Its assertions are unchanged.

## Local validation

All results below are local runs on Windows 11 with Node 24.19.0, Playwright Chromium and Electron, and the pinned SQLite 3.53.4 with its SHA3 checksum verified. No hosted CI result is claimed here.

**Integrated candidate `6eeaa83`:**

| Check | Result |
| --- | --- |
| `npm run typecheck`, `npm run build:pwa`, `npm run build` | clean |
| `npm run test:pwa:e2e` (full web suite) | **50/50** |
| `npx playwright test` (full Electron suite) | **33/33** |

**Earlier failures during integration:**

- At `3f3b3a3`, before the helper fix, the full Electron run failed **8 of 33**:
  - 7 failures came from the shared `navigateTo` helper clicking links inside collapsed groups.
  - 1 was the known G7 resume-tailoring flake.
- One later rerun hit the G7 `onboarding.spec.ts:219` flake, which then passed 5/5 twice.

**Real-browser review:** 3 themes × {1440×900, 1280×580, 390×780, 320×700} × 3 routes.

| Measure | `main` `296cac2` | Candidate `6eeaa83` |
| --- | --- | --- |
| Settings visible in viewport | 18/36 | **36/36**, and Help is also visible in 36/36 |
| Horizontal overflow | none | none |
| Sidebar controls under 44 px | menu button 46×38 | **none** |
| Sidebar text contrast against the theme sidebar color | — | 6.6–12.6:1 (white/60 to white/80) |

Defects found and fixed in this review:

- **Active page hidden after auto-expand:** a deep link to `#/resume` at 1280×580 expanded My Career, but Resume stayed below the sidebar's scroll area.
- **Small menu button:** the toggle was 46×38 px.

Both defects have regression tests in `tests/pwa/sidebar-scroll.spec.ts` that failed before the fix.

## Remaining before merge

- An independent UX and accessibility review of the exact candidate SHA.
- Owner preview and explicit merge approval, after #186.

## Broader UI refinement (#248)

After the navigation is qualified, consider a **separate incremental visual-elevation pass** rather than a full rewrite:

- reduce the oversized hero sections that repeat on every page;
- make each page's primary action clearer;
- normalize card density and text hierarchy;
- audit content readability on small screens.

Keep Career Evidence provenance and the deliberate-application controls visible.
