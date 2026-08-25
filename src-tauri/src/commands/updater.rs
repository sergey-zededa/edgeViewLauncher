// Auto-update commands using tauri-plugin-updater.
//
// Replaces the electron-updater IPC handlers in electron-main.js.
// Update availability and download events are pushed to the frontend
// via tauri::Emitter::emit() instead of ipcRenderer.on().

use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Updater state shared across the three updater commands.
///
/// `checked` caches the `Update` handle from the most recent
/// `check_for_updates` so `download_update` can reuse it instead of hitting the
/// release endpoint a second time. `downloaded` holds the fetched bytes awaiting
/// installation.
#[derive(Default)]
pub struct PendingUpdate {
    pub checked: Mutex<Option<Update>>,
    pub downloaded: Mutex<Option<(Update, Vec<u8>)>>,
}

/// Check for a new version.  Emits `update-available` or `update-not-available`
/// to ALL windows.
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<Value, String> {
    match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                // Cache the handle so download_update does not re-query the endpoint.
                *app.state::<PendingUpdate>().checked.lock().unwrap() = Some(update);
                let _ = app.emit("update-available", serde_json::json!({ "version": version }));
                Ok(serde_json::json!({ "success": true, "version": version }))
            }
            Ok(None) => {
                *app.state::<PendingUpdate>().checked.lock().unwrap() = None;
                let _ = app.emit("update-not-available", serde_json::json!({}));
                Ok(serde_json::json!({ "success": true, "upToDate": true }))
            }
            Err(e) => {
                // 404 = no releases yet; don't surface as error
                let msg = e.to_string();
                if msg.contains("404") || msg.contains("No releases") || msg.contains("valid release JSON") {
                    let _ = app.emit("update-not-available", serde_json::json!({}));
                    return Ok(serde_json::json!({ "success": true, "upToDate": true, "noReleases": true }));
                }
                let _ = app.emit("update-error", &msg);
                Err(msg)
            }
        },
        Err(e) => Err(format!("Updater not configured: {e}")),
    }
}

/// Download the update without installing. Stores the bytes for later install.
#[tauri::command]
pub async fn download_update(app: AppHandle) -> Result<Value, String> {
    // Reuse the handle from the preceding check_for_updates. Only fall back to a
    // fresh check if there is none cached (e.g. download_update invoked directly).
    let cached = app.state::<PendingUpdate>().checked.lock().unwrap().take();

    let update = match cached {
        Some(update) => update,
        None => {
            let updater = app
                .updater()
                .map_err(|e| format!("Updater not configured: {e}"))?;

            updater
                .check()
                .await
                .map_err(|e| format!("Update check failed: {e}"))?
                .ok_or_else(|| "No update available".to_string())?
        }
    };

    println!(
        "[Updater] Found update v{}, downloading from: {}",
        update.version, update.download_url
    );

    let app_clone = app.clone();
    let bytes = update
        .download(
            move |downloaded, total| {
                let pct = total
                    .map(|t| (downloaded as f64 / t as f64 * 100.0).round() as u64)
                    .unwrap_or(0);
                let _ = app_clone.emit(
                    "update-download-progress",
                    serde_json::json!({ "percent": pct, "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    println!("[Updater] Download complete ({} bytes), ready to install", bytes.len());

    // Store the downloaded bytes for later installation
    let pending = app.state::<PendingUpdate>();
    *pending.downloaded.lock().unwrap() = Some((update, bytes));

    let _ = app.emit("update-downloaded", serde_json::json!({}));

    Ok(serde_json::json!({ "success": true }))
}

/// Install the previously downloaded update. On Windows this launches the
/// NSIS installer and exits; on other platforms it restarts the app.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<Value, String> {
    let pending = app.state::<PendingUpdate>();
    let (update, bytes) = pending
        .downloaded
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "No pending update to install".to_string())?;

    println!("[Updater] Installing update...");

    update
        .install(bytes)
        .map_err(|e| format!("Install failed: {e}"))?;

    app.restart();

    #[allow(unreachable_code)]
    Ok(serde_json::json!({ "success": true }))
}
