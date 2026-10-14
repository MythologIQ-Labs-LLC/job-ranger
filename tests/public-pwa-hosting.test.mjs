import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyLocalBuild, verifyPublicOrigin } from '../scripts/verify-public-pwa.mjs';

const sha = 'a'.repeat(40);
const buildId = '1.3.0+' + sha.slice(0, 12);
const policy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; frame-ancestors 'none'";
const manifest = { id: './', start_url: './', scope: './', display: 'standalone' };
const index = '<meta http-equiv="Content-Security-Policy" content="' + policy +
  '"><meta name="job-ranger-build" content="' + buildId + '">';
const sw = 'const BUILD_ID = "' + buildId + '";';
const headers = ['/*', '  Content-Security-Policy: ' + policy, '  X-Frame-Options: DENY',
  '  Referrer-Policy: no-referrer', '  Strict-Transport-Security: max-age=63072000; includeSubDomains',
  '', '/sw.js', '  Cache-Control: no-cache', '', '/index.html', '  Cache-Control: no-cache',
  '', '/build-info.json', '  Cache-Control: no-cache', '', '/manifest.webmanifest',
  '  Cache-Control: no-cache', '  Content-Type: application/manifest+json', ''].join('\n');

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jr-public-host-'));
  await mkdir(path.join(dir, 'assets'));
  const assets = { 'index.html': index, 'manifest.webmanifest': JSON.stringify(manifest),
    'assets/app.js': 'console.log("synthetic fixture")' };
  for (const [name, data] of Object.entries(assets)) await writeFile(path.join(dir, name), data);
  const build = { buildId, commit: sha, sourceRepository: 'MythologIQ-Labs-LLC/job-ranger',
    contentSecurityPolicy: policy,
    assets: Object.entries(assets).map(([name, data]) => ({
      path: name, sha256: createHash('sha256').update(data).digest('hex'),
    })) };
  await writeFile(path.join(dir, 'sw.js'), sw);
  await writeFile(path.join(dir, '_headers'), headers);
  await writeFile(path.join(dir, 'build-info.json'), JSON.stringify(build));
  return { dir, build };
}

function simulatedHost(build, overrides = {}) {
  const contents = { '/': index, '/sw.js': sw, '/manifest.webmanifest': JSON.stringify(manifest),
    '/build-info.json': JSON.stringify(build), ...overrides };
  return async (input) => {
    const resource = new URL(input).pathname;
    if (!(resource in contents)) return new Response('not found', { status: 404 });
    const contentType = resource === '/manifest.webmanifest' ? 'application/manifest+json' :
      resource === '/build-info.json' ? 'application/json' : resource === '/' ? 'text/html' : 'text/javascript';
    return new Response(contents[resource], { status: 200, headers: {
      'content-type': contentType, 'content-security-policy': policy, 'x-frame-options': 'DENY',
      'strict-transport-security': 'max-age=63072000; includeSubDomains',
      'referrer-policy': 'no-referrer', 'cache-control': 'no-cache',
    } });
  };
}

test('verifies an honest release shell and synthetic public host', async () => {
  const { dir } = await fixture();
  try {
    const reviewed = await verifyLocalBuild(dir);
    assert.equal(reviewed.buildId, buildId);
    assert.equal((await verifyPublicOrigin('https://jobs.example.org', reviewed,
      simulatedHost(reviewed))).verified, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects changed shell bytes', async () => {
  const { dir } = await fixture();
  try {
    await writeFile(path.join(dir, 'assets/app.js'), 'tampered');
    await assert.rejects(verifyLocalBuild(dir), /digest mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects unsafe PWA scope and missing security headers', async () => {
  const { dir } = await fixture();
  try {
    await writeFile(path.join(dir, 'manifest.webmanifest'), JSON.stringify({ ...manifest, scope: '/' }));
    await assert.rejects(verifyLocalBuild(dir), /digest mismatch|Manifest scope/);
    await writeFile(path.join(dir, 'manifest.webmanifest'), JSON.stringify(manifest));
    await writeFile(path.join(dir, '_headers'), headers.replace('  X-Frame-Options: DENY', ''));
    await assert.rejects(verifyLocalBuild(dir), /X-Frame-Options/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects non-HTTPS, path, credentials and arbitrary queries', async () => {
  const { dir } = await fixture();
  try {
    const build = await verifyLocalBuild(dir);
    for (const url of ['http://jobs.example.org', 'https://jobs.example.org/subpath',
      'https://me:password@jobs.example.org', 'https://jobs.example.org/?q=secret']) {
      await assert.rejects(verifyPublicOrigin(url, build, simulatedHost(build)),
        /HTTPS|credentials|origin|Origin/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects wrong live build and missing live CSP', async () => {
  const { dir } = await fixture();
  try {
    const build = await verifyLocalBuild(dir);
    await assert.rejects(verifyPublicOrigin('https://jobs.example.org', build,
      simulatedHost({ ...build, buildId: 'different' })), /Live build identity/);
    const noCsp = async (url, options) => {
      const response = await simulatedHost(build)(url, options);
      if (new URL(url).pathname !== '/') return response;
      const h = new Headers(response.headers); h.delete('content-security-policy');
      return new Response(await response.text(), { headers: h });
    };
    await assert.rejects(verifyPublicOrigin('https://jobs.example.org', build, noCsp),
      /Content-Security-Policy/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
