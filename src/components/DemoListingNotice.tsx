import { FlaskConical } from "lucide-react";
import { DEMO_LISTING_BADGE_TEXT, DEMO_LISTING_LINK_MESSAGE, isDemoListing } from "../shared/demo-listing";
import { getDesktopApi } from "../services/api";

/** "Demo listing — fictional, not a real opening" badge; renders nothing for real listings. */
export function DemoListingBadge({ url }: { url: string | null | undefined }) {
  if (!isDemoListing(url)) return null;
  return (
    <span className="soft-badge soft-badge-warning" data-testid="demo-listing-badge">
      <FlaskConical aria-hidden="true" className="h-3.5 w-3.5" />
      {DEMO_LISTING_BADGE_TEXT}
    </span>
  );
}

/** Shown in place of navigation when someone opens a fictional demo listing. */
export function DemoListingLinkMessage() {
  return (
    <p role="status" data-testid="demo-listing-link-message" className="mt-3 text-sm text-[var(--color-text-secondary)]">
      {DEMO_LISTING_LINK_MESSAGE}
    </p>
  );
}

/**
 * Opens a listing's real posting, except for fictional demo listings, which
 * have none: then `onDemoListing` lets the caller explain that instead.
 */
export function openListingUrl(url: string, onDemoListing: () => void): void {
  if (isDemoListing(url)) {
    onDemoListing();
    return;
  }
  void getDesktopApi().openExternal(url);
}
