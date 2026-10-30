/**
 * Web runtime security policy: the single source of truth for the production
 * Content-Security-Policy, security headers, and the explicit set of external
 * origins Sojourner's web runtime may contact.
 *
 * Every external origin is a public, credential-less, read-only job-feed API.
 * Nothing in this list receives Career Evidence, resumes, applications, or any
 * other personal data: acquisition requests are GETs for public job postings.
 * Adding an origin here is a reviewed security change (see
 * tests/pwa-security-policy.test.mjs).
 */
export const ACQUISITION_ORIGINS = [
  "https://boards-api.greenhouse.io",
  "https://api.lever.co",
  "https://api.ashbyhq.com",
  "https://api.smartrecruiters.com",
  "https://remoteok.com",
  "https://www.arbeitnow.com",
] as const;

export function isAllowedAcquisitionOrigin(url: string): boolean {
  try {
    return (ACQUISITION_ORIGINS as readonly string[]).includes(new URL(url).origin);
  } catch {
    return false;
  }
}

export interface PwaSecurityOptions { googleOAuthEnabled?: boolean; isolatedGoogleOAuthOrigin?: string; }

export function buildContentSecurityPolicy(options: PwaSecurityOptions = {}): string {
  const isolated = options.googleOAuthEnabled === true && Boolean(options.isolatedGoogleOAuthOrigin);
  const google = options.googleOAuthEnabled === true && !isolated;
  const googleApis = options.googleOAuthEnabled === true;
  return [
    "default-src 'none'",
    // 'wasm-unsafe-eval' permits compiling the bundled SQLite WebAssembly
    // module only; JavaScript eval stays forbidden.
    google ? "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client" : "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    google ? "style-src 'self' https://accounts.google.com/gsi/style" : "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${ACQUISITION_ORIGINS.join(" ")}${google ? " https://accounts.google.com/gsi/" : ""}${googleApis ? " https://www.googleapis.com https://oauth2.googleapis.com" : ""}`,
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    google ? "frame-src https://accounts.google.com/gsi/" : "frame-src 'none'",
    `child-src 'self'${isolated ? " " + options.isolatedGoogleOAuthOrigin : ""}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
    "require-trusted-types-for 'script'",
    google ? "trusted-types job-ranger-script-url job-ranger-google-gis" : "trusted-types job-ranger-script-url",
  ].join("; ");
}

/** Headers for every response served from the production origin. */
export function buildSecurityHeaders(options: PwaSecurityOptions = {}): Record<string, string> {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy(options),
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": options.googleOAuthEnabled ? "same-origin-allow-popups" : "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
  };
}
