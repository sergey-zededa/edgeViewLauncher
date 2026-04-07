; Custom NSIS hooks for EdgeView Launcher installer
; Kill lingering processes and set the install path to match the old Electron app.
; No need to run uninstallers — NSIS overwrites existing files during upgrade.

!macro NSIS_HOOK_PREINSTALL
  ; Kill the Go sidecar backend if still running
  nsExec::Exec 'taskkill /F /IM "edgeview-backend.exe"'
  ; Kill any running EdgeView Launcher instances (both Electron and Tauri)
  nsExec::Exec 'taskkill /F /IM "EdgeView Launcher.exe"'
  nsExec::Exec 'taskkill /F /IM "edgeview-launcher.exe"'

  ; Match the old Electron install path so the upgrade is seamless
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\edgeview-launcher"
!macroend
