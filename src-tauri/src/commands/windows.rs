// Window management commands.
//
// Replaces the following ipcMain.handle calls from electron-main.js:
//   - open-terminal-window
//   - open-vnc-window
//   - resize-window
//   - close-current-window

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, LogicalSize, WebviewUrl, WebviewWindowBuilder, Window};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOptions {
    pub port: u16,
    pub node_name: Option<String>,
    pub target_info: Option<String>,
    pub tunnel_id: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub theme: Option<String>,
    pub mode: Option<String>,
    pub initial_command: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VncOptions {
    pub port: u16,
    pub node_name: Option<String>,
    pub app_name: Option<String>,
    pub tunnel_id: Option<String>,
    pub theme: Option<String>,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Open a new frameless terminal window, routed to the SSH terminal UI.
#[tauri::command]
pub async fn open_terminal_window(
    app: AppHandle,
    options: Value,
) -> Result<bool, String> {
    let opts: TerminalOptions =
        serde_json::from_value(options).map_err(|e| format!("Invalid options: {e}"))?;

    let node_name = opts.node_name.clone().unwrap_or_else(|| "Unknown Device".into());
    let label = sanitize_label(&format!("terminal-{}", opts.port));

    let mut params = format!(
        "mode={}&port={}&nodeName={}&targetInfo={}&tunnelId={}&username={}&password={}&theme={}",
        urlenc(opts.mode.as_deref().unwrap_or("terminal")),
        opts.port,
        urlenc(&node_name),
        urlenc(opts.target_info.as_deref().unwrap_or("SSH")),
        urlenc(opts.tunnel_id.as_deref().unwrap_or("")),
        urlenc(opts.username.as_deref().unwrap_or("")),
        urlenc(opts.password.as_deref().unwrap_or("")),
        urlenc(opts.theme.as_deref().unwrap_or("dark")),
    );
    if let Some(cmd) = &opts.initial_command {
        params.push_str(&format!("&initialCommand={}", urlenc(cmd)));
    }

    let url = dev_or_prod_url(&app, &format!("/?{params}"), "index.html", &params);
    build_child_window(&app, &label, &format!("SSH – {node_name}"), url, 1024, 768)?;
    Ok(true)
}

/// Open a new frameless VNC viewer window.
#[tauri::command]
pub async fn open_vnc_window(app: AppHandle, options: Value) -> Result<bool, String> {
    let opts: VncOptions =
        serde_json::from_value(options).map_err(|e| format!("Invalid options: {e}"))?;

    let node_name = opts.node_name.clone().unwrap_or_else(|| "Unknown Device".into());
    let label = sanitize_label(&format!("vnc-{}", opts.port));

    let params = format!(
        "port={}&nodeName={}&appName={}&tunnelId={}&theme={}",
        opts.port,
        urlenc(&node_name),
        urlenc(opts.app_name.as_deref().unwrap_or("VNC")),
        urlenc(opts.tunnel_id.as_deref().unwrap_or("")),
        urlenc(opts.theme.as_deref().unwrap_or("dark")),
    );

    let url = dev_or_prod_url(&app, &format!("/vnc.html?{params}"), "vnc.html", &params);
    build_child_window(&app, &label, &format!("VNC – {node_name}"), url, 1024, 768)?;
    Ok(true)
}

/// Resize the window that sent this command.
#[tauri::command]
pub async fn resize_window(window: Window, width: f64, height: f64) -> Result<bool, String> {
    let size = LogicalSize::new(width, height);
    window
        .set_size(tauri::Size::Logical(size))
        .map_err(|e| format!("resize failed: {e}"))?;
    window
        .center()
        .map_err(|e| format!("center failed: {e}"))?;
    Ok(true)
}

/// Close the window that sent this command.
#[tauri::command]
pub async fn close_current_window(window: Window) -> Result<bool, String> {
    window.close().map_err(|e| format!("close failed: {e}"))?;
    Ok(true)
}

/// Quit the entire application.
#[tauri::command]
pub async fn quit_app(app: AppHandle) -> Result<bool, String> {
    app.exit(0);
    Ok(true)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn dev_or_prod_url(_app: &AppHandle, dev_path: &str, prod_file: &str, query: &str) -> WebviewUrl {
    let _ = dev_path;
    let _ = prod_file;
    let _ = query;
    #[cfg(debug_assertions)]
    {
        let base = "http://localhost:5173";
        WebviewUrl::External(
            format!("{base}{dev_path}")
                .parse()
                .expect("valid dev URL"),
        )
    }
    #[cfg(not(debug_assertions))]
    {
        WebviewUrl::App(format!("{prod_file}?{query}").into())
    }
}

fn build_child_window(
    app: &AppHandle,
    label: &str,
    title: &str,
    url: WebviewUrl,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let builder = WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .inner_size(width as f64, height as f64)
        .decorations(true)
        .visible(false);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true);

    builder
        .build()
        .map_err(|e| format!("Failed to create window: {e}"))?
        .show()
        .map_err(|e| format!("Failed to show window: {e}"))?;
    Ok(())
}

/// Tauri window labels must match `[a-zA-Z0-9_-]`.
fn sanitize_label(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Percent-encode a string for use in URL query parameters.
fn urlenc(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                vec![c]
            }
            ' ' => vec!['+'],
            _ => {
                let encoded = format!("%{:02X}", c as u32);
                encoded.chars().collect()
            }
        })
        .collect()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_label_replaces_special_chars() {
        assert_eq!(sanitize_label("terminal-8080"), "terminal-8080");
        assert_eq!(sanitize_label("vnc:5900"), "vnc-5900");
        assert_eq!(sanitize_label("ssh/node.name"), "ssh-node-name");
    }

    #[test]
    fn urlenc_encodes_spaces_and_special() {
        assert_eq!(urlenc("hello world"), "hello+world");
        assert_eq!(urlenc("a=b&c=d"), "a%3Db%26c%3Dd");
        assert_eq!(urlenc("simple"), "simple");
    }
}
