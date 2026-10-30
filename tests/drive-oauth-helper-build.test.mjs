import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builder = path.join(root, "scripts", "build-drive-oauth-helper.mjs");
const output = path.join(root, "build", "drive-oauth-helper");
const config = {
  SOJOURNER_DRIVE_APP_ORIGIN: "https://career.example.test",
  SOJOURNER_DRIVE_HELPER_ORIGIN: "https://auth.example.test",
  SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_ID: "test-id.apps.googleusercontent.com",
};
function run(overrides = {}) {
  const env = { ...process.env, ...config, ...overrides };
  delete env.SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_SECRET;
  return execFileSync(process.execPath, [builder], { cwd: root, env, encoding: "utf8" });
}
test("helper build requires two exact HTTPS origins and no client secret", () => {
  for (const invalid of [
    { SOJOURNER_DRIVE_APP_ORIGIN: "http://career.example.test" },
    { SOJOURNER_DRIVE_HELPER_ORIGIN: "https://career.example.test" },
    { SOJOURNER_DRIVE_HELPER_ORIGIN: "https://auth.example.test/path" },
    { SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_ID: "not-a-client" },
  ]) {
    assert.throws(() => run(invalid));
  }
  assert.throws(() => execFileSync(process.execPath, [builder], {
    cwd: root,
    env: { ...process.env, ...config, SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_SECRET: "never" },
  }));
});

test("helper build contains only isolated files and fail-closed public settings", () => {
  assert.match(run(), /Deploy ONLY to https:\/\/auth.example.test/);
  writeFileSync(path.join(output, "old-config-secret.txt"), "stale private configuration");
  assert.match(run(), /Deploy ONLY to https:\/\/auth.example.test/);
  assert.deepEqual(readdirSync(output).sort(),
    ["_headers", "config.mjs", "helper.mjs", "index.html"].sort(),
    "rebuilt security helper must not retain stale files");

  const html = readFileSync(path.join(output, "index.html"), "utf8");
  const js = readFileSync(path.join(output, "helper.mjs"), "utf8");
  const conf = readFileSync(path.join(output, "config.mjs"), "utf8");
  const headers = readFileSync(path.join(output, "_headers"), "utf8");
  assert.match(html, /Continue with Google/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https:\/\/accounts\.google\.com/i,
    "parser-loaded GIS could observe the OAuth nonce before scrub");
  assert.match(js, /tt\.createPolicy\("sojourner-google-gis"/);
  assert.match(js, /if \(url !== GOOGLE_SCRIPT\) throw/);
  assert.ok(js.indexOf("history.replaceState(") >= 0 &&
    js.indexOf("history.replaceState(") < js.indexOf("document.head.appendChild(gisScript)"),
    "the nonce must be removed before the GIS script is appended");
  assert.match(js, /window\.opener\.postMessage/);
  assert.match(js, /client\.requestAccessToken\(\)/);
  assert.match(conf, /https:\/\/career\.example\.test/);
  assert.match(conf, /test-id\.apps\.googleusercontent\.com/);
  assert.doesNotMatch(conf, /client_secret|access_token|refresh_token/i);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /trusted-types sojourner-google-gis/);
  assert.match(headers, /require-trusted-types-for 'script'/);
  assert.match(headers, /Cross-Origin-Opener-Policy: unsafe-none/);
  assert.match(headers, /Referrer-Policy: no-referrer/);
  assert.match(headers, /Cache-Control: no-store/);
  assert.doesNotMatch(html + js + conf, /indexedDB|localStorage|opfs|serviceWorker/);
});
