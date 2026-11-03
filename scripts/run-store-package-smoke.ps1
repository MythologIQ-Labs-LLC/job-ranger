<#
  Installs the Microsoft Store (AppX) package on a Windows machine/runner and
  validates the packaged runtime *inside the package context*:

  1. seeds a historical direct-download (NSIS-style) data root under
     %APPDATA%\Sojourner to exercise coexistence;
  2. signs a COPY of the package with an ephemeral, self-signed certificate
     whose subject equals the package publisher (local install only — the
     artifact submitted to Partner Center stays unsigned; Microsoft signs it
     after certification);
  3. installs it, runs `Sojourner.exe --sojourner-package-smoke-report=...`
     in the package context (real Electron main process, package identity,
     file-system virtualization);
  4. records data isolation (virtualized LocalCache path, no leak into the
     real %APPDATA%), proves the legacy data was not modified, uninstalls, and
     records whether uninstall removed package data;
  5. removes the ephemeral certificate.

  This is package validation, NOT Store certification.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$AppVersion,
  [string]$ReleaseDirectory = "release",
  [string]$TrustDirectory = "build/trust"
)

$ErrorActionPreference = "Stop"
Import-Module Appx -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem

$appx = Get-ChildItem -Path $ReleaseDirectory -Filter "Job*windows-store*.appx" -File | Select-Object -First 1
if (-not $appx) { throw "No Microsoft Store AppX package was found in $ReleaseDirectory." }
New-Item -ItemType Directory -Path $TrustDirectory -Force | Out-Null
$trustRoot = (Resolve-Path $TrustDirectory).Path

$zip = [System.IO.Compression.ZipFile]::OpenRead($appx.FullName)
try {
  $reader = New-Object System.IO.StreamReader($zip.GetEntry("AppxManifest.xml").Open())
  [xml]$manifest = $reader.ReadToEnd()
  $reader.Dispose()
} finally {
  $zip.Dispose()
}
$identityName = $manifest.Package.Identity.Name
$publisher = $manifest.Package.Identity.Publisher

$work = Join-Path $env:RUNNER_TEMP "sojourner-store-smoke"
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $work -Force | Out-Null

# --- 1. Historical direct-download data (coexistence) ---
$legacyUserData = Join-Path $env:APPDATA "Sojourner"
$legacySeedReport = Join-Path $work "legacy-seed.json"
$env:SOJOURNER_PACKAGE_SMOKE_USER_DATA = $legacyUserData
$env:SOJOURNER_PACKAGE_SMOKE_REPORT = $legacySeedReport
$env:SOJOURNER_PACKAGE_SMOKE_VERSION = "1.2.0"
try {
  node electron-runtime/electron/src/package-smoke-cli.cjs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not seed the historical direct-download data root." }
} finally {
  Remove-Item Env:SOJOURNER_PACKAGE_SMOKE_USER_DATA, Env:SOJOURNER_PACKAGE_SMOKE_REPORT, Env:SOJOURNER_PACKAGE_SMOKE_VERSION -ErrorAction SilentlyContinue
}
$legacyDatabase = Join-Path $legacyUserData "data\sojourner.sqlite3"
$legacyHashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $legacyDatabase).Hash

# --- 2. Ephemeral signature for local installation only ---
$signedAppx = Join-Path $work "install-only-signed.appx"
Copy-Item -LiteralPath $appx.FullName -Destination $signedAppx
$password = [guid]::NewGuid().ToString("N")
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature `
  -FriendlyName "Sojourner package validation (ephemeral)" -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}") -NotAfter (Get-Date).AddDays(1)
$pfx = Join-Path $work "ephemeral.pfx"
$cer = Join-Path $work "ephemeral.cer"
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $securePassword | Out-Null
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null

$signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match "\\x64\\" } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw "signtool.exe was not found in the Windows SDK." }

$report = Join-Path $trustRoot "windows-store-package-smoke.json"
Remove-Item -LiteralPath $report -Force -ErrorAction SilentlyContinue
$package = $null
$launchMethod = "none"
try {
  & $signtool.FullName sign /fd SHA256 /f $pfx /p $password $signedAppx | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "signtool could not sign the install-only package copy." }

  # --- 3. Install and run inside the package context ---
  Add-AppxPackage -Path $signedAppx
  $package = Get-AppxPackage -Name $identityName
  if (-not $package) { throw "The AppX package did not install." }
  $exe = Join-Path $package.InstallLocation "app\Sojourner.exe"
  $smokeArgument = "--sojourner-package-smoke-report=$report"

  if (Get-Command Invoke-CommandInDesktopPackage -ErrorAction SilentlyContinue) {
    $launchMethod = "Invoke-CommandInDesktopPackage"
    Invoke-CommandInDesktopPackage -PackageFamilyName $package.PackageFamilyName -AppId "Sojourner" -Command $exe -Args $smokeArgument
  } else {
    $launchMethod = "Start-Process"
    Start-Process -FilePath $exe -ArgumentList $smokeArgument | Out-Null
  }
  $deadline = (Get-Date).AddMinutes(6)
  while ((Get-Date) -lt $deadline) {
    if ((Test-Path -LiteralPath $report) -and -not (Get-Process -Name "Sojourner" -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Seconds 3
  }
  if (-not (Test-Path -LiteralPath $report)) {
    throw "The packaged smoke did not produce a report within the time limit (launch method: $launchMethod)."
  }

  $smoke = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
  $failures = @()
  if ($smoke.status -ne "passed") { $failures += "Packaged smoke failed: $($smoke.error)" }
  if ($smoke.scenario -ne "healthcare-operations") { $failures += "Packaged smoke did not run the non-software scenario." }
  if ($smoke.appVersion -ne $AppVersion) { $failures += "Packaged smoke version $($smoke.appVersion) does not match $AppVersion." }
  foreach ($check in @("docxImportSucceeded", "storeDataIsolated", "sqliteBundled", "resumeTruthGatePassed", "resumeParseabilityPassed", "archiveRestoreApplied", "archiveRestoredProfile", "externalNavigationValidated", "backupValidated", "jsonResumeExported", "legacyImportApplicable", "legacyInstallFound")) {
    if ($smoke.checks.$check -ne $true) { $failures += "Packaged smoke check '$check' was not true." }
  }
  if ($smoke.checks.channel -ne "microsoft-store") { $failures += "Runtime did not detect the Microsoft Store channel." }
  if ($smoke.checks.windowsStore -ne $true) { $failures += "Runtime did not run with package identity (process.windowsStore)." }

  # --- 4. Isolation, coexistence, uninstall evidence ---
  $virtualizedData = Join-Path $env:LOCALAPPDATA "Packages\$($package.PackageFamilyName)\LocalCache\Roaming\Sojourner Store"
  $storeDataInPackageStorage = Test-Path -LiteralPath $virtualizedData
  $storeDataLeakedToRealAppData = Test-Path -LiteralPath (Join-Path $env:APPDATA "Sojourner Store")
  $legacyHashAfter = (Get-FileHash -Algorithm SHA256 -LiteralPath $legacyDatabase).Hash
  if (-not $storeDataInPackageStorage) { $failures += "Store data was not found in the package's private LocalCache storage." }
  if ($storeDataLeakedToRealAppData) { $failures += "Store data leaked into the real %APPDATA% folder." }
  if ($legacyHashAfter -ne $legacyHashBefore) { $failures += "The historical direct-download database was modified." }

  Remove-AppxPackage -Package $package.PackageFullName
  $packageDataRemovedOnUninstall = -not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA "Packages\$($package.PackageFamilyName)\LocalCache"))
  $legacySurvivesUninstall = Test-Path -LiteralPath $legacyDatabase
  if (-not $legacySurvivesUninstall) { $failures += "Uninstalling the Store package removed historical direct-download data." }
  $package = $null

  $evidence = [ordered]@{
    schemaVersion = 1
    package = $appx.Name
    identityName = $identityName
    publisher = $publisher
    launchMethod = $launchMethod
    packageFamilyName = $smoke.checks.packageFamilyName
    smokeStatus = $smoke.status
    storeDataInPackageStorage = $storeDataInPackageStorage
    storeDataLeakedToRealAppData = $storeDataLeakedToRealAppData
    legacyDatabaseUnchanged = ($legacyHashAfter -eq $legacyHashBefore)
    legacyDataSurvivesStoreUninstall = $legacySurvivesUninstall
    packageDataRemovedOnUninstall = $packageDataRemovedOnUninstall
    windowsVersion = [System.Environment]::OSVersion.VersionString
    certification = "not performed (Partner Center certification is external)"
    failures = $failures
    status = $(if ($failures.Count -eq 0) { "passed" } else { "failed" })
  }
  $evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $trustRoot "windows-store-install.json") -Encoding utf8
  if ($failures.Count -gt 0) { throw "Store package runtime validation failed:`n$($failures -join "`n")" }
  Write-Host "Store package runtime validation passed ($launchMethod)."
} finally {
  if ($package) { Remove-AppxPackage -Package $package.PackageFullName -ErrorAction SilentlyContinue }
  Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object { $_.Thumbprint -eq $cert.Thumbprint } | Remove-Item -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pfx, $cer, $signedAppx -Force -ErrorAction SilentlyContinue
}
