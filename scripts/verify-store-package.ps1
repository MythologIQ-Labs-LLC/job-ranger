<#
  Verifies a Microsoft Store (AppX) package produced by electron-builder.store.cjs
  without installing it, and writes machine-readable evidence.

  Checks: package identity and version, the exact (narrow) capability set,
  full-trust entry point, absence of startup/protocol/file-association
  extensions, canonical Sojourner tile assets (not electron-builder samples),
  and the presence of the bundled sqlite3.exe and app.asar.
#>
param(
  [string]$ReleaseDirectory = "release",
  [string]$ReportPath = "build/trust/windows-store-package.json",
  [string]$ExpectedVersion
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$appx = Get-ChildItem -Path $ReleaseDirectory -Filter "Job*windows-store*.appx" -File | Select-Object -First 1
if (-not $appx) { throw "No Microsoft Store AppX package was found in $ReleaseDirectory." }
if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  $ExpectedVersion = (node -p "require('./package.json').version").Trim()
}

function Get-EntrySha256($archive, [string]$name) {
  $entry = $archive.Entries | Where-Object { [Uri]::UnescapeDataString($_.FullName) -eq $name } | Select-Object -First 1
  if (-not $entry) { return $null }
  $stream = $entry.Open()
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return (($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $stream.Dispose()
  }
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($appx.FullName)
try {
  $names = @($archive.Entries | ForEach-Object { [Uri]::UnescapeDataString($_.FullName) })
  $manifestEntry = $archive.GetEntry("AppxManifest.xml")
  if (-not $manifestEntry) { throw "AppxManifest.xml is missing from $($appx.Name)." }
  $reader = New-Object System.IO.StreamReader($manifestEntry.Open())
  $manifestText = $reader.ReadToEnd()
  $reader.Dispose()
  [xml]$manifest = $manifestText

  $identity = $manifest.Package.Identity
  $application = $manifest.Package.Applications.Application
  $capabilities = @($manifest.Package.Capabilities.ChildNodes | ForEach-Object { $_.GetAttribute("Name") } | Sort-Object)
  $expectedCapabilities = @("internetClient", "runFullTrust")
  $extensions = $application.Extensions

  $failures = @()
  if ($identity.Version -ne "$ExpectedVersion.0") { $failures += "Identity version $($identity.Version) does not match $ExpectedVersion.0" }
  if ($identity.ProcessorArchitecture -ne "x64") { $failures += "Unexpected architecture $($identity.ProcessorArchitecture)" }
  if (-not ($identity.Publisher -like "CN=*")) { $failures += "Publisher is not a distinguished name" }
  if ((Compare-Object $capabilities $expectedCapabilities)) { $failures += "Capabilities must be exactly runFullTrust + internetClient, found: $($capabilities -join ', ')" }
  if ($application.EntryPoint -ne "Windows.FullTrustApplication") { $failures += "Unexpected entry point $($application.EntryPoint)" }
  if ($application.Executable -ne "app\Sojourner.exe") { $failures += "Unexpected executable $($application.Executable)" }
  if ($application.Id -ne "Sojourner") { $failures += "Unexpected application id $($application.Id)" }
  if ($extensions) { $failures += "Package declares extensions (startup task, protocol, or file association) that Sojourner does not use" }
  if ($manifestText -match "electron-updater|squirrel") { $failures += "Package manifest references an app-managed updater" }

  $assetChecks = @{}
  foreach ($asset in @("StoreLogo.png", "Square44x44Logo.png", "Square150x150Logo.png", "Wide310x150Logo.png", "LargeTile.png", "SmallTile.png")) {
    $expected = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path "build/appx" $asset)).Hash.ToLowerInvariant()
    $actual = Get-EntrySha256 $archive "assets/$asset"
    $assetChecks[$asset] = ($actual -eq $expected)
    if ($actual -ne $expected) { $failures += "Tile asset $asset is not the canonical Sojourner asset" }
  }
  foreach ($required in @("app/Sojourner.exe", "app/resources/app.asar", "app/resources/sqlite3.exe")) {
    if ($names -notcontains $required) { $failures += "Package is missing $required" }
  }

  $report = [ordered]@{
    schemaVersion = 1
    package = $appx.Name
    bytes = $appx.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $appx.FullName).Hash.ToLowerInvariant()
    identityName = $identity.Name
    publisher = $identity.Publisher
    version = $identity.Version
    architecture = $identity.ProcessorArchitecture
    validationIdentity = ($identity.Publisher -eq "CN=Sojourner Package Validation")
    displayName = $manifest.Package.Properties.DisplayName
    publisherDisplayName = $manifest.Package.Properties.PublisherDisplayName
    minVersion = $manifest.Package.Dependencies.TargetDeviceFamily.MinVersion
    maxVersionTested = $manifest.Package.Dependencies.TargetDeviceFamily.MaxVersionTested
    capabilities = $capabilities
    entryPoint = $application.EntryPoint
    executable = $application.Executable
    extensionsDeclared = [bool]$extensions
    canonicalAssets = $assetChecks
    bundledSqlite = ($names -contains "app/resources/sqlite3.exe")
    signedBySubmitter = ($names -contains "AppxSignature.p7x")
    failures = $failures
    status = $(if ($failures.Count -eq 0) { "passed" } else { "failed" })
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $ReportPath) -Force | Out-Null
  $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding utf8
  $manifestText | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $ReportPath) "windows-store-AppxManifest.xml") -Encoding utf8
  if ($failures.Count -gt 0) { throw "Store package verification failed:`n$($failures -join "`n")" }
  Write-Host "Store package verified: $($appx.Name) ($($identity.Name), $($identity.Version))"
} finally {
  $archive.Dispose()
}
