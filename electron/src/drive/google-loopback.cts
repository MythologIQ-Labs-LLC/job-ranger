import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DriveError } from "./drive-errors.cjs";

export function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** RFC 7636 S256: 32 random bytes -> 43-char verifier; challenge = BASE64URL(SHA256(verifier)). */
export function createPkcePair(random: (size: number) => Buffer = randomBytes): PkcePair {
  const verifier = base64Url(random(32));
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier, "ascii").digest());
}

export function createOAuthState(random: (size: number) => Buffer = randomBytes): string {
  return base64Url(random(32));
}

export function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

const PAGE_STYLE = "font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2937";
function staticPage(heading: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Job Ranger</title></head><body style="${PAGE_STYLE}"><h1>${heading}</h1><p>${body}</p></body></html>`;
}
const PAGES = {
  success: staticPage("Google Drive connected", "You can close this tab and return to Job Ranger."),
  cancelled: staticPage("Google Drive was not connected", "You can close this tab and return to Job Ranger."),
  failed: staticPage("Job Ranger could not finish connecting", "You can close this tab and return to Job Ranger, then try again."),
} as const;

const RESPONSE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Connection: "close",
} as const;

export interface LoopbackReceiver {
  redirectUri: string;
  /** Resolves with the authorization code, or rejects with a DriveError. */
  code: Promise<string>;
  cancel(error?: DriveError): void;
}

/**
 * One-shot OAuth redirect receiver bound to 127.0.0.1 on an ephemeral port.
 * Accepts only GET on "/", validates `state` in constant time, never reflects
 * query parameters, and closes after the first decisive callback, a cancel,
 * or the timeout.
 */
export async function startLoopbackReceiver(expectedState: string, timeoutMs: number): Promise<LoopbackReceiver> {
  const server = http.createServer();
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: DriveError) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Callers may cancel before awaiting; never surface an unhandled rejection.
  code.catch(() => undefined);
  let settled = false;
  let timer: NodeJS.Timeout | null = null;

  const finish = (error: DriveError | null, value?: string) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    server.close();
    server.closeIdleConnections?.();
    if (error) rejectCode(error);
    else resolveCode(value ?? "");
  };

  server.on("request", (request, response) => {
    const respond = (status: number, page: string) => {
      response.writeHead(status, RESPONSE_HEADERS);
      response.end(page);
    };
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/") return respond(404, PAGES.failed);
    if (request.method !== "GET") return respond(405, PAGES.failed);
    if (settled) return respond(410, PAGES.failed);
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const authorizationCode = url.searchParams.get("code");
    // Requests without a state (probes, other local software) are refused but do not end the flow.
    if (state === null) return respond(400, PAGES.failed);
    if (!constantTimeEqual(state, expectedState)) {
      respond(400, PAGES.failed);
      return finish(new DriveError("auth_failed", "The Google sign-in response did not match this request, so it was rejected. Try connecting again."));
    }
    if (oauthError !== null) {
      respond(200, PAGES.cancelled);
      return finish(
        oauthError === "access_denied"
          ? new DriveError("auth_cancelled", "Google Drive was not connected because access was not granted.")
          : new DriveError("auth_failed", "Google could not complete the sign-in. Try connecting again."),
      );
    }
    if (!authorizationCode) {
      respond(400, PAGES.failed);
      return finish(new DriveError("auth_failed", "Google returned no authorization code. Try connecting again."));
    }
    respond(200, PAGES.success);
    finish(null, authorizationCode);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  timer = setTimeout(
    () => finish(new DriveError("timeout", "Google sign-in was not finished in time. Try connecting again.")),
    timeoutMs,
  );

  return {
    redirectUri: `http://127.0.0.1:${port}`,
    code,
    cancel: (error) => finish(error ?? new DriveError("auth_cancelled", "Google Drive sign-in was cancelled.")),
  };
}
