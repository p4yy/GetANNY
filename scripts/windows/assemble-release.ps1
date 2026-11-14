# Fail-closed assembly from disposable Windows EXE verification only.
$ErrorActionPreference='Stop'
$evidenceRoot = 'test-results/windows'
$overall = Get-Content "$evidenceRoot/installer-report.json" -Raw | ConvertFrom-Json
if (-not $overall.passed) { throw 'Cannot assemble an installer from failed EXE evidence.' }
if ($overall.installer -ne 'NSIS x64 Setup EXE only') { throw 'Unexpected installer target.' }
if ($overall.browserExtensionTests -notmatch 'Skipped per owner request') { throw 'Browser-test scope was not recorded.' }
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
$measured = [System.Collections.Generic.List[string]]::new()
$measured.Add('# GetANNY 2.6.0 - measured NSIS Setup EXE checks')
$measured.Add('')
$measured.Add(('Desktop source tests: **{0} passed, 0 failed, 0 skipped**.' -f $cases))
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
$measured.Add('The real NSIS EXE was installed, reinstalled, self-tested, and uninstalled. Shortcuts, user-data retention, completed output and registration cleanup were checked.')
$measured.Add('Browser extension tests were intentionally skipped at owner request. They are not part of this EXE verification.')
$measured.Add('Unsigned owner-test build only; not a public release or live cloud-provider certification.')
foreach ($signature in $overall.signatures) {
  $measured.Add(('- Authenticode {0}: **{1}**.' -f $signature.file,$signature.status))
}
New-Item release-assets -ItemType Directory -Force | Out-Null
Get-ChildItem release-assets -File -ErrorAction SilentlyContinue | Remove-Item -Force
$measured | Set-Content 'release-assets/MEASURED_RESULTS.md'
Copy-Item 'dist/GetANNY Setup.exe' 'release-assets/GetANNY Setup.exe'
Copy-Item 'docs/INSTALL_WINDOWS.md' 'release-assets/INSTALL_WINDOWS.md'
Compress-Archive -Path test-results/windows/* -DestinationPath release-assets/Windows-test-evidence.zip -Force
node scripts/checksums.js
if ($LASTEXITCODE -ne 0) { throw 'EXE checksum generation failed.' }
