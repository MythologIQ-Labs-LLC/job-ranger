/**
 * Build flavor of the web/PWA runtime, fixed at build time by
 * vite.pwa.config.ts (`__JOB_RANGER_PWA_FLAVOR__`, see scripts/pwa-flavor.mjs).
 *
 * Every other build (Electron renderer, Node tests) leaves the constant
 * undefined and is therefore always the standard flavor. Demo behavior (the
 * session-scoped seeded workspace, banner and reset) is gated on
 * `IS_DEMO_FLAVOR` and is never active in the standard flavor.
 */
declare const __JOB_RANGER_PWA_FLAVOR__: string | undefined;

export type PwaFlavor = "standard" | "demo";

export function resolvePwaFlavor(value: unknown): PwaFlavor {
  return value === "demo" ? "demo" : "standard";
}

// Written as a plain constant expression so the bundler folds it and drops the
// demo-only code paths from the standard build entirely.
export const IS_DEMO_FLAVOR: boolean =
  typeof __JOB_RANGER_PWA_FLAVOR__ !== "undefined" && __JOB_RANGER_PWA_FLAVOR__ === "demo";

export const PWA_FLAVOR: PwaFlavor = IS_DEMO_FLAVOR ? "demo" : "standard";

/**
 * A demo workspace unused for this many hours is replaced with fresh sample data
 * at the next start (src/pwa/runtime/demo-workspace.ts), so browsers that restore
 * sessions do not keep a previous visitor's entries indefinitely.
 */
export const DEMO_IDLE_RESET_HOURS = 8;

/**
 * Window event the demo banner dispatches to reset the demo workspace. The
 * demo-flavor entry point (src/pwa/main.tsx) owns the session bookkeeping, so
 * the standard build carries none of it.
 */
export const DEMO_RESET_REQUEST_EVENT = "job-ranger:demo-reset-requested";
