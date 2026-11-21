# Fail-closed assembly from disposable Windows EXE verification only.
$ErrorActionPreference='Stop'
$evidenceRoot = 'test-results/windows'
$version = node -p "require('./package.json').version"
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version.' }
$overall = Get-Content "$evidenceRoot/installer-report.json" -Raw | ConvertFrom-Json
if (-not $overall.passed) { throw 'Cannot assemble an installer from failed EXE evidence.' }
# Keep the release gate aligned with the installer identity and browser-test
# scope written by test-installers.ps1. Do not silently certify an older target.
$expectedInstaller = 'Dark WPF setup shell with embedded NSIS x64 engine'
$expectedBrowserScope = 'Extension source regression tests run in the separate browser-handoff workflow gate; real-browser matrix remains owner validation.'
if ($overall.installer -cne $expectedInstaller) {
  throw 'Unexpected installer target; expected the branded WPF shell with its embedded NSIS x64 engine.'
}
if ($overall.browserExtensionTests -cne $expectedBrowserScope) {
  throw 'Browser-test scope was not recorded accurately.'
}
$retention = $overall.defaultProfileRetention.exe
if (-not $retention.retained -or -not $retention.nativeCleanupVerified -or
    $retention.ownedNativeEntries -lt 1 -or $retention.history -lt 1) {
  throw 'EXE uninstall/profile-retention checks were not verified.'
}
[xml]$junit = Get-Content "$evidenceRoot/backend-junit.xml" -Raw
$cases = $junit.SelectNodes('//testcase').Count
$failures = $junit.SelectNodes('//failure').Count
$skipped = $junit.SelectNodes('//skipped').Count
if ($cases -eq 0 -or $failures -ne 0 -or $skipped -ne 0) {
  throw 'EXE core test evidence is missing, failed or skipped.'
}
[xml]$browserJUnit = Get-Content "$evidenceRoot/browser-junit.xml" -Raw
$browserCases = $browserJUnit.SelectNodes('//testcase').Count
if ($browserCases -eq 0 -or $browserJUnit.SelectNodes('//failure|//skipped').Count -ne 0) {
  throw 'Browser handoff source test evidence is missing, failed or skipped.'
}
$measured = [System.Collections.Generic.List[string]]::new()
$measured.Add("# GetANNY $version - measured branded Windows Setup EXE checks")
$measured.Add('')
$measured.Add(('Desktop source tests: **{0} passed, 0 failed, 0 skipped**.' -f $cases))
$measured.Add(('Browser handoff and bridge source tests: **{0} passed, 0 failed, 0 skipped**.' -f $browserCases))
foreach ($name in @('exe-first-install','exe-upgrade-restart','exe-actual-default-profile','exe-desktop-lifecycle')) {
  $record = Get-Content "$evidenceRoot/$name.json" -Raw | ConvertFrom-Json
  $minimum = if ($name -eq 'exe-desktop-lifecycle') { 4 } else { 13 }
  if (-not $record.passed -or $record.checks.Count -lt $minimum -or
      ($record.checks | Where-Object passed -ne $true)) {
    throw "Packaged EXE check failed or missing: $name"
  }
  $measured.Add(('- {0}: **{1} passed checks**.' -f $name,$record.checks.Count))
}
$tray = Get-Content "$evidenceRoot/exe-tray-idle.json" -Raw | ConvertFrom-Json
if (-not $tray.passed -or -not $tray.trayLifecycle.passed -or
    -not $tray.trayLifecycle.rendererReleased -or
    -not $tray.trayLifecycle.bridgeStayedAvailable -or
    -not $tray.trayLifecycle.browserRequestWokeWindow -or
    $null -eq $tray.trayLifecycle.idleCpuMicrosOver10Seconds -or
    $null -eq $tray.trayLifecycle.reportedWorkingSetMiB) {
  throw 'Real packaged tray/idle CPU/RAM or window lifecycle evidence missing.'
}
$measured.Add(('- Packaged tray idle 10s: **{0} CPU microseconds; {1} MiB working set**.' -f
  $tray.trayLifecycle.idleCpuMicrosOver10Seconds,$tray.trayLifecycle.reportedWorkingSetMiB))
$measured.Add('')
$measured.Add('The branded WPF Setup EXE, containing the NSIS x64 installation engine, was installed, reinstalled, self-tested, and uninstalled. Shortcuts, user-data retention, completed output and registration cleanup were checked.')
$measured.Add('The installed real-browser matrix and cross-version upgrade are separate from these checks. Cloud-provider compatibility is not certified here.')
foreach ($signature in $overall.signatures) {
  $measured.Add(('- Authenticode {0}: **{1}**.' -f $signature.file,$signature.status))
}
New-Item release-assets -ItemType Directory -Force | Out-Null
Get-ChildItem release-assets -File -ErrorAction SilentlyContinue | Remove-Item -Force
$measured | Set-Content 'release-assets/MEASURED_RESULTS.md'
Copy-Item 'dist/GetANNY Setup.exe' 'release-assets/GetANNY.Setup.exe'
if (Test-Path -LiteralPath 'dist/GetANNY Setup.exe.blockmap') {
  Copy-Item 'dist/GetANNY Setup.exe.blockmap' 'release-assets/GetANNY.Setup.exe.blockmap'
}
Copy-Item 'docs/INSTALL_WINDOWS.md' 'release-assets/INSTALL_WINDOWS.md'
Compress-Archive -Path test-results/windows/* -DestinationPath release-assets/Windows-test-evidence.zip -Force
node scripts/write-update-metadata.js release-assets
if ($LASTEXITCODE -ne 0) { throw 'Update metadata generation failed.' }
node scripts/checksums.js
if ($LASTEXITCODE -ne 0) { throw 'EXE checksum generation failed.' }
