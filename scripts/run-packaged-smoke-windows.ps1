param(
  [Parameter(Mandatory = $true)]
  [string]$AppVersion
)

$ErrorActionPreference = "Stop"

$smokeRoot = Join-Path $env:RUNNER_TEMP "sojourner-package-smoke-windows"
$trustRoot = Join-Path (Get-Location) "build\trust"
$reportPath = Join-Path $trustRoot "windows-package-smoke.json"
$exePath = (Resolve-Path "release\win-unpacked\Sojourner.exe").Path
$resourcesPath = (Resolve-Path "release\win-unpacked\resources").Path
$scriptPath = Join-Path $resourcesPath "app.asar\electron-runtime\electron\src\package-smoke-cli.cjs"

Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $trustRoot -Force | Out-Null
Remove-Item -LiteralPath $reportPath -Force -ErrorAction SilentlyContinue

$env:ELECTRON_RUN_AS_NODE = "1"
$env:SOJOURNER_PACKAGE_SMOKE_USER_DATA = $smokeRoot
$env:SOJOURNER_PACKAGE_SMOKE_REPORT = $reportPath
$env:SOJOURNER_PACKAGE_SMOKE_VERSION = $AppVersion

try {
  $process = Start-Process -FilePath $exePath -ArgumentList @($scriptPath) -Wait -PassThru -NoNewWindow
  if ($process.ExitCode -ne 0) {
    throw "Packaged Sojourner smoke process exited with code $($process.ExitCode)."
  }
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Remove-Item Env:SOJOURNER_PACKAGE_SMOKE_USER_DATA -ErrorAction SilentlyContinue
  Remove-Item Env:SOJOURNER_PACKAGE_SMOKE_REPORT -ErrorAction SilentlyContinue
  Remove-Item Env:SOJOURNER_PACKAGE_SMOKE_VERSION -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $reportPath)) {
  throw "Packaged smoke report was not created: $reportPath"
}

$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
if ($report.status -ne "passed") {
  throw "Packaged smoke report did not pass: $($report.error)"
}
if ($report.scenario -ne "healthcare-operations") {
  throw "Packaged smoke did not execute the required non-software scenario."
}
if ($report.appVersion -ne $AppVersion) {
  throw "Packaged smoke version mismatch. Expected $AppVersion but received $($report.appVersion)."
}
if (-not $report.checks.backupValidated -or -not $report.checks.jsonResumeExported) {
  throw "Packaged smoke did not complete backup and JSON Resume portability checks."
}

Write-Host "Packaged Windows smoke passed: $reportPath"
