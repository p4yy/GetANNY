[CmdletBinding()]
param(
  [string] $DotnetPath,
  [string] $Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$project = Join-Path $root 'installer\GetANNY.Setup\GetANNY.Setup.csproj'
$publish = Join-Path $root 'installer\publish'
$cache = Join-Path $root 'installer\.cache'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$env:DOTNET_CLI_HOME = Join-Path $cache 'dotnet-cli-home'
$env:NUGET_PACKAGES = Join-Path $cache 'nuget-packages'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

if ($DotnetPath) {
  if (-not (Test-Path -LiteralPath $DotnetPath)) { throw "dotnet was not found at '$DotnetPath'." }
  $dotnetCandidates = @($DotnetPath)
} else {
  $dotnetCandidates = @()
  $dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
  if ($dotnetCommand) { $dotnetCandidates += $dotnetCommand.Source }
  # Supports an isolated desktop build when a machine has a runtime but no SDK.
  $localSdk = Join-Path $root 'tmp-inspect\dotnet10\dotnet.exe'
  if (Test-Path -LiteralPath $localSdk) { $dotnetCandidates += $localSdk }
}

$selectedDotnet = $null
$sdkVersion = $null
foreach ($candidate in $dotnetCandidates | Select-Object -Unique) {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $versionOutput = & $candidate --version 2>&1
    $versionExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldPreference
  }
  if ($versionExitCode -eq 0 -and $versionOutput -match '^(\d+)\.' -and [int]$Matches[1] -ge 10) {
    $selectedDotnet = $candidate
    $sdkVersion = $versionOutput.Trim()
    break
  }
}
if (-not $selectedDotnet) {
  throw 'The .NET 10 SDK is required to build the WPF installer shell.'
}
$DotnetPath = $selectedDotnet

$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if ($package.version -notmatch '^(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.+-]+)?$') {
  throw "Invalid GetANNY package version '$($package.version)'."
}
$numericVersion = $Matches[1]

if (Test-Path -LiteralPath $publish) {
  $resolvedRoot = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  $resolvedPublish = [IO.Path]::GetFullPath($publish)
  if (-not $resolvedPublish.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -or
      (Split-Path $resolvedPublish -Leaf) -ne 'publish') {
    throw "Refusing to clean unexpected publish path '$resolvedPublish'."
  }
  Remove-Item -LiteralPath $resolvedPublish -Recurse -Force
}
New-Item -ItemType Directory -Path $publish -Force | Out-Null

Write-Host "Publishing GetANNY Setup $numericVersion (self-contained win-x64)..."
& $DotnetPath publish $project -c $Configuration -r win-x64 --self-contained true `
  "-p:SetupVersion=$numericVersion" "-p:InformationalVersion=$($package.version)" `
  -p:IncludeSourceRevisionInInformationalVersion=false `
  -o $publish --nologo
if ($LASTEXITCODE -ne 0) { throw 'The WPF setup publish failed.' }

$exe = Join-Path $publish 'GetANNY.Setup.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Publish did not produce '$exe'." }
$versionInfo = (Get-Item -LiteralPath $exe).VersionInfo
if ($versionInfo.ProductVersion -ne $package.version -or $versionInfo.ProductName -ne 'GetANNY Download Manager') {
  throw "Setup metadata mismatch: $($versionInfo.ProductName) $($versionInfo.ProductVersion)."
}
$loose = Get-ChildItem -LiteralPath $publish -File | Where-Object Name -ne 'GetANNY.Setup.exe'
if ($loose) { throw "Unexpected loose publish files: $($loose.Name -join ', ')" }

$sha = [Security.Cryptography.SHA256]::Create()
$fileStream = [IO.File]::OpenRead($exe)
try {
  $hash = [BitConverter]::ToString($sha.ComputeHash($fileStream)).Replace("-", "").ToLowerInvariant()
} finally {
  $fileStream.Dispose()
  $sha.Dispose()
}
Write-Host ("Built {0} ({1:N1} MB), SHA-256 {2}" -f $exe, ((Get-Item -LiteralPath $exe).Length / 1MB), $hash)
