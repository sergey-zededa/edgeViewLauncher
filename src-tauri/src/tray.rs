/// System tray implementation.
///
/// Replaces createTray() and updateTrayMenu() from electron-main.js.
/// The tray menu is rebuilt every 30 seconds by polling the Go backend.

use crate::state::AppState;
use tauri::{
    AppHandle, Manager,
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter,
};
use tokio::time::{Duration, interval};

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("EdgeView Launcher")
        .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
            tauri::image::Image::new_owned(vec![], 0, 0)
        }))
        .menu(&build_initial_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if id == "show" {
                if let Some(w) = app.get_webview_window("main") {
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
                    tauri::async_runtime::spawn(async move {
                        let url = format!("http://localhost:{port}/api/tunnel/{tid}");
                        let _ = reqwest::Client::new().delete(&url).send().await;
                        let _ = app2.emit("tunnel-closed", ());
                    });
                }
            }
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            _ => {}
        })
        .build(app)?;

    // Store tray in app state so we can call set_menu later
    app.manage(tray);

    // Start background refresh task
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
    let mut ticker = interval(Duration::from_secs(30));
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
    let tunnels = fetch_tunnels(port).await.unwrap_or_default();

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
                        &format!("Type: {ttype}"),
                    ).enabled(false).build(app_ref)?)
                    .item(&MenuItemBuilder::with_id(
                        format!("port-{i}"),
                        &format!("Local Port: {port_val}"),
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
        Err(e) => eprintln!("[Tray] Failed to build menu: {e}"),
    }
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
