# Feature Index

Per `qor/references/doctrine-feature-inventory.md` (ships with the installed Qor-logic-plus skills, not this repo): one row per user-touchable feature, cross-referenced
to the supporting test evidence. V1 (2026-10-06) enumerated user journeys reachable from the
renderer routes in `src/App.tsx` plus runtime-specific (Electron / web) surfaces.
The 2026-10-10 reconciliation adds FX051-FX059 against `main` at `4721e7fa782099c69019494d6f823c2cc372b98d`; these new entries do not inherit the earlier UI-verification results.
The 2026-10-15 refresh adds FX060-FX069 against `main` at `5c749dc28170bc46ce2b104fe24309d3aff7a02c` (PRs merged 2026-10-10 to 2026-10-15) and moves the FX051 and FX053 line anchors to their current lines. FX020 is re-pointed because #272 shortened `src/components/FilterForm.tsx` below its old line. Other FX001-FX050 line anchors date from the October 6 inventory and may have drifted. The cited specs were added red-first in their PRs, but no run is recorded against this inventory checkpoint, so these rows are also `unverified`.

Status is assigned honestly:

- `verified` — a UI-driven Playwright spec exercises the feature and passed on 2026-10-06
  (`npm run test:e2e`, Windows host).
- `unverified` — no recorded passing UI-driven acceptance evidence for this exact feature and validation target at the inventory checkpoint, even if deterministic unit tests or a Playwright spec exist. The October 6 Windows-host PWA limitation is historical evidence, not a claim that all PWA tests still fail today.

Surface is the route (or runtime surface) where the feature ships.

| ID | Name | Source-of-truth file:line | Doc citation | Test path | Verification status | Surface |
| --- | --- | --- | --- | --- | --- | --- |
| FX001 | Primary navigation sidebar | src/components/Sidebar.tsx:16 | HELP.md | tests/e2e/app.spec.ts | verified | shell |
| FX002 | Dashboard next-step navigation | src/pages/Dashboard.tsx:162 | HELP.md | tests/e2e/app.spec.ts | verified | / |
| FX003 | Onboarding: start from a resume | src/pages/Onboarding.tsx:226 | docs/design/UNIVERSAL_USER_STORIES.md (US-1) | tests/e2e/onboarding.spec.ts | verified | /onboarding |
| FX004 | Onboarding: enter background manually | src/pages/Onboarding.tsx:246 | docs/design/UNIVERSAL_USER_STORIES.md (US-2) | tests/e2e/onboarding.spec.ts | verified | /onboarding |
| FX005 | Onboarding: goal-first target track | src/pages/Onboarding.tsx:370 | docs/design/UNIVERSAL_USER_STORIES.md (US-3) | tests/e2e/onboarding.spec.ts | verified | /onboarding |
| FX006 | Onboarding: skip setup | src/pages/Onboarding.tsx:200 | HELP.md |  | unverified | /onboarding |
| FX007 | Author Career Evidence (incl. credentials, references) | src/pages/EvidenceEntry.tsx:341 | docs/design/UNIVERSAL_USER_STORIES.md (US-7, US-8) | tests/e2e/credential-evidence.spec.ts | verified | /career-evidence/new |
| FX008 | Replace evidence with supersede lineage | src/pages/EvidenceEntry.tsx:466 | docs/validation/evidence-references-lineage-v1.md | tests/e2e/evidence-history.spec.ts | verified | /career-evidence/new |
| FX009 | Save Career Profile preferences | src/pages/CareerProfile.tsx:378 | HELP.md |  | unverified | /career-profile |
| FX010 | Paste resume text and extract evidence | src/pages/CareerProfile.tsx:441 | docs/design/UNIVERSAL_USER_STORIES.md (US-1) | tests/e2e/app.spec.ts | verified | /career-profile |
| FX011 | Import resume file from Career Profile (DOCX/PDF/TXT) | src/pages/CareerProfile.tsx:397 | docs/design/UNIVERSAL_USER_STORIES.md (US-1) | tests/pwa/career-ops.spec.ts | unverified | /career-profile |
| FX012 | Review imported evidence: confirm | src/pages/CareerProfile.tsx:576 | docs/design/UNIVERSAL_USER_STORIES.md (US-9) | tests/e2e/app.spec.ts | verified | /career-profile |
| FX013 | Review imported evidence: edit, reject, merge | src/pages/CareerProfile.tsx:585 | docs/design/UNIVERSAL_USER_STORIES.md (US-9, US-10) |  | unverified | /career-profile |
| FX014 | Target Tracks with constraint strengths | src/pages/TargetTracks.tsx:337 | docs/design/UNIVERSAL_USER_STORIES.md (US-4, US-5, US-6) | tests/e2e/target-tracks.spec.ts | verified | /target-tracks |
| FX015 | Delete a Target Track | src/pages/TargetTracks.tsx:335 | HELP.md |  | unverified | /target-tracks |
| FX016 | Discover opportunities and approve a source | src/pages/Companies.tsx:217 | docs/validation/source-discovery-tranche-1.md | tests/e2e/source-discovery.spec.ts | verified | /companies |
| FX017 | Add a job source manually | src/components/CompanyForm.tsx:93 | HELP.md | tests/e2e/app.spec.ts | verified | /companies |
| FX018 | Run a source scrape | src/pages/Companies.tsx:488 | HELP.md |  | unverified | /companies |
| FX019 | Remove a job source | src/pages/Companies.tsx:497 | HELP.md | tests/e2e/app.spec.ts | verified | /companies |
| FX020 | Create a filter | src/components/FilterForm.tsx:65 | HELP.md |  | unverified | /filters |
| FX021 | Delete a filter | src/pages/Filters.tsx:84 | HELP.md |  | unverified | /filters |
| FX022 | Browse and search jobs | src/pages/Jobs.tsx:162 | HELP.md |  | unverified | /jobs |
| FX023 | Opportunity assessment against a track | src/components/JobEvidenceCoverage.tsx:159 | docs/design/UNIVERSAL_USER_STORIES.md (US-14 to US-18) | tests/e2e/evidence-coverage.spec.ts | verified | /jobs |
| FX024 | Mark job seen | src/pages/Jobs.tsx:291 | HELP.md |  | unverified | /jobs |
| FX025 | Track a job as an application | src/pages/Jobs.tsx:300 | HELP.md |  | unverified | /jobs |
| FX026 | Prepare resume for a job | src/components/JobEvidenceCoverage.tsx:349 | docs/design/UNIVERSAL_USER_STORIES.md (US-19) | tests/e2e/evidence-coverage.spec.ts | verified | /jobs |
| FX027 | Application status and notes | src/pages/Applications.tsx:77 | docs/design/APPLICATION_LIFECYCLE_FOUNDATION.md |  | unverified | /applications |
| FX028 | Remove an application | src/pages/Applications.tsx:93 | HELP.md |  | unverified | /applications |
| FX029 | Application contacts, events, and reminders | src/components/ApplicationLifecyclePanel.tsx:179 | docs/design/APPLICATION_LIFECYCLE_FOUNDATION.md | tests/e2e/application-lifecycle.spec.ts | verified | /applications |
| FX030 | Search context and offer details | src/components/ApplicationInsightsPanel.tsx:160 | docs/design/SEARCH_LEARNING.md | tests/e2e/application-insights.spec.ts | verified | /applications |
| FX031 | Cover letter drafts with stale-evidence warning | src/components/ApplicationMaterialsPanel.tsx:98 | docs/design/APPLICATION_MATERIALS.md | tests/e2e/application-materials.spec.ts | verified | /applications |
| FX032 | Interview prep | src/components/InterviewPrepPanel.tsx:52 | docs/design/INTERVIEW_PREP.md | tests/e2e/interview-prep.spec.ts | verified | /applications |
| FX033 | Career Stories linked to evidence | src/components/CareerStoriesPanel.tsx:279 | docs/design/CAREER_STORIES.md | tests/e2e/career-stories.spec.ts | verified | /career-stories |
| FX034 | Delete a Career Story | src/components/CareerStoriesPanel.tsx:328 | docs/design/CAREER_STORIES.md |  | unverified | /career-stories |
| FX035 | Search Insights | src/pages/SearchInsights.tsx:1 | docs/design/SEARCH_LEARNING.md | tests/e2e/application-insights.spec.ts | verified | /search-insights |
| FX036 | Create truthful resume draft and export verified PDF | src/pages/Resume.tsx:296 | docs/design/CAREER_EVIDENCE_RESUME_FUNCTIONAL_DESIGN.md | tests/e2e/app.spec.ts | verified | /resume |
| FX037 | Edit resume statements under the Truth Gate | src/pages/Resume.tsx:345 | docs/design/CAREER_EVIDENCE_RESUME_FUNCTIONAL_DESIGN.md |  | unverified | /resume |
| FX038 | Compare resume versions | src/pages/Resume.tsx:352 | HELP.md |  | unverified | /resume |
| FX039 | Tailor a resume to a job | src/components/ResumeTailoringPanel.tsx:125 | docs/design/UNIVERSAL_USER_STORIES.md (US-19, US-20) | tests/e2e/resume-tailoring.spec.ts | verified | /resume |
| FX040 | Theme selection | src/pages/Settings.tsx:66 | HELP.md |  | unverified | /settings |
| FX041 | Runtime and notification settings | src/pages/Settings.tsx:158 | HELP.md |  | unverified | /settings |
| FX042 | Backup and restore | src/components/BackupRestorePanel.tsx:79 | docs/design/BACKUP_RESTORE.md | tests/pwa/portability.spec.ts | unverified | /settings |
| FX043 | JSON Resume export | src/components/JsonResumePanel.tsx:68 | HELP.md | tests/pwa/career-ops.spec.ts | unverified | /settings |
| FX044 | JSON Resume import | src/components/JsonResumePanel.tsx:59 | HELP.md |  | unverified | /settings |
| FX045 | Store app: import legacy desktop data | src/components/RuntimePanel.tsx:161 | docs/design/MICROSOFT_STORE_PACKAGING.md |  | unverified | /settings |
| FX046 | Web runtime boot, security headers, offline shell | src/pwa/PwaShell.tsx:24 | docs/design/PWA_RUNTIME.md | tests/pwa/runtime.spec.ts | unverified | web runtime |
| FX047 | Web runtime verified update and shell repair | src/pwa/PwaShell.tsx:105 | docs/design/PWA_RUNTIME.md | tests/pwa/update-and-storage.spec.ts | unverified | web runtime |
| FX048 | Web runtime non-Latin resume PDF | src/pwa/runtime/resume-pdf.ts:1 | docs/design/PWA_RUNTIME.md | tests/pwa/unicode-resume.spec.ts | unverified | web runtime |
| FX049 | Desktop Help window and data folder menu | electron/src/main.cts:190 | HELP.md |  | unverified | desktop menu |
| FX050 | Desktop tray and notifications | electron/src/tray-notifications.cts:30 | HELP.md |  | unverified | desktop tray |
| FX051 | Personal Brand drafts and deterministic readiness | src/pages/PersonalBrand.tsx:85 | docs/design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md | tests/pwa/personal-brand.spec.ts | unverified | /personal-brand |
| FX052 | Human-reviewed exact-copy post package and manual receipt | src/shared/personal-brand.ts:121 | docs/adr/0001-personal-brand-publishing-and-analytics.md | tests/personal-brand.test.mjs | unverified | /personal-brand |
| FX053 | Local LinkedIn XLSX import preview and user-confirmed persistence | src/pages/PersonalBrand.tsx:649 | docs/design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md | tests/linkedin-analytics.test.mjs; tests/personal-brand-persistence.test.cjs | unverified | /personal-brand |
| FX054 | Reconciled observed LinkedIn metrics | src/components/LinkedInObservedDashboard.tsx:19 | docs/design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md | tests/linkedin-reconciliation.test.mjs; tests/linkedin-observed-dashboard.test.mjs | unverified | /personal-brand |
| FX055 | User-attested historical LinkedIn post text | src/components/HistoricalLinkedInArchive.tsx:10 | docs/design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md | tests/linkedin-history.test.mjs | unverified | /personal-brand |
| FX056 | Human-confirmed LinkedIn topic labels | src/components/LinkedInTopicAttestations.tsx:8 | docs/design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md | tests/linkedin-topics.test.mjs | unverified | /personal-brand |
| FX057 | Approved-content cohort comparisons | src/components/LinkedInApprovedContentCohorts.tsx:31 | docs/design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md | tests/linkedin-approved-content-cohorts.test.mjs | unverified | /personal-brand |
| FX058 | User-authored economic pathway scenario comparison | src/pages/TargetTracks.tsx:354 | docs/rfc/RFC_ECONOMIC_PATHWAYS_2026-10-09.md | tests/economic-pathways.test.mjs; tests/pwa/economic-pathways-exploration.spec.ts | unverified | /target-tracks |
| FX059 | Development-only read-only MCP adapter | mcp/read-only-adapter.mjs:1 | docs/integrations/JOB_RANGER_MCP_READONLY.md | tests/mcp-readonly-adapter.test.mjs; tests/mcp-readonly-stdio.test.mjs | unverified | local agent stdio (not an end-user route) |
| FX060 | Topic cohort comparisons from user-attested labels (#246) | src/components/LinkedInTopicCohortSummary.tsx:12 | docs/design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md | tests/linkedin-topic-cohorts.test.mjs; tests/pwa/personal-brand.spec.ts | unverified | /personal-brand |
| FX061 | In-app offline Help page (#186) | src/pages/Help.tsx:44 | HELP.md | tests/pwa/help.spec.ts | unverified | /help |
| FX062 | Grouped sidebar navigation with pinned Settings and Help (#273, #318) | src/components/Sidebar.tsx:36 | docs/design/GROUPED_NAVIGATION_271.md | tests/pwa/sidebar-scroll.spec.ts; tests/pwa/sidebar-group-remount.spec.ts | unverified | shell |
| FX063 | Skip link, Escape and focus after mobile navigation (#279) | src/components/Layout.tsx:25 | HELP.md | tests/pwa/nav-keyboard-a11y.spec.ts | unverified | shell |
| FX064 | Pause, resume and reschedule a job source (#275) | src/pages/Companies.tsx:542 | HELP.md | tests/pwa/source-schedule.spec.ts | unverified | /companies |
| FX065 | Edit, enable and disable a filter (#272) | src/pages/Filters.tsx:112 | HELP.md | tests/pwa/filter-editing.spec.ts | unverified | /filters |
| FX066 | Copy current cover-letter text (#270) | src/components/ApplicationMaterialsPanel.tsx:182 | HELP.md | tests/pwa/cover-letter-copy.spec.ts | unverified | /applications |
| FX067 | Save notification settings in place (#276) | src/pages/Settings.tsx:289 | HELP.md | tests/pwa/settings-save-feedback.spec.ts | unverified | /settings |
| FX068 | Task-first Home decision cards (#306, #317) | src/pages/Dashboard.tsx:177 | HELP.md | tests/pwa/home-task-first.spec.ts | unverified | / |
| FX069 | Applications status focus with unsaved-editor retention (#310) | src/pages/Applications.tsx:101 | HELP.md | tests/pwa/applications-status-focus.spec.ts | unverified | /applications |
