; Custom NSIS hooks for EdgeView Launcher installer
; Kill lingering processes and set the install path to match the old Electron app.
; No need to run uninstallers — NSIS overwrites existing files during upgrade.

!macro NSIS_HOOK_PREINSTALL
  ; Kill the Go sidecar backend if still running
  nsExec::Exec 'taskkill /F /IM "edgeview-backend.exe"'
  ; Kill any running EdgeView Launcher instances (both Electron and Tauri)
  nsExec::Exec 'taskkill /F /IM "EdgeView Launcher.exe"'
  nsExec::Exec 'taskkill /F /IM "edgeview-launcher.exe"'

  ; Match the old Electron install path so the upgrade is seamless.
  ; SetOutPath must be re-issued because Tauri's NSIS template ran
  ; `SetOutPath $INSTDIR` immediately before this hook (see installer.nsi:
  ; "SetOutPath $INSTDIR" right above "!insertmacro NSIS_HOOK_PREINSTALL").
  ; That call captured the previous $INSTDIR as the file-extraction target;
  ; updating $INSTDIR alone leaves files going to the old path while
  ; shortcuts / uninstaller / registry use the new one — producing a
  ; broken Start Menu shortcut on fresh installs.
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\edgeview-launcher"
  SetOutPath $INSTDIR
!macroend
