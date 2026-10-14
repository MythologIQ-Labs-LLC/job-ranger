/**
 * Fail-closed public PWA host preflight (#299).
 * Complements (never substitutes for) the release ZIP checksum and GitHub attestation.
 * Usage: npm run verify:pwa:hosting -- --dist dist-pwa [--origin https://jobs.example.org]
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const required = ['index.html', 'sw.js', '_headers', 'manifest.webmanifest', 'build-info.json'];
const repo = 'MythologIQ-Labs-LLC/job-ranger';
const requiredSecurity = {
  'Content-Security-Policy': "default-src 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=',
};
const refuse = (message) => { throw new Error(message); };
const digest = (value) => createHash('sha256').update(value).digest('hex');

function assertManifest(manifest) {
  for (const key of ['id', 'start_url', 'scope']) {
    if (manifest?.[key] !== './') refuse('Manifest ' + key + ' must be ./ to retain isolated origin scope');
  }
}

function parseHeaders(text) {
  const result = new Map();
  let rule;
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      if (result.has(value)) refuse('Duplicate _headers rule: ' + value);
      rule = new Map();
      result.set(value, rule);
    } else if (rule) {
      const colon = value.indexOf(':');
      if (colon < 1) refuse('Invalid _headers line: ' + value);
      rule.set(value.slice(0, colon), value.slice(colon + 1).trim());
    } else refuse('Header without a path');
  }
  return result;
}

function assertHeaderContract(text, build) {
  const rules = parseHeaders(text);
  const globals = rules.get('/*');
  if (!globals) refuse('Missing global security headers');
  for (const [name, expected] of Object.entries(requiredSecurity)) {
    if (!globals.get(name)?.includes(expected)) refuse('Missing or weak ' + name);
  }
  if (globals.get('Content-Security-Policy') !== build.contentSecurityPolicy ||
      !build.contentSecurityPolicy.includes("frame-ancestors 'none'")) refuse('PWA CSP differs from reviewed release');
  for (const resource of ['/sw.js', '/index.html', '/build-info.json', '/manifest.webmanifest']) {
    if (!rules.get(resource)?.get('Cache-Control')?.includes('no-cache')) refuse('Missing no-cache: ' + resource);
  }
  if (rules.get('/manifest.webmanifest')?.get('Content-Type') !== 'application/manifest+json') {
    refuse('Manifest must use application/manifest+json');
  }
}

export async function verifyLocalBuild(directory) {
  const root = path.resolve(directory);
  const files = new Map();
  for (const name of required) {
    const content = await readFile(path.join(root, name));
    if (!content.length) refuse('Empty required file: ' + name);
    files.set(name, content.toString('utf8'));
  }
  const build = JSON.parse(files.get('build-info.json'));
  if (build.sourceRepository !== repo || typeof build.buildId !== 'string' || build.buildId.length < 8 ||
      !/^[a-f0-9]{40}$/.test(build.commit)) refuse('Invalid production build provenance');
  if (typeof build.contentSecurityPolicy !== 'string' || !Array.isArray(build.assets) || !build.assets.length) {
    refuse('Missing build policy or hashed assets');
  }
  const paths = new Set();
  for (const asset of build.assets) {
    const item = asset.path;
    if (typeof item !== 'string' || !/^[\w./-]+$/.test(item) || item.startsWith('/') ||
        item.split('/').includes('..') || paths.has(item)) refuse('Unsafe or duplicate asset path');
    paths.add(item);
    if (digest(await readFile(path.join(root, item))) !== asset.sha256) refuse('SHA-256 digest mismatch: ' + item);
  }
  for (const item of ['index.html', 'manifest.webmanifest']) {
    if (!paths.has(item)) refuse('Unhashed required shell asset: ' + item);
  }
  assertManifest(JSON.parse(files.get('manifest.webmanifest')));
  assertHeaderContract(files.get('_headers'), build);
  if (!files.get('sw.js').includes('BUILD_ID = "' + build.buildId + '"')) refuse('Service worker build ID mismatch');
  if (!files.get('index.html').includes('name="job-ranger-build" content="' + build.buildId + '"')) {
    refuse('HTML shell build ID mismatch');
  }
  if (!files.get('index.html').includes('http-equiv="Content-Security-Policy"')) refuse('Missing HTML CSP meta');
  return { buildId: build.buildId, commit: build.commit, sourceRepository: build.sourceRepository,
    contentSecurityPolicy: build.contentSecurityPolicy, assets: build.assets };
}

export async function verifyPublicOrigin(input, expected, http = fetch) {
  let url;
  try { url = new URL(input); } catch { refuse('Invalid HTTPS origin'); }
  if (url.protocol !== 'https:') refuse('Public origin must be HTTPS');
  if (url.username || url.password) refuse('Origin cannot include credentials');
  if (url.pathname !== '/' || url.search || url.hash) refuse('Origin must be a root without path, query, or fragment');
  const get = async (resource) => {
    const response = await http(url.origin + resource, {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || response.redirected) refuse('Public ' + resource + ' is unavailable or redirected');
    return response;
  };
  const actual = await (await get('/build-info.json')).json();
  if (actual.buildId !== expected.buildId || actual.commit !== expected.commit ||
      actual.sourceRepository !== repo || JSON.stringify(actual.assets) !== JSON.stringify(expected.assets)) {
    refuse('Live build identity or asset hashes do not match reviewed release');
  }
  const home = await get('/');
  for (const [name, part] of Object.entries(requiredSecurity)) {
    if (!home.headers.get(name)?.includes(part)) refuse('HTML shell missing ' + name);
  }
  if (home.headers.get('Content-Security-Policy') !== expected.contentSecurityPolicy) refuse('Live CSP mismatch');
  if (!(await home.text()).includes('name="job-ranger-build" content="' + expected.buildId + '"')) {
    refuse('HTML shell build ID mismatch');
  }
  const manifest = await get('/manifest.webmanifest');
  if (!manifest.headers.get('Content-Type')?.startsWith('application/manifest+json')) refuse('Manifest Content-Type invalid');
  assertManifest(await manifest.json());
  const sw = await get('/sw.js');
  if (!sw.headers.get('Cache-Control')?.includes('no-cache')) refuse('Service worker caching is unsafe');
  if (!(await sw.text()).includes('BUILD_ID = "' + expected.buildId + '"')) refuse('Live service worker build ID mismatch');
  return { origin: url.origin, buildId: expected.buildId, commit: expected.commit, verified: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => { const idx = args.indexOf(flag); return idx < 0 ? null : args[idx + 1]; };
  const dist = value('--dist') ?? 'dist-pwa';
  const origin = value('--origin');
  if (args.some((part) => !['--dist', '--origin', dist, origin].includes(part))) {
    console.error('Usage: --dist <release-directory> [--origin https://hostname]');
    process.exitCode = 2;
  } else {
    try {
      const build = await verifyLocalBuild(dist);
      console.log('Release shell verified: ' + build.buildId + ' (' + build.commit + ')');
      if (origin) console.log(JSON.stringify(await verifyPublicOrigin(origin, build)));
    } catch (error) {
      console.error('Public PWA verification refused: ' + error.message);
      process.exitCode = 1;
    }
  }
}
