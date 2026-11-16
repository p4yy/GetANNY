[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$cache = Join-Path $root 'installer\.cache'
$temporary = Join-Path $cache 'tmp'
$electronDist = Join-Path $root 'node_modules\electron\dist'
if (-not (Test-Path -LiteralPath (Join-Path $electronDist 'electron.exe'))) {
  throw 'The local Electron runtime is missing from node_modules/electron/dist; the local-only build will not download it.'
}
New-Item -ItemType Directory -Path $temporary -Force | Out-Null

# Keep Electron Builder downloads and temp renames in the local workspace. This
# is needed on packaged Windows hosts where the profile temp directory is
# redirected and may reject cache moves.
$env:TEMP = $temporary
$env:TMP = $temporary
$env:ELECTRON_BUILDER_CACHE = Join-Path $cache 'electron-builder'
$env:ELECTRON_CACHE = Join-Path $cache 'electron'
$env:DOTNET_CLI_HOME = Join-Path $cache 'dotnet-cli-home'
$env:NUGET_PACKAGES = Join-Path $cache 'nuget-packages'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

function Invoke-BuildTask([string] $Name, [string[]] $Arguments) {
  Write-Host "`n> $Name $($Arguments -join ' ')"
  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Build task '$Name' failed with exit code $LASTEXITCODE." }
}

Push-Location $root
try {
  Invoke-BuildTask 'build:browser-bridge' @('run', 'build:browser-bridge')
  Invoke-BuildTask 'verify:branding' @('run', 'verify:branding')
  Invoke-BuildTask 'build-extension' @('run', 'build-extension')
  Invoke-BuildTask 'build:renderer' @('run', 'build:renderer')
  Invoke-BuildTask 'build:setup-ui' @('run', 'build:setup-ui')

  Write-Host "`n> electron-builder (local candidate output)"
  & .\node_modules\.bin\electron-builder.cmd --win nsis --x64 --publish never `
    --config.directories.output=installer/artifacts/raw "--config.electronDist=$electronDist"
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE." }

  Write-Host "`n> wrap-installer-candidate"
  & node scripts/windows/wrap-installer-candidate.js
  if ($LASTEXITCODE -ne 0) { throw "Candidate wrapper failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
