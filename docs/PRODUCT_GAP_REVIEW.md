# Product Gap Review

**Review date:** October 2026  
**Scope:** current `main`, not only the published v1.2.0 release

This document identifies meaningful product gaps without turning competitor feature lists into a shopping spree. Sojourner's accepted strategic direction is **quality over quantity**: help a person find the right path to employment, not maximize application throughput.

## Disposition vocabulary

| Disposition | Meaning |
| --- | --- |
| **Needed** | A demonstrated reliability/product-delivery gap that materially limits the current contract. |
| **Candidate** | Plausibly valuable, but still requires evidence, UX design, or boundary review before implementation. |
| **Deferred** | Intentionally postponed because current evidence does not justify the complexity, privacy cost, or support burden. |
| **Rejected / non-goal** | Conflicts with accepted product principles unless governance explicitly changes. |
| **Covered** | Represented by current `main`, even if future refinement may still be useful. |

## Current baseline

Current `main` covers:

- progressive onboarding;
- multiple Target Tracks with required/preferred/target semantics;
- Career Evidence import/direct authoring, provenance, correction, credentials, references, and lineage;
- company/source monitoring and explicit source-support classification;
- consumer source discovery with explicit approval before monitoring;
- durable canonical job-source snapshots;
- source acquisition diagnostics;
- connection-pinned anti-rebinding network transport;
- multi-dimensional opportunity assessment;
- deterministic resume creation, validation, tailoring, versioning, and exact submitted-artifact linkage;
- application lifecycle contacts, milestones, reminders, interviews, follow-up, and offers;
- evidence-grounded interview preparation, Career Stories, and application materials;
- recurring-gap and observed-outcome analysis;
- verified backup/restore and JSON Resume interoperability;
- release-blocking packaged-binary smoke on Windows/macOS prerelease builds.

The October 4, 2026 auto-apply research is retained in [`research/AUTO_APPLY_MARKET_RESEARCH_2026-10-04.md`](./research/AUTO_APPLY_MARKET_RESEARCH_2026-10-04.md).

## Covered gaps

### Canonical full job-description/source preservation

**Disposition: Covered**

Completed under #117.

Sojourner now stores durable source snapshots with source URL, retrieval time, content hash, extraction/version metadata, completeness state, changed-content history, and deduplication. Requirement analysis reasons over preserved source text rather than the legacy short description snippet and retains source linkage for later application/interview context.

Future source-specific improvements may still increase completeness, but the underlying truth/provenance gap is closed.

### Source reliability and diagnostics for dynamic portals

**Disposition: Covered**

Completed under #118.

Acquisition now distinguishes success, successful zero-result runs, cooldown/circuit states, unsupported sources, browser unavailability, network-policy rejection, access denial, rate limiting, timeouts/retrieval errors, extraction failures, parser failures, and unclassified failures. User-facing explanations are separated from raw diagnostics.

Future source-family improvements should be evidence-driven rather than restoring generic “scrape failed” ambiguity.

### Career Ops relationship-path design

**Disposition: Design covered; implementation remains a candidate**

Issue #121 completed the bounded design/governance pass.

Accepted direction includes:

- intentional company targets before an opening exists;
- relationships independent of one application;
- real referrals/introductions/recruiters/hiring managers/former employees/communities/events where the data is user-supplied or explicitly connected;
- explicit distinction between an existing relationship, a plausible path, and a person merely worth researching;
- user-controlled outreach preparation/follow-up;
- no contact scraping/enrichment by default;
- no invented familiarity/referral/endorsement;
- no automated connection-request or cold-outreach spam;
- no silent external action;
- no networking-volume vanity metric.

Those broader relationship-path features are **not implemented in v1.2.0** merely because their design contract is complete.

## Needed gap

### Publish the accumulated product

**Disposition: Done for v1.2.0; distribution channels in progress**

v1.2.0 published the accumulated product on 2026-10-05 as an owner-approved unsigned desktop release. Ordinary-user delivery now runs through the Microsoft Store package (#125, which awaits Partner Center certification) and the local-first web/PWA runtime (#130, self-hosted on localhost until public demand justifies a production origin). Neither channel needs Sojourner-owned signing certificates.

## Strong candidates after v1.2.0

### Broader opportunity discovery providers

**Disposition: Candidate, strategically important**

Potential classes include:

- USAJOBS/federal;
- state/local government;
- school districts;
- hospitals/health systems;
- academic boards;
- professional associations;
- union/apprenticeship sources;
- staffing/contract marketplaces;
- broader general job feeds.

Provider credentials must not become mandatory ordinary-user setup. Discovery candidates remain untrusted until user approval, and a provider should earn inclusion through coverage value, stability, terms/licensing, and maintenance cost.

### Faster job capture from arbitrary browsing

**Disposition: Candidate**

Before maintaining a browser extension, validate whether a simpler local paste/import or protocol-handler flow solves most of the need. Any captured content remains untrusted source evidence, requires explicit user action, and does not imply application submission.

### Reusable application-question answers

**Disposition: Candidate**

Potential direction:

- preserve exact question text and user-authored answer;
- classify factual, narrative, and preference answers;
- link factual claims to Career Evidence where appropriate;
- suggest prior answers for review rather than silently reusing them;
- never auto-submit.

### User-controlled application form assistance

**Disposition: Candidate, high governance threshold**

A bounded implementation could fill confirmed/user-authored facts on a specific user-initiated application page while keeping every value visible/editable and leaving final submission to the user.

No CAPTCHA bypass, stealth automation, or mass submission. Browser authority and supported ATS boundaries require explicit security review.

### Career Ops company targeting and relationship-path implementation

**Disposition: Candidate, strategically important**

The #121 design contract is complete. Actual implementation should happen only after v1.2.0 delivery and should preserve the user-authority/privacy boundaries already documented.

### Calendar integration

**Disposition: Candidate**

A narrow opt-in adapter could mirror selected interviews/deadlines/follow-ups while keeping Sojourner authoritative. Deleting a calendar event must not silently erase Sojourner history.

### Mock interview practice and answer feedback

**Disposition: Candidate**

Potential layers include deterministic question practice, optional inference-backed follow-ups, and optional audio feedback. Any remote path must disclose exactly what career/job/answer content leaves the device.

### User-defined tags / richer organization

**Disposition: Candidate, low urgency**

Validate actual organization pain before adding another taxonomy beside Target Tracks and lifecycle statuses.

### Compensation-basis expansion

**Disposition: Candidate**

Add daily/project/commission/mixed compensation semantics only when real workflows demonstrate that hourly/annual plus notes are insufficient.

## Deferred capabilities

### Remote inference provider

**Disposition: Deferred**

The deterministic core already supports assessment, tailoring, materials, interview preparation, Career Stories, and insights. A provider-neutral inference seam remains possible but has not demonstrated enough incremental value to justify privacy/configuration complexity.

### OCR for scanned/image-only resumes

**Disposition: Deferred**

Current import surfaces an explicit OCR-required state. Add OCR only after evaluating local or clearly disclosed provider options, accuracy, packaging cost, and demand.

### DOCX resume export

**Disposition: Deferred**

PDF remains the governed output path with Truth and Parseability Gates. DOCX should earn its additional rendering/compatibility surface through demonstrated demand.

### Federal resume / academic CV specialized projections

**Disposition: Deferred / candidate on demonstrated demand**

The core evidence model can represent the facts, but these artifact types have materially different document requirements.

### Travel, relocation, sponsorship/work-authorization fields as universal core

**Disposition: Deferred**

Cross-career validation did not justify forcing them into every Target Track. Add bounded fields only when repeated real workflows show notes/unknowns are insufficient.

### Cloud sync / multi-device state

**Disposition: Deferred, high-impact**

Backup/restore provides portability without account, encryption/key-management, conflict-resolution, server, and privacy obligations. Sync must earn those costs.

### Linux packaged distribution

**Disposition: Deferred pending demand**

Evaluation #129 is closed. Electron packaging options exist, but a supported Linux product means owning packaging, runtime, source acquisition, desktop integration, update behavior, and release validation. Linux is not being added merely to avoid Windows/macOS signing requirements.

### Microsoft Store AppX/MSIX distribution

**Disposition: Valid future distribution candidate, deferred past v1.2.0**

Evaluation #133 is closed. Microsoft Store distribution is a legitimate way to obtain a Microsoft-trusted Store package without owning the same direct-download signing path, but introducing a new package/store lifecycle during v1.2.0 stabilization would create unnecessary release scope.

## Rejected / non-goals

### Autonomous mass auto-apply

**Disposition: Rejected / non-goal**

Sojourner automates work around good employment decisions, not submission volume. It may automate discovery, assessment, preparation, reminders, and bounded user-controlled form assistance. Autonomous mass submission conflicts with user authority and the product's quality-over-quantity contract.

### Opaque ATS / hiring probability as product truth

**Disposition: Rejected / non-goal**

Sojourner may expose evidence coverage, keywords, parseability, or known requirements. It must not present a proprietary percentage as an employer's hidden ranking or probability of being hired.

### Recruiter-facing ATS / team workspace

**Disposition: Rejected unless product governance changes**

The product is a personal job-seeker tool. Being recruiter-friendly through higher-intent candidates does not require Sojourner to become recruiter software.

### Generic agent framework, vector database, or workflow engine as product architecture

**Disposition: Rejected without a measured requirement**

These are implementation choices, not user capabilities. Current vertical domain services are clearer and safer.

## Competitive-pattern observations

Public product/help material from Huntr, Teal, Simplify, Careerflow, Jobscan, ApplyBlast, LinkedIn, Indeed, and related tools remains useful directional evidence. It is not a feature-parity checklist. Sojourner should be better at its own contract rather than becoming an offline imitation of every career SaaS simultaneously.

## Recommended next-work order

After **stable v1.2.0 is published**, the current investigation order is:

1. broaden opportunity discovery, prioritizing underserved validated career contexts;
2. test low-friction job capture, beginning with native paste/import before maintaining a browser extension;
3. evaluate reusable application-question answers and bounded user-controlled form assistance;
4. select a first implementation slice from the completed Career Ops relationship-path design;
5. evaluate calendar and mock-interview enhancements only when real use demonstrates the need;
6. revisit Linux and Store distribution only when user demand/support economics justify the additional release surface.

Release delivery remains the immediate priority. Future work should favor **better paths and better decisions over more applications**.
