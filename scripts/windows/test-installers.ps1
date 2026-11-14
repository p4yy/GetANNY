$ErrorActionPreference = 'Stop'
trap {
  if($results -and (Test-Path $results)) {
    @{passed=$false;date=(Get-Date -Format o);error=$_.Exception.Message;script=$_.ScriptStackTrace} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $results 'installer-fatal.json')
  }
  throw $_
}
if($env:CI -ne 'true' -or -not $env:RUNNER_TEMP){throw 'Installer tests modify the default app profile and require a disposable Windows CI account.'}
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$results = Join-Path $root 'test-results\windows'
$installRoot = Join-Path $env:RUNNER_TEMP 'GetANNYInstallerTests'
New-Item $results -ItemType Directory -Force | Out-Null
New-Item $installRoot -ItemType Directory -Force | Out-Null
$exePackage = Join-Path $root 'dist\GetANNY Setup.exe'
function Run-Checked([string] $File, [string[]] $Arguments, [int] $Timeout = 420000, [switch] $CaptureOutput) {
  $started = Get-Date
  "START $($started.ToString('o')) PID-pending $File $($Arguments -join ' ')" | Add-Content (Join-Path $results 'processes.log')
  $start = @{FilePath=$File;ArgumentList=$Arguments;PassThru=$true}
  if ($CaptureOutput) {
    $prefix = 'process-' + [guid]::NewGuid().ToString('N')
    $start.RedirectStandardOutput = Join-Path $results "$prefix.stdout.log"
    $start.RedirectStandardError = Join-Path $results "$prefix.stderr.log"
  }
  $p = Start-Process @start
  "STARTED $($started.ToString('o')) PID=$($p.Id) $File" | Add-Content (Join-Path $results 'processes.log')
  if (-not $p.WaitForExit($Timeout)) {
    $processInfo = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -eq $p.Id -or $_.ParentProcessId -eq $p.Id -or $_.Name -in @('GetANNY.exe','GetANNY Setup.exe')
    } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)
    $files = @()
    if (Test-Path $installRoot) {
      $files = @(Get-ChildItem $installRoot -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime)
    }
    @{passed=$false;date=(Get-Date -Format o);file=$File;arguments=$Arguments;timeoutMs=$Timeout;processes=$processInfo;installFiles=$files} | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $results 'process-timeout.json')
    & taskkill.exe /PID $p.Id /T /F 2>&1 | Add-Content (Join-Path $results 'processes.log')
    throw "Timed out: $File. See process-timeout.json and processes.log"
  }
  "EXIT $((Get-Date).ToString('o')) PID=$($p.Id) code=$($p.ExitCode) elapsedMs=$([int]((Get-Date)-$started).TotalMilliseconds)" | Add-Content (Join-Path $results 'processes.log')
  if ($p.ExitCode -notin @(0, 3010)) { throw "$File exited $($p.ExitCode)" }
}
function Self-Test([string] $InstalledExe, [string] $Name, [string] $Data, [switch] $Tray) {
  if (-not (Test-Path $InstalledExe)) { throw "Installed application missing: $InstalledExe" }
  $report = Join-Path $results "$Name.json"
  $arguments = @('--self-test','--exe-only-test')
  if ($Tray) { $arguments += '--tray-self-test' }
  $arguments += @('--test-user-data',"`"$Data`"",'--report',"`"$report`"")
  Run-Checked $InstalledExe $arguments
  $result = Get-Content $report -Raw | ConvertFrom-Json
  if (-not $result.passed -or -not $result.packaged -or $result.platform -ne 'win32') { throw "Installed-app self-test failed: $report" }
  if ($Tray) {
    $idle = $result.trayLifecycle
    if (-not $idle -or -not $idle.passed -or -not $idle.rendererReleased -or -not $idle.bridgeStayedAvailable -or -not $idle.browserRequestWokeWindow) {
      throw "Installed tray lifecycle failed. Inspect $report"
    }
    if ($null -eq $idle.idleCpuMicrosOver10Seconds -or $null -eq $idle.reportedWorkingSetMiB) {
      throw "Packaged tray test omitted measured idle CPU or RAM. Inspect $report"
    }
    Write-Host ("::notice title=Packaged tray idle::{0} MiB working set; {1} CPU microseconds over 10s; under 50 MiB={2}" -f $idle.reportedWorkingSetMiB,$idle.idleCpuMicrosOver10Seconds,$idle.under50MB)
  }
  Write-Host ("::notice title=Installed app {0}::{1} actual packaged Windows checks passed" -f $Name,$result.checks.Count)
  foreach ($check in $result.checks) {
    Write-Host "PASS $Name : $($check.name)"
    if ($check.name -eq 'Rendered layouts at 1320, 1024 and 760 pixel windows') {
      foreach ($screenshot in $check.detail) { Copy-Item $screenshot (Join-Path $results "$Name-$(Split-Path $screenshot -Leaf)") }
    }
  }
}
function Assert-Shortcuts([string] $InstalledExe) {
  $shell = New-Object -ComObject WScript.Shell
  $found = [System.Collections.Generic.List[object]]::new()
  try {
    foreach ($location in @(
      @{kind='desktop';path=[Environment]::GetFolderPath('DesktopDirectory')},
      @{kind='desktop';path=[Environment]::GetFolderPath('CommonDesktopDirectory')},
      @{kind='startMenu';path=[Environment]::GetFolderPath('Programs')},
      @{kind='startMenu';path=[Environment]::GetFolderPath('CommonPrograms')}
    )) {
      if (-not $location.path -or -not (Test-Path $location.path)) { continue }
      foreach ($file in Get-ChildItem $location.path -Filter '*GetANNY*.lnk' -File -Recurse -ErrorAction SilentlyContinue) {
        $link=$shell.CreateShortcut($file.FullName)
        try { if ($link.TargetPath -ieq $InstalledExe) { $found.Add(@{kind=$location.kind;path=$file.FullName;target=$link.TargetPath}) } }
        finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null }
      }
    }
  } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null }
  if (-not ($found | Where-Object kind -eq 'desktop')) { throw 'Default desktop shortcut missing or targets the wrong application.' }
  if (-not ($found | Where-Object kind -eq 'startMenu')) { throw 'Start Menu shortcut missing or targets the wrong application.' }
  return $found.ToArray()
}
function Desktop-Lifecycle([string] $InstalledExe, [string] $Name, [string] $Data, $Shortcuts) {
  $desktop=$Shortcuts | Where-Object kind -eq 'desktop' | Select-Object -First 1
  $startMenu=$Shortcuts | Where-Object kind -eq 'startMenu' | Select-Object -First 1
  & node "$PSScriptRoot\test-desktop-lifecycle.js" $InstalledExe $Data (Join-Path $results "$Name-desktop-lifecycle.json") $desktop.path $startMenu.path
  if($LASTEXITCODE -ne 0){throw 'Installed cold native / actual shell shortcut lifecycle test failed.'}
  Write-Host ("::notice title=Desktop lifecycle {0}::Compiled-native cold launch, real output hash, no resurrection and both actual shell shortcut launches passed" -f $Name)
}
function Profile-Snapshot([string] $Data) {
  $json=& node "$PSScriptRoot\snapshot-profile.js" (Join-Path $Data 'getanny.db')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read real default-profile retention snapshot.' }
  return ($json | ConvertFrom-Json)
}
function Owned-NativeEntries([string] $Data) {
  $found=[System.Collections.Generic.List[object]]::new()
  $missing=[System.Collections.Generic.List[string]]::new()
  $vendors=@('Google\Chrome','Chromium','Mozilla','Vivaldi','Microsoft\Edge','BraveSoftware\Brave-Browser','Opera Software\Opera Stable','Perplexity\Comet')
  foreach($vendor in $vendors) {
    $key="HKCU\Software\$vendor\NativeMessagingHosts\com.getanny.native"
    foreach($view in @('64','32')) {
      $output=& reg.exe query $key /ve "/reg:$view" 2>$null
      if($LASTEXITCODE -ne 0){
        $missing.Add("$vendor ($view-bit): absent") | Out-Null
        continue
      }
      $text=($output -join "`n")
      if($text -match [regex]::Escape("$Data\GetANNY Browser Bridge\")) {
        $value=([regex]::Match($text,'REG_SZ\s+(.+)$',[Text.RegularExpressions.RegexOptions]::Multiline)).Groups[1].Value.Trim()
        $found.Add(@{key=$key;view=$view;value=$value})
      }else{
        $missing.Add("$vendor ($view-bit): owned by another user-data profile") | Out-Null
      }
    }
  }
  $expected=$vendors.Count * 2
  if($found.Count -ne $expected){
    throw "Expected $expected owned native registrations across both registry views; found $($found.Count). Missing or overwritten: $($missing -join '; ')"
  }
  return $found.ToArray()
}
function Wait-ProductRemoved([string] $InstalledExe, [string] $UninstallerPath, $Shortcuts, [int] $Timeout = 90000) {
  $started=Get-Date
  # The NSIS uninstaller can remove the executable before its shell links.
  # Wait for BOTH the actual product files and all links created by this
  # installation, rather than racing shortcut cleanup after EXE deletion.
  while((Test-Path -LiteralPath $InstalledExe) -or
        (Test-Path -LiteralPath $UninstallerPath) -or
        (@($Shortcuts | Where-Object { Test-Path -LiteralPath $_.path }).Count -gt 0)) {
    if(((Get-Date)-$started).TotalMilliseconds -ge $Timeout) {
      $installDirectory=Split-Path $InstalledExe -Parent
      $processes=@(Get-CimInstance Win32_Process | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($installDirectory,[StringComparison]::OrdinalIgnoreCase)) -or
        ($_.CommandLine -and $_.CommandLine.Contains($installDirectory,[StringComparison]::OrdinalIgnoreCase)) -or
        $_.Name -like '*GetANNY*'
      } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)
      $files=@(Get-ChildItem $installDirectory -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime)
      $links=@($Shortcuts | Where-Object { Test-Path -LiteralPath $_.path } | ForEach-Object { $_.path })
      @{passed=$false;date=(Get-Date -Format o);timeoutMs=$Timeout;installedExe=$InstalledExe;uninstaller=$UninstallerPath;remainingShortcuts=$links;processes=$processes;remainingFiles=$files} | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $results 'exe-uninstall-timeout.json')
      throw "EXE uninstallation did not remove all product files and shortcuts within $Timeout ms. See exe-uninstall-timeout.json."
    }
    Start-Sleep -Milliseconds 250
  }
  "REMOVED $((Get-Date).ToString('o')) exe=$InstalledExe elapsedMs=$([int]((Get-Date)-$started).TotalMilliseconds)" | Add-Content (Join-Path $results 'processes.log')
}
function Assert-Uninstalled([string] $InstalledExe, $Shortcuts, [string] $Data, $Before, $NativeEntries) {
  $bridgeReport=Join-Path $Data 'browser-uninstall-report.json'
  if(Test-Path $bridgeReport){Copy-Item $bridgeReport (Join-Path $results ((Split-Path (Split-Path $InstalledExe -Parent) -Leaf)+'-uninstall-bridge.json'))}
  if (Test-Path $InstalledExe) { throw 'Uninstallation left the application executable.' }
  foreach ($link in $Shortcuts) { if (Test-Path $link.path) { throw "Uninstallation left shortcut $($link.path)" } }
  foreach($directory in @('GetANNY Browser Bridge','native-messaging','extensions')) {if(Test-Path (Join-Path $Data $directory)){throw "Uninstall left owned prepared directory $directory"}}
  $after=Profile-Snapshot $Data
  foreach($entry in $NativeEntries) {
    $output=& reg.exe query $entry.key /ve "/reg:$($entry.view)" 2>$null
    if($LASTEXITCODE -eq 0 -and (($output -join "`n") -match [regex]::Escape($entry.value))) {
      throw "Owned native registry entry survived uninstall: $($entry.key) ($($entry.view)-bit view)"
    }
  }
  if($after.missingCompletedFiles -gt $Before.missingCompletedFiles) {throw 'Uninstallation removed a real completed output from the default profile.'}
  if ($after.history -lt 1 -or $Before.sha256 -cne $after.sha256) { throw 'Uninstallation changed or removed actual default-profile history/settings.' }
  return @{history=$after.history;settings=$after.settings;sha256=$after.sha256;retained=$true;missingCompletedFiles=$after.missingCompletedFiles;ownedNativeEntries=$NativeEntries.Count;nativeCleanupVerified=($NativeEntries.Count -gt 0)}
}
if (-not (Test-Path $exePackage)) { throw 'Required NSIS GetANNY Setup.exe was not built.' }
$defaultData = Join-Path $env:APPDATA 'getanny'
$exeDir = Join-Path $installRoot 'exe-app'
$exeData = Join-Path $installRoot 'exe-data'
Write-Host 'Checking the unpacked browser-setup helper before NSIS installation...'
$setupReport = Join-Path $results 'setup-helper.json'
Run-Checked (Join-Path $root 'dist\win-unpacked\GetANNY.exe') @('--setup-browser-hosts','--quiet','--enable-logging','--report',"`"$setupReport`"") 90000 -CaptureOutput
Write-Host 'Installing the actual NSIS EXE package...'
Run-Checked $exePackage @('/S','/currentuser',"/D=$exeDir")
$installedExe = Join-Path $exeDir 'GetANNY.exe'
$exeShortcuts=@(Assert-Shortcuts $installedExe)
Self-Test $installedExe 'exe-first-install' $exeData
Write-Host 'Reinstalling EXE (upgrade / repair preservation test)...'
Run-Checked $exePackage @('/S','/currentuser',"/D=$exeDir")
Self-Test $installedExe 'exe-upgrade-restart' $exeData
$restart = Get-Content (Join-Path $results 'exe-upgrade-restart.json') -Raw | ConvertFrom-Json
if (-not ($restart.checks | Where-Object name -eq 'Persisted history, settings and actual process restart marker').detail.priorRunObserved) { throw 'EXE reinstall destroyed persisted data.' }
Self-Test $installedExe 'exe-actual-default-profile' $defaultData
# Exercise the real packaged tray on an isolated profile. Verify release of the
# renderer, real 10-second idle CPU/RAM readings, and authenticated bridge wake.
Self-Test $installedExe 'exe-tray-idle' (Join-Path $installRoot 'exe-tray-data') -Tray
Run-Checked $installedExe @('--setup-browser-hosts','--quiet')
Desktop-Lifecycle $installedExe 'exe' $defaultData $exeShortcuts
# Owner direction: no browser-extension or real-browser matrix tests.
# Keep installer-owned registration and uninstall-cleanup verification.
$nativeRestoreError=$null
$exeNativeEntries=@()
try {
  Run-Checked $installedExe @('--setup-browser-hosts','--quiet') 90000
  $exeNativeEntries=@(Owned-NativeEntries $defaultData)
  Write-Host "::notice title=Native registry owners::Verified $($exeNativeEntries.Count) native registrations owned by installed EXE."
}catch{
  $nativeRestoreError=$_.Exception.Message
  Write-Warning "Native owner restore/verification failed. Continue real uninstall then fail: $nativeRestoreError"
}
$exeDefaultBefore=Profile-Snapshot $defaultData
$uninstaller = Get-ChildItem $exeDir -Filter '*Uninstall*.exe' | Select-Object -First 1
if (-not $uninstaller) { throw 'EXE uninstaller not found.' }
Run-Checked $uninstaller.FullName @('/S')
$exeCleanupError=$null;$exeDefaultRetained=$null
try {
  # NSIS first launches a temporary uninstaller and can return before that child
  # removes the product. Wait for the measured product state, not the stub PID.
  Wait-ProductRemoved $installedExe $uninstaller.FullName $exeShortcuts
  if (-not (Test-Path (Join-Path $exeData 'getanny.db'))) { throw 'Uninstaller destroyed isolated test history.' }
  $exeDefaultRetained=Assert-Uninstalled $installedExe $exeShortcuts $defaultData $exeDefaultBefore $exeNativeEntries
}
catch {$exeCleanupError=$_.Exception.Message;Write-Warning "EXE cleanup gate failed; preserve measured evidence: $exeCleanupError"}
$exeFilesRemoved=(-not(Test-Path $installedExe) -and -not(Test-Path $uninstaller.FullName))
@{passed=($null -eq $exeCleanupError);error=$exeCleanupError;exe=@{installed=$true;reinstalled=$true;uninstalled=($null -eq $exeCleanupError);applicationFilesRemoved=$exeFilesRemoved};defaultProfileRetention=@{exe=$exeDefaultRetained};shortcuts=@{exe=$exeShortcuts;createdAndTargetsVerified=$true;removedOnUninstall=($null -eq $exeCleanupError);shellLaunch='passed-in-exe-desktop-lifecycle.json'}} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $results 'exe-uninstall.json')
$signatures = @($exePackage) | ForEach-Object {
  $signature = Get-AuthenticodeSignature $_
  @{file=(Split-Path $_ -Leaf);status=$signature.Status.ToString()}
}
$verified = ($null -eq $exeCleanupError -and $null -eq $nativeRestoreError)
@{
  passed=$verified
  date=(Get-Date -Format o)
  exeCleanupError=$exeCleanupError
  browserExtensionTests='Skipped per owner request (tested on owner PC)'
  nativeRestoreError=$nativeRestoreError
  nativeEntriesVerified=$exeNativeEntries.Count
  installer='NSIS x64 Setup EXE only'
  sourceCommit=$env:GITHUB_SHA
  exe=@{installed=$true;reinstalled=$true;uninstalled=($null -eq $exeCleanupError);applicationFilesRemoved=$exeFilesRemoved}
  signatures=$signatures
  defaultProfileRetention=@{exe=$exeDefaultRetained}
  shortcuts=@{exe=$exeShortcuts;createdAndTargetsVerified=$true;removedOnUninstall=($null -eq $exeCleanupError);shellLaunch='passed-in-exe-desktop-lifecycle.json'}
  limitations=@(
    'Hosted Windows runner is not a pristine consumer Windows installation.',
    'Same-version reinstall tested; 2.5.0-to-2.6.0 migration remains a dedicated gate.',
    'Interactive installer, multiple DPI scales, notification and tray appearance need human validation.',
    'Browser extension tests skipped per owner request; cloud-provider flows not certified.',
    'Microsoft Store readiness remains separate.'
  )
} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $results 'installer-report.json')
if ($exeCleanupError) { throw "NSIS uninstall/retention gate failed: $exeCleanupError" }
if ($nativeRestoreError) { throw "NSIS native registration gate failed: $nativeRestoreError" }
Write-Host 'NSIS Setup EXE, actual transfers, tray idle, restart retention and uninstall passed. Browser extension tests skipped.'
exit 0
