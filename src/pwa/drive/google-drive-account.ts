/** Drive-scope-only account verification without an identity/OIDC scope or hosted token custody. */
export interface DriveAccount {
  /** Google Drive permissionId, stable opaque account binding; never use display name as an authority. */
  accountId: string;
  label: string;
}
export class DriveAccountVerificationError extends Error {
  constructor(message: string) { super(message); this.name = "DriveAccountVerificationError"; }
}
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,160}$/;
export async function verifyDriveAccount(token: string, http: typeof fetch = fetch): Promise<DriveAccount> {
  if (!token || token.length > 8192 || /[\r\n]/.test(token)) {
    throw new DriveAccountVerificationError("Google authorization is missing or invalid.");
  }
  let response: Response;
  try {
    response = await http("https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName,me)", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new DriveAccountVerificationError("Google account verification is temporarily unavailable.");
  }
  if (!response.ok) {
    throw new DriveAccountVerificationError(response.status === 401
      ? "Google Drive authorization expired; reconnect before exporting."
      : "Google Drive did not verify the active account.");
  }
  let about: { user?: { permissionId?: unknown; emailAddress?: unknown; displayName?: unknown; me?: unknown } };
  try { about = await response.json(); } catch {
    throw new DriveAccountVerificationError("Google Drive returned an invalid account response.");
  }
  const user = about?.user;
  if (!user || user.me !== true || typeof user.permissionId !== "string" ||
      !ACCOUNT_ID.test(user.permissionId)) {
    throw new DriveAccountVerificationError("Google Drive did not return a verified active account identifier.");
  }
  const email = typeof user.emailAddress === "string" && user.emailAddress.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.emailAddress)
    ? user.emailAddress : null;
  return { accountId: user.permissionId, label: email ?? "Verified Google Drive account" };
}
