# Test-only UI automation for Chrome's NORMAL "Load unpacked" folder dialog.
# Only the disposable browser profile launched by test-extension.js is targeted.
# No policy/registry/profile/signing changes; never used by the application.
param([Parameter(Mandatory=$true)][int]$BrowserPid,[Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath (Join-Path $Directory 'manifest.json'))){throw 'Prepared extension manifest missing.'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GetANNYTestForeground {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$automation=[System.Windows.Automation.AutomationElement]
# Current Chrome can host its folder dialog below the browser UI tree or in a
# browser-owned utility process. Never target an unrelated process/window.
$allowed=[System.Collections.Generic.HashSet[int]]::new()
$allowed.Add($BrowserPid) | Out-Null
$windowCondition=[System.Windows.Automation.PropertyCondition]::new($automation::ControlTypeProperty,[System.Windows.Automation.ControlType]::Window)
$deadline=(Get-Date).AddSeconds(25)
$dialog=$null
$seen=@()
while((Get-Date) -lt $deadline) {
  $processes=Get-CimInstance Win32_Process
  do {
    $changed=$false
    foreach($process in $processes) {
      if($allowed.Contains([int]$process.ParentProcessId) -and $allowed.Add([int]$process.ProcessId)){$changed=$true}
    }
  }while($changed)
  $windows=$automation::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,$windowCondition)
  $seen=@()
  foreach($window in $windows) {
    if(-not $allowed.Contains($window.Current.ProcessId)){continue}
    $seen+=@{pid=$window.Current.ProcessId;name=$window.Current.Name;class=$window.Current.ClassName}
    if($window.Current.ClassName -eq '#32770' -or $window.Current.Name -match 'Select.*extension.*directory'){$dialog=$window;break}
  }
  if($dialog){break}
  Start-Sleep -Milliseconds 150
}
if(-not $dialog){throw ('Chrome folder dialog unavailable. Actual browser-owned windows: '+($seen | ConvertTo-Json -Compress))}
# Do not type a filesystem path until a browser-owned *actual file dialog*
# and its address field are both verified. SetForegroundWindow can return true
# even when Windows delays activating the window.
$dialogHandle=[IntPtr]$dialog.Current.NativeWindowHandle
if(-not [GetANNYTestForeground]::SetForegroundWindow($dialogHandle)){throw 'Chrome folder dialog could not be brought to the foreground.'}
$address=$null
$focusDiagnostics=@()
for($attempt=0;$attempt -lt 6;$attempt++){
  if([GetANNYTestForeground]::GetForegroundWindow() -ne $dialogHandle){
    [GetANNYTestForeground]::SetForegroundWindow($dialogHandle) | Out-Null
    Start-Sleep -Milliseconds 150
    continue
  }
  # Some Windows common dialogs expose an editable ComboBox rather than
  # immediately focusing its child Edit. Never accept an unrelated control.
  try{$dialog.SetFocus()}catch{}
  Start-Sleep -Milliseconds 150
  # Windows 11 may leave Alt+D/Ctrl+L focused on the Documents pane.
  # The normal native "File name" keyboard mnemonic Alt+N is a final,
  # explicitly scoped fallback. Never send a filesystem path until the
  # resulting Edit is proved to belong to this Chrome-owned dialog.
  $focusKey = if($attempt -ge 4){'%n'}elseif($attempt % 2 -eq 0){'%d'}else{'^l'}
  [System.Windows.Forms.SendKeys]::SendWait($focusKey)
  Start-Sleep -Milliseconds 200
  $focused=$automation::FocusedElement
  if(-not $focused){continue}
  $candidate=$focused
  if($candidate.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox){
    $candidate=$candidate.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new($automation::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit))
  }
  $focusDiagnostics+=@{pid=$focused.Current.ProcessId;name=$focused.Current.Name;type=$focused.Current.ControlType.ProgrammaticName}
  if(-not $candidate -or $candidate.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit){continue}
  if(-not $allowed.Contains([int]$candidate.Current.ProcessId)){continue}
  # Prove the focused address edit belongs to the selected file dialog,
  # not just some other window in the same Chromium process.
  $dialogRuntimeId=($dialog.GetRuntimeId() -join ',')
  $walk=$candidate
  $isDialogChild=$false
  while($walk){
    if(($walk.GetRuntimeId() -join ',') -eq $dialogRuntimeId){$isDialogChild=$true;break}
    $walk=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($walk)
  }
  if($isDialogChild){$address=$candidate;break}
}
# On newer Windows 11 builds Alt+D/Ctrl+L sometimes leave keyboard focus on
# the Documents pane. Direct UI Automation can locate the *address-specific*
# editable child without typing anywhere. Never use the generic File name edit.
if(-not $address){
  $edits=$dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new($automation::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit))
  foreach($edit in $edits){
    if(-not $allowed.Contains([int]$edit.Current.ProcessId)){continue}
    $node=$edit
    $verifiedAddress=$false
    $underDialog=$false
    while($node){
      if($node.Current.Name -match '^(Address|Location)(:|$)' -or $node.Current.AutomationId -eq '41477'){$verifiedAddress=$true}
      if(($node.GetRuntimeId() -join ',') -eq ($dialog.GetRuntimeId() -join ',')){$underDialog=$true;break}
      $node=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($node)
    }
    if(-not $verifiedAddress -or -not $underDialog){continue}
    try{$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) | Out-Null}catch{continue}
    $address=$edit
    break
  }
}
# Common Windows 11 file dialogs often expose the dedicated Folder/File-name
# control as UIA ID 1148 instead of an Alt+D address edit. Microsoft's Windows
# UI Automation documentation recommends 1148 for native file dialog input.
# Accept that exact ID only within the verified, browser-owned dialog.
# Never type keyboard input into a generic Documents pane or unknown control.
$folderPathEdit=$null
if(-not $address){
  $edits=$dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new($automation::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit))
  foreach($edit in $edits){
    if(-not $allowed.Contains([int]$edit.Current.ProcessId)){continue}
    $node=$edit
    $is1148=$false
    $underDialog=$false
    while($node){
      if($node.Current.AutomationId -eq '1148'){$is1148=$true}
      if(($node.GetRuntimeId() -join ',') -eq ($dialog.GetRuntimeId() -join ',')){$underDialog=$true;break}
      $node=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($node)
    }
    if(-not $is1148 -or -not $underDialog){continue}
    try{$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) | Out-Null}catch{continue}
    if($folderPathEdit){throw 'More than one eligible 1148 folder input found; refusing ambiguous selection.'}
    $folderPathEdit=$edit
  }
}
if($folderPathEdit){
  if([GetANNYTestForeground]::GetForegroundWindow() -ne $dialogHandle){throw 'Chrome folder dialog lost foreground before verified folder input.'}
  $select=$dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty,'1'))
  if(-not $select -or $select.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button){throw 'Browser-owned folder selection button missing.'}
  if($select.Current.Name -notmatch 'Select|Choose|Open'){throw ('Unexpected folder chooser button: '+$select.Current.Name)}
  $folderPathEdit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Directory)
  # UIA Invoke targets exactly the verified dialog button; do not SendKeys
  # because Windows may have focused the underlying Documents pane.
  $select.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Write-Output 'Selected extension folder using verified UIA control 1148 in Chrome dialog.'
  return
}
if(-not $address){throw ('Folder-dialog address field is not focused; refusing to send a path to another window. Focus: '+($focusDiagnostics | ConvertTo-Json -Compress))}
# Confirm foreground ownership before Enter; programmatic edits alone never
# authorize sending a keystroke to another application.
if([GetANNYTestForeground]::GetForegroundWindow() -ne $dialogHandle){throw 'Folder dialog lost foreground before path selection.'}
$address.SetFocus()
Start-Sleep -Milliseconds 150
$focusedForEnter=$automation::FocusedElement
if(-not $focusedForEnter -or ($focusedForEnter.GetRuntimeId() -join ',') -ne ($address.GetRuntimeId() -join ',')){throw 'Address edit did not take focus; refusing to send Enter.'}
$value=$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$value.SetValue($Directory)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 250
$select=$dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty,'1'))
if(-not $select -or $select.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button){throw 'Folder-dialog selection button missing.'}
$select.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Write-Output 'Selected the prepared extension using the actual browser folder dialog.'
