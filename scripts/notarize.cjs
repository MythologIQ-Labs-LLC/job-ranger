/**
 * Notarization hook for macOS release builds.
 *
 * RC/beta/tester builds may be produced without Apple credentials when
 * SOJOURNER_REQUIRE_NOTARIZATION is not set. Stable public releases set that
 * flag and must fail closed if signing/notarization credentials are absent.
 */

const { spawnSync } = require("node:child_process");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  const requireNotarization = process.env.SOJOURNER_REQUIRE_NOTARIZATION === "1";
  const credentials = {
    appleId: process.env.APPLE_ID,
    appleIdPassword:
      process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  };
  const credentialsPresent = Object.values(credentials).every(Boolean);

  if (!credentialsPresent) {
    if (requireNotarization) {
      throw new Error(
        "macOS notarization is required for this public release, but APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD (or legacy APPLE_ID_PASSWORD), and APPLE_TEAM_ID are not all configured.",
      );
    }
    console.log(
      "Tester build: macOS notarization skipped because Apple credentials are not configured. This artifact must not be presented as a normal signed/notarized public release.",
    );
    return;
  }

  const { notarize } = await import("@electron/notarize");
  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  await notarize({
    tool: "notarytool",
    appPath,
    appleId: credentials.appleId,
    appleIdPassword: credentials.appleIdPassword,
    teamId: credentials.teamId,
  });

  const staple = spawnSync("xcrun", ["stapler", "staple", appPath], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (staple.status !== 0) {
    throw new Error(
      `Apple notarization succeeded but stapling failed: ${staple.stderr || staple.stdout || "unknown stapler error"}`,
    );
  }
  console.log(`Stapled Apple notarization ticket to ${appPath}.`);
};
