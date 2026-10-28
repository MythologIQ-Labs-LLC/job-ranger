import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "../src/pwa/security/policy.ts";

test("normal production PWA keeps its existing no-Google network/remote script posture", () => {
  const csp = buildContentSecurityPolicy();
  const headers = buildSecurityHeaders();
  assert.doesNotMatch(csp, /accounts\.google\.com|googleapis\.com|job-ranger-google-gis/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /trusted-types job-ranger-script-url$/);
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(headers["Content-Security-Policy"], csp);
});

test("configured PWA allows only explicit GIS and Drive API endpoints", () => {
  const csp = buildContentSecurityPolicy({ googleOAuthEnabled: true });
  const headers = buildSecurityHeaders({ googleOAuthEnabled: true });
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(csp, /frame-src https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(csp, /connect-src 'self' [^;]+https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(csp, /trusted-types job-ranger-script-url job-ranger-google-gis/);
  assert.match(csp, /https:\/\/www\.googleapis\.com/);
  assert.doesNotMatch(csp, /'unsafe-eval'|unsafe-inline/);
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin-allow-popups");
  assert.equal(headers["Content-Security-Policy"], csp);
});

test("explicitly disabled options are equivalent to normal build", () => {
  assert.equal(buildContentSecurityPolicy({ googleOAuthEnabled: false }), buildContentSecurityPolicy());
  assert.deepEqual(buildSecurityHeaders({ googleOAuthEnabled: false }), buildSecurityHeaders());
});
