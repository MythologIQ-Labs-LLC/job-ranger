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

/**
 * Google Drive export (#314) is enabled only together with the separately hosted
 * OAuth helper origin (#264). Google's sign-in script never runs on this origin:
 * no option adds accounts.google.com to script-src, style-src, frame-src or
 * connect-src. The configured build only gains the two Drive API paths it calls
 * with an access token obtained through the helper popup.
 */
export interface PwaSecurityOptions { googleOAuthEnabled?: boolean; isolatedGoogleOAuthOrigin?: string; }

function driveExportEnabled(options: PwaSecurityOptions): boolean {
  return options.googleOAuthEnabled === true && Boolean(options.isolatedGoogleOAuthOrigin);
}

export function buildContentSecurityPolicy(options: PwaSecurityOptions = {}): string {
  const driveApis = driveExportEnabled(options);
  return [
    "default-src 'none'",
    // 'wasm-unsafe-eval' permits compiling the bundled SQLite WebAssembly
    // module only; JavaScript eval stays forbidden.
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${ACQUISITION_ORIGINS.join(" ")}${driveApis ? " https://www.googleapis.com/drive/v3/ https://www.googleapis.com/upload/drive/v3/" : ""}`,
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    // window.open() is not governed by CSP; the helper popup needs no child-src entry.
    "child-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
    "require-trusted-types-for 'script'",
    "trusted-types sojourner-script-url",
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
    // The helper popup must keep window.opener to post its one-time grant back.
    "Cross-Origin-Opener-Policy": driveExportEnabled(options) ? "same-origin-allow-popups" : "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
  };
}
