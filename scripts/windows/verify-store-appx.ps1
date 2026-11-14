param(
  [string] $Package = 'dist/GetANNY Store.appx',
  [string] $Report = 'test-results/windows/store-appx-report.json'
)
$ErrorActionPreference = 'Stop'
$archive = $null
$checks = [System.Collections.Generic.List[object]]::new()
function Check([string] $Name, [bool] $Good, [string] $Detail = '') {
  $checks.Add(@{name=$Name;passed=$Good;detail=$Detail})
  if (-not $Good) { throw "$Name failed: $Detail" }
}
try {
  $full = (Resolve-Path -LiteralPath $Package -ErrorAction Stop).Path
  $file = Get-Item -LiteralPath $full
  Check 'Store AppX is not empty' ($file.Length -gt 20000000) "$($file.Length) bytes"
  Add-Type -AssemblyName System.IO.Compression
  $archive = [System.IO.Compression.ZipFile]::OpenRead($full)
  $manifest = $archive.Entries | Where-Object { $_.FullName -ieq 'AppxManifest.xml' } | Select-Object -First 1
  Check 'AppX manifest exists' ($null -ne $manifest)
  $reader = [System.IO.StreamReader]::new($manifest.Open())
  try { [xml] $xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $identity = $xml.SelectSingleNode('//*[local-name()="Identity"]')
  Check 'Identity exists' ($null -ne $identity)
  $identityName = [string] $identity.GetAttribute('Name')
  $publisher = [string] $identity.GetAttribute('Publisher')
  $version = [string] $identity.GetAttribute('Version')
  Check 'Exact Partner Center identity declared' ($identityName -ceq 'AcevAppsCo.GetANNYMediaDownloader') $identityName
  Check 'Exact publisher declared' ($publisher -ceq 'CN=44221EAF-7759-44DD-9DA8-F00E45DF7108') $publisher
  Check 'Correct Microsoft Store package version' ($version -ceq '2.6.0.0') $version
  $capabilities = @($xml.SelectNodes('//*[local-name()="Capability"]') | ForEach-Object { $_.GetAttribute('Name') })
  Check 'Full trust desktop capability present' ($capabilities -contains 'runFullTrust') ($capabilities -join ', ')
  $app = $xml.SelectSingleNode('//*[local-name()="Applications"]/*[local-name()="Application"]')
  Check 'Application is registered' ($null -ne $app)
  $names = @($archive.Entries | ForEach-Object FullName)
  foreach ($logo in @('StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png', 'Wide310x150Logo.png')) {
    $matching = @($archive.Entries | Where-Object { $_.FullName -like "*$logo" })
    Check "Store artwork $logo included" ($matching.Count -gt 0) "$($matching.Count) embedded resources"
    $entry = $matching[0]
    $stream = $entry.Open()
    try {
      $header = [byte[]]::new(8)
      $readBytes = $stream.Read($header, 0, 8)
      Check "Store artwork $logo is PNG" ($readBytes -eq 8 -and ([Convert]::ToHexString($header) -ceq '89504E470D0A1A0A'))
    } finally { $stream.Dispose() }
  }
  $certificateIncluded = $names -contains 'AppxSignature.p7x'
  $actualHash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
  $result = @{
    passed=$true
    package=(Split-Path $full -Leaf)
    sha256=$actualHash
    bytes=$file.Length
    identityName=$identityName
    publisher=$publisher
    version=$version
    signed=$certificateIncluded
    capabilities=$capabilities
    checks=$checks.ToArray()
    restrictions=@(
      'This is package structure verification, not Partner Center account/identity confirmation.',
      'No signed Store ingestion, entitlement, policy or installed sandbox tests have passed.',
      'Do not upload this unsigned candidate to a public GitHub release.'
    )
  }
  Write-Output "AppX candidate: $identityName $version, SHA-256 $actualHash (signed=$certificateIncluded)"
} catch {
  $result = @{passed=$false; error=$_.Exception.Message;package=$Package;checks=$checks.ToArray()}
  throw
} finally {
  if($null -ne $archive) { $archive.Dispose() }
  $parent = Split-Path $Report -Parent
  if($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  if($null -ne $result) {
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report
  }
}
