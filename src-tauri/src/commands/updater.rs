/// Auto-update commands using tauri-plugin-updater.
///
/// Replaces the electron-updater IPC handlers in electron-main.js.
/// Update availability and download events are pushed to the frontend
/// via tauri::Emitter::emit() instead of ipcRenderer.on().

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

/// Check for a new version.  Emits `update-available` or `update-not-available`
/// to ALL windows.
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<Value, String> {
    match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let _ = app.emit("update-available", serde_json::json!({ "version": version }));
                Ok(serde_json::json!({ "success": true, "version": version }))
            }
            Ok(None) => {
                let _ = app.emit("update-not-available", serde_json::json!({}));
                Ok(serde_json::json!({ "success": true, "upToDate": true }))
            }
            Err(e) => {
                // 404 = no releases yet; don't surface as error
                let msg = e.to_string();
                if msg.contains("404") || msg.contains("No releases") {
                    return Ok(serde_json::json!({ "success": false, "noReleases": true }));
                }
                let _ = app.emit("update-error", &msg);
                Err(msg)
            }
        },
        Err(e) => Err(format!("Updater not configured: {e}")),
    }
}

/// Download the pending update, emitting progress events.
#[tauri::command]
pub async fn download_update(app: AppHandle) -> Result<Value, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("Updater not configured: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;

    let app_clone = app.clone();
    update
        .download_and_install(
            move |downloaded, total| {
                let pct = total
                    .map(|t| (downloaded as f64 / t as f64 * 100.0).round() as u64)
                    .unwrap_or(0);
                let _ = app_clone.emit(
                    "update-download-progress",
                    serde_json::json!({ "percent": pct, "downloaded": downloaded, "total": total }),
                );
            },
            move || {
                let _ = app.emit("update-downloaded", serde_json::json!({}));
            },
        )
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    Ok(serde_json::json!({ "success": true }))
}

/// Restart and install the downloaded update.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<Value, String> {
    app.restart();
    #[allow(unreachable_code)]
    Ok(serde_json::json!({ "success": true }))
}
