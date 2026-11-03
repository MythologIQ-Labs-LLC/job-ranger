"use strict";

/**
 * Authenticode signing through SignTool and the Azure Artifact Signing client
 * (MythologIQ-Labs-LLC/Myth-Tech-Forge docs/WINDOWS_CODE_SIGNING_STANDARD.md).
 *
 * Only the Azure CLI credential is allowed, so the signer is whoever `az` is signed in as:
 * the GitHub OIDC identity of the `release` environment in CI, or the owner locally.
 * There is no client secret.
 *
 * Used two ways:
 * - as electron-builder's `win.signtoolOptions.sign` hook (one call per file);
 * - from the command line, `node scripts/windows-sign.cjs <file>...`, for binaries
 *   electron-builder does not sign itself (the bundled sqlite3.exe).
 *
 * Signing is enabled by SOJOURNER_WINDOWS_SIGNING_CLIENT_DIR, the folder holding
 * bin/x64/Azure.CodeSigning.Dlib.dll from the Microsoft.ArtifactSigning.Client package.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ARTIFACT_SIGNING = Object.freeze({
  Endpoint: "https://eus.codesigning.azure.net/",
  CodeSigningAccountName: "MythologIQ-Labs-Signing",
  CertificateProfileName: "mythologiq-labs-public-release",
  ExcludeCredentials: [
    "ManagedIdentityCredential",
    "EnvironmentCredential",
    "WorkloadIdentityCredential",
    "SharedTokenCacheCredential",
    "VisualStudioCredential",
    "VisualStudioCodeCredential",
    "AzurePowerShellCredential",
    "AzureDeveloperCliCredential",
    "InteractiveBrowserCredential",
  ],
});
const TIMESTAMP_URL = "http://timestamp.acs.microsoft.com";

function findSignTool(env) {
  if (env.SOJOURNER_SIGNTOOL_PATH) return env.SOJOURNER_SIGNTOOL_PATH;
  const kits = path.join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  const candidates = fs.existsSync(kits)
    ? fs.readdirSync(kits)
        .filter((name) => /^10\.\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .reverse()
        .map((name) => path.join(kits, name, "x64", "signtool.exe"))
        .filter((candidate) => fs.existsSync(candidate))
    : [];
  if (candidates.length === 0) throw new Error("signtool.exe was not found. Install the Windows SDK or set SOJOURNER_SIGNTOOL_PATH.");
  return candidates[0];
}

/** null when signing is not configured; throws when it is configured but unusable. */
function resolveSigning(env = process.env) {
  const clientDir = env.SOJOURNER_WINDOWS_SIGNING_CLIENT_DIR;
  if (!clientDir) return null;
  const dlib = path.join(clientDir, "bin", "x64", "Azure.CodeSigning.Dlib.dll");
  if (!fs.existsSync(dlib)) throw new Error(`Artifact Signing client not found at ${dlib}.`);
  return { dlib, signTool: findSignTool(env) };
}

let metadataPath = null;
/** Written once per process. Node writes no byte-order mark, which the signing client cannot parse. */
function signingMetadata() {
  if (!metadataPath) {
    metadataPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sojourner-signing-")), "metadata.json");
    fs.writeFileSync(metadataPath, JSON.stringify(ARTIFACT_SIGNING, null, 2));
  }
  return metadataPath;
}

function signToolArgs(file, dlib, metadata) {
  return ["sign", "/v", "/fd", "SHA256", "/tr", TIMESTAMP_URL, "/td", "SHA256", "/dlib", dlib, "/dmdf", metadata, file];
}

function signFile(file, env = process.env) {
  const signing = resolveSigning(env);
  if (!signing) throw new Error("Windows signing is not configured: set SOJOURNER_WINDOWS_SIGNING_CLIENT_DIR.");
  execFileSync(signing.signTool, signToolArgs(file, signing.dlib, signingMetadata()), { stdio: "inherit" });
}

/** electron-builder `win.signtoolOptions.sign` hook. */
async function sign(configuration) {
  signFile(configuration.path);
}

module.exports = sign;
module.exports.default = sign;
module.exports.ARTIFACT_SIGNING = ARTIFACT_SIGNING;
module.exports.TIMESTAMP_URL = TIMESTAMP_URL;
module.exports.resolveSigning = resolveSigning;
module.exports.signToolArgs = signToolArgs;
module.exports.signFile = signFile;

if (require.main === module) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node scripts/windows-sign.cjs <file>...");
    process.exit(2);
  }
  for (const file of files) signFile(path.resolve(file));
}
