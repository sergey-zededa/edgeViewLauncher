// EdgeView Launcher – Tauri v2 main entry point
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod sidecar;
mod state;
mod tray;

use commands::{api, files, secure_storage, system, updater, windows};
use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Spawn Go sidecar
            sidecar::start(app_handle.clone());

            // Set up system tray
            tray::setup(&app_handle)?;

            // Show main window once ready
            let main_window = app.get_webview_window("main").expect("main window must exist");
            main_window.show().unwrap_or_default();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // API proxy
            api::api_call,
            api::get_backend_port,
            // Window management
            windows::open_terminal_window,
            windows::open_vnc_window,
            windows::resize_window,
            windows::close_current_window,
            // System
            system::open_external,
            system::open_external_terminal,
            system::get_system_time_format,
            system::get_app_version,
            // Secure storage
            secure_storage::secure_storage_status,
            secure_storage::secure_storage_get_settings,
            secure_storage::secure_storage_save_settings,
            secure_storage::secure_storage_migrate,
            // Files
            files::save_collected_file,
            // Updater
            updater::check_for_updates,
            updater::download_update,
            updater::install_update,
        ])
        .on_window_event(|window, event| {
            // Hide (rather than close) the main window; keep app running in tray
            if matches!(event, tauri::WindowEvent::CloseRequested { api, .. }
                if window.label() == "main")
            {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window.hide().unwrap_or_default();
                    #[cfg(target_os = "macos")]
                    let _ = window.app_handle().set_activation_policy(
                        tauri::ActivationPolicy::Accessory,
                    );
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
