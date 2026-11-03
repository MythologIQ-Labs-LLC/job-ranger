# QOR Research: Sojourner Technical Capability Catalog Reconciliation

**Status:** Product-wide capability reconciliation supporting the accepted architecture  
**Date:** 2026-09-24  
**Scope:** Evaluate the maintained Technical Capability Catalog against Sojourner as a whole, not only resume/import intelligence.

## Executive conclusion

The Technical Capability Catalog contains many sophisticated systems that overlap pieces of Sojourner. Most of them should **not** be dependencies.

Sojourner is strongest when it remains a focused consumer application with a small native core:

- Electron desktop shell;
- SQLite-backed durable state;
- typed IPC boundary;
- source-specific ATS adapters plus constrained browser fallback;
- deterministic career/profile matching;
- native application tracking;
- OS-native notifications;
- native Career Evidence and resume lifecycle;
- optional inference behind a narrow provider boundary.

The catalog is most valuable as a source of **specialized capability donors, implementation patterns, benchmarks, and explicit rejection evidence**. It should not turn Sojourner into a composition of agent frameworks, browser clouds, memory systems, workflow engines, and hosted services simply because those products exist.

The accepted architectural principle is therefore:

> **Native vertical product core; narrow replaceable adapters at true external capability boundaries.**

## Evaluation rule

A catalog resource earns adoption only when all of the following are true:

1. it solves a material Sojourner gap;
2. it is materially better than the native implementation path;
3. its license is compatible with Sojourner's MIT distribution and intended use;
4. its transitive/bundled licensing is understood;
5. it does not create an unnecessary cloud or credential boundary;
6. it does not substantially increase installation/packaging burden for ordinary users;
7. it preserves Sojourner's authority and data model rather than becoming a second product inside the product;
8. it has a clear testable seam and can be replaced later.

A resource can be excellent software and still fail this test.

## Product capability map

```text
User intent / Career Profile
          │
          ├─────────────► Source Discovery
          │                    │
          │                    ▼
          │              Source Acquisition
          │                    │
          │                    ▼
          │              Job Normalization
          │                    │
          ▼                    ▼
Career Evidence ───────► Fit / Requirement Mapping
          │                    │
          │                    ▼
          ├─────────────► Resume / Application Material
          │                    │
          │                    ▼
          └─────────────► Applications Lifecycle
                               │
                     ┌─────────┼──────────┐
                     ▼         ▼          ▼
                  Follow-up  Interview   Offer/closeout

Cross-cutting:
- SQLite persistence
- notifications/scheduling
- optional inference
- security/privacy
- import/export/backup
```

The following sections reconcile each domain against catalog candidates.

---

## 1. Desktop runtime and persistence

### Current Sojourner capability

- Electron 44 desktop runtime;
- constrained preload/IPC boundary;
- SQLite repository layer;
- Windows/macOS packaging;
- OS integration for notifications/tray/shell.

### Catalog candidates considered

The catalog contains broad local/self-hosted workspaces, agent control planes, durable workflow engines, memory systems, and application frameworks including Mastra, Vercel Workflow SDK, Restate, Open Multi-Agent, Agent Control Plane, RecallNest, Odysseus, and others.

### Decision

**Keep Sojourner native. Adopt none of these as a core runtime.**

Why:

- Sojourner does not have a distributed-workflow problem;
- SQLite already provides sufficient durable state for a single-user desktop application;
- most workflow/agent platforms introduce server processes, provider abstractions, cloud/storage requirements, or high-authority tool execution;
- adding a general agent-memory platform would duplicate the career evidence/application state Sojourner must own deterministically.

### Architectural rule

All new user-domain state should migrate behind Sojourner's existing backend/SQLite repository boundary unless there is concrete evidence SQLite is insufficient.

---

## 2. Source discovery

### Current gap

Sojourner can monitor known employer career pages, but ordinary users should not need to know ATS URLs or employer source structure in advance.

This is a real product gap.

### Catalog candidates considered

- Career-Ops discovery/scanner patterns;
- Firecrawl web search/scrape/crawl platform;
- wigolo local-first web intelligence;
- browser/search agent stacks and research frameworks;
- broad browser infrastructure such as Browserless and Steel.

### Licensing/boundary findings

- `wigolo` is AGPL-3.0-only, so it is unsuitable for direct incorporation into Sojourner's MIT product.
- Firecrawl has component-scoped/mixed licensing and combines self-hosted and hosted service boundaries; it is too broad to become a default Sojourner dependency without a much stronger need.
- generic browser/search agent platforms introduce far more authority and infrastructure than source discovery requires.

### Decision

**Build a native `SourceDiscoveryProvider` seam. Do not adopt a catalog platform as the default discovery engine.**

Initial discovery should prefer:

1. deterministic recognition of user-provided company/domain/URL input;
2. ATS/careers-page resolution from known patterns;
3. optional, clearly disclosed external search provider later if evidence shows it materially improves discovery.

The provider contract should return candidates, not mutate the source list automatically.

Conceptual contract:

```text
SourceDiscoveryQuery
  targetRoles[]
  geography
  employerHints[]
  remotePreference

SourceDiscoveryCandidate
  employer
  careersUrl
  detectedSourceFamily?
  confidence
  evidence
  provider
```

Users approve sources before they become monitored companies.

### Career-Ops harvest

Use Career-Ops as a reference for:

- title expansion;
- adjacent-title discovery;
- role/geography search configuration;
- company/source portfolio thinking.

Do not import its tech-company defaults or CLI workflow.

---

## 3. Source acquisition and scraping

### Current Sojourner capability

Sojourner already has:

- Greenhouse adapter;
- Lever adapter;
- SmartRecruiters adapter;
- Ashby adapter;
- generic HTML extraction;
- source-family classification;
- browser-backed fallback through an isolated hidden Electron `BrowserWindow`;
- scrape guard/circuit-breaker behavior;
- persistent scrape history.

The current browser loader uses sandboxed Electron web contents, disables Node integration, uses context isolation, denies new windows, validates navigation, uses an ephemeral session partition, and destroys the hidden window after extraction.

### Catalog candidates considered

- Puppeteer;
- Browserless;
- Steel Browser;
- Cloudflare Browser Run;
- Firecrawl;
- Notte;
- browser MCP servers and computer-use frameworks.

### Decision

**Do not replace the current source acquisition architecture.**

Reasons:

- Sojourner already ships Chromium through Electron;
- the hidden BrowserWindow path avoids another bundled browser/runtime;
- managed browser services add cloud, credentials, pricing, session-state, and privacy boundaries;
- browser-agent frameworks add model reasoning where deterministic extraction is preferable;
- Sojourner's use case is narrow: fetch enough page state to extract listings, not operate arbitrary user browser sessions.

### Allowed future exception

If a specific high-value source family cannot be supported reliably with the existing structured/API/HTML/Electron browser paths, evaluate a **source-specific adapter** first. A remote browser service is a last-resort optional provider, not the next abstraction layer.

### Playwright decision

Keep Playwright in the **testing/E2E** role. Do not promote it into production scraping merely because it is already a development dependency.

---

## 4. Job normalization and extraction

### Current capability

Sojourner owns normalized job records and source adapters.

### Catalog relevance

General web/document extraction platforms exist, but adopting one would push source semantics outside Sojourner while still requiring Sojourner-specific normalization.

### Decision

**Keep native source-family normalization.**

Refine adapters as evidence demands. Shared extraction helpers should be native and deterministic.

Use external tools only as test/reference implementations when a parser/extractor deficiency is being investigated.

---

## 5. Career Profile and candidate identity

### Current capability

Career Profile captures user preferences and career context. Current renderer-local persistence is transitional.

### Catalog candidates considered

- Career-Ops profile/config model;
- Work Operating Model Activation and other structured elicitation/profile systems;
- agent memory systems such as RecallNest;
- broad personal-context platforms.

### Decision

**Do not add an agent-memory or generic profiling system.**

Sojourner needs two explicit native concepts:

1. **Preferences/intent**: target roles, geography, compensation, commute, work preferences.
2. **Career Evidence**: factual experience, skills, credentials, education, achievements, projects, publications, etc.

These should live in Sojourner's domain schema and SQLite.

### Useful catalog pattern

Structured, resumable elicitation with confirmation gates is useful as a UX pattern. The data should still persist as native Sojourner records.

---

## 6. Fit and requirement intelligence

### Current capability

Sojourner already has deterministic profile-to-listing fit guidance.

### Strongest catalog/domain source

**Career-Ops remains the main implementation/reference donor.**

Useful mechanisms:

- role/title expansion;
- requirement classification;
- `existing / supported / gap` thinking;
- skill-gap analysis;
- role-specific evidence selection;
- recruiter/hiring-manager risk framing;
- repeated pattern analysis across applications.

### Decision

**Expand the native Sojourner fit engine rather than embedding Career-Ops or an agent framework.**

The next native model becomes:

```text
JobRequirement
      ↕
RequirementEvidenceMap
      ↕
CandidateEvidence
```

Classifications:

- direct;
- transferable;
- ambiguous;
- gap.

Optional inference may suggest mappings, but deterministic/user-confirmed evidence remains authoritative.

### No proprietary ATS score

Hosted resume/ATS scoring services such as Hireflow are useful comparison references but should not define Sojourner's fit score or product truth.

---

## 7. Resume and Career Evidence

See:

- `RESUME_INTELLIGENCE_QOR.md`
- `RESUME_INTELLIGENCE_CATALOG_HARVEST.md`
- `../design/CAREER_EVIDENCE_RESUME_FUNCTIONAL_DESIGN.md`

### Selected combined solution

- **Preferred R1 parser candidate:** anydoc, pending benchmark.
- **Canonical model:** native Candidate Evidence with provenance.
- **Renderer:** existing Electron/Chromium first.
- **Output verification:** reuse adopted parser to re-read generated PDFs where possible.
- **Career-Ops:** native adaptation of truth/ATS/relevance mechanisms.
- **EasyPeasyCV/Tailit:** UX/schema/adapter references, not embedded products.
- **OCR:** separate later capability; no hosted default.

This is the main catalog-driven runtime addition currently justified.

---

## 8. Application tracking

### Current capability

Sojourner owns application statuses and notes. Planned maturity includes dates, contacts, interview milestones, offer data, reminders, and artifact linkage.

### Catalog candidates

Career-Ops has strong workflow concepts, but no catalog resource justifies replacing Sojourner's application domain with an external ATS/project/task system.

### Decision

**Keep Applications native.**

Extend the model to include:

```text
Application
  jobId
  status
  appliedAt
  nextActionAt
  contacts[]
  milestones[]
  notes[]
  artifacts[]
  followUps[]
  outcome?
```

This domain is strategically important because it connects job discovery, resume versions, interviews, and outcomes. Outsourcing it would break Sojourner's product continuity.

---

## 9. Follow-up and reminders

### Current capability

Desktop notifications already exist.

### Catalog candidates considered

General notification systems, workflow engines, calendar platforms, Microsoft 365 context/action products, SaaS agent workspaces.

### Decision

**Use native scheduled state + OS notifications first.**

A simple `nextActionAt`/reminder model in SQLite plus existing desktop notification infrastructure is enough for the base product.

Do not add a workflow engine to remind someone to follow up with a recruiter.

### Future calendar integration

Calendar integration can later be an optional connector boundary if users need it. It should not become a prerequisite for reminders.

---

## 10. Interview preparation

### Catalog sources

- Career-Ops interview workflow and story-bank patterns;
- Interview Prep AI Stack reference workflow;
- generic agent/research frameworks.

### Decision

**Build interview preparation natively around the application's existing evidence.**

Sojourner has an advantage generic interview tools do not: it can know

- the job description;
- requirement/evidence map;
- exact resume version sent;
- application notes;
- identified gaps;
- recruiter/hiring-manager concerns recorded during resume preparation.

Recommended future structure:

```text
InterviewBrief
  applicationId
  jobRequirements[]
  sentResumeArtifactId
  likelyEvidenceQuestions[]
  knownGaps[]
  stories[]
  userPracticeNotes[]
```

Optional inference can generate/practice questions. The evidence package remains deterministic.

Do not adopt a broad interview SaaS or agent platform as core architecture.

---

## 11. Story bank and reusable career examples

Career-Ops' interview story-bank idea is valuable enough to become part of Career Evidence later.

Rather than a separate interview-only data silo, model stories as evidence compositions:

```text
CareerStory
  id
  title
  evidenceIds[]
  situation
  challenge
  action
  result
  reflection
  tags[]
```

A story can then support:

- interview preparation;
- resume statements;
- cover letters;
- networking/outreach;
- performance narrative.

This avoids creating separate copies of the same career facts for every feature.

---

## 12. Cover letters and application materials

### Decision

Do not create a separate document intelligence architecture for cover letters.

They should consume the same:

- Candidate Evidence;
- Job Requirements;
- Requirement Evidence Map;
- company/job context;
- application artifact/version system.

Inference can help draft prose, but truth/provenance rules remain the same.

The resume architecture therefore becomes a **general application-material foundation**, not a resume-specific dead end.

---

## 13. Offer and negotiation support

### Catalog/domain references

Career-Ops contains negotiation and offer-stage patterns.

### Decision

Keep this as future native application-lifecycle functionality:

- offer details;
- compensation components;
- comparison;
- negotiation notes/scripts;
- deadline/reminder tracking.

No third-party runtime is needed to model or compare offer data.

Any inference-based negotiation assistance is advisory only.

---

## 14. Optional inference

### Catalog candidates considered

The catalog contains full agent frameworks and runtimes including Mastra, Open Multi-Agent, Strands, durable workflow systems, multi-agent control planes, and many others.

### Decision

**Do not adopt an agent framework for Sojourner's first inference layer.**

Sojourner needs a narrow provider abstraction, not agent infrastructure.

Conceptual API:

```text
InferenceProvider
  capability()
  structuredGenerate(request, schema)
```

Initial optional use cases:

- semantic requirement/evidence mapping;
- transferability suggestions;
- resume phrasing proposals;
- interview question generation;
- gap synthesis;
- company/role research summaries.

Every inference request must declare which user data is being sent and whether the provider is local or remote.

If future workflows become sufficiently long-running/agentic to justify a framework, reevaluate then. Do not pre-install complexity for hypothetical autonomy.

---

## 15. Research and company context

### Potential future need

Users may benefit from company/role research before an application or interview.

### Catalog candidates

Web search/research systems exist, including Firecrawl and local-first research layers, but several have mixed/AGPL licensing or introduce external service boundaries.

### Decision

Define a future **ResearchProvider** boundary rather than adopting a broad research platform now.

```text
ResearchProvider
  researchCompany(company, role, allowedData)
  researchRoleMarket(role, geography, allowedData)
```

No personal resume/evidence data should be included in general web search queries unless strictly necessary and explicitly allowed.

Sojourner can operate without this capability.

---

## 16. Browser form filling and application submission

### Catalog findings

Career automation workflows and browser agents demonstrate that form filling is technically feasible. The catalog also records policy risk, including current restrictions around third-party automation of some application flows such as Indeed Apply.

### Decision

**Remain out of scope for the current architecture.**

Sojourner may eventually assist with form-answer preparation or browser handoff, but autonomous submission is not implied by the resume/application roadmap.

A future implementation would require an explicit governance/product decision covering:

- site terms;
- per-application human approval;
- screening-question truthfulness;
- duplicate prevention;
- external-action receipts;
- credential/session handling;
- stop-before-submit behavior.

Do not let a browser dependency make this feature appear accidentally.

---

## 17. Notifications and background scheduling

### Current capability

Electron tray/notifications plus local scrape scheduling already exist.

### Decision

**Keep native.**

No catalog notification platform or workflow engine materially improves the single-user desktop use case enough to justify another service.

Future email/SMS/Slack delivery, if ever desired, belongs behind optional notification adapters and should not replace local notifications.

---

## 18. Export, backup, and portability

### Current need

As Career Evidence and Applications become more valuable, users need an escape hatch from the application.

### Decision

Build a native export/import bundle before considering sync services.

Recommended portable bundle:

```text
sojourner-export.zip
  manifest.json
  profile.json
  evidence.json
  applications.json
  sources.json
  jobs.json
  artifacts/
```

Properties:

- documented schema version;
- hashes for managed artifacts;
- no hidden cloud account requirement;
- explicit handling of sensitive personal data;
- restore/import validation.

JSON Resume can be offered separately as a career-document interoperability export, not as full Sojourner backup.

---

## 19. Search/indexing inside Sojourner

The projected dataset is small enough that SQLite queries and ordinary full-text indexing should remain the default.

Do not add a vector database merely because Career Evidence exists.

A vector/embedding index becomes justified only if measured semantic retrieval quality or performance cannot be delivered through ordinary domain queries and optional inference.

---

## 20. Accessibility/UI component systems

The catalog contains mature React component libraries such as Mantine. Sojourner already has an established lightweight component/theme system.

### Decision

**Do not replace the UI system solely to gain more components.**

Continue improving the current design primitives and accessibility semantics. Introduce a component library only if the maintenance cost of the native system becomes demonstrably larger than migration cost.

The recent sidebar/link defects are evidence for stronger accessibility/interaction tests, not evidence that Sojourner needs a new design system.

---

## 21. Evaluation and testing opportunities

The catalog's strongest reusable lesson outside direct dependencies is systematic evaluation.

Sojourner should add domain benchmarks for:

- source adapter fixtures;
- parser/import corpus;
- requirement/evidence matching;
- resume truth gate;
- resume parseability;
- fit scoring stability;
- first-run usability;
- application migration/export.

Large agent-evaluation frameworks are not required for these. Deterministic fixtures should be preferred wherever possible.

Optional inference features should have separate golden/benchmark sets so model/provider changes cannot silently alter career claims.

---

## 22. Licensing architecture

Sojourner remains MIT.

External capability policy:

### Permissible for direct incorporation, subject to exact review

- MIT;
- Apache-2.0, with required notices/attribution;
- other clearly compatible permissive licenses after review.

### Reference-only unless a separate decision is made

- AGPL/GPL network/copyleft components;
- SSPL;
- noncommercial/share-alike content/templates;
- source-available licenses;
- custom commercial thresholds;
- proprietary services;
- repositories with no stated license.

### Important rule

A permissive root application license does not automatically cover:

- bundled fonts;
- themes/templates;
- model weights;
- datasets;
- hosted services;
- optional plugins/dependencies.

Every adopted component is reviewed at the exact dependency/asset boundary.

---

## 23. Selected architecture after reconciliation

The broader catalog review produces a deliberately small external stack.

### Native Sojourner core

- Electron shell;
- SQLite and managed artifact storage;
- source adapters and hidden Electron browser extraction;
- source/job normalization;
- Career Profile;
- Career Evidence;
- deterministic fit/requirement mapping;
- Applications lifecycle;
- reminders/desktop notifications;
- resume/application artifact lifecycle;
- export/backup;
- UI and accessibility layer.

### Likely new runtime dependency

- **anydoc**, only if it wins the bounded resume-import benchmark.

### Optional future adapter seams, not dependencies today

- `SourceDiscoveryProvider`;
- `InferenceProvider`;
- `ResearchProvider`;
- `OcrProvider`;
- `CalendarProvider`;
- additional `NotificationProvider` channels.

### Primary external design/reference sources

- Career-Ops;
- EasyPeasyCV;
- Tailit;
- parser benchmark peers;
- Interview Prep AI Stack as a workflow reference;
- selected catalog architecture patterns where they solve a defined problem.

### Rejected platform expansion

Do not make Sojourner depend on:

- a generic agent framework;
- a general workflow engine;
- an agent memory platform;
- a managed browser platform;
- a general web scraping platform;
- a vector database;
- a cloud account/backend;
- a proprietary ATS scoring service;
- an autonomous application bot.

Not because those categories are bad, but because Sojourner does not currently need them.

---

## 24. Product architecture principle

The catalog reconciliation yields a useful long-term rule:

> **Sojourner owns career truth, job-search state, and the user's application lifecycle. External capabilities are adapters, never authorities.**

That means:

- a parser can extract but cannot establish truth;
- an LLM can propose but cannot establish truth;
- a search provider can discover but cannot silently add trusted sources;
- a browser can retrieve but cannot silently submit consequential actions;
- a renderer can format but cannot become canonical storage;
- a calendar can mirror reminders but cannot own the application lifecycle.

This keeps Sojourner small enough for ordinary people and extensible enough to grow without turning every future feature into a platform migration.

## 25. Immediate roadmap consequence

The next implementation sequence should be:

1. finish backend/SQLite migration for Career Profile and Applications;
2. freeze Career Evidence contracts and artifact storage;
3. run the resume parser bake-off;
4. implement evidence import/review;
5. implement requirement/evidence mapping;
6. implement deterministic resume projection/rendering/gates;
7. integrate exact resume artifacts into Applications;
8. improve first-run/source discovery around the richer profile/evidence model;
9. add optional inference only after deterministic paths are complete;
10. mature follow-up/interview/offer workflows using the same evidence/application foundation.

This order makes the resume phase strengthen the whole product rather than become an isolated feature tab.
