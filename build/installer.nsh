; Sojourner NSIS customisation, included through electron-builder `nsis.include`.
;
; LEGACY: Job Ranger, and Sojourner before the rename (2026-11-02), were installed with
; appId com.jobranger.app. electron-builder names an install's registry keys after the
; UUID v5 of its appId, so that install lives under the GUID below
; (tests/nsis-legacy-uninstall.test.cjs recomputes it from app-builder-lib). Sojourner
; now uses appId com.mythologiq.sojourner, so electron-builder's own old-version removal
; would not see the legacy install and the user would end up with two apps.
;
; customInstall runs at the end of the install section, after the user chose to install
; and Sojourner's files, shortcuts and uninstall entry are in place; cancelling the wizard
; or a failed install therefore never removes the legacy app. It looks the legacy install
; up under HKCU, then HKLM, and runs its uninstaller silently with `--updated` (the
; electron-builder flag that keeps app data; deleteAppDataOnUninstall stays false) and
; `_?=<install dir>` so ExecWait really waits, retrying like electron-builder's
; uninstallOldVersion. User data is never deleted: the data folder is copied to
; %APPDATA%\Sojourner at first start (electron/src/legacy-migration.cts).
;
; A legacy install in the same folder as this one (a pre-rename Sojourner build) already
; had its files replaced by this install, so only its registration is removed. A legacy
; install whose shortcuts have this install's name keeps them (--keep-shortcuts).

!include LogicLib.nsh

!define SOJOURNER_LEGACY_APP_GUID "96a4dbef-49fd-52cb-bf74-9cfc92808aa6"
!define SOJOURNER_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SOJOURNER_LEGACY_APP_GUID}"
!define SOJOURNER_LEGACY_INSTALL_KEY "Software\${SOJOURNER_LEGACY_APP_GUID}"
!define SOJOURNER_LEGACY_UNINSTALL_ATTEMPTS 5

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

    ${If} $R4 == $INSTDIR
      ; Same folder: this install already replaced the legacy files; drop the legacy entry.
      DetailPrint "Removing the earlier registration of $R4."
      DeleteRegKey ${ROOT_KEY} "${SOJOURNER_LEGACY_UNINSTALL_KEY}"
      DeleteRegKey ${ROOT_KEY} "${SOJOURNER_LEGACY_INSTALL_KEY}"
    ${ElseIf} ${FileExists} "$R2"
      DetailPrint "Removing the earlier Job Ranger installation in $R4 (your data is kept)."
      StrCpy $R5 "/S /KEEP_APP_DATA ${SCOPE_FLAG} --updated"
      ReadRegStr $R1 ${ROOT_KEY} "${SOJOURNER_LEGACY_INSTALL_KEY}" "ShortcutName"
      ${If} $R1 == "${SHORTCUT_NAME}"
        StrCpy $R5 "$R5 --keep-shortcuts"
      ${EndIf}
      InitPluginsDir
      ClearErrors
      CopyFiles /SILENT "$R2" "$PLUGINSDIR\sojourner-legacy-uninstaller.exe"
      ${If} ${Errors}
        StrCpy $R1 "$R2"
      ${Else}
        StrCpy $R1 "$PLUGINSDIR\sojourner-legacy-uninstaller.exe"
      ${EndIf}
      StrCpy $R3 0
      ${Do}
        IntOp $R3 $R3 + 1
        ClearErrors
        ExecWait '"$R1" $R5 _?=$R4' $R6
        ${IfNot} ${Errors}
        ${AndIf} $R6 == 0
          ${ExitDo}
        ${EndIf}
        ${If} $R3 >= ${SOJOURNER_LEGACY_UNINSTALL_ATTEMPTS}
          ; Never fail the install: the earlier app stays listed and can be removed by hand.
          DetailPrint "The earlier Job Ranger installation could not be removed automatically (exit $R6)."
          ${ExitDo}
        ${EndIf}
        ; The legacy app may still be closing; electron-builder waits and retries the same way.
        Sleep 1000
      ${Loop}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
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
