use std::sync::Mutex;

/// Shared application state injected by Tauri into every command.
pub struct AppState {
    /// Port the Go backend HTTP server is listening on (set after sidecar starts).
    pub backend_port: Mutex<Option<u16>>,
    /// Whether the Go backend has received its initial secure configuration.
    pub is_configured: Mutex<bool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            backend_port: Mutex::new(None),
            is_configured: Mutex::new(false),
        }
    }

    /// Block until the backend port is known, up to `max_wait_ms` milliseconds.
    /// Returns the port or an error string if the timeout expires.
    pub async fn wait_for_port(&self, max_wait_ms: u64) -> Result<u16, String> {
        use tokio::time::{sleep, Duration};
        let step = Duration::from_millis(100);
        let mut waited = 0u64;
        loop {
            {
                let guard = self.backend_port.lock().map_err(|e| e.to_string())?;
                if let Some(p) = *guard {
                    return Ok(p);
                }
            }
            if waited >= max_wait_ms {
                return Err("Backend port not ready after timeout".to_string());
            }
            sleep(step).await;
            waited += 100;
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
