import { test, after } from "node:test";
import assert from "node:assert/strict";

// Public dummy client ID only; never place secrets in this research test.
process.env.JOB_RANGER_GOOGLE_WEB_CLIENT_ID = "123456789-research.apps.googleusercontent.com";
process.env.JOB_RANGER_PWA_ORIGIN = "http://localhost:4174";

const { createIsolatedAuthHelperServer } = await import("../scripts/research/serve-isolated-google-auth.mjs");
const server = createIsolatedAuthHelperServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Test listener unavailable.");
const origin = "http://127.0.0.1:" + address.port;

after(() => new Promise((resolve) => server.close(resolve)));

test("helper serves exactly one isolated page with strict CSP and no caching", async () => {
  const response = await fetch(origin + "/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /trusted-types job-ranger-auth-gis/);
  assert.equal(response.headers.get("cross-origin-opener-policy"), "unsafe-none");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(await response.text(), /Google Drive/);
});

test("public helper config contains exact PWA origin and no bearer credentials", async () => {
  const response = await fetch(origin + "/config.mjs");
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /123456789-research\.apps\.googleusercontent\.com/);
  assert.match(text, /http:\/\/localhost:4174/);
  assert.doesNotMatch(text, /secret|refresh_token|access_token/i);
});

test("helper refuses uploads, unsolicited routes and URL query data", async () => {
  const cases = [
    ["/unknown", { method: "GET" }, 404],
    ["/?access_token=foo", { method: "GET" }, 400],
    ["/config.mjs?token=foo", { method: "GET" }, 400],
    ["/", { method: "POST", body: "user career data" }, 400],
  ];
  for (const [path, init, status] of cases) {
    const response = await fetch(origin + path, init);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("Google's hosted library is not served by our static helper", async () => {
  const response = await fetch(origin + "/gsi/client");
  assert.equal(response.status, 404);
  const script = await (await fetch(origin + "/helper.mjs")).text();
  assert.match(script, /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.doesNotMatch(script, /https:\/\/www\.googleapis\.com\/drive/);
});
