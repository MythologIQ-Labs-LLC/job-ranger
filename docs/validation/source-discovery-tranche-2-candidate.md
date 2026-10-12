# Discovery Provider Tranche #136: Himalayas Candidate

**Status:** exploratory implementation only, isolated `wip/136-himalayas-discovery-unqualified`, **not on main, not shipped, not Qortara-qualified**.  
**Plan:** `docs/plans/136-provider-expansion.md`.  
**Existing stable boundary:** `docs/validation/source-discovery-tranche-1.md`.  
**Verified provider documentation, 2026-10-09:** https://himalayas.app/docs/remote-jobs-api, https://himalayas.app/api, https://himalayas.app/docs/openapi.json .

## Candidate functionality

- Job Ranger's public-feed source-discovery seam now includes bounded, role-specific Himalayas search requests (at most the first three target role titles, one first-page request per title).
- Validated listings retain source attribution and a URL on Himalayas, not an invented direct application URL. The UI's existing **Found via Himalayas** and **Open opportunity** controls supply source name and backlink.
- Job location represents provider restrictions explicitly: worldwide only when both geography and time-zone lists are explicitly empty. Missing location data stays **eligibility unspecified** rather than fabricated as unrestricted remote.
- Listings remain *opportunity-only*. They never become monitorable employers merely because the upstream provider returns a listing. Existing monitored-source approval is unchanged.
- Responses with missing or hostile URLs are discarded. An invalid response, HTTP 429, or browser policy block produces provider-specific warnings while other feeds remain available.
- Results are deterministically interleaved by provider before applying the user's result cap, so large legacy feed responses cannot silently crowd out new relevant providers. This does not establish a real-world improvement in unique coverage; that needs measured fixtures.
- The browser/PWA explicitly skips Himalayas with a CORS warning, because the official API disallows direct browser requests. No proxy, CORS bypass, personal-data upload, or mandatory credentials have been added.

## Limits

- This is **not** a general Himalayas integration, all-market crawl, or candidate application API; it uses the public search endpoint only.
- The first three role queries, first pages, and user-visible `partial` coverage are deliberately bounded. The provider's job inventory is refreshed daily. More frequent polling cannot create fresher jobs.
- The job API requires a visible backlink and source credit. Job Ranger must not syndicate these jobs to third-party aggregators.
- We Work Remotely remains a **separate second phase**, contingent on safe RSS parsing, terms compliance, actual PWA access, and tested unique value. https://weworkremotely.com/remote-job-rss-feed
- No live duplicate/unique-coverage measurement against Remote OK and Arbeitnow has been completed; **#136 must stay open** until measured and either implemented with evidence or explicitly rejected/deferred.
- Qortara formal plan gate, independent audit, intent lock and final seal are not established. No production claim is made.

## Test contract

`tests/himalayas-discovery.test.cjs`: isolated synthetic fixtures assert payload validation, URL and GUID integrity, deterministic role filtering, geographic and timezone restrictions, attribution, rate-limit failure isolation, request cap, and browser skip.

`tests/e2e/source-discovery.spec.ts`: mock first-party listings appear in the discovery UI with attribution, visible eligibility and no approval action for provider-only opportunities.

**CI evidence:** not established until exact-head workflow results are independently observed. Green source-contract tests do not prove provider availability or PWA parity.
