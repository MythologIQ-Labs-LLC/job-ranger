/**
 * Microsoft Store (AppX) packaging for the existing Electron application,
 * using the electron-builder v26 `appx` target evaluated in #133.
 *
 * Package identity is NOT stored in source. Partner Center assigns it when the
 * app name is reserved; supply it through environment variables (repository
 * variables in CI):
 *
 *   JOB_RANGER_STORE_IDENTITY_NAME           Package/Identity/Name
 *   JOB_RANGER_STORE_PUBLISHER               Package/Identity/Publisher (CN=...)
 *   JOB_RANGER_STORE_PUBLISHER_DISPLAY_NAME  Package/Properties/PublisherDisplayName
 *   JOB_RANGER_STORE_DISPLAY_NAME            Reserved app name (optional; defaults to "Job Ranger")
 *
 * Without them the build produces a clearly labelled *validation* package
 * (placeholder identity) that is only for packaged-runtime testing and can
 * never be mistaken for a Store submission. Set
 * JOB_RANGER_REQUIRE_STORE_IDENTITY=1 to fail closed when producing a
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

module.exports = {
  ...base,
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
    applicationId: "JobRanger",
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
