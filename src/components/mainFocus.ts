// Each page renders its own Layout, so the shell remounts on navigation. A destination
// chosen from the mobile menu asks the next Layout to move focus to its main content,
// so keyboard and screen-reader focus never stays on a link that the closed menu hides.
let pendingMainFocus = false;

export const MAIN_CONTENT_ID = "main-content";

export function requestMainFocus(): void {
  pendingMainFocus = true;
}

export function consumeMainFocusRequest(): boolean {
  const pending = pendingMainFocus;
  pendingMainFocus = false;
  return pending;
}

export function focusMainContent(): void {
  document.getElementById(MAIN_CONTENT_ID)?.focus();
}
