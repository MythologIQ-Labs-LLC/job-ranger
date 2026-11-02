const assert = require("node:assert/strict");
const { parseWwrFeed } = require("../electron-runtime/electron/src/wwr-discovery.cjs");
const { discoverPublicJobFeeds } = require("../electron-runtime/electron/src/source-discovery.cjs");
const { fetchDiscoveryXml } = require("../electron-runtime/electron/src/source-discovery-fetch.cjs");

const request = {
  targetTrackId: "track-customer-success",
  roleTitles: ["Customer Success Manager", "Product Manager"],
  locations: ["Maryland, USA"],
  limit: 12,
};

function sample(extra = "") {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"><channel><title>We Work Remotely</title>',
    '<item><title><![CDATA[Headway: Customer Success Manager: Enterprise]]></title>',
    '<guid isPermaLink="true">https://weworkremotely.com/remote-jobs/headway-csm</guid>',
    '<link>https://weworkremotely.com/remote-jobs/headway-csm</link>',
    '<pubDate>Fri, 09 Oct 2026 18:48:42 +0000</pubDate>',
    '<region>Anywhere in the World</region><country>🇨🇦 Canada and 🇺🇸 United States of America</country>',
    '<state>California</state><type>Full-Time</type>',
    '<description>&lt;p&gt;Help &amp; serve enterprise customers.&lt;/p&gt;</description></item>',
    '<item><title>Acme: Product Manager</title>',
    '<link>https://weworkremotely.com/remote-jobs/acme-product-manager</link>',
    '<region>Europe Only</region><description><![CDATA[<p>Build products safely.</p>]]></description></item>',
    '<item><title>Unknown: Customer Success Manager</title>',
    '<link>https://weworkremotely.com/remote-jobs/unknown-csm</link>',
    '<region>Anywhere in the World</region></item>',
    '<item><title>Unsafe: Customer Success Manager</title><link>javascript:alert(1)</link></item>',
    '<item><title>Offsite: Customer Success Manager</title><link>https://evil.example/remote-jobs/offsite</link></item>',
    '<item><title>Developer Co: Backend Engineer</title><link>https://weworkremotely.com/remote-jobs/backend</link></item>',
    '<item><title>Headway: Customer Success Manager: Enterprise</title>',
    '<link>https://weworkremotely.com/remote-jobs/headway-csm</link></item>',
    extra, '</channel></rss>',
  ].join("\n");
}

const bad = [
  '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel/></rss>',
  '<rss><channel><item><title>Unclosed</title></channel></rss>',
  '<rss><channel><item><title>Text &spy;</title></item></channel></rss>',
  '<rss><channel><item><title><![CDATA[not finished</title></item></channel></rss>',
  '<rss><channel><item><title>test</title><link>url</link></item>',
  '<html><body>captcha</body></html>',
  '<rss><channel><item><title>Text</title><link>url</link></item></channel>',
  '<rss><channel><item><title>Test <script>alert(1)</script></title></item></channel></rss>',
];

function response(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}

(async () => {
  const parsed = parseWwrFeed(sample());
  assert.equal(parsed.length, 4, "parser retains valid listings regardless of requested role");
  assert.deepEqual(parsed.map(item => item.employerName), ["Headway", "Acme", "Unknown", "Developer Co"]);
  assert.equal(parsed[0].title, "Customer Success Manager: Enterprise");
  assert.equal(parsed[0].url, "https://weworkremotely.com/remote-jobs/headway-csm");
  assert.equal(parsed[0].country, "🇨🇦 Canada and 🇺🇸 United States of America");
  assert.equal(parsed[0].region, "Anywhere in the World");
  assert.equal(parsed[0].employmentType, "Full-Time");
  assert.equal(parsed[0].publishedAt, "2026-10-09T18:48:42.000Z");
  assert.match(parsed[0].summary, /Help & serve enterprise customers/);
  assert.equal(parsed[1].country, null);
  assert.equal(parsed[1].region, "Europe Only");
  assert.equal(parsed[2].country, null);

  assert.deepEqual(parseWwrFeed('<rss version="2.0"><channel><title>Empty</title></channel></rss>'), []);
  for (const badXml of bad) {
    assert.throws(() => parseWwrFeed(badXml), /Invalid|Forbidden|Unexpected|Malformed|Unsupported|not RSS|Unclosed|entity/i, badXml.slice(0, 40));
  }
  assert.throws(() => parseWwrFeed(" ".repeat(1_048_577)), /too large/);
  const many = '<item><title>A: Customer Success Manager</title><link>https://weworkremotely.com/remote-jobs/a</link></item>';
  assert.throws(() => parseWwrFeed(sample(many.repeat(201))), /too many items/);

  const calls = [];
  const result = await discoverPublicJobFeeds(request, {
    fetchImpl: async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("weworkremotely.com")) return response(sample());
      if (u.includes("himalayas.app")) return new Response('{"jobs":[]}', { status: 200 });
      if (u.includes("remoteok.com")) return new Response("[]", { status: 200 });
      if (u.includes("arbeitnow.com")) return new Response('{"data":[]}', { status: 200 });
      throw new Error("Unexpected provider call " + u);
    },
    existingCompanies: [],
    runtimeKind: "electron",
    now: () => "2026-10-10T00:00:00.000Z",
  });
  assert.equal(calls.filter(x => x === "https://weworkremotely.com/remote-jobs.rss").length, 1);
  assert.equal(result.coverage, "partial");
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.candidates.map(item => item.providerName), ["We Work Remotely","We Work Remotely","We Work Remotely"]);
  assert.equal(result.candidates[0].opportunityTitle, "Customer Success Manager: Enterprise");
  assert.equal(result.candidates[0].employerName, "Headway");
  assert.equal(result.candidates[0].location, "Remote · 🇨🇦 Canada and 🇺🇸 United States of America");
  assert.equal(result.candidates[1].location, "Remote · Europe Only");
  assert.equal(result.candidates[2].location, "Remote · eligibility unspecified");
  assert.equal(result.candidates[0].opportunityUrl, parsed[0].url);
  assert.equal(result.candidates[0].provenanceUrl, parsed[0].url);
  assert.equal(result.candidates[0].applyUrl, null);
  assert.equal(result.candidates[0].canMonitor, false);
  assert.equal(result.candidates[0].sourceUrl, null);
  assert.equal(new Set(result.candidates.map(x => x.id)).size, 3);

  const failures = await discoverPublicJobFeeds(request, {
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("weworkremotely.com")) return response("rate limited", 429);
      if (u.includes("himalayas.app")) return new Response('{"jobs":[]}', { status: 200 });
      if (u.includes("remoteok.com")) return new Response("[]");
      return new Response('{"data":[]}');
    },
    existingCompanies: [],
    runtimeKind: "electron",
  });
  assert.equal(failures.coverage, "partial");
  assert.equal(failures.candidates.length, 0);
  assert.ok(failures.warnings.some(w => /We Work Remotely.*HTTP 429/.test(w)));

  const webFetches = [];
  const web = await discoverPublicJobFeeds(request, {
    fetchImpl: async (url) => {
      webFetches.push(String(url));
      if (String(url).includes("remoteok.com")) return new Response("[]");
      if (String(url).includes("arbeitnow.com")) return new Response('{"data":[]}');
      throw new Error("Cross-origin WWR/Himalayas requests must not be attempted");
    },
    existingCompanies: [],
    runtimeKind: "web",
  });
  assert.equal(web.candidates.length, 0);
  assert.ok(web.warnings.some(w => /We Work Remotely.*browser.*unverified/i.test(w)));
  assert.ok(webFetches.every(u => !u.includes("weworkremotely.com")));

  await assert.rejects(() => fetchDiscoveryXml(
    "https://weworkremotely.com/remote-jobs.rss",
    async () => new Response("", { status: 302, headers: { location: "https://attacker.example/rss" } }),
  ), /redirect.*host|publisher/i);
  await assert.rejects(() => fetchDiscoveryXml(
    "https://weworkremotely.com/remote-jobs.rss",
    async () => response("x".repeat(1_048_577)),
  ), /too large/);

  console.log("We Work Remotely RSS parser and discovery boundaries passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
