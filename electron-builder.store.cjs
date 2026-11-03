/**
 * Microsoft Store (AppX) packaging for the existing Electron application,
 * using the electron-builder v26 `appx` target evaluated in #133.
 *
 * Package identity is NOT stored in source. Partner Center assigns it when the
 * app name is reserved; supply it through environment variables (repository
 * variables in CI):
 *
 *   SOJOURNER_STORE_IDENTITY_NAME           Package/Identity/Name
 *   SOJOURNER_STORE_PUBLISHER               Package/Identity/Publisher (CN=...)
 *   SOJOURNER_STORE_PUBLISHER_DISPLAY_NAME  Package/Properties/PublisherDisplayName
 *   SOJOURNER_STORE_DISPLAY_NAME            Reserved app name (optional; defaults to "Sojourner")
 *
 * Without them the build produces a clearly labelled *validation* package
 * (placeholder identity) that is only for packaged-runtime testing and can
 * never be mistaken for a Store submission. Set
 * SOJOURNER_REQUIRE_STORE_IDENTITY=1 to fail closed when producing a
 * submission package.
 *
 * The Store signs certified packages, so no code-signing certificate (and no
 * Azure Artifact Signing) is involved here.
 */
const base = require("./electron-builder.json");
const { resolveStoreIdentity } = require("./scripts/store-identity.cjs");

const identity = resolveStoreIdentity();
const artifactSuffix = identity.kind === "store" ? "windows-store" : "windows-store-validation";

// Only the Store package target; the NSIS direct-download build keeps using
// electron-builder.windows.cjs and is unaffected.
const { signtoolOptions: _unusedSigning, ...baseWin } = base.win;
// Google Drive export ships only in the signed NSIS build; never let a stale local
// build/google-oauth client config reach the Store package.
baseWin.extraResources = (baseWin.extraResources ?? []).filter((entry) => entry.from !== "build/google-oauth");

module.exports = {
  ...base,
  // The Store package is named Sojourner like the direct-download installer (executable
  // `app\Sojourner.exe`, artifact `Sojourner-v<version>-windows-store*.appx`, data root
  // STORE_USER_DATA_FOLDER "Sojourner Store", migrated at first start from the LEGACY
  // "Job Ranger Store"). The Store is not a shipping channel (ARCH-001); a Partner Center
  // submission still needs its reserved identity through the variables above.
  productName: "Sojourner",
  win: {
    ...baseWin,
    target: [{ target: "appx", arch: ["x64"] }],
    artifactName: `\${productName}-v\${version}-${artifactSuffix}-\${arch}.\${ext}`,
  },
  appx: {
    identityName: identity.identityName,
    publisher: identity.publisher,
    publisherDisplayName: identity.publisherDisplayName,
    displayName: identity.displayName,
    applicationId: "Sojourner",
    backgroundColor: "#fdf9f6",
    showNameOnTiles: false,
    languages: ["en-US"],
    // runFullTrust is mandatory for Electron desktop apps (added automatically).
    // internetClient covers the explicit, user-approved job-source requests.
    // Nothing else (no broadFileSystemAccess, no private network, no devices).
    capabilities: ["runFullTrust", "internetClient"],
    addAutoLaunchExtension: false,
    minVersion: "10.0.17763.0",
    maxVersionTested: "10.0.26100.0",
  },
};
