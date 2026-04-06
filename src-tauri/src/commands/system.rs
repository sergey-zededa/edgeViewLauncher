// System integration commands.
//
// Replaces:
//   - ipcMain.handle('open-external', ...)
//   - ipcMain.handle('open-external-terminal', ...)
//   - ipcMain.handle('get-system-time-format', ...)
//   - ipcMain.handle('get-electron-app-info', ...)

use tauri_plugin_opener::OpenerExt;
use tauri::AppHandle;

/// Open a URL in the system default browser.
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<bool, String> {
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open URL: {e}"))?;
    Ok(true)
}

/// Open an external terminal emulator and run a command.
///
/// macOS : Terminal.app via AppleScript
/// Windows: cmd.exe /k
/// Linux  : gnome-terminal, xterm fallback
#[tauri::command]
pub async fn open_external_terminal(app: AppHandle, command: String) -> Result<bool, String> {
    use tauri_plugin_shell::ShellExt;

    #[cfg(target_os = "macos")]
    {
        let escaped = command.replace('"', r#"\""#);
        let script = format!(
            r#"tell application "Terminal" to do script "{}" activate"#,
            escaped
        );
        app.shell()
            .command("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("AppleScript failed: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        app.shell()
            .command("cmd.exe")
            .args(["/c", "start", "cmd.exe", "/k", &command])
            .spawn()
            .map_err(|e| format!("cmd.exe failed: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try gnome-terminal first, fall back to xterm
        let _ = app
            .shell()
            .command("gnome-terminal")
            .args(["--", "bash", "-c", &format!("{command}; exec bash")])
            .spawn()
            .or_else(|_| {
                app.shell()
                    .command("xterm")
                    .args(["-e", &format!("{command}; exec bash")])
                    .spawn()
            })
            .map_err(|e| format!("Terminal open failed: {e}"))?;
    }

    Ok(true)
}

/// Detect whether the system uses 24-hour time format.
/// Returns true for 24-hour, false for 12-hour, null on failure.
#[tauri::command]
pub async fn get_system_time_format() -> Option<bool> {
    detect_24h()
}

fn detect_24h() -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // 1. Check AppleICUForce24HourTime
        if let Ok(out) = Command::new("defaults")
            .args(["read", "-g", "AppleICUForce24HourTime"])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            match s.as_str() {
                "1" | "true" => return Some(true),
                "0" | "false" => return Some(false),
                _ => {}
            }
        }

        // 2. Check AppleTimeFormat
        if let Ok(out) = Command::new("defaults")
            .args(["read", "-g", "AppleTimeFormat"])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout).to_string();
            if s.contains('H') || s.contains('k') {
                return Some(true);
            }
            if s.contains('h') || s.contains('K') {
                return Some(false);
            }
        }

        None
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if let Ok(out) = Command::new("reg")
            .args(["query", r#"HKCU\Control Panel\International"#, "/v", "sShortTime"])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout).to_string();
            if s.contains('H') {
                return Some(true);
            }
            if s.contains('h') {
                return Some(false);
            }
        }
        None
    }

    #[cfg(target_os = "linux")]
    {
        None // Rely on JS Intl API fallback
    }
}

/// Return the app version and build metadata.
#[tauri::command]
pub fn get_app_version(app: AppHandle) -> serde_json::Value {
    let version = app.package_info().version.to_string();
    serde_json::json!({
        "version": version,
        "buildNumber": option_env!("BUILD_NUMBER").unwrap_or("dev"),
        "buildDate": option_env!("BUILD_DATE"),
        "gitCommit": option_env!("GIT_COMMIT"),
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::detect_24h;

    #[test]
    fn detect_24h_returns_bool_or_none() {
        // On any CI runner this should not panic; it may return None
        let result = detect_24h();
        assert!(matches!(result, Some(true) | Some(false) | None));
    }
}
