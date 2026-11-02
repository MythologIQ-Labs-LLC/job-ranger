const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const windowsScript = fs.readFileSync(
  path.join(root, "scripts", "verify-windows-distribution.ps1"),
  "utf8",
);
const macScript = fs.readFileSync(
  path.join(root, "scripts", "verify-macos-distribution.sh"),
  "utf8",
);

assert.match(windowsScript, /\[string\[\]\]\$ArtifactPath/);
assert.match(windowsScript, /\[string\]\$ReportPath/);
assert.match(windowsScript, /Get-AuthenticodeSignature/);
assert.match(windowsScript, /Get-FileHash -Algorithm SHA256/);
assert.match(windowsScript, /schemaVersion = 3/);
// A required signature is valid, from MythologIQ Labs, LLC, timestamped and passes signtool verify /pa.
assert.match(windowsScript, /\$ExpectedSignerPattern = '\^CN="MythologIQ Labs, LLC"'/);
assert.match(windowsScript, /& \$SignToolPath verify \/pa \$target/);
assert.match(windowsScript, /The signature is not timestamped\./);
assert.match(windowsScript, /"resources\/sqlite3\.exe"/);
assert.match(windowsScript, /osVersion/);

assert.match(macScript, /--require-trust/);
assert.match(macScript, /--app/);
assert.match(macScript, /--report/);
assert.match(macScript, /codesign --verify --deep --strict/);
assert.match(macScript, /spctl --assess/);
assert.match(macScript, /xcrun stapler validate/);
assert.match(macScript, /productVersion/);

console.log("Clean-machine evidence tool contracts passed!");
