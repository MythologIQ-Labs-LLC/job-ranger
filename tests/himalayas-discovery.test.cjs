const assert = require("node:assert/strict");
const { normalizeHimalayasResponse } = require("../electron-runtime/electron/src/himalayas-discovery.cjs");
const { discoverPublicJobFeeds } = require("../electron-runtime/electron/src/source-discovery.cjs");

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
  pubDate: 1791504000000,
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
function fetchFixture(url) {
  const value = String(url);
  if (value.includes("remoteok.com")) return Promise.resolve(json([]));
  if (value.includes("arbeitnow.com")) return Promise.resolve(json({ data: [] }));
  if (value.startsWith("https://himalayas.app/jobs/api/search?")) return Promise.resolve(json(jobs));
  throw new Error("Unexpected provider endpoint: " + value);
}

(async () => {
  // The parser is strict on envelope, bounded, and rejects unsafe/offsite links.
  assert.throws(() => normalizeHimalayasResponse({}), /jobs array/);
  assert.throws(() => normalizeHimalayasResponse({ jobs: "not-an-array" }), /jobs array/);
  assert.throws(
    () => normalizeHimalayasResponse({ jobs: Array.from({ length: 101 }, () => entry) }),
    /too many jobs/,
  );
  const parsed = normalizeHimalayasResponse(jobs);
  assert.deepEqual(parsed.map(x => x.guid), ["h-101", "h-102", "h-103", "h-nomatch"]);
  assert.deepEqual(parsed[0].locationRestrictions, ["United States"]);
  assert.deepEqual(parsed[0].timezoneRestrictions, ["UTC-05:00"]);
  assert.equal(parsed[0].publishedAt, new Date(1791504000000).toISOString());
  assert.equal(parsed[2].locationRestrictions, null);
  assert.equal(parsed[2].timezoneRestrictions, null);

  const urls = [];
  const result = await discoverPublicJobFeeds(request, {
    fetchImpl: (url) => {
      urls.push(String(url));
      return fetchFixture(url);
    },
    existingCompanies: [],
    runtimeKind: "electron",
    now: () => "2026-10-09T00:00:00.000Z",
  });
  assert.equal(result.coverage, "partial");
  assert.equal(result.candidates.length, 3);
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
  assert.equal(acme.publishedAt, new Date(entry.pubDate).toISOString());
  assert.equal(acme.canMonitor, false);
  assert.equal(acme.sourceUrl, null);
  assert.equal(acme.applyUrl, null);
  assert.match(acme.summary, /Lead onboarding/);
  assert.equal(result.candidates[1].location, "Worldwide remote");
  assert.equal(result.candidates[2].location, "Remote · eligibility unspecified");
  assert.equal(new Set(result.candidates.map(x=>x.id)).size, 3);
  assert.equal(urls.filter(x=>x.includes("himalayas.app")).length, 2);
  assert.ok(urls.some(x => new URL(x).searchParams.get("q") === "Customer Success Manager"));
  assert.ok(urls.some(x => new URL(x).searchParams.get("q") === "Product Manager"));

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
      const value = String(url);
      if (value.includes("remoteok.com")) return Promise.resolve(json(saturatedRemoteOk));
      return fetchFixture(url);
    },
    existingCompanies: [],
    runtimeKind: "electron",
  });
  assert.equal(diversified.candidates.length, 3);
  assert.ok(diversified.candidates.some(candidate => candidate.providerName === "Himalayas"),
    "newly discovered relevant opportunities must not be starved by first-source ordering");

  const unavailable = await discoverPublicJobFeeds(request, {
    fetchImpl: (url) => {
      if (String(url).includes("himalayas.app")) return Promise.resolve(json({ errors: "Rate limited" }, 429));
      return fetchFixture(url);
    },
    existingCompanies: [],
    runtimeKind: "electron",
  });
  assert.equal(unavailable.coverage, "partial", "other feeds are independent of Himalayas");
  assert.equal(unavailable.candidates.length, 0);
  assert.ok(unavailable.warnings.some(x => /Himalayas.*HTTP 429/.test(x)));

  const browserFetches = [];
  const web = await discoverPublicJobFeeds(request, {
    fetchImpl: (url) => { browserFetches.push(String(url)); return fetchFixture(url); },
    existingCompanies: [],
    runtimeKind: "web",
  });
  assert.equal(web.candidates.length, 0);
  assert.ok(web.warnings.some(x => /Himalayas.*browser.*CORS/i.test(x)));
  assert.equal(browserFetches.some(x => x.includes("himalayas.app")), false, "no futile browser-only CORS requests");

  console.log("Himalayas source-discovery normalization, attribution, isolation and web boundary passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
