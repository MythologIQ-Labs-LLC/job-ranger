/**
 * Demo flavor: the page's per-tab demo session id.
 *
 * Each tab keeps a random session id in `sessionStorage` (a new tab, a new
 * window or a restarted browser without session restore gets a new one). The
 * runtime worker compares it with the session id recorded in the workspace's
 * demo sentinel (src/pwa/runtime/demo-workspace.ts) and replaces the workspace
 * with fresh sample data when they differ, when the workspace has been idle too
 * long, or when the visitor chose Reset demo. A reload keeps the id, so the
 * visitor's changes survive it.
 *
 * Nothing here runs in the standard flavor: only the demo-flavor branch of
 * src/pwa/main.tsx uses this module.
 */
export const DEMO_SESSION_KEY = "job-ranger.demo.session.v1";
export const ONBOARDING_DISMISSED_KEY = "job-ranger.onboarding.dismissed.v1";
const SESSION_ID = /^[A-Za-z0-9-]{16,80}$/;

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
 * Returns this tab's demo session id, creating one when the tab has none.
 * Without usable sessionStorage every load is a new session, so the demo never
 * carries entries into a session it cannot identify.
 */
export function demoSessionId(
  storage: StorageLike | null = sessionStore(),
  randomId: () => string = () => crypto.randomUUID(),
): string {
  try {
    const existing = storage?.getItem(DEMO_SESSION_KEY) ?? null;
    if (existing && SESSION_ID.test(existing)) return existing;
  } catch {
    // Fall through to a new session.
  }
  const id = randomId();
  try {
    storage?.setItem(DEMO_SESSION_KEY, id);
  } catch {
    // Unpersisted: the next load starts another fresh session.
  }
  return id;
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

/** Once the worker reports the workspace ready: after a replacement, reset preferences before the app renders. */
export function completeDemoSession(reset: boolean, storage: StorageLike | null = localStore()): void {
  if (reset) resetDemoLocalStorage(storage);
}

/** "Reset demo": forget this tab's session and reload; the worker replaces the workspace before opening it. */
export function restartDemoSession(storage: StorageLike | null = sessionStore()): void {
  try {
    storage?.removeItem(DEMO_SESSION_KEY);
  } catch {
    // A missing id already means "new session" on the next load.
  }
  window.location.reload();
}
