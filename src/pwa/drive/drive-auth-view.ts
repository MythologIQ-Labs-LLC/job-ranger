/**
 * Display-only Google Drive authorization state shared by the PWA export UI (#314).
 *
 * Authorization happens only in the separately hosted OAuth helper origin
 * (isolated-drive-auth.ts, #264). Google's sign-in script is never loaded on the
 * Career Ops origin. Authorization alone is not permission to upload Career Ops
 * data; a view never contains the access token. The only requested scope is
 * DRIVE_HELPER_SCOPE (drive.file) in oauth-helper-response-contract.ts.
 */
export type DriveAuthPhase =
  | "not_connected"
  | "authorizing"
  | "authorized_unverified"
  | "action_needed";

export interface DriveAuthView {
  phase: DriveAuthPhase;
  message: string;
  expiresAt: number | null;
}
