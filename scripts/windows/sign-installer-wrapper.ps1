[CmdletBinding()]
param(
  [string] $InstallerPath = 'dist/GetANNY Setup.exe'
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($env:CSC_LINK)) {
  throw 'CSC_LINK is required to sign the final branded GetANNY wrapper.'
}
if (-not (Test-Path -LiteralPath $InstallerPath)) {
  throw "Installer not found: $InstallerPath"
}
$current = Get-AuthenticodeSignature -LiteralPath $InstallerPath
if ($current.Status -eq 'Valid' -and $current.TimeStamperCertificate) {
  Write-Host 'The branded GetANNY installer is already validly signed and timestamped.'
  exit 0
}
$temporary = Join-Path $env:RUNNER_TEMP ('getanny-sign-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
$certificate = Join-Path $temporary 'certificate.pfx'
try {
  $link = $env:CSC_LINK.Trim()
  if ($link -match '^file://') {
    $link = ([uri]$link).LocalPath
  }
  if ($link -match '^https?://') {
    Invoke-WebRequest -Uri $link -OutFile $certificate
  } elseif ($link -match '^(?:[A-Za-z]:\\|\\\\|\.\.?[\\/])' -or (Test-Path -LiteralPath $link -PathType Leaf -ErrorAction SilentlyContinue)) {
    Copy-Item -LiteralPath $link -Destination $certificate -Force
  } else {
    $encoded = [regex]::Replace($link, '^(?:data:[^,]*;base64,|base64:)', '')
    $encoded = [regex]::Replace($encoded, '\s', '')
    try { $bytes = [Convert]::FromBase64String($encoded) }
    catch { throw 'CSC_LINK must be a PFX file path, HTTPS URL, or base64-encoded PFX.' }
    [IO.File]::WriteAllBytes($certificate, $bytes)
  }
  if (-not (Test-Path -LiteralPath $certificate) -or (Get-Item $certificate).Length -lt 1024) {
    throw 'The configured signing certificate is missing or invalid.'
  }
  $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  $kits = Join-Path $programFilesX86 'Windows Kits\10\bin'
  $signtool = Get-ChildItem -LiteralPath $kits -Filter signtool.exe -Recurse -File -ErrorAction Stop |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $signtool) { throw 'Windows SDK signtool.exe was not found.' }
  $arguments = @('sign','/fd','SHA256','/f',$certificate,'/tr','http://timestamp.digicert.com','/td','SHA256','/v')
  if ($null -ne $env:CSC_KEY_PASSWORD) { $arguments += @('/p',$env:CSC_KEY_PASSWORD) }
  $arguments += $InstallerPath
  & $signtool.FullName @arguments
  if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE." }
  $signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
  if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
    throw "The final branded installer signature is not valid and timestamped: $($signature.Status)"
  }
  Write-Host 'Final branded GetANNY Setup.exe signature is valid and timestamped.'
} finally {
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
