// Spawns the Go HTTP backend as a Tauri sidecar and captures its dynamic port.
//
// The binary is declared in tauri.conf.json under `bundle.externalBin` as
// `"binaries/edgeview-backend"`.  Tauri resolves the correct platform triple
// (e.g. `edgeview-backend-aarch64-apple-darwin`) automatically.

use crate::state::AppState;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

/// Start the sidecar.  Called once from `lib.rs` setup.
pub fn start(app: AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        run_sidecar(app_clone).await;
    });
}

async fn run_sidecar(app: AppHandle) {
    use tauri_plugin_shell::process::CommandEvent;

    let sidecar_cmd = match app.shell().sidecar("edgeview-backend") {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("[Sidecar] Failed to locate edgeview-backend: {e}");
            return;
        }
    };

    let (mut rx, _child) = match sidecar_cmd.args(["-port", "0"]).spawn() {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("[Sidecar] Failed to spawn edgeview-backend: {e}");
            return;
        }
    };

    let state = app.state::<AppState>();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                let text = String::from_utf8_lossy(&line);
                println!("[Go Backend] {text}");

                // Parse "HTTP Server starting on :<PORT>"
                if let Some(port) = parse_port(&text) {
                    let mut guard = state.backend_port.lock().unwrap();
                    if guard.is_none() {
                        *guard = Some(port);
                        println!("[Sidecar] Backend port detected: {port}");
                        drop(guard);
                    }
                }
            }
            CommandEvent::Error(e) => eprintln!("[Sidecar] Error: {e}"),
            CommandEvent::Terminated(status) => {
                println!("[Sidecar] Backend exited: {status:?}");
                break;
            }
            _ => {}
        }
    }
}

fn parse_port(line: &str) -> Option<u16> {
    // Matches "HTTP Server starting on :8080" (any port)
    let prefix = "HTTP Server starting on :";
    let idx = line.find(prefix)?;
    let rest = &line[idx + prefix.len()..];
    rest.split_whitespace().next()?.parse::<u16>().ok()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::parse_port;

    #[test]
    fn parses_port_from_startup_log() {
        assert_eq!(parse_port("HTTP Server starting on :8080"), Some(8080));
        assert_eq!(parse_port("HTTP Server starting on :0"), Some(0));
        assert_eq!(parse_port("HTTP Server starting on :54321"), Some(54321));
    }

    #[test]
    fn ignores_unrelated_lines() {
        assert_eq!(parse_port("EdgeView Backend Version 0.1.22"), None);
        assert_eq!(parse_port("Found free port"), None);
        assert_eq!(parse_port(""), None);
    }

    #[test]
    fn parses_port_with_trailing_content() {
        // Some log lines may have extra content after the port
        assert_eq!(parse_port("HTTP Server starting on :9090 ..."), Some(9090));
    }
}
