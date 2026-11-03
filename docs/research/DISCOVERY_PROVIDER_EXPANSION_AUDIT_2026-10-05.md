# Discovery Provider Expansion Audit — 2026-10-05

## Purpose

This audit evaluates a bounded set of job-source candidates surfaced by the October 2026 remote-job-source review. It does **not** convert a website list into an integration backlog.

Sojourner's accepted discovery contract remains unchanged:

- quality over quantity;
- discovery provider, employer, opportunity, and monitorable employer source remain distinct concepts;
- discovered sources do not become trusted/monitored without explicit user approval;
- ordinary users should not need developer credentials merely to use core discovery;
- provider expansion must improve meaningful career coverage rather than inflate listing volume;
- no autonomous application submission or silent external action.

The current built-in discovery provider uses Remote OK and Arbeitnow. This audit is intended to identify the strongest next provider candidates after stable v1.2.0 delivery.

## Evaluation rubric

Each candidate is evaluated on:

1. **Coverage value** — does it add meaningfully different career/employer coverage?
2. **Machine-readable access** — documented JSON/API/RSS is preferred over browser scraping.
3. **Consumer setup burden** — no-auth or low-friction access is preferred.
4. **Terms / attribution clarity** — can Sojourner comply without guesswork?
5. **Maintenance risk** — documented public interfaces are preferred over DOM-dependent extraction.
6. **Fit with Sojourner** — can the provider cleanly sit behind `SourceDiscoveryProvider` without weakening existing trust boundaries?

Scores are directional prioritization aids, not product truth.

## Candidate matrix

| Candidate | Coverage value | Access model | Consumer burden | Maintenance risk | Directional score | Disposition |
| --- | --- | --- | --- | --- | ---: | --- |
| Himalayas | Broad remote roles with location, seniority, employment-type, salary, and timezone semantics | Public JSON API, RSS, MCP | None for public data | Low | **9.5/10** | **P1 provider candidate** |
| We Work Remotely | Established remote-job board across support, product, engineering, sales/marketing, finance, design, DevOps, and other categories | Public RSS, including category feeds | None | Low | **9.0/10** | **P1 provider candidate** |
| ReliefWeb | Humanitarian / international-development jobs not well represented by current general remote feeds | Public read API; pre-approved `appname` required | Low-to-moderate product registration burden | Low | **8.5/10** | **P1 niche candidate after access approval** |
| Idealist | Nonprofit, mission-driven, volunteer, and social-impact employment | Listings REST API; production API key granted on request | Product-side key required | Low | **7.5/10** | **P2 niche candidate** |
| HigherEdJobs | Higher-education faculty, administration, and institutional roles | Public RSS endpoint is strongly indicated, but official current feed documentation was not verified in this pass | Likely none if RSS remains supported | Medium until directly verified | **7.0/10** | **P2 candidate; validate endpoint/terms first** |
| Climatebase | High-value climate-sector specialization with role, workplace, employment-type, experience, organization-type, sector, and climate-solution filtering | Public job UI; no documented public consumer API identified in this pass | None for manual use | Medium-high if browser extraction were required | **6.5/10** | **Research/manual source, not yet an integration candidate** |
| Tech Jobs for Good | Social-impact technology roles across climate, health, education, public service, human rights, and related areas | Public job UI; substantial additional listings appear gated behind account/upgrade behavior | Potential account/subscription dependency | Medium-high | **5.5/10** | **Manual / partnership research** |
| Wellfound | Startup and venture-backed company coverage with compensation/equity and company context | Public job UI; no documented public consumer listings API identified in this pass | None for browsing; integration path unclear | Medium-high | **5.5/10** | **Manual / browser-capture candidate** |
| Devex | International development and NGO ecosystem | Documented API is for member organizations posting jobs, not public consumer discovery | Recruiter/member credentials for documented API | High for discovery unless a separate licensed feed exists | **4.5/10** | **Do not integrate from current evidence** |
| eFinancialCareers | Finance, banking, fintech, and related specialist roles | Documented API is recruiter/account oriented; third-party data-feed vendors exist but introduce separate commercial/terms dependencies | High for direct documented API | High | **4.0/10** | **Do not integrate from current evidence** |

## Evidence notes

### Himalayas

Official documentation exposes a free public JSON jobs API with no authentication, cursor pagination, keyword search, country/worldwide filters, seniority, employment type, company, timezone, salary-related data, and application links. Himalayas also documents an RSS feed and a public MCP surface.

Important constraints:

- API responses are rate limited;
- data refreshes on a documented cadence;
- attribution/link-back is required;
- Himalayas explicitly prohibits republishing its jobs to certain third-party job sites, so Sojourner must remain a user-facing discovery client rather than a redistribution service.

Sources:

- https://himalayas.app/api
- https://himalayas.app/docs/remote-jobs-api
- https://himalayas.app/docs/ai-agents

**Assessment:** best immediate technical fit from this review.

### We Work Remotely

Official documentation exposes a public RSS feed for all jobs plus category-specific RSS feeds. WWR asks consumers to attribute links back to We Work Remotely. The feed model is deterministic and fits the existing local discovery/provider seam without browser automation.

Source:

- https://weworkremotely.com/remote-job-rss-feed

**Assessment:** strong immediate candidate. Category feeds may allow Sojourner to reduce irrelevant volume before local Target Track matching.

### ReliefWeb

ReliefWeb exposes a public read-only V2 JSON API covering jobs and other ReliefWeb content. From November 2025 onward, API usage requires a pre-approved `appname`. The API is documented with quotas and an OpenAPI definition.

Sources:

- https://apidoc.reliefweb.int/
- https://apidoc.reliefweb.int/parameters

**Assessment:** unusually valuable because it adds a genuinely different labor-market segment rather than another general remote aggregator. The appname approval is a product-maintainer concern, not something ordinary users should configure.

### Idealist

Idealist documents a JSON Listings API for consuming jobs and other listings. Production access requires an API key issued manually on request, with attribution/branding requirements and responsible-use guidance.

Sources:

- https://api-sandbox.idealist.org/listings-api
- https://api-sandbox.idealist.org/

**Assessment:** strong nonprofit/social-impact coverage, but product-side credential governance is required before implementation.

### HigherEdJobs

A public RSS category endpoint is referenced by multiple current integrations in the broader open-source career tooling ecosystem:

- `https://www.higheredjobs.com/rss/categoryFeed.cfm?catID={catID}`

The endpoint could not be independently validated through the web research tool during this audit, and current official documentation was not located.

**Assessment:** coverage value is high enough to keep this candidate, but **implementation must not proceed until direct endpoint behavior, attribution expectations, and terms are verified from HigherEdJobs itself.**

### Climatebase

The current public jobs UI provides rich filtering for workplace preference, employment type, experience level, organization type, sector, and climate-solution categories. No documented public consumer API or RSS feed was located in this pass.

Source:

- https://jobs.climatebase.org/jobs

**Assessment:** strategically interesting, technically unproven. Prefer browser/paste capture or a future partnership/feed over undocumented scraping.

### Tech Jobs for Good

The public job search exposes social-impact categories and useful salary/location filters, but the current public surface advertises additional results behind an upgrade flow.

Source:

- https://www.techjobsforgood.com/jobs/

**Assessment:** valuable niche source, but current evidence does not justify a built-in provider dependency. Keep as a manual source / partnership candidate.

### Wellfound

Wellfound provides rich startup job and company context through its public search experience. This pass did not locate a documented public consumer listings API or RSS feed.

Source:

- https://wellfound.com/jobs

**Assessment:** high user value, but browser capture/import is a safer near-term route than maintaining an undocumented provider integration.

### Devex

Devex documents a job-posting API for member organizations using recruiter credentials and an API key. That API is not evidence of a public consumer discovery feed.

Source:

- https://support.devex.com/hc/en-us/articles/360000127713-Job-posting-API-information

**Assessment:** do not treat recruiter-side posting APIs as consumer discovery APIs. Keep Devex as a user-visible/manual source unless Devex offers or approves a separate consumption integration.

### eFinancialCareers

eFinancialCareers documents recruiter/account APIs for creating and retrieving jobs associated with the authenticated account. Third-party vendors advertise normalized eFinancialCareers data feeds, but using those would introduce a separate commercial/provider dependency and must not be mistaken for first-party public access.

Source:

- https://recruitershub.efinancialcareers.com/documentation/api-documentation

**Assessment:** specialist coverage is attractive, but the currently verified integration path is a poor fit for local-first consumer discovery.

## Recommended provider sequence

### Tranche A — public, low-friction providers

1. **Himalayas**
2. **We Work Remotely**

These two provide the clearest technical path to broader remote discovery without requiring ordinary users to configure credentials or weakening the current trust model.

### Tranche B — high-value niche providers

3. **ReliefWeb**, after Sojourner obtains/records an approved product `appname` and verifies attribution/IP handling.
4. **Idealist**, after production API-key approval and credential-storage/governance review.
5. **HigherEdJobs**, only after first-party endpoint and terms verification.

### Remain research/manual for now

- Climatebase
- Tech Jobs for Good
- Wellfound
- Devex
- eFinancialCareers

For these sources, low-friction job capture from normal browsing may deliver more value with less maintenance and terms risk than dedicated adapters.

## Architecture implications

No new discovery architecture is justified.

Any accepted provider should reuse the existing `SourceDiscoveryProvider` boundary and return normalized discovery candidates with:

- provider provenance;
- employer identity where supplied;
- opportunity URL and application URL separately where available;
- location / remote restrictions without inventing unrestricted remote status;
- posted/updated dates when supplied;
- compensation only when source semantics are clear;
- explicit provider-coverage state;
- no automatic promotion to monitored employer source.

Provider-specific fields stay behind the provider adapter. Direct application URLs may become monitorable only through the existing source-detection and user-approval path.

## Implementation gates

Before adding any provider:

- verify current first-party terms and attribution requirements;
- confirm access can be maintained without per-user developer credentials;
- add deterministic normalization and deduplication tests;
- test location/remote restrictions explicitly;
- verify partial-provider failure remains visible and non-destructive;
- measure duplicate rate against existing Remote OK / Arbeitnow results;
- measure unique employer/opportunity coverage using the universal career fixtures;
- reject the provider if it mostly increases duplicate volume or maintenance burden.

## Recommended next action

After stable v1.2.0 publication, implement **one bounded discovery-provider tranche containing Himalayas and We Work Remotely**, then run the universal career fixtures and duplicate/coverage analysis before approving any additional provider.

ReliefWeb should be the first niche provider evaluated after that tranche because it expands the reachable career population rather than merely adding another general remote feed.
