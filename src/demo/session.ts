/**
 * Session-scoped demo workspace (demo flavor only).
 *
 * Each browser session of the demo starts from a freshly reset, seeded
 * workspace. A per-tab `sessionStorage` marker, written by the page once the
 * runtime worker has reset and seeded the workspace, distinguishes "reload in
 * the same session" (keep the visitor's changes) from "new tab, new window or
 * restarted browser" (start over). The worker performs the wipe itself, under
 * the single-writer Web Lock and before it opens the database.
 *
 * Nothing here runs in the standard flavor: callers gate on IS_DEMO_FLAVOR.
 */
export const DEMO_SESSION_KEY = "job-ranger.demo.session.v1";
export const ONBOARDING_DISMISSED_KEY = "job-ranger.onboarding.dismissed.v1";

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function sessionStore(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function localStore(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * True when this tab must start a new demo session (no marker yet). If
 * sessionStorage is unavailable the safe answer is also "reset": the demo
 * never carries one visitor's entries into an unidentifiable session.
 */
export function demoSessionNeedsReset(storage: StorageLike | null = sessionStore()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(DEMO_SESSION_KEY) === null;
  } catch {
    return true;
  }
}

/** Job Ranger's own localStorage keys: `job-ranger.*` preferences/legacy keys and the theme. */
export function isJobRangerLocalStorageKey(key: string): boolean {
  return key === "theme" || key.startsWith("job-ranger.") || key.startsWith("job-ranger:");
}

/** Removes Job Ranger's localStorage keys and marks onboarding dismissed (the workspace is pre-seeded). */
export function resetDemoLocalStorage(storage: StorageLike | null = localStore()): void {
  if (!storage) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && isJobRangerLocalStorageKey(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  storage.setItem(ONBOARDING_DISMISSED_KEY, "true");
}

/**
 * Called once the worker reports the demo workspace is ready. After a reset,
 * clears this origin's Job Ranger preferences before the app renders; in every
 * case records that this tab's session now owns the workspace.
 */
export function completeDemoSession(
  reset: boolean,
  storage: { session: StorageLike | null; local: StorageLike | null } = { session: sessionStore(), local: localStore() },
): void {
  if (reset) resetDemoLocalStorage(storage.local);
  try {
    storage.session?.setItem(DEMO_SESSION_KEY, new Date().toISOString());
  } catch {
    // Without sessionStorage every load is a new session; the demo still works.
  }
}

/** "Reset demo": forget this session and reload; the worker wipes and reseeds before opening the database. */
export function restartDemoSession(): void {
  try {
    sessionStore()?.removeItem(DEMO_SESSION_KEY);
  } catch {
    // A missing marker already means "reset" on the next load.
  }
  window.location.reload();
}
