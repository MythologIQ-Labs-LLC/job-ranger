/**
 * The single network egress of Windows storage locations (#249).
 *
 * Every Google Drive storage request and every Microsoft request the main process makes
 * for backups and documents goes through this fetch. It refuses anything outside the
 * exact allowlist below (origin, method and path, checked before each request), never
 * follows a redirect, enforces timeouts and caps how many response bytes it reads.
 *
 * Google sign-in and token refresh stay on #369's Drive egress (drive-egress.cts); this
 * module adds only the Drive v3 file calls a storage folder needs. Microsoft is limited to
 * the token endpoint and Graph paths under /v1.0/me/drive/special/approot. OneDrive hands
 * out short-lived pre-authenticated URLs for chunked uploads and downloads on content
 * hosts; such a URL is reachable only after Graph returned it (an explicit single-URL
 * grant), only over https on a Microsoft content domain, and never with a bearer token.
 */
export type EgressMethod = "GET" | "POST" | "PUT" | "DELETE";

interface PathRule {
  origin: string;
  methods: readonly EgressMethod[];
  path: RegExp;
}

const NAME = "[A-Za-z0-9][A-Za-z0-9._-]{0,199}";
const FOLDER = "(?:Backups|Documents)";

export const STORAGE_EGRESS_RULES: readonly PathRule[] = Object.freeze([
  // Google Drive v3: list/get (and generateIds), folder create, delete of an app file.
  { origin: "https://www.googleapis.com", methods: ["GET", "POST", "DELETE"], path: /^\/drive\/v3\/files(?:\/[A-Za-z0-9_-]{1,160})?$/ },
  // Google uploads: multipart, resumable session start and the session PUTs.
  { origin: "https://www.googleapis.com", methods: ["POST", "PUT"], path: /^\/upload\/drive\/v3\/files$/ },
  // Microsoft identity platform token endpoint (public client, tenant common).
  { origin: "https://login.microsoftonline.com", methods: ["POST"], path: /^\/common\/oauth2\/v2\.0\/token$/ },
  // Microsoft Graph, only the app folder and its Backups/ and Documents/ children.
  { origin: "https://graph.microsoft.com", methods: ["GET"], path: /^\/v1\.0\/me\/drive\/special\/approot$/ },
  { origin: "https://graph.microsoft.com", methods: ["POST"], path: /^\/v1\.0\/me\/drive\/special\/approot\/children$/ },
  { origin: "https://graph.microsoft.com", methods: ["GET"], path: new RegExp(`^/v1\\.0/me/drive/special/approot:/${FOLDER}(?::/children)?$`) },
  { origin: "https://graph.microsoft.com", methods: ["GET", "DELETE"], path: new RegExp(`^/v1\\.0/me/drive/special/approot:/${FOLDER}/${NAME}$`) },
  { origin: "https://graph.microsoft.com", methods: ["PUT"], path: new RegExp(`^/v1\\.0/me/drive/special/approot:/${FOLDER}/${NAME}:/content$`) },
  { origin: "https://graph.microsoft.com", methods: ["POST"], path: new RegExp(`^/v1\\.0/me/drive/special/approot:/${FOLDER}/${NAME}:/createUploadSession$`) },
]);

/** Hosts OneDrive uses for upload-session and download URLs. */
export const MICROSOFT_CONTENT_HOST_SUFFIXES: readonly string[] = Object.freeze([
  ".1drv.com", ".onedrive.com", ".sharepoint.com", ".microsoftpersonalcontent.com", ".livefilestore.com",
  ".storage.live.com",
]);

/** JSON answers (token, metadata, listings) are small. */
export const STORAGE_JSON_RESPONSE_LIMIT = 1024 * 1024;
/** Media downloads are streamed; a `.sojourner` archive is at most 2 GiB - 1. */
export const STORAGE_MEDIA_RESPONSE_LIMIT = 2 * 1024 * 1024 * 1024 - 1;

export class StorageEgressError extends TypeError {
  constructor(message: string) { super(message); this.name = "StorageEgressError"; }
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

function cleanUrl(url: URL): boolean {
  return !url.username && !url.password && !url.hash && !url.pathname.includes("/../") &&
    !url.pathname.includes("/./") && !/%2e%2e|%2f|%5c/i.test(url.pathname);
}

export function allowedStorageRequest(url: URL, method: string): boolean {
  if (!cleanUrl(url)) return false;
  return STORAGE_EGRESS_RULES.some((rule) => rule.origin === url.origin &&
    (rule.methods as readonly string[]).includes(method) && rule.path.test(url.pathname));
}

export function isMicrosoftContentUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.port || !cleanUrl(url)) return false;
  const host = url.hostname.toLowerCase();
  return MICROSOFT_CONTENT_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

interface Grant {
  method: "GET" | "PUT";
  expiresAt: number;
  uses: number;
}

export interface StorageEgressOptions {
  fetch: typeof fetch;
  /** Non-packaged E2E only: loopback origin standing in for Google storage calls. */
  googleTestOrigin?: string | null;
  /** Non-packaged E2E only: loopback origin standing in for every Microsoft origin. */
  microsoftTestOrigin?: string | null;
  timeoutMs?: number;
  transferTimeoutMs?: number;
  now?: () => number;
}

export interface StorageEgress {
  fetch: typeof fetch;
  /**
   * Allows one URL Graph returned (upload session or download URL) for `method`, for at
   * most `uses` requests within `ttlMs`. Refused unless it is an https Microsoft content URL.
   */
  grant(url: string, method: "GET" | "PUT", uses: number, ttlMs?: number): void;
  revoke(url: string): void;
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

function cappedStream(body: ReadableStream<Uint8Array>, limit: number, abort: () => void,
  what = "file"): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > limit) {
        abort();
        await reader.cancel().catch(() => undefined);
        controller.error(new StorageEgressError(`The storage provider sent a larger ${what} than Sojourner accepts.`));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function readCapped(response: Response, limit: number, abort: () => void): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = cappedStream(response.body, limit, abort, "response").getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * A fetch with the storage allowlist, no redirects, timeouts and response caps.
 * Google resumable uploads answer an incomplete chunk with 308 "Resume Incomplete",
 * which is a status, not a redirect: it is passed through only for those PUTs.
 */
export function createStorageEgress(options: StorageEgressOptions): StorageEgress {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const transferTimeoutMs = options.transferTimeoutMs ?? 30 * 60_000;
  const now = options.now ?? Date.now;
  const grants = new Map<string, Grant>();

  const egressFetch = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(requestUrl(input));
    } catch {
      throw new StorageEgressError("Sojourner refused a malformed storage address.");
    }
    const method = (init.method ?? "GET").toUpperCase();
    let granted: Grant | undefined;
    if (!allowedStorageRequest(url, method)) {
      granted = grants.get(url.href);
      if (!granted || granted.method !== method || granted.expiresAt < now() || granted.uses < 1 ||
          !isMicrosoftContentUrl(url)) {
        throw new StorageEgressError(`Sojourner refused to contact ${url.origin}; only the chosen storage provider is allowed.`);
      }
      const headers = new Headers(init.headers);
      if (headers.has("authorization")) {
        throw new StorageEgressError("Sojourner never sends a sign-in token to a OneDrive content address.");
      }
      granted.uses -= 1;
      if (granted.uses < 1) grants.delete(url.href);
    }
    const google = url.origin === "https://www.googleapis.com";
    const testOrigin = google ? options.googleTestOrigin : options.microsoftTestOrigin;
    const target = testOrigin ? `${testOrigin}${url.pathname}${url.search}` : url.href;
    const resumablePut = google && method === "PUT" && url.pathname === "/upload/drive/v3/files";
    const media = (google && url.searchParams.get("alt") === "media") || (granted?.method === "GET");
    const transfer = media || method === "PUT" || url.pathname.startsWith("/upload/");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), transfer ? transferTimeoutMs : timeoutMs);
    timer.unref?.();
    const outer = init.signal;
    const forward = () => controller.abort();
    outer?.addEventListener("abort", forward, { once: true });
    let keepTimer = false;
    try {
      const response = await options.fetch(target, {
        method,
        headers: init.headers,
        body: init.body,
        redirect: resumablePut ? "manual" : "error",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400 && !(resumablePut && response.status === 308)) {
        throw new StorageEgressError("The storage provider answered with a redirect, which Sojourner does not follow.");
      }
      if (media && response.ok) {
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > STORAGE_MEDIA_RESPONSE_LIMIT) {
          controller.abort();
          throw new StorageEgressError("The storage provider sent a larger file than Sojourner accepts.");
        }
        if (!response.body) return new Response(null, { status: response.status, headers: response.headers });
        keepTimer = true;
        const stream = cappedStream(response.body, STORAGE_MEDIA_RESPONSE_LIMIT, () => controller.abort());
        const reader = stream.getReader();
        const finishing = new ReadableStream<Uint8Array>({
          async pull(streamController) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                clearTimeout(timer);
                outer?.removeEventListener("abort", forward);
                streamController.close();
              } else {
                streamController.enqueue(value);
              }
            } catch (error) {
              clearTimeout(timer);
              outer?.removeEventListener("abort", forward);
              streamController.error(error);
            }
          },
          cancel(reason) {
            clearTimeout(timer);
            outer?.removeEventListener("abort", forward);
            return reader.cancel(reason);
          },
        });
        return new Response(finishing, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > STORAGE_JSON_RESPONSE_LIMIT) {
        controller.abort();
        throw new StorageEgressError("The storage provider sent a larger response than Sojourner accepts.");
      }
      const bytes = await readCapped(response, STORAGE_JSON_RESPONSE_LIMIT, () => controller.abort());
      return new Response(NULL_BODY_STATUS.has(response.status) ? null : bytes, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } finally {
      if (!keepTimer) {
        clearTimeout(timer);
        outer?.removeEventListener("abort", forward);
      }
    }
  }) as typeof fetch;

  return {
    fetch: egressFetch,
    grant(rawUrl, method, uses, ttlMs = 60 * 60_000) {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        throw new StorageEgressError("OneDrive returned a malformed transfer address.");
      }
      if (!isMicrosoftContentUrl(url) || allowedStorageRequest(url, method)) {
        throw new StorageEgressError("OneDrive returned a transfer address outside its content domains, so Sojourner refused it.");
      }
      grants.set(url.href, { method, uses: Math.max(1, Math.floor(uses)), expiresAt: now() + ttlMs });
    },
    revoke(rawUrl) {
      try {
        grants.delete(new URL(rawUrl).href);
      } catch {
        // A malformed URL was never granted.
      }
    },
  };
}

/** Rewrites the Microsoft sign-in URL to the fake identity platform in non-packaged E2E runs. */
export function microsoftBrowserUrl(url: string, testOrigin: string | null | undefined): string {
  if (!testOrigin) return url;
  const parsed = new URL(url);
  return `${testOrigin}${parsed.pathname}${parsed.search}`;
}
