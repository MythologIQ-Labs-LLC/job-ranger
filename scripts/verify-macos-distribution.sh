#!/usr/bin/env bash
set -euo pipefail

require_trust="0"
report_path="build/trust/macos-signing.txt"
explicit_apps=()

# Backward compatibility: the release workflow historically passes a single 0/1
# positional argument. Additional clean-machine use should prefer the named flags.
if [[ "${1:-}" == "0" || "${1:-}" == "1" ]]; then
  require_trust="$1"
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --require-trust)
      require_trust="1"
      shift
      ;;
    --report)
      report_path="${2:?--report requires a path}"
      shift 2
      ;;
    --app)
      explicit_apps+=("${2:?--app requires a Sojourner.app path}")
      shift 2
      ;;
    --help|-h)
      cat <<'USAGE'
Usage:
  bash scripts/verify-macos-distribution.sh [0|1]
  bash scripts/verify-macos-distribution.sh --require-trust --app "/Applications/Sojourner.app" --report ./macos-clean-machine.txt

Without --app, the script searches release/**/Sojourner.app for CI/package verification.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

report_dir="$(dirname "$report_path")"
mkdir -p "$report_dir"
: > "$report_path"

{
  echo "schemaVersion: 2"
  echo "generatedAt: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "requireTrust: $require_trust"
  echo "hostArchitecture: $(uname -m)"
  echo "kernel: $(uname -sr)"
  if command -v sw_vers >/dev/null 2>&1; then
    echo "productName: $(sw_vers -productName)"
    echo "productVersion: $(sw_vers -productVersion)"
    echo "buildVersion: $(sw_vers -buildVersion)"
  fi
} >> "$report_path"

apps=()
if [[ ${#explicit_apps[@]} -gt 0 ]]; then
  for app in "${explicit_apps[@]}"; do
    if [[ ! -d "$app" ]]; then
      echo "Requested Sojourner.app does not exist: $app" | tee -a "$report_path" >&2
      exit 1
    fi
    apps+=("$app")
  done
else
  while IFS= read -r -d '' app; do
    apps+=("$app")
  done < <(find release -maxdepth 3 -type d -name 'Sojourner.app' -print0 2>/dev/null)
fi

if [[ ${#apps[@]} -eq 0 ]]; then
  echo "No packaged Sojourner.app bundles were found." | tee -a "$report_path"
  exit 1
fi

failures=0
for app in "${apps[@]}"; do
  echo "APP: $app" | tee -a "$report_path"
  executable="$app/Contents/MacOS/Sojourner"
  if [[ -f "$executable" ]]; then
    echo "executableArchitecture: $(file "$executable")" | tee -a "$report_path"
  fi

  if codesign --verify --deep --strict --verbose=2 "$app" >>"$report_path" 2>&1; then
    echo "codesign: valid" | tee -a "$report_path"
  else
    echo "codesign: invalid" | tee -a "$report_path"
    failures=$((failures + 1))
  fi

  codesign -dv --verbose=4 "$app" >>"$report_path" 2>&1 || true

  if spctl --assess --verbose=2 --type exec "$app" >>"$report_path" 2>&1; then
    echo "gatekeeper: accepted" | tee -a "$report_path"
  else
    echo "gatekeeper: not accepted" | tee -a "$report_path"
    failures=$((failures + 1))
  fi

  if xcrun stapler validate "$app" >>"$report_path" 2>&1; then
    echo "stapler: valid" | tee -a "$report_path"
  else
    echo "stapler: missing-or-invalid" | tee -a "$report_path"
    failures=$((failures + 1))
  fi
done

if [[ "$require_trust" != "1" ]]; then
  echo "Tester mode: trust failures are recorded but do not fail the build." | tee -a "$report_path"
  exit 0
fi

if [[ $failures -gt 0 ]]; then
  echo "Public macOS distribution trust verification failed with $failures trust check failure(s)." | tee -a "$report_path"
  exit 1
fi

echo "Public macOS distribution trust verification passed." | tee -a "$report_path"
