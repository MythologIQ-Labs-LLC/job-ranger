/**
 * Web runtime adapter replacing electron/src/pinned-fetch.cts.
 *
 * Electron pins acquisition sockets to policy-approved DNS answers. Browsers
 * expose neither DNS nor sockets, so the equivalent boundary is enforced by:
 * 1. the shared URL policy (no credentials, no localhost/private literals);
 * 2. an explicit allowlist of public job-feed API origins, enforced here and
 *    by the production CSP `connect-src` (which also covers redirect hops);
 * 3. credential-less (`credentials: "omit"`), referrer-less CORS requests, so
 *    a site can only be read if it deliberately allows cross-origin reads;
 * 4. browser mixed-content blocking and Private Network Access protections.
 */
import { validateAcquisitionUrlSyntax } from "../../../electron/src/acquisition-network-policy.cjs";
import { isAllowedAcquisitionOrigin } from "../security/policy";

export class BrowserAcquisitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserAcquisitionError";
  }
}

function assertAllowed(url: string): string {
  const parsed = validateAcquisitionUrlSyntax(url);
  if (parsed.protocol !== "https:" || !isAllowedAcquisitionOrigin(parsed.toString())) {
    throw new BrowserAcquisitionError(
      `The web app can only read supported public job-board APIs; ${parsed.hostname} cannot be read from a browser tab (cross-origin access unavailable).`,
    );
  }
  return parsed.toString();
}

export function createPinnedFetch(): typeof fetch {
  const browserFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = assertAllowed(requestUrl);
    const accept = new Headers(init?.headers).get("accept") ?? "application/json";
    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        method: "GET",
        headers: { Accept: accept },
        credentials: "omit",
        mode: "cors",
        cache: "no-store",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        signal: init?.signal ?? null,
      });
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw error;
      throw new BrowserAcquisitionError(
        "The browser blocked this cross-origin request or the network is unavailable. This source may not be readable from a browser tab.",
      );
    }
    if (response.url) assertAllowed(response.url);
    return response;
  };
  return browserFetch as typeof fetch;
}

/** Socket-level pinned requests do not exist in browsers; fail explicitly. */
export const executePinnedAddressRequest = async (): Promise<never> => {
  throw new BrowserAcquisitionError(
    "Connection-level DNS pinning is not available in the web app; it uses the browser network policy.",
  );
};
