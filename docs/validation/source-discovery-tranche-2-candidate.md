# Discovery Provider Tranche #136: Himalayas Candidate

**Status:** candidate on `wip/136-himalayas-discovery-unqualified` (PR #233), **not on main and not shipped**. Merge follows the `GOVERNANCE.md` merge standard: matched scope, exact-head local validation, true documentation, independent review and an owner merge.
**Historical plan record:** `docs/plan-qor-phase17-provider-tranche.md` (vetoed iterations retained for provenance; no gate PASS or seal is claimed).
**Existing stable boundary:** `docs/validation/source-discovery-tranche-1.md`.
**Provider documentation, re-read 2026-11-02:** https://himalayas.app/docs/remote-jobs-api .

## Candidate functionality

- Desktop discovery reads the **unfiltered** Himalayas browse endpoint (`https://himalayas.app/jobs/api`): at most 5 sequential pages of 20, the documented maximum page size, so up to the 100 most recent listings. The only query parameters are `limit=20` and the opaque `cursor` that Himalayas returned on the previous page. **No user data is sent to Himalayas.** Search terms, target-role titles, locations and track identifiers never appear in a Himalayas request. Role matching against the user's target-role titles happens locally, with the same title matcher used for Remote OK and Arbeitnow.
- A first-page failure (HTTP error, oversized or invalid body) makes Himalayas unavailable for that run with a named warning. A later-page failure keeps the earlier pages and says where reading stopped. Other feeds are unaffected either way.
- Validated listings keep source attribution and the API's `applicationLink` on `himalayas.app`, as the provider's terms require. Sojourner does not invent a direct employer application URL. The existing **Found via Himalayas** and **Open opportunity** controls supply the source name and backlink.
- Listings remain *opportunity-only*. They never become monitorable employers just because the provider returns a listing. Existing monitored-source approval is unchanged.
- Results are interleaved by provider before the user's result cap, so a large incumbent feed cannot silently crowd out a newer relevant provider. This does not by itself show a real-world gain in unique coverage.
- The web app skips Himalayas and shows the warning "Himalayas was skipped: the web app cannot reach its public API because Himalayas does not allow browser cross-origin requests (CORS). No proxy or credential workaround is used." Himalayas is not in the PWA `connect-src` allowlist (`src/pwa/security/policy.ts`), and no request to it is attempted.

## Defects closed in this candidate

| Defect | Before | Now |
| --- | --- | --- |
| `pubDate` epoch seconds | Read as milliseconds, so dates rendered in January 1970 | A number below 1e12 is seconds and anything larger is milliseconds. Strings go through `Date.parse`. Dates before 2000-01-01 or more than one day in the future become unknown. |
| Numeric time zones | Live values such as `[-5, -4]` were rejected, so time-zone eligibility was dropped | Offsets from -12 to 14 render as `UTC-5`, `UTC+3.5` or `UTC+0`. Numeric strings and `UTC±HH:MM` strings are accepted. Anything else, such as `EST`, makes time-zone eligibility unknown. |
| Location lists over 12 | The whole list was dropped as "eligibility unspecified" | Lists are accepted. Up to 250 countries and 50 time zones are stored, with the provider's full count kept. Display shows three entries, then "and N more". The listing is never dropped for a long list. The documented `{ name }` object form is also read. |
| Unbounded response bodies | `response.json()` with no size limit | Bodies are read as a counted stream. The stream is cancelled once it passes the cap, and the call fails with "discovery response too large". The body is decoded as strict UTF-8. Caps: Himalayas 1 MiB per page (a live 20-job page was about 171 KB on 2026-11-02), Remote OK 4 MiB and Arbeitnow 8 MiB. |
| Search queries carrying role titles | Up to three `q=<role title>` searches per run | Replaced by the unfiltered browse endpoint and local matching, as described above. |

## Limits

- Coverage is **partial**: only the most recent listings (up to 100) are read, out of a much larger inventory. The provider refreshes data about every 24 hours. Polling more often cannot create fresher jobs, and unauthenticated callers share one public rate allowance.
- This is not a general Himalayas integration, an all-market crawl or an application API.
- The job API requires visible credit and a backlink. Sojourner must not pass these jobs to other job boards or aggregators.
- We Work Remotely remains a **separate, held phase**, pending written publisher-terms clarification (PR #238).
- No live measurement of duplicate versus unique coverage against Remote OK and Arbeitnow has been completed. **#136 stays open** until that is measured, and the provider is then either kept with evidence or explicitly deferred.

## Test contract

- `tests/himalayas-discovery.test.cjs` uses isolated synthetic fixtures with exact parsed-host routing. It covers:
  - payload validation, URL and GUID integrity, and attribution;
  - the seconds, milliseconds and bounds date rules;
  - numeric and string time zones, long and truncated restriction lists, and their rendering;
  - cursor validation and the page bound;
  - local role filtering, and an assertion that every Himalayas request URL carries only `limit=20` and a provider-issued cursor, with no user value;
  - later-page and first-page failure isolation;
  - streaming cancellation of an oversized body;
  - the exact web-skip warning, with no Himalayas request made.
- `tests/source-discovery-provider.test.cjs` adds the Remote OK and Arbeitnow body caps, and routes by exact hostname instead of URL substrings.
- `tests/e2e/source-discovery.spec.ts` (Electron) checks that a mocked Himalayas page appears with attribution, the eligibility text `Remote · United States · UTC-5, UTC-4 time zone` and no approval action. A non-matching listing is filtered out locally, and the recorded Himalayas requests carry only `limit=20`.
- `tests/pwa/source-discovery-web-boundary.spec.ts` (PWA production build) checks that discovery shows the exact Himalayas skip warning and makes no request to `himalayas.app`.

**CI evidence:** not established until exact-head workflow results are independently observed. Green source-contract tests do not prove provider availability.

## We Work Remotely RSS phase-2 implementation candidate (dependent WIP)

- First-party source: https://weworkremotely.com/remote-job-rss-feed; all-jobs feed at https://weworkremotely.com/remote-jobs.rss.
- WWR's RSS page expressly allows use of the public feed with attribution. Its separate https://weworkremotely.com/api-terms-and-guidelines restricts job-search services and bypassing its application interface. **This unresolved terms-scope conflict is a release blocker**, not a grant of broader rights.
- Candidate fetches only one first-party HTTPS RSS feed with a strict byte limit, publisher-only redirects, timeout, and denial of DTD/entity declarations. No page scraping, new library, API key, or external proxy.
- Normalizer accepts valid RSS 2.0 item elements with title as Employer: Position, direct publisher link, date, region, country, type and description; ignores headquarters state. Rejects unsafe/offsite links, unsupported entities, malformed nesting, duplicate listing links and oversize feeds.
- Location prefers country over potentially misleading broad region; missing country plus Anywhere in the World yields **eligibility unspecified** rather than invented unrestricted access.
- Every result remains an opportunity-only lead. The existing per-provider result interleaving prevents monopolization of the limit.
- PWA browser CORS is **unverified**; this feed is skipped there with a warning. No cloud proxy, CORS bypass or silent feature-parity claim.
- Not shipped or Qortara-qualified. Pending: complete exact-head suites; live RSS schema/size check; terms signoff; independent source security review; measured incremental employer/title/eligibility coverage vs Remote OK, Arbeitnow and Himalayas.

### Regression cases

`tests/wwr-discovery.test.cjs` covers CDATA, entities, invalid XML and DTDs, offsite links, duplicate jobs, field projection, country restrictions, redirect host and size boundaries, HTTP 429, runtime skip and independent failure isolation. The Electron source-discovery E2E fixture asserts attribution and no source approval.

No live provider availability, legal permission or employment eligibility is inferred from synthetic test successes.
