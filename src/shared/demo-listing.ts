/**
 * Fictional demonstration listings.
 *
 * The demo flavor of the web app seeds sample job listings whose URLs live on
 * a reserved, never-resolving host (RFC 2606 `.invalid`). Every surface that
 * shows a job or application labels such listings as fictional and does not
 * navigate to them. The check is runtime-independent: in the standard flavor a
 * stored URL can only match if someone deliberately typed this reserved host.
 */
export const DEMO_LISTING_HOST = "demo-listing.invalid";
export const DEMO_LISTING_ORIGIN = `https://${DEMO_LISTING_HOST}`;

export const DEMO_LISTING_BADGE_TEXT = "Demo listing — fictional, not a real opening";
export const DEMO_LISTING_LINK_MESSAGE =
  "This is a fictional demo listing, so there is no real job posting to open or apply to. Real sources you add yourself link to their actual postings.";

export const DEMO_SOURCE_BADGE_TEXT = "Demo employer — fictional, never scanned";
export const DEMO_SOURCE_LINK_MESSAGE =
  "This is a fictional demo employer, so there is no real careers page to open, and Sojourner never scans it.";

/** True only for http(s) URLs on the reserved demo host (or a subdomain of it). */
export function isDemoListing(url: string | null | undefined): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return host === DEMO_LISTING_HOST || host.endsWith(`.${DEMO_LISTING_HOST}`);
}

/** Builds a demo listing URL under the reserved host. */
export function demoListingUrl(pathname: string): string {
  const clean = pathname.replace(/^\/+/, "");
  return `${DEMO_LISTING_ORIGIN}/${clean}`;
}
