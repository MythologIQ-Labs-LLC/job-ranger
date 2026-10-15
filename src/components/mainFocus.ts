// Each page renders its own Layout, so the shell remounts on navigation. A destination
// chosen from the mobile menu asks the following Layout mounts to move focus to their main
// content, so keyboard and screen-reader focus never stays on a link the closed menu hides.
// Some routes mount a loading Layout and then the real page's Layout (Home, onboarding), so
// the request stays valid for a short window instead of being used up by the first mount;
// an abandoned navigation (for example "Stay on this page") lets it expire.
const REQUEST_WINDOW_MS = 1500;
let requestedAt: number | null = null;

export const MAIN_CONTENT_ID = "main-content";

export function requestMainFocus(): void {
  requestedAt = Date.now();
}

export function hasPendingMainFocusRequest(): boolean {
  if (requestedAt === null) return false;
  if (Date.now() - requestedAt <= REQUEST_WINDOW_MS) return true;
  requestedAt = null;
  return false;
}

export function focusMainContent(): void {
  document.getElementById(MAIN_CONTENT_ID)?.focus();
}
