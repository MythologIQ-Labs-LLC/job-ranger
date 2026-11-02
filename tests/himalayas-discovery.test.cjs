const assert = require("node:assert/strict");
const {
  normalizeHimalayasResponse,
  himalayasLocation,
  himalayasNextCursor,
  publicationDate,
  HIMALAYAS_MAX_PAGES,
  HIMALAYAS_MAX_RESPONSE_BYTES,
} = require("../electron-runtime/electron/src/himalayas-discovery.cjs");
const {
  discoverPublicJobFeeds,
  HIMALAYAS_WEB_WARNING,
} = require("../electron-runtime/electron/src/source-discovery.cjs");

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const request = {
  targetTrackId: "target-1",
  roleTitles: ["Customer Success Manager", "Product Manager"],
  locations: ["Maryland, USA"],
  limit: 20,
};
const entry = {
  guid: "h-101",
  companyName: "Acme Global",
  title: "Customer Success Manager",
  applicationLink: "https://himalayas.app/jobs/acme-csm-101",
  locationRestrictions: ["United States"],
  timezoneRestrictions: ["UTC-05:00"],
  employmentType: "Full Time",
  excerpt: "Lead onboarding and customer retention.",
  pubDate: 1789962228,
};
const jobs = {
  jobs: [
    entry,
    { ...entry, guid: "h-101", excerpt: "Duplicate listing" },
    {
      guid: "h-102", companyName: "Globe Co", title: "Customer Success Manager",
      applicationLink: "https://himalayas.app/jobs/global-csm-102",
      locationRestrictions: [], timezoneRestrictions: [], excerpt: "Improve lifecycle.",
    },
    {
      guid: "h-103", companyName: "Unknown Region", title: "Product Manager",
      applicationLink: "https://himalayas.app/jobs/product-103",
      excerpt: "Drive product improvements.",
    },
    {
      guid: "h-unsafe", companyName: "Unsafe", title: "Customer Success Manager",
      applicationLink: "javascript:alert(1)",
    },
    {
      guid: "h-offsite", companyName: "External Only", title: "Customer Success Manager",
      applicationLink: "https://example.org/jobs/others",
    },
    {
      guid: "h-nomatch", companyName: "Engineers", title: "Backend Engineer",
      applicationLink: "https://himalayas.app/jobs/backend",
    },
  ],
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

/** Route by exact parsed host and path, never by URL substring. */
function route(url) {
  const parsed = new URL(String(url));
  return { parsed, host: parsed.hostname, path: parsed.pathname };
}
function isHimalayasBrowse(url) {
  const { host, path } = route(url);
  return host === "himalayas.app" && path === "/jobs/api";
}
function isHimalayas(url) {
  return route(url).host === "himalayas.app";
}
function feedFixture(url, himalayasBody = jobs) {
  const { host } = route(url);
  if (host === "remoteok.com") return Promise.resolve(json([]));
  if (host === "www.arbeitnow.com") return Promise.resolve(json({ data: [] }));
  if (isHimalayasBrowse(url)) return Promise.resolve(json(himalayasBody));
  throw new Error("Unexpected provider endpoint: " + String(url));
}

/** Every Himalayas request carries only the fixed page size and a provider-issued cursor. */
function assertNoUserDataSent(urls, providerCursors) {
  const userValues = [...request.roleTitles, ...request.locations, request.targetTrackId]
    .flatMap((value) => [value, ...value.split(/[\s,]+/)])
    .filter((value) => value.length >= 3)
    .map((value) => value.toLowerCase());
  for (const raw of urls) {
    const url = new URL(raw);
    assert.equal(url.origin + url.pathname, "https://himalayas.app/jobs/api");
    for (const key of url.searchParams.keys()) {
      assert.ok(["limit", "cursor"].includes(key), "unexpected Himalayas query parameter " + key);
    }
    assert.equal(url.searchParams.get("limit"), "20");
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null) assert.ok(providerCursors.includes(cursor), "cursor must come from Himalayas");
    const decoded = decodeURIComponent(raw).toLowerCase();
    for (const value of userValues) {
      assert.equal(decoded.includes(value), false, "request URL leaks user value " + value);
    }
  }
}

function job(overrides) {
  return normalizeHimalayasResponse({ jobs: [{ ...entry, ...overrides }] }, NOW)[0];
}

function oversizedStream(onCancel) {
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent > 4 * HIMALAYAS_MAX_RESPONSE_BYTES) {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      onCancel();
    },
  });
}

(async () => {
  // The parser is strict on envelope, bounded, and rejects unsafe/offsite links.
  assert.throws(() => normalizeHimalayasResponse({}), /jobs array/);
  assert.throws(() => normalizeHimalayasResponse({ jobs: "not-an-array" }), /jobs array/);
  assert.throws(
    () => normalizeHimalayasResponse({ jobs: Array.from({ length: 101 }, () => entry) }),
    /too many jobs/,
  );
  const parsed = normalizeHimalayasResponse(jobs, NOW);
  assert.deepEqual(parsed.map(x => x.guid), ["h-101", "h-102", "h-103", "h-nomatch"]);
  assert.deepEqual(parsed[0].locationRestrictions, { entries: ["United States"], total: 1 });
  assert.deepEqual(parsed[0].timezoneRestrictions, { entries: ["UTC-05:00"], total: 1 });
  assert.equal(parsed[2].locationRestrictions, null);
  assert.equal(parsed[2].timezoneRestrictions, null);

  // pubDate is documented and observed as Unix seconds; it must never render as 1970.
  assert.equal(parsed[0].publishedAt, "2026-09-21T03:43:48.000Z");
  assert.equal(publicationDate(1791504000000, NOW), new Date(1791504000000).toISOString());
  assert.equal(publicationDate(946684799, NOW), null, "before 2000 is not a plausible listing date");
  assert.equal(publicationDate(4102444800, NOW), null, "far-future dates are rejected");
  assert.equal(publicationDate("2026-10-01T00:00:00Z", NOW), "2026-10-01T00:00:00.000Z");
  assert.equal(publicationDate("not a date", NOW), null);
  assert.equal(publicationDate(Number.NaN, NOW), null);

  // Numeric UTC offsets (the live form) are kept, not dropped.
  assert.deepEqual(job({ timezoneRestrictions: [-5, 3.5, 0] }).timezoneRestrictions,
    { entries: ["UTC-5", "UTC+3.5", "UTC+0"], total: 3 });
  assert.deepEqual(job({ timezoneRestrictions: ["-5", "+5.5"] }).timezoneRestrictions,
    { entries: ["UTC-5", "UTC+5.5"], total: 2 });
  for (const invalid of [["EST"], [15], [-13], [Number.NaN], ["UTC-5:00"]]) {
    assert.equal(job({ timezoneRestrictions: invalid }).timezoneRestrictions, null, JSON.stringify(invalid));
  }
  const liveMaximum = [-11, -10, -9.5, -9, -8, -7, -6, -5, -4, -3.5, -3, -2, -1, 0, 1, 2, 3, 3.5, 4, 4.5,
    5, 5.5, 5.75, 6, 6.5, 7, 8, 8.75, 9, 9.5, 10, 10.5, 11, 12, 12.75, 13, 14];
  const allZones = job({ timezoneRestrictions: liveMaximum });
  assert.equal(allZones.timezoneRestrictions.total, 37);
  assert.deepEqual(allZones.timezoneRestrictions.entries.slice(0, 3), ["UTC-11", "UTC-10", "UTC-9.5"]);
  assert.equal(himalayasLocation(allZones), "Remote · United States · UTC-11, UTC-10, UTC-9.5 and 34 more time zone");
  const manyZones = job({ timezoneRestrictions: [...liveMaximum, ...Array(23).fill(0)] });
  assert.equal(manyZones.timezoneRestrictions.total, 60, "long lists are accepted, not dropped");
  assert.equal(manyZones.timezoneRestrictions.entries.length, 50, "stored entries are capped");
  assert.match(himalayasLocation(manyZones), /UTC-11, UTC-10, UTC-9\.5 and 57 more time zone$/);

  // Location lists longer than 12 are accepted; very long lists are truncated with a true count.
  const countries = Array.from({ length: 149 }, (_, index) => `Country ${index + 1}`);
  const emea = job({ locationRestrictions: countries, timezoneRestrictions: [0, 1, 2] });
  assert.equal(emea.locationRestrictions.total, 149);
  assert.equal(himalayasLocation(emea),
    "Remote · Country 1, Country 2, Country 3 and 146 more · UTC+0, UTC+1, UTC+2 time zone");
  const huge = job({ locationRestrictions: Array.from({ length: 300 }, (_, index) => `Place ${index}`) });
  assert.equal(huge.locationRestrictions.entries.length, 250);
  assert.equal(huge.locationRestrictions.total, 300);
  assert.match(himalayasLocation(huge), /^Remote · Place 0, Place 1, Place 2 and 297 more · /);
  assert.deepEqual(job({ locationRestrictions: [{ alpha2: "DE", name: "Germany", slug: "germany" }] })
    .locationRestrictions, { entries: ["Germany"], total: 1 }, "documented object form is read by name");
  const malformed = job({ locationRestrictions: ["United States", "x".repeat(81)] });
  assert.equal(malformed.locationRestrictions, null);
  assert.equal(himalayasLocation(malformed), "Remote · eligibility unspecified");

  assert.equal(himalayasNextCursor({ nextCursor: "MjAyNi0xMS0wMlQ=" }), "MjAyNi0xMS0wMlQ=");
  assert.equal(himalayasNextCursor({ nextCursor: "../x?q=1" }), null);
  assert.equal(himalayasNextCursor({ nextCursor: 7 }), null);

  // Discovery reads the unfiltered list and filters by target-role title locally.
  const urls = [];
  const result = await discoverPublicJobFeeds(request, {
    fetchImpl: (url) => {
      if (isHimalayas(url)) urls.push(String(url));
      return feedFixture(url);
    },
    existingCompanies: [],
    runtimeKind: "electron",
    now: () => "2026-10-09T00:00:00.000Z",
  });
  assert.equal(result.coverage, "partial");
  assert.deepEqual(
    result.candidates.map(x => [x.providerName, x.employerName, x.opportunityTitle]),
    [
      ["Himalayas", "Acme Global", "Customer Success Manager"],
      ["Himalayas", "Globe Co", "Customer Success Manager"],
      ["Himalayas", "Unknown Region", "Product Manager"],
    ],
  );
  const acme = result.candidates[0];
  assert.equal(acme.opportunityUrl, entry.applicationLink);
  assert.equal(acme.provenanceUrl, entry.applicationLink);
  assert.equal(acme.location, "Remote · United States · UTC-05:00 time zone");
  assert.equal(acme.employmentType, "Full Time");
  assert.equal(acme.publishedAt, "2026-09-21T03:43:48.000Z");
  assert.equal(acme.canMonitor, false);
  assert.equal(acme.sourceUrl, null);
  assert.equal(acme.applyUrl, null);
  assert.match(acme.summary, /Lead onboarding/);
  assert.equal(result.candidates[1].location, "Worldwide remote");
  assert.equal(result.candidates[2].location, "Remote · eligibility unspecified");
  assert.equal(new Set(result.candidates.map(x => x.id)).size, 3);
  assert.equal(urls.length, 1, "no cursor means a single page");
  assertNoUserDataSent(urls, []);
  assert.ok(result.warnings.some(x => /Himalayas coverage is limited to its 4 most recent listings.*sent no search terms/.test(x)));

  // Pagination follows only the provider-issued cursor, and stops at the page bound.
  const pagedUrls = [];
  const issued = [];
  let page = 0;
  const paged = await discoverPublicJobFeeds(request, {
    fetchImpl: (url) => {
      if (!isHimalayasBrowse(url)) return feedFixture(url);
      pagedUrls.push(String(url));
      page += 1;
      const nextCursor = `cursor${page}`;
      issued.push(nextCursor);
      return Promise.resolve(json({
        nextCursor,
        jobs: [{ ...entry, guid: `h-page-${page}`, companyName: `Page ${page} Co` }],
      }));
    },
    existingCompanies: [],
    runtimeKind: "electron",
  });
  assert.equal(pagedUrls.length, HIMALAYAS_MAX_PAGES);
  assert.equal(new URL(pagedUrls[0]).searchParams.has("cursor"), false);
  assert.equal(new URL(pagedUrls[1]).searchParams.get("cursor"), "cursor1");
  assertNoUserDataSent(pagedUrls, issued);
  assert.equal(paged.candidates.filter(x => x.providerName === "Himalayas").length, HIMALAYAS_MAX_PAGES);

  // A later page failure keeps the earlier page and says so.
  let calls = 0;
  const interrupted = await discoverPublicJobFeeds(request, {
    fetchImpl: (url) => {
      if (!isHimalayasBrowse(url)) return feedFixture(url);
      calls += 1;
      return Promise.resolve(calls === 1 ? json({ ...jobs, nextCursor: "next" }) : json({ errors: "Rate limited" }, 429));
    },
    existingCompanies: [],
    runtimeKind: "electron",
  });
  assert.equal(calls, 2);
  assert.equal(interrupted.candidates.length, 3);
  assert.ok(interrupted.warnings.some(x => /Himalayas stopped after 1 page: HTTP 429/.test(x)));

  // A prolific incumbent feed must not crowd a distinct source out of a short result list.
  const saturatedRemoteOk = Array.from({ length: 12 }, (_, index) => ({
    id: 9000 + index,
    company: `Remote Employer ${index}`,
    position: "Customer Success Manager",
    url: `https://remoteok.com/remote-jobs/${9000 + index}`,
    location: "Remote",
  }));
  const diversified = await discoverPublicJobFeeds({ ...request, limit: 3 }, {
    fetchImpl: (url) => {
      if (route(url).host === "remoteok.com") return Promise.resolve(json(saturatedRemoteOk));
      return feedFixture(url);
    },
    existingCompanies: [],
    runtimeKind: "electron",
  });
  assert.equal(diversified.candidates.length, 3);
  assert.ok(diversified.candidates.some(candidate => candidate.providerName === "Himalayas"),
    "newly discovered relevant opportunities must not be starved by first-source ordering");

  const unavailable = await discoverPublicJobFeeds(request, {
    fetchImpl: (url) => {
      if (isHimalayas(url)) return Promise.resolve(json({ errors: "Rate limited" }, 429));
      return feedFixture(url);
    },
    existingCompanies: [],
    runtimeKind: "electron",
  });
  assert.equal(unavailable.coverage, "partial", "other feeds are independent of Himalayas");
  assert.equal(unavailable.candidates.length, 0);
  assert.ok(unavailable.warnings.some(x => /Himalayas was unavailable for this discovery run: HTTP 429/.test(x)));

  // An oversized body is cancelled mid-stream; other providers are unaffected.
  let cancelled = false;
  const oversized = await discoverPublicJobFeeds(request, {
    fetchImpl: (url) => {
      if (isHimalayas(url)) {
        return Promise.resolve(new Response(oversizedStream(() => { cancelled = true; }), {
          status: 200, headers: { "content-type": "application/json" },
        }));
      }
      if (route(url).host === "remoteok.com") return Promise.resolve(json(saturatedRemoteOk.slice(0, 1)));
      return feedFixture(url);
    },
    existingCompanies: [],
    runtimeKind: "electron",
  });
  assert.ok(oversized.warnings.some(x => /Himalayas was unavailable.*too large/.test(x)));
  assert.equal(oversized.candidates.some(x => x.providerName === "Himalayas"), false);
  assert.ok(oversized.candidates.some(x => x.providerName === "Remote OK"));
  assert.equal(cancelled, true, "the oversized stream is cancelled");

  // The web runtime skips Himalayas honestly and makes no futile CORS request.
  const browserFetches = [];
  const web = await discoverPublicJobFeeds(request, {
    fetchImpl: (url) => { browserFetches.push(String(url)); return feedFixture(url); },
    existingCompanies: [],
    runtimeKind: "web",
  });
  assert.equal(web.candidates.length, 0);
  assert.ok(web.warnings.includes(HIMALAYAS_WEB_WARNING));
  assert.match(HIMALAYAS_WEB_WARNING, /Himalayas.*browser.*CORS/i);
  assert.equal(browserFetches.some(isHimalayas), false, "no futile browser-only CORS requests");

  console.log("Himalayas source-discovery normalization, privacy, bounds, attribution, isolation and web boundary passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
