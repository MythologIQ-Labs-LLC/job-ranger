import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "../src/pwa/security/policy.ts";
import { assertIsolatedAuthOrigin } from "../src/pwa/drive/isolated-auth-channel.ts";

test("ordinary builds preserve the strict original PWA CSP and opener isolation", () => {
  const headers = buildSecurityHeaders();
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(headers["Content-Security-Policy"], buildContentSecurityPolicy());
  assert.deepEqual(buildSecurityHeaders({ isolatedDriveAuthEnabled: false }), headers);
  assert.match(headers["Content-Security-Policy"], /frame-src 'none'/);
  assert.match(headers["Content-Security-Policy"], /trusted-types job-ranger-script-url$/);
  assert.doesNotMatch(headers["Content-Security-Policy"], /accounts\.google\.com|googleapis\.com|gsi\/client/);
});

test("explicit isolated helper config only changes COOP, not PWA CSP or other response headers", () => {
  const baseline = buildSecurityHeaders();
  const enabled = buildSecurityHeaders({ isolatedDriveAuthEnabled: true });
  assert.equal(enabled["Cross-Origin-Opener-Policy"], "same-origin-allow-popups");
  assert.deepEqual(
    { ...enabled, "Cross-Origin-Opener-Policy": "same-origin" },
    baseline,
  );
});

test("only explicit separate HTTPS or loopback helper origin is valid", () => {
  for (const url of ["https://auth.example.org", "http://localhost:4175", "http://127.0.0.1:4175"]) {
    assert.equal(assertIsolatedAuthOrigin(url), url);
  }
  for (const url of ["", "javascript:alert(1)", "http://evil.example.org", "https://auth.example.org/tenant", "https://user:password@auth.example.org"]) {
    assert.throws(() => assertIsolatedAuthOrigin(url));
  }
});

test("research flag is build-time only, and third-party GIS is absent from the Career Ops source", () => {
  const config = readFileSync(new URL("../vite.pwa.config.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/components/IsolatedGoogleDrivePanel.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/pages/Settings.tsx", import.meta.url), "utf8");
  assert.match(config, /JOB_RANGER_ISOLATED_DRIVE_AUTH_ORIGIN/);
  assert.match(config, /JSON\.stringify\(isolatedDriveAuthOrigin\)/);
  assert.match(config, /buildSecurityHeaders\(pwaSecurity\)/);
  assert.match(panel, /if \(!AUTH_ORIGIN\) return null/);
  assert.match(panel, /connectFromUserClick\(\)/);
  assert.match(settings, /webRuntime && <IsolatedGoogleDrivePanel/);
  assert.doesNotMatch(panel, /accounts\.google\.com\/gsi\/client|initTokenClient|requestAccessToken|<script/);
});
