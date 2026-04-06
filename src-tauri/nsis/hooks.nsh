; Custom NSIS hooks for EdgeView Launcher installer
; Kill lingering processes and remove the old Electron installation

!macro NSIS_HOOK_PREINSTALL
  ; Kill the Go sidecar backend if still running
  nsExec::Exec 'taskkill /F /IM "edgeview-backend.exe"'
  ; Kill any running EdgeView Launcher instances (both Electron and Tauri)
  nsExec::Exec 'taskkill /F /IM "EdgeView Launcher.exe"'

  ; Remove the old Electron installation if it exists
  IfFileExists "$LOCALAPPDATA\Programs\edgeview-launcher\Uninstall EdgeView Launcher.exe" 0 +2
    nsExec::Exec '"$LOCALAPPDATA\Programs\edgeview-launcher\Uninstall EdgeView Launcher.exe" /S'
!macroend
