// System tray implementation.
//
// Replaces createTray() and updateTrayMenu() from electron-main.js.
// The tray menu is rebuilt on demand whenever the frontend reports a tunnel
// state change (the `tunnels-changed` event) or a tunnel is closed from the
// tray itself, with a 5-second poll of the Go backend as a backstop. A
// signature check skips rebuilding the native menu when nothing the tray shows
// has actually changed, so the frequent backstop poll and byte-counter updates
// don't cause needless rebuilds or flicker.

use crate::state::AppState;
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Listener, Manager,
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
};
use tokio::time::{Duration, interval};

// Signature of the last menu the tray rendered. Used to skip `set_menu` when
// the visible tunnel set (and user label) is unchanged.
static LAST_TRAY_SIG: Mutex<Option<String>> = Mutex::new(None);

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("EdgeView Launcher")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../../assets/trayTemplate.png")).expect("tray icon"))
        .icon_as_template(true)
        .menu(&build_initial_menu(app)?)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if id == "show" {
                if let Some(w) = app.get_webview_window("main") {
                    #[cfg(target_os = "macos")]
                    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            } else if id == "quit" {
                app.exit(0);
            } else if let Some(tid) = id.strip_prefix("close|") {
                let tid = tid.to_string();
                let app2 = app.clone();
                let state = app.state::<AppState>();
                let port_opt = *state.backend_port.lock().unwrap(); // Drops the lock here
                if let Some(port) = port_opt {
                    // Surface a "Terminating..." state in the main window's tunnel
                    // list immediately, so the user gets feedback without having
                    // to wait for the next 5s poll to reconcile.
                    let _ = app2.emit("tunnel-closing", serde_json::json!({ "tunnelId": tid }));
                    tauri::async_runtime::spawn(async move {
                        let url = format!("http://localhost:{port}/api/tunnel/{tid}");
                        let _ = reqwest::Client::new().delete(&url).send().await;
                        // Refresh the tray immediately so the just-closed tunnel
                        // disappears from the menu without waiting for the poll.
                        update_tray_menu(&app2).await;
                    });
                }
            }
        })
        .build(app)?;

    // Store tray in app state so we can call set_menu later
    app.manage(tray);

    // Rebuild the tray immediately whenever the frontend reports a tunnel state
    // change, so the menu tracks the app window in near-real-time rather than
    // lagging behind the backstop poll.
    let app_listen = app.clone();
    app.listen("tunnels-changed", move |_| {
        let a = app_listen.clone();
        tauri::async_runtime::spawn(async move {
            update_tray_menu(&a).await;
        });
    });

    // Start background refresh task (backstop poll)
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        refresh_loop(app_clone).await;
    });

    Ok(())
}

fn build_initial_menu(app: &AppHandle) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
    MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("header", "EdgeView Launcher").enabled(false).build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("status", "Status: Initializing...").enabled(false).build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("show", "Open EdgeView Launcher").build(app)?)
        .item(&MenuItemBuilder::with_id("quit", "Quit").build(app)?)
        .build()
}

async fn refresh_loop(app: AppHandle) {
    // Backstop poll: catches state changes the frontend didn't emit about
    // (e.g. a tunnel failing on a non-selected node while the global panel is
    // closed). The `tunnels-changed` event handles the common case instantly.
    let mut ticker = interval(Duration::from_secs(5));
    loop {
        ticker.tick().await;
        update_tray_menu(&app).await;
    }
}

async fn update_tray_menu(app: &AppHandle) {
    let state = app.state::<AppState>();
    let port = match *state.backend_port.lock().unwrap() {
        Some(p) => p,
        None => return, // backend not ready yet
    };

    let tray = match app.tray_by_id("main-tray") {
        Some(t) => t,
        None => return,
    };

    // Fetch user info
    let user_label = fetch_user_label(port).await;
    // Fetch active tunnels
    let mut tunnels = fetch_tunnels(port).await.unwrap_or_default();

    // Only show tunnels the app considers active. The Go backend keeps a tunnel
    // in /api/tunnels with Status:"failed" after it dies on its own; the app
    // hides those, so the tray must too — otherwise dead tunnels linger in the
    // menu as "active connections".
    tunnels.retain(|t| {
        t.get("Status")
            .and_then(|s| s.as_str())
            .map_or(true, |s| s != "failed")
    });

    // Skip rebuilding the native menu when nothing the tray shows has changed.
    // Without this, the 5s backstop poll (and byte-counter updates) would rebuild
    // the menu constantly and could flicker a menu the user has open.
    let signature = build_signature(user_label.as_deref(), &tunnels);
    {
        let mut last = LAST_TRAY_SIG.lock().unwrap();
        if last.as_deref() == Some(signature.as_str()) {
            return;
        }
        *last = Some(signature);
    }

    let app_ref = app;

    let result: Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> = (|| {
        let mut builder = MenuBuilder::new(app_ref);

        builder = builder
            .item(&MenuItemBuilder::with_id("header", "EdgeView Launcher").enabled(false).build(app_ref)?);

        if let Some(label) = user_label {
            builder = builder.item(
                &MenuItemBuilder::with_id("user", &label).enabled(false).build(app_ref)?,
            );
        }

        builder = builder.separator();

        if tunnels.is_empty() {
            builder = builder.item(
                &MenuItemBuilder::with_id("no-tunnels", "No active connections")
                    .enabled(false)
                    .build(app_ref)?,
            );
        } else {
            builder = builder.item(
                &MenuItemBuilder::with_id("tunnels-header", "ACTIVE CONNECTIONS")
                    .enabled(false)
                    .build(app_ref)?,
            );

            for (i, tunnel) in tunnels.iter().enumerate() {
                let device = tunnel["NodeName"]
                    .as_str()
                    .unwrap_or("Unknown")
                    .to_string();
                let port_val = tunnel["LocalPort"].as_u64().unwrap_or(0);
                let ttype = tunnel["Type"].as_str().unwrap_or("TCP");
                let tid = tunnel["ID"].as_str().unwrap_or("").to_string();

                let label = format!("{device} → :{port_val} ({ttype})");
                let close_id = format!("close|{tid}");
                let close_item = MenuItemBuilder::with_id(&close_id, "Close Tunnel").build(app_ref)?;

                let submenu = SubmenuBuilder::new(app_ref, &label)
                    .item(&MenuItemBuilder::with_id(
                        format!("type-{i}"),
                        format!("Type: {ttype}"),
                    ).enabled(false).build(app_ref)?)
                    .item(&MenuItemBuilder::with_id(
                        format!("port-{i}"),
                        format!("Local Port: {port_val}"),
                    ).enabled(false).build(app_ref)?)
                    .separator()
                    .item(&close_item)
                    .build()?;

                builder = builder.item(&submenu);
            }
        }

        builder = builder
            .separator()
            .item(&MenuItemBuilder::with_id("show", "Open EdgeView Launcher").build(app_ref)?)
            .item(&MenuItemBuilder::with_id("quit", "Quit").build(app_ref)?);

        builder.build()
    })();

    match result {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => {
            eprintln!("[Tray] Failed to build menu: {e}");
            // Rebuild failed — clear the cached signature so the next tick retries
            // instead of treating this un-rendered state as already displayed.
            *LAST_TRAY_SIG.lock().unwrap() = None;
        }
    }
}

// Order-independent signature of the visible tray state (user label + the set of
// active tunnels reduced to the fields the menu renders). Used to detect whether
// a rebuild is actually needed.
fn build_signature(user_label: Option<&str>, tunnels: &[serde_json::Value]) -> String {
    let mut parts: Vec<String> = tunnels
        .iter()
        .map(|t| {
            let id = t["ID"].as_str().unwrap_or("");
            let name = t["NodeName"].as_str().unwrap_or("");
            let port = t["LocalPort"].as_u64().unwrap_or(0);
            let ttype = t["Type"].as_str().unwrap_or("");
            format!("{id}|{name}|{port}|{ttype}")
        })
        .collect();
    parts.sort();
    format!("{}#{}", user_label.unwrap_or(""), parts.join(";"))
}

async fn fetch_user_label(port: u16) -> Option<String> {
    let url = format!("http://localhost:{port}/api/user-info");
    let resp = reqwest::Client::new().get(&url).send().await.ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    let data = json.get("data")?.as_object()?;
    let owner = data.get("tokenOwner")?.as_str()?.to_string();
    Some(owner)
}

async fn fetch_tunnels(port: u16) -> Option<Vec<serde_json::Value>> {
    let url = format!("http://localhost:{port}/api/tunnels");
    let resp = reqwest::Client::new().get(&url).send().await.ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    json.get("data")?.as_array().cloned()
}
