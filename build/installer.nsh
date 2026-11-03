; Sojourner NSIS customisation, included through electron-builder `nsis.include`.
;
; LEGACY: Job Ranger, and Sojourner before the rename (2026-11-02), were installed with
; appId com.jobranger.app. electron-builder names an install's registry keys after the
; UUID v5 of its appId, so that install lives under the GUID below
; (tests/nsis-legacy-uninstall.test.cjs recomputes it from app-builder-lib). Sojourner
; now uses appId com.mythologiq.sojourner, so electron-builder's own old-version removal
; would not see the legacy install and the user would end up with two apps.
;
; customInit runs before anything is installed: it looks the legacy install up under
; HKCU, then HKLM, and runs its uninstaller silently with `--updated` (the electron-builder
; flag that keeps app data) and `_?=<install dir>` so ExecWait really waits, exactly as
; electron-builder's uninstallOldVersion does for an update. User data is never deleted:
; the data folder is copied to %APPDATA%\Sojourner at first start
; (electron/src/legacy-migration.cts) and deleteAppDataOnUninstall stays false.

!include LogicLib.nsh

!define SOJOURNER_LEGACY_APP_GUID "96a4dbef-49fd-52cb-bf74-9cfc92808aa6"
!define SOJOURNER_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SOJOURNER_LEGACY_APP_GUID}"
!define SOJOURNER_LEGACY_INSTALL_KEY "Software\${SOJOURNER_LEGACY_APP_GUID}"

; Removes the legacy install registered under ROOT_KEY (HKCU or HKLM), if there is one.
; SCOPE_FLAG is the uninstaller's install-mode switch (/currentuser or /allusers).
!macro sojournerRemoveLegacyInstall ROOT_KEY SCOPE_FLAG
  ReadRegStr $R0 ${ROOT_KEY} "${SOJOURNER_LEGACY_UNINSTALL_KEY}" "QuietUninstallString"
  ${If} $R0 == ""
    ReadRegStr $R0 ${ROOT_KEY} "${SOJOURNER_LEGACY_UNINSTALL_KEY}" "UninstallString"
  ${EndIf}
  ${If} $R0 != ""
    ; The uninstaller path is the first token: "C:\...\Uninstall Job Ranger.exe" /currentuser /S
    StrCpy $R1 $R0 1
    ${If} $R1 == '"'
      StrCpy $R3 1
      ${Do}
        StrCpy $R1 $R0 1 $R3
        ${If} $R1 == '"'
        ${OrIf} $R1 == ""
          ${ExitDo}
        ${EndIf}
        IntOp $R3 $R3 + 1
      ${Loop}
      IntOp $R3 $R3 - 1
      StrCpy $R2 $R0 $R3 1
    ${Else}
      StrCpy $R2 $R0
    ${EndIf}

    ReadRegStr $R4 ${ROOT_KEY} "${SOJOURNER_LEGACY_INSTALL_KEY}" "InstallLocation"
    ${If} $R4 == ""
      ${StdUtils.GetParentPath} $R4 "$R2"
    ${EndIf}

    ${If} ${FileExists} "$R2"
      DetailPrint "Removing the earlier Job Ranger installation in $R4 (your data is kept)."
      InitPluginsDir
      ClearErrors
      CopyFiles /SILENT "$R2" "$PLUGINSDIR\sojourner-legacy-uninstaller.exe"
      ${If} ${Errors}
        StrCpy $R5 "$R2"
      ${Else}
        StrCpy $R5 "$PLUGINSDIR\sojourner-legacy-uninstaller.exe"
      ${EndIf}
      ClearErrors
      ExecWait '"$R5" /S /KEEP_APP_DATA ${SCOPE_FLAG} --updated _?=$R4' $R6
      ${If} ${Errors}
      ${OrIf} $R6 != 0
        ; Never block the install: the earlier app stays listed and can be removed by hand.
        DetailPrint "The earlier Job Ranger installation could not be removed automatically (exit $R6)."
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  !insertmacro sojournerRemoveLegacyInstall HKCU "/currentuser"
  !insertmacro sojournerRemoveLegacyInstall HKLM "/allusers"
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
