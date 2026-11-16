; Only native-host manifests and extension files are prepared. Browser security
; and consent are not bypassed: no policies, profile edits or silent add-on installs.

!include "FileFunc.nsh"
!include "WinMessages.nsh"
!define GETANNY_SHELL_UNINSTALLER "GetANNY Uninstall.exe"
!macro customInstall
  ; Only the installed NSIS Setup EXE participates in the GitHub updater.
  ; MSI, portable and Store installs intentionally have no marker.
  FileOpen $0 "$INSTDIR\resources\getanny-github-updates" w
  FileWrite $0 "nsis-github"
  FileClose $0

  ; electron-builder has no Start Menu equivalent for its desktop shortcut flag.
  ; The WPF shell passes this when Start Menu creation was unticked.
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--no-start-menu-shortcut" $R1
  ${IfNot} ${Errors}
    DetailPrint "Start Menu shortcut not requested; removing $newStartMenuLink"
    WinShell::UninstShortcut "$newStartMenuLink"
    Delete "$newStartMenuLink"
    !ifdef MENU_FILENAME
      RMDir "$SMPROGRAMS\${MENU_FILENAME}"
    !endif
  ${EndIf}

  ; Keep NSIS as the uninstall engine while presenting the WPF UI through ARP.
  ; The same registry entry is rewritten; no second entry is created.
  ${If} ${FileExists} "$INSTDIR\${GETANNY_SHELL_UNINSTALLER}"
    ${If} $installMode == "CurrentUser"
      StrCpy $R2 "/currentuser"
    ${Else}
      StrCpy $R2 "/allusers"
    ${EndIf}
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString" '"$INSTDIR\${GETANNY_SHELL_UNINSTALLER}" $R2'
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString" '"$INSTDIR\${GETANNY_SHELL_UNINSTALLER}" $R2 /S'
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "GetANNYShellUninstaller" "$INSTDIR\${GETANNY_SHELL_UNINSTALLER}"
    DetailPrint "Registered GetANNY Uninstall.exe for Add/Remove Programs"
  ${EndIf}
  DetailPrint "Provisioning GetANNY's secure local browser bridge for this user..."
  ; The helper is standalone: it never starts the download database/server and
  ; provisions every supported browser, including browsers installed later.
  ExecWait '"$INSTDIR\GetANNY.exe" --setup-browser-hosts --quiet' $0
  ${If} $0 != 0
    DetailPrint "Browser bridge provisioning failed; GetANNY will retry on first launch and show diagnostics in Browser integration."
  ${EndIf}
!macroend
!macro customUnInstall
  ${IfNot} ${isUpdated}
    ; The interactive WPF uninstaller already handled this as a visible stage.
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--hosts-unregistered" $R1
    ${If} ${Errors}
      DetailPrint "Removing GetANNY native messaging registrations for this user..."
      ExecWait '"$INSTDIR\GetANNY.exe" --unregister-browser-hosts --quiet' $0
      ${If} $0 != 0
        DetailPrint "Some browser bridge files were locked. Close browsers to remove remaining files."
      ${EndIf}
    ${Else}
      DetailPrint "Native messaging registrations were already removed by GetANNY Uninstall."
    ${EndIf}
  ${EndIf}
!macroend
