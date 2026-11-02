import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { test } from "node:test";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "../src/pwa/security/policy.ts";

const HELPER = "https://auth.example.test";
const directives = (csp) => Object.fromEntries(csp.split("; ").map(item => [item.split(" ")[0], item]));

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

test("configured PWA gains only the two Drive API paths; Google sign-in stays on the helper origin", () => {
  const options = { googleOAuthEnabled: true, isolatedGoogleOAuthOrigin: HELPER };
  const csp = buildContentSecurityPolicy(options);
  const parsed = directives(csp);
  assert.equal(parsed["connect-src"].endsWith(" https://www.googleapis.com/drive/v3/ https://www.googleapis.com/upload/drive/v3/"), true);
  assert.equal(parsed["script-src"], "script-src 'self' 'wasm-unsafe-eval'");
  assert.equal(parsed["style-src"], "style-src 'self'");
  assert.equal(parsed["frame-src"], "frame-src 'none'");
  assert.equal(parsed["trusted-types"], "trusted-types job-ranger-script-url");
  assert.doesNotMatch(csp, /'unsafe-eval'|unsafe-inline|job-ranger-google-gis/);
  assert.equal(buildSecurityHeaders(options)["Cross-Origin-Opener-Policy"], "same-origin-allow-popups");
  assert.equal(buildSecurityHeaders(options)["Content-Security-Policy"], csp);
});

test("the main-origin CSP never allows accounts.google.com, for any option combination (#264)", () => {
  const combinations = [
    undefined, {}, { googleOAuthEnabled: false }, { googleOAuthEnabled: true },
    { googleOAuthEnabled: true, isolatedGoogleOAuthOrigin: "" },
    { googleOAuthEnabled: true, isolatedGoogleOAuthOrigin: HELPER },
    { googleOAuthEnabled: false, isolatedGoogleOAuthOrigin: HELPER },
  ];
  for (const options of combinations) {
    const csp = buildContentSecurityPolicy(options);
    const parsed = directives(csp);
    assert.doesNotMatch(csp, /accounts\.google\.com|gstatic\.com|apis\.google\.com/, JSON.stringify(options));
    assert.equal(parsed["script-src"], "script-src 'self' 'wasm-unsafe-eval'", JSON.stringify(options));
    assert.equal(parsed["frame-src"], "frame-src 'none'", JSON.stringify(options));
    assert.doesNotMatch(buildSecurityHeaders(options)["Content-Security-Policy"], /accounts\.google\.com/);
  }
});

test("Drive endpoints and the popup-compatible COOP require the isolated helper origin", () => {
  // An enabled flag without a helper origin is a misconfiguration (drive-build-config.ts refuses it);
  // the policy itself fails closed to the unconfigured posture.
  assert.equal(buildContentSecurityPolicy({ googleOAuthEnabled: true }), buildContentSecurityPolicy());
  assert.deepEqual(buildSecurityHeaders({ googleOAuthEnabled: true }), buildSecurityHeaders());
  assert.equal(buildContentSecurityPolicy({ googleOAuthEnabled: false }), buildContentSecurityPolicy());
  assert.deepEqual(buildSecurityHeaders({ googleOAuthEnabled: false }), buildSecurityHeaders());
});

test("no main-origin source loads Google Identity Services", () => {
  const root = new URL("../src/", import.meta.url);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(child);
    }
  };
  walk(root);
  assert.ok(files.length > 50);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /accounts\.google\.com\/gsi|initTokenClient|job-ranger-google-gis/, file.pathname);
  }
  assert.equal(existsSync(new URL("pwa/drive/gis-sdk.ts", root)), false);
});
