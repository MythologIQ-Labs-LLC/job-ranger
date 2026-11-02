import { DRIVE_FILE_UPLOAD_LIMIT } from "../../../src/shared/drive/google-drive-transport.js";

/**
 * The single network egress of the Windows Google Drive export (#314).
 *
 * Every request the main process makes for Drive goes through this fetch. It refuses
 * anything outside the exact allowlist below (checked before each request, by origin,
 * method and path), never follows a redirect, enforces a timeout, and caps how many
 * response bytes it will read. accounts.google.com is deliberately absent: the sign-in
 * page is opened only in the system browser, never fetched by Sojourner.
 */
interface EgressRule {
  origin: string;
  method: "GET" | "POST";
  /** Exact path, or a prefix when it ends with "/". */
  path: string;
}

export const DRIVE_EGRESS_RULES: readonly EgressRule[] = Object.freeze([
  { origin: "https://oauth2.googleapis.com", method: "POST", path: "/token" },
  { origin: "https://oauth2.googleapis.com", method: "POST", path: "/revoke" },
  { origin: "https://www.googleapis.com", method: "GET", path: "/drive/v3/" },
  { origin: "https://www.googleapis.com", method: "POST", path: "/upload/drive/v3/" },
]);

/** JSON answers (token, about, generateIds, metadata, search) are small. */
export const DRIVE_JSON_RESPONSE_LIMIT = 256 * 1024;
/** Byte readback (alt=media) of an approved PDF, which is itself capped at 5 MB. */
export const DRIVE_MEDIA_RESPONSE_LIMIT = DRIVE_FILE_UPLOAD_LIMIT;

export class DriveEgressError extends TypeError {
  constructor(message: string) { super(message); this.name = "DriveEgressError"; }
}

export interface DriveEgressOptions {
  /** Underlying fetch (Node's in the main process; a fake in unit tests). */
  fetch: typeof fetch;
  /** Non-packaged E2E only: loopback origin that stands in for every Google origin. */
  testOrigin?: string | null;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

export function allowedDriveRequest(url: URL, method: string): boolean {
  if (url.username || url.password || url.hash) return false;
  return DRIVE_EGRESS_RULES.some((rule) => rule.origin === url.origin && rule.method === method &&
    (rule.path.endsWith("/") ? url.pathname.startsWith(rule.path) && !url.pathname.includes("/../")
      : url.pathname === rule.path));
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

async function readCapped(response: Response, limit: number, abort: () => void): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    abort();
    throw new DriveEgressError("Google sent a larger response than Sojourner accepts.");
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      abort();
      await reader.cancel().catch(() => undefined);
      throw new DriveEgressError("Google sent a larger response than Sojourner accepts.");
    }
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

/** A fetch with the Drive allowlist, no redirects, timeouts and response size caps. */
export function createDriveEgressFetch(options: DriveEgressOptions): typeof fetch {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? 120_000;
  return (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(requestUrl(input));
    } catch {
      throw new DriveEgressError("Sojourner refused a malformed Google address.");
    }
    const method = (init.method ?? "GET").toUpperCase();
    if (!allowedDriveRequest(url, method)) {
      throw new DriveEgressError(`Sojourner refused to contact ${url.origin}; only Google sign-in and Drive are allowed.`);
    }
    const target = options.testOrigin ? `${options.testOrigin}${url.pathname}${url.search}` : url.href;
    const controller = new AbortController();
    const upload = url.pathname.startsWith("/upload/");
    const timer = setTimeout(() => controller.abort(), upload ? uploadTimeoutMs : timeoutMs);
    const outer = init.signal;
    const forward = () => controller.abort();
    outer?.addEventListener("abort", forward, { once: true });
    try {
      const response = await options.fetch(target, {
        method,
        headers: init.headers,
        body: init.body,
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new DriveEgressError("Google answered with a redirect, which Sojourner does not follow.");
      }
      const limit = url.searchParams.get("alt") === "media" ? DRIVE_MEDIA_RESPONSE_LIMIT : DRIVE_JSON_RESPONSE_LIMIT;
      const bytes = await readCapped(response, limit, () => controller.abort());
      return new Response(NULL_BODY_STATUS.has(response.status) ? null : bytes, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", forward);
    }
  }) as typeof fetch;
}

/** Rewrites the browser sign-in URL to the fake Google in non-packaged E2E runs only. */
export function browserAuthorizationUrl(url: string, testOrigin: string | null | undefined): string {
  if (!testOrigin) return url;
  const parsed = new URL(url);
  return `${testOrigin}${parsed.pathname}${parsed.search}`;
}
