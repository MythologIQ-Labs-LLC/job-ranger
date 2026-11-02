const path = require("node:path");
const base = require("./electron-builder.json");
const { resolveSigning } = require("./scripts/windows-sign.cjs");

// Azure Artifact Signing through SignTool and the Azure CLI sign-in (GitHub OIDC in the
// `release` environment, or the owner's `az login` locally). No client secret.
const requireSigning = process.env.JOB_RANGER_REQUIRE_WINDOWS_SIGNING === "1";
const signing = resolveSigning(process.env);

if (requireSigning && !signing) {
  throw new Error(
    "Windows code signing is required for this public release, but the Artifact Signing client is not configured (JOB_RANGER_WINDOWS_SIGNING_CLIENT_DIR).",
  );
}

module.exports = {
  ...base,
  win: {
    ...base.win,
    ...(signing
      ? {
          signtoolOptions: {
            sign: path.join(__dirname, "scripts", "windows-sign.cjs"),
            signingHashAlgorithms: ["sha256"],
          },
        }
      : {}),
  },
};
