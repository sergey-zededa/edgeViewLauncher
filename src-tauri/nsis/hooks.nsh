; Custom NSIS hooks for EdgeView Launcher installer
; Kill lingering processes, match the old Electron install path, and clean up

!macro NSIS_HOOK_PREINSTALL
  ; Kill the Go sidecar backend if still running
  nsExec::Exec 'taskkill /F /IM "edgeview-backend.exe"'
  ; Kill any running EdgeView Launcher instances (both Electron and Tauri)
  nsExec::Exec 'taskkill /F /IM "EdgeView Launcher.exe"'
  nsExec::Exec 'taskkill /F /IM "edgeview-launcher.exe"'

  ; Match the old Electron install path so the upgrade is seamless
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\edgeview-launcher"

  ; Remove the old Electron uninstaller if it exists
  IfFileExists "$INSTDIR\Uninstall EdgeView Launcher.exe" 0 +2
    nsExec::Exec '"$INSTDIR\Uninstall EdgeView Launcher.exe" /S'

  ; Remove a previous Tauri NSIS uninstaller if it exists
  ; /UPDATE tells it to run silently in update mode (no "Unable to uninstall!" dialog)
  IfFileExists "$INSTDIR\uninstall.exe" 0 +2
    nsExec::Exec '"$INSTDIR\uninstall.exe" /UPDATE'
!macroend
