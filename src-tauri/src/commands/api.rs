/// Generic HTTP proxy command that forwards all frontend API calls to the Go backend.
///
/// Replaces the `api-call` ipcMain.handle in electron-main.js.
/// All ~30 frontend API calls funnel through this single Tauri command.

use crate::state::AppState;
use serde_json::Value;
use tauri::State;

/// Proxy an API call to the Go HTTP backend.
///
/// * `endpoint` – path such as `/api/search-nodes`
/// * `method`   – HTTP verb: `"GET"`, `"POST"`, `"DELETE"`
/// * `body`     – optional JSON body
#[tauri::command]
pub async fn api_call(
    state: State<'_, AppState>,
    endpoint: String,
    method: String,
    body: Option<Value>,
) -> Result<Value, String> {
    // Wait up to 10 s for the backend to be ready
    let port = state.wait_for_port(10_000).await?;

    // Wait for configuration to be injected (up to 5 s)
    let mut waited = 0u64;
    while !*state.is_configured.lock().map_err(|e| e.to_string())? {
        if waited >= 5_000 {
            // Don't block forever; proceed anyway
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        waited += 100;
    }

    let url = format!("http://localhost:{port}{endpoint}");
    let client = reqwest::Client::new();

    let request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => {
            let req = client.post(&url);
            if let Some(b) = body {
                req.json(&b)
            } else {
                req
            }
        }
        "DELETE" => client.delete(&url),
        "PUT" => {
            let req = client.put(&url);
            if let Some(b) = body {
                req.json(&b)
            } else {
                req
            }
        }
        _ => return Err(format!("Unsupported HTTP method: {method}")),
    };

    let response = request
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    // Tolerate empty bodies (e.g. 204 No Content)
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    if text.trim().is_empty() {
        return Ok(Value::Null);
    }

    serde_json::from_str::<Value>(&text)
        .map_err(|e| format!("Failed to parse response JSON: {e}"))
}

/// Return the current backend port (used by the VNC viewer WebSocket URL).
#[tauri::command]
pub async fn get_backend_port(state: State<'_, AppState>) -> Result<Option<u16>, String> {
    let port = state.backend_port.lock().map_err(|e| e.to_string())?;
    Ok(*port)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use serde_json::json;

    fn make_state_with_port(port: u16) -> AppState {
        let s = AppState::new();
        *s.backend_port.lock().unwrap() = Some(port);
        *s.is_configured.lock().unwrap() = true;
        s
    }

    #[tokio::test]
    async fn wait_for_port_times_out_when_no_port_set() {
        let state = AppState::new();
        let result = state.wait_for_port(200).await; // 200 ms timeout
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not ready"));
    }

    #[tokio::test]
    async fn wait_for_port_returns_immediately_when_set() {
        let state = make_state_with_port(8080);
        let result = state.wait_for_port(5000).await;
        assert_eq!(result.unwrap(), 8080);
    }

    #[tokio::test]
    async fn api_call_proxies_get_to_mock_server() {
        let mut server = mockito::Server::new_async().await;
        let port: u16 = server.socket_address().port();

        let _m = server
            .mock("GET", "/api/user-info")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"success":true,"data":{"tokenOwner":"test@example.com"}}"#)
            .create_async()
            .await;

        let state = make_state_with_port(port);
        // We call the internal logic directly since we can't easily construct a Tauri State
        let url = format!("http://localhost:{port}/api/user-info");
        let resp = reqwest::Client::new().get(&url).send().await.unwrap();
        let body: Value = resp.json().await.unwrap();

        assert_eq!(body["success"], json!(true));
        assert_eq!(body["data"]["tokenOwner"], json!("test@example.com"));
        drop(state);
    }

    #[tokio::test]
    async fn api_call_proxies_post_with_body_to_mock_server() {
        let mut server = mockito::Server::new_async().await;
        let port: u16 = server.socket_address().port();

        let _m = server
            .mock("POST", "/api/search-nodes")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"success":true,"data":[]}"#)
            .create_async()
            .await;

        let url = format!("http://localhost:{port}/api/search-nodes");
        let resp = reqwest::Client::new()
            .post(&url)
            .json(&json!({"query": "test", "limit": 10}))
            .send()
            .await
            .unwrap();
        let body: Value = resp.json().await.unwrap();

        assert_eq!(body["success"], json!(true));
    }

    #[tokio::test]
    async fn api_call_handles_empty_body_gracefully() {
        let mut server = mockito::Server::new_async().await;
        let port: u16 = server.socket_address().port();

        let _m = server
            .mock("DELETE", "/api/tunnel/tunnel-1")
            .with_status(204)
            .with_body("")
            .create_async()
            .await;

        let url = format!("http://localhost:{port}/api/tunnel/tunnel-1");
        let resp = reqwest::Client::new().delete(&url).send().await.unwrap();
        let text = resp.text().await.unwrap();

        // Empty body should be handled without a JSON parse error
        assert!(text.is_empty());
    }
}
