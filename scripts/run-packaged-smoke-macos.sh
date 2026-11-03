#!/usr/bin/env bash
set -euo pipefail

app_version="${1:?App version is required}"
smoke_root="${RUNNER_TEMP:?RUNNER_TEMP is required}/sojourner-package-smoke-macos"
trust_root="$(pwd)/build/trust"
report_path="$trust_root/macos-package-smoke.json"

rm -rf "$smoke_root"
mkdir -p "$smoke_root" "$trust_root"
rm -f "$report_path"

x64_binary="release/mac/Sojourner.app/Contents/MacOS/Sojourner"
arm64_binary="release/mac-arm64/Sojourner.app/Contents/MacOS/Sojourner"

if [[ ! -x "$x64_binary" ]]; then
  echo "Expected macOS x64 packaged executable is missing: $x64_binary" >&2
  exit 1
fi
if [[ ! -x "$arm64_binary" ]]; then
  echo "Expected macOS arm64 packaged executable is missing: $arm64_binary" >&2
  exit 1
fi

x64_file="$(file "$x64_binary")"
arm64_file="$(file "$arm64_binary")"
[[ "$x64_file" == *"x86_64"* ]] || { echo "x64 packaged executable has unexpected architecture: $x64_file" >&2; exit 1; }
[[ "$arm64_file" == *"arm64"* ]] || { echo "arm64 packaged executable has unexpected architecture: $arm64_file" >&2; exit 1; }

runner_arch="$(uname -m)"
case "$runner_arch" in
  arm64)
    binary="$arm64_binary"
    resources="release/mac-arm64/Sojourner.app/Contents/Resources"
    ;;
  x86_64)
    binary="$x64_binary"
    resources="release/mac/Sojourner.app/Contents/Resources"
    ;;
  *)
    echo "Unsupported macOS runner architecture for packaged smoke: $runner_arch" >&2
    exit 1
    ;;
esac

script_path="$resources/app.asar/electron-runtime/electron/src/package-smoke-cli.cjs"

ELECTRON_RUN_AS_NODE=1 \
SOJOURNER_PACKAGE_SMOKE_USER_DATA="$smoke_root" \
SOJOURNER_PACKAGE_SMOKE_REPORT="$report_path" \
SOJOURNER_PACKAGE_SMOKE_VERSION="$app_version" \
"$binary" "$script_path"

node - "$report_path" "$app_version" "$runner_arch" <<'NODE'
const fs = require('node:fs');
const [reportPath, appVersion, runnerArch] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.status !== 'passed') {
  throw new Error(`Packaged smoke report did not pass: ${report.error ?? 'unknown failure'}`);
}
if (report.scenario !== 'healthcare-operations') {
  throw new Error('Packaged smoke did not execute the required non-software scenario.');
}
if (report.appVersion !== appVersion) {
  throw new Error(`Packaged smoke version mismatch. Expected ${appVersion} but received ${report.appVersion}.`);
}
if (!report.checks.backupValidated || !report.checks.jsonResumeExported) {
  throw new Error('Packaged smoke did not complete backup and JSON Resume portability checks.');
}
report.checks.macosX64ExecutablePresent = true;
report.checks.macosArm64ExecutablePresent = true;
report.checks.nativePackagedExecutableLaunched = true;
report.checks.nativeRunnerArchitecture = runnerArch;
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
NODE

echo "Packaged macOS smoke passed: $report_path"
