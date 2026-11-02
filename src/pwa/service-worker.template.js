/* Sojourner web runtime service worker (generated at build time).
 *
 * Scope of responsibility: the versioned application shell ONLY.
 * - It never reads, stores, or proxies career data (that lives in the
 *   origin-private file system, owned by the runtime worker).
 * - It never intercepts cross-origin requests.
 * - Every shell asset is verified against the build's SHA-256 manifest before
 *   a version is installed; any mismatch aborts the install and the previous
 *   version keeps running.
 * - A new version waits until the user chooses to reload (SKIP_WAITING).
 * - On-demand assets (resume PDF fonts) are not precached. They are fetched
 *   the first time a resume needs them, verified against the same SHA-256
 *   manifest, and kept in a content-addressed cache so they work offline
 *   afterwards. Unverified bytes are never cached or served from the cache.
 */
const BUILD_ID = "__JOB_RANGER_BUILD_ID__";
const ASSETS = __JOB_RANGER_PRECACHE__;
const CACHE_PREFIX = "job-ranger-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const ON_DEMAND = __JOB_RANGER_ON_DEMAND__;
// Content-addressed file names, so this cache survives app updates.
const ON_DEMAND_CACHE = "job-ranger-on-demand-v1";
const ON_DEMAND_BY_URL = new Map(
  ON_DEMAND.map((asset) => [new URL(asset.path, self.registration.scope).toString(), asset.sha256]),
);

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Browsers refuse a redirected response as the answer to a navigation, so a
 * cached redirected shell would break every later visit (hosts commonly
 * redirect `/index.html` to `/`). Re-wrap the verified body so the cached copy
 * is always a plain, non-redirected response.
 */
async function cacheableResponse(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function onDemandAsset(url, sha256) {
  const cache = await caches.open(ON_DEMAND_CACHE);
  const cached = await cache.match(url);
  if (cached) return cached;
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) return response;
  const bytes = await response.arrayBuffer();
  if (toHex(await crypto.subtle.digest("SHA-256", bytes)) !== sha256) {
    return new Response("On-demand asset failed integrity verification", { status: 502 });
  }
  const verified = new Response(bytes, { status: 200, headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream" } });
  await cache.put(url, verified.clone());
  return verified;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        for (const asset of ASSETS) {
          const url = new URL(asset.path, self.registration.scope).toString();
          // The shell document is fetched at its canonical directory URL:
          // pretty-URL hosts redirect `/index.html` to `/`.
          const source = asset.path === "index.html" ? self.registration.scope : url;
          const response = await fetch(source, { cache: "reload", credentials: "same-origin" });
          if (!response.ok) throw new Error(`Shell asset ${asset.path} returned HTTP ${response.status}`);
          const digest = toHex(await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer()));
          if (digest !== asset.sha256) {
            throw new Error(`Shell asset ${asset.path} does not match build ${BUILD_ID}`);
          }
          await cache.put(url, await cacheableResponse(response));
        }
      } catch (error) {
        await caches.delete(CACHE_NAME);
        throw error;
      }
      // First installation activates immediately; updates wait for the user.
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      if (await caches.has(ON_DEMAND_CACHE)) {
        const onDemand = await caches.open(ON_DEMAND_CACHE);
        for (const request of await onDemand.keys()) {
          if (!ON_DEMAND_BY_URL.has(request.url)) await onDemand.delete(request);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "GET_BUILD_ID" && event.ports[0]) {
    event.ports[0].postMessage({ buildId: BUILD_ID });
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  const onDemandHash = ON_DEMAND_BY_URL.get(url.origin + url.pathname);
  if (onDemandHash) {
    event.respondWith(onDemandAsset(url.origin + url.pathname, onDemandHash));
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      if (request.mode === "navigate") {
        const page = await cache.match(request, { ignoreSearch: true });
        if (page) return page;
        const shell = await cache.match(new URL("index.html", self.registration.scope).toString());
        if (shell) return shell;
        return fetch(request);
      }
      const cached = await cache.match(request, { ignoreSearch: true });
      return cached || fetch(request);
    })(),
  );
});
