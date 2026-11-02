import http from "node:http";
import type { AddressInfo } from "node:net";
import { constantTimeEqual } from "../drive/google-loopback.cjs";

export type StorageAuthErrorCode = "auth_cancelled" | "auth_failed" | "timeout" | "auth_in_progress" |
  "not_configured" | "not_connected" | "auth_expired" | "insufficient_scope" | "invalid_response";

export class StorageAuthError extends Error {
  constructor(readonly code: StorageAuthErrorCode, message: string) {
    super(message);
    this.name = "StorageAuthError";
  }
}

const PAGE_STYLE = "font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2937";
function staticPage(heading: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sojourner</title></head><body style="${PAGE_STYLE}"><h1>${heading}</h1><p>${body}</p></body></html>`;
}

const RESPONSE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Connection: "close",
} as const;

export interface OAuthLoopback {
  redirectUri: string;
  /** Resolves with the authorization code, or rejects with a StorageAuthError. */
  code: Promise<string>;
  cancel(error?: StorageAuthError): void;
}

/**
 * One-shot OAuth redirect receiver for the Microsoft identity platform (RFC 8252 section
 * 7.3). Microsoft public clients register `http://localhost` and accept any port at run
 * time, so the redirect URI is `http://localhost:<port>`. The receiver listens on the
 * loopback interfaces only (127.0.0.1, and [::1] on the same port when IPv6 is present,
 * because browsers may resolve `localhost` to either), accepts only GET "/", checks
 * `state` in constant time, never reflects query parameters and closes after the first
 * decisive callback, a cancel or the timeout. A request without the exact state is
 * refused without ending the flow. PKCE protects the code even if another local program
 * received it.
 */
export async function startOAuthLoopback(input: {
  expectedState: string;
  timeoutMs: number;
  providerName: string;
}): Promise<OAuthLoopback> {
  const pages = {
    success: staticPage(`${input.providerName} connected`, "You can close this tab and return to Sojourner. Nothing was uploaded."),
    cancelled: staticPage(`${input.providerName} was not connected`, "You can close this tab and return to Sojourner."),
    failed: staticPage("Sojourner could not finish connecting", "You can close this tab and return to Sojourner, then try again."),
  };
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: StorageAuthError) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  code.catch(() => undefined);
  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  const servers: http.Server[] = [];

  const finish = (error: StorageAuthError | null, value?: string) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    for (const server of servers) {
      server.close();
      server.closeIdleConnections?.();
    }
    if (error) rejectCode(error);
    else resolveCode(value ?? "");
  };

  const onRequest = (request: http.IncomingMessage, response: http.ServerResponse) => {
    const respond = (status: number, page: string) => {
      response.writeHead(status, RESPONSE_HEADERS);
      response.end(page);
    };
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      return respond(400, pages.failed);
    }
    if (url.pathname !== "/") return respond(404, pages.failed);
    if (request.method !== "GET") return respond(405, pages.failed);
    if (settled) return respond(410, pages.failed);
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const authorizationCode = url.searchParams.get("code");
    if (state === null || !constantTimeEqual(state, input.expectedState)) return respond(400, pages.failed);
    if (oauthError === null && !authorizationCode) return respond(400, pages.failed);
    if (oauthError !== null) {
      respond(200, pages.cancelled);
      return finish(oauthError === "access_denied"
        ? new StorageAuthError("auth_cancelled", `${input.providerName} was not connected because access was not granted.`)
        : new StorageAuthError("auth_failed", `${input.providerName} could not complete the sign-in. Try connecting again.`));
    }
    respond(200, pages.success);
    finish(null, authorizationCode ?? "");
  };

  const listen = (server: http.Server, host: string, port: number) => new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host, exclusive: true }, () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });

  const ipv4 = http.createServer(onRequest);
  const port = await listen(ipv4, "127.0.0.1", 0);
  servers.push(ipv4);
  if ((ipv4.address() as AddressInfo).address !== "127.0.0.1") {
    ipv4.close();
    throw new StorageAuthError("auth_failed", "Sojourner could not open a local-only sign-in receiver.");
  }
  const ipv6 = http.createServer(onRequest);
  try {
    await listen(ipv6, "::1", port);
    servers.push(ipv6);
  } catch {
    // No IPv6 loopback (or the port is taken there): browsers then fall back to 127.0.0.1.
    ipv6.close();
  }
  timer = setTimeout(() => finish(new StorageAuthError("timeout",
    `${input.providerName} sign-in was not finished in time. Try connecting again.`)), input.timeoutMs);

  return {
    redirectUri: `http://localhost:${port}`,
    code,
    cancel: (error) => finish(error ?? new StorageAuthError("auth_cancelled", `${input.providerName} sign-in was cancelled.`)),
  };
}
