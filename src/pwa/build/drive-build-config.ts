/**
 * Build-time Google Drive configuration for the PWA (used by vite.pwa.config.ts).
 *
 * Google Identity Services must never run on the Career Ops origin (#264): a build that enables
 * Drive must name the separately hosted OAuth helper origin. A client ID without a helper origin
 * is refused rather than silently falling back to loading Google's script next to career data.
 * The demo flavor never gets Google access, whatever is configured.
 *
 * Only erasable TypeScript syntax is used so Node can load this file directly in tests.
 */
export interface DriveBuildInput {
  flavor: string;
  /** VITE_JOB_RANGER_GOOGLE_WEB_CLIENT_ID */
  clientId?: string;
  /** VITE_SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN */
  helperOrigin?: string;
}

export interface DriveBuildConfig {
  googleWebClientId: string;
  googleOAuthHelperOrigin: string;
  driveSecurity: { googleOAuthEnabled: boolean; isolatedGoogleOAuthOrigin: string | undefined };
}

export function resolveDriveBuildConfig(input: DriveBuildInput): DriveBuildConfig {
  const suppliedGoogleId = (input.clientId ?? "").trim();
  if (suppliedGoogleId && !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(suppliedGoogleId)) {
    throw new Error("Invalid Google Web OAuth client ID format");
  }
  const rawHelperOrigin = (input.helperOrigin ?? "").trim();
  if (rawHelperOrigin) {
    const url = new URL(rawHelperOrigin);
    if (url.protocol !== "https:" || url.origin !== rawHelperOrigin ||
        url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new Error("Google OAuth helper must be one exact HTTPS origin without a path.");
    }
  }
  if (input.flavor === "demo") {
    return { googleWebClientId: "", googleOAuthHelperOrigin: "", driveSecurity: { googleOAuthEnabled: false, isolatedGoogleOAuthOrigin: undefined } };
  }
  if (suppliedGoogleId && !rawHelperOrigin) {
    throw new Error(
      "Google Drive needs the isolated OAuth helper: set VITE_SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN. " +
        "Google's sign-in script must never run on the Sojourner origin that holds career data (#264).",
    );
  }
  return {
    googleWebClientId: suppliedGoogleId,
    googleOAuthHelperOrigin: rawHelperOrigin,
    driveSecurity: {
      googleOAuthEnabled: suppliedGoogleId.length > 0 || rawHelperOrigin.length > 0,
      isolatedGoogleOAuthOrigin: rawHelperOrigin || undefined,
    },
  };
}
