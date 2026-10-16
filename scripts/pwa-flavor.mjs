/**
 * Build flavors of the Job Ranger web/PWA runtime.
 *
 * - "standard": the real local-first workspace (default; unchanged behavior).
 * - "demo": the same application with a session-scoped, fictional, resettable
 *   demonstration workspace. It must be hosted on its OWN origin, never on the
 *   origin that holds anyone's real workspace (origin-private storage is shared
 *   by everything served from one origin).
 *
 * Shared by vite.pwa.config.ts, scripts/package-pwa.mjs and the Studio handoff
 * contract so build identity, output directory and archive naming cannot drift.
 */

export const PWA_FLAVORS = Object.freeze(["standard", "demo"]);
export const PWA_FLAVOR_ENV = "JOB_RANGER_PWA_FLAVOR";
const DEMO_BUILD_SUFFIX = ".demo";

/** Unset/empty means "standard"; anything other than a known flavor fails closed. */
export function parsePwaFlavor(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return "standard";
  if (!PWA_FLAVORS.includes(normalized)) {
    throw new Error(`Unknown Job Ranger PWA flavor "${value}". Expected one of: ${PWA_FLAVORS.join(", ")}.`);
  }
  return normalized;
}

/**
 * Build ID: `VERSION+SHA12` for the standard flavor (unchanged) and
 * `VERSION+SHA12.demo` for the demo flavor, so a demo artifact can never carry
 * a standard build identity (and vice versa).
 */
export function pwaBuildId({ version, commit, flavor, override }) {
  const parsed = parsePwaFlavor(flavor);
  const explicit = typeof override === "string" ? override.trim() : "";
  const base = explicit || `${version}+${String(commit).slice(0, 12)}`;
  if (parsed === "demo") return base.endsWith(DEMO_BUILD_SUFFIX) ? base : `${base}${DEMO_BUILD_SUFFIX}`;
  if (base.endsWith(DEMO_BUILD_SUFFIX)) {
    throw new Error(`A standard Job Ranger PWA build cannot use the demo build ID "${base}".`);
  }
  return base;
}

/** True when the build ID and the declared flavor agree. */
export function buildIdMatchesFlavor(buildId, flavor) {
  if (typeof buildId !== "string" || !PWA_FLAVORS.includes(flavor)) return false;
  return flavor === "demo" ? buildId.endsWith(DEMO_BUILD_SUFFIX) : !buildId.endsWith(DEMO_BUILD_SUFFIX);
}

/** Output directory (relative to the repository root) for a flavor's production build. */
export function pwaOutDirName(flavor) {
  return parsePwaFlavor(flavor) === "demo" ? "dist-pwa-demo" : "dist-pwa";
}

/** Release archive name. The demo archive is deliberately distinct from the standard one. */
export function pwaArchiveName(version, flavor) {
  return parsePwaFlavor(flavor) === "demo" ? `job-ranger-web-demo-v${version}.zip` : `job-ranger-web-v${version}.zip`;
}

/** Trust-evidence file written next to the archive under build/trust/. */
export function pwaTrustFileName(flavor) {
  return parsePwaFlavor(flavor) === "demo" ? "web-demo-build-info.json" : "web-build-info.json";
}
