/// File-download command with native save dialog.
///
/// Replaces ipcMain.handle('save-collected-file', ...) from electron-main.js.
/// Downloads a streaming response from the Go backend and saves it to a
/// user-chosen path via the native macOS/Windows/Linux save dialog.

use crate::state::AppState;
use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[tauri::command]
pub async fn save_collected_file(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    filename: String,
    endpoint: Option<String>,
) -> Result<Value, String> {
    let port = state.wait_for_port(5_000).await?;
    let api_path = endpoint.unwrap_or_else(|| "/api/collect-info/download".to_string());

    // Show native save dialog
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();

    app.dialog()
        .file()
        .set_file_name(&filename)
        .set_title("Save System Info")
        .add_filter("Archive", &["tar.gz", "tar", "gz"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let chosen = rx.await.map_err(|e| format!("Dialog channel error: {e}"))?;

    let file_path = match chosen {
        Some(fp) => fp.into_path().map_err(|e| format!("Path error: {e}"))?,
        None => return Ok(serde_json::json!({ "canceled": true })),
    };

    // Stream-download from Go backend
    let url = format!("http://localhost:{port}{api_path}?jobId={job_id}");
    let response = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        if status == 404 || body.contains("not found") {
            return Err(
                "The collected information bundle could not be found. \
                 The collection process may have failed. Please try again."
                    .into(),
            );
        }
        return Err(format!("Download failed: HTTP {status} – {body}"));
    }

    // Write to disk using tokio async I/O
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("Cannot create file: {e}"))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream error: {e}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
    }

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path.to_string_lossy()
    }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    // Integration tests for save_collected_file require a live Tauri app handle
    // and dialog which cannot be constructed in unit tests.
    // The streaming download logic is tested at the Go backend level.
    // Here we verify supporting type assumptions:

    #[test]
    fn file_path_roundtrip() {
        use std::path::PathBuf;
        let p = PathBuf::from("/tmp/test.tar.gz");
        let s = p.to_string_lossy().into_owned();
        assert_eq!(s, "/tmp/test.tar.gz");
    }
}
