param(
  [switch]$RequireSigned,
  [string[]]$ArtifactPath,
  [string]$ReportPath,
  [string]$SignToolPath
)

# Publisher required by the Windows code signing standard
# (MythologIQ-Labs-LLC/Myth-Tech-Forge docs/WINDOWS_CODE_SIGNING_STANDARD.md).
$ExpectedSignerPattern = '^CN="MythologIQ Labs, LLC"'

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
  $reportDir = Join-Path $PSScriptRoot "../build/trust"
  New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
  $ReportPath = Join-Path $reportDir "windows-signing.json"
} else {
  $ReportPath = [System.IO.Path]::GetFullPath($ReportPath)
  $reportDir = Split-Path -Parent $ReportPath
  if (-not [string]::IsNullOrWhiteSpace($reportDir)) {
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
  }
}

$targets = @()
if ($ArtifactPath -and $ArtifactPath.Count -gt 0) {
  foreach ($candidate in $ArtifactPath) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      throw "Windows trust-verification artifact does not exist: $candidate"
    }
    $targets += (Resolve-Path -LiteralPath $candidate).Path
  }
} else {
  # Every executable the installer puts on disk that we sign, plus the installer itself.
  foreach ($relative in @("Job Ranger.exe", "resources/elevate.exe", "resources/sqlite3.exe")) {
    $candidate = Join-Path $PSScriptRoot "../release/win-unpacked/$relative"
    if (Test-Path -LiteralPath $candidate) {
      $targets += (Resolve-Path $candidate).Path
    }
  }
  $targets += Get-ChildItem -Path (Join-Path $PSScriptRoot "../release") -Filter "Job*windows*.exe" -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
}
$targets = @($targets | Select-Object -Unique)

if ($targets.Count -eq 0) {
  throw "No Windows release executables were found for trust verification."
}

if ($RequireSigned -and -not $SignToolPath) {
  $SignToolPath = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $SignToolPath) { throw "signtool.exe was not found; it is needed to verify a signed release." }
}

$results = foreach ($target in $targets) {
  $signature = Get-AuthenticodeSignature -FilePath $target
  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $target
  $item = Get-Item -LiteralPath $target
  $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
  $issuer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Issuer } else { $null }
  $timestamper = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
  $signToolVerified = $null
  if ($RequireSigned) {
    & $SignToolPath verify /pa $target | Out-Host
    $signToolVerified = ($LASTEXITCODE -eq 0)
  }
  $entry = [ordered]@{
    path = $target
    fileName = $item.Name
    bytes = $item.Length
    sha256 = $hash.Hash.ToLowerInvariant()
    status = [string]$signature.Status
    statusMessage = $signature.StatusMessage
    signerSubject = $subject
    signerIssuer = $issuer
    timestamperSubject = $timestamper
    signToolVerifyPa = $signToolVerified
  }

  if ($RequireSigned) {
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
      $entry.failure = "Public release requires a valid Authenticode signature."
    } elseif ($subject -notmatch $ExpectedSignerPattern) {
      $entry.failure = "Unexpected signer: $subject"
    } elseif (-not $timestamper) {
      $entry.failure = "The signature is not timestamped."
    } elseif (-not $signToolVerified) {
      $entry.failure = "signtool verify /pa failed."
    }
  }

  [pscustomobject]$entry
}

$windowsCaption = $null
$windowsVersion = $null
try {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  $windowsCaption = $os.Caption
  $windowsVersion = $os.Version
} catch {
  $windowsCaption = [System.Environment]::OSVersion.VersionString
  $windowsVersion = [System.Environment]::OSVersion.Version.ToString()
}

$report = [ordered]@{
  schemaVersion = 3
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  requireSigned = [bool]$RequireSigned
  expectedSigner = if ($RequireSigned) { 'CN="MythologIQ Labs, LLC"' } else { $null }
  host = [ordered]@{
    computerName = $env:COMPUTERNAME
    os = $windowsCaption
    osVersion = $windowsVersion
    architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    powershellVersion = $PSVersionTable.PSVersion.ToString()
  }
  artifacts = $results
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $ReportPath -Encoding UTF8
Get-Content $ReportPath

$invalid = @($results | Where-Object { $_.failure })
if ($RequireSigned -and $invalid.Count -gt 0) {
  throw "Windows distribution trust verification failed for $($invalid.Count) artifact(s)."
}
