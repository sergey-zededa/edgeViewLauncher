/// Secure token storage using the OS keychain (macOS Keychain, Windows Credential
/// Manager, Linux Secret Service).
///
/// Replaces `electron-secure-storage.js` which used `electron.safeStorage`.
///
/// ⚠️  IMPORTANT: The Electron `secure-tokens.enc` file (AES-256-GCM encrypted
/// with the OS signing key via safeStorage) is NOT readable by this module.
/// On first launch after migration the app detects this and sets
/// `requires_reauth: true` in the status response, prompting the user to
/// re-enter their API tokens once.
///
/// Service name: "edgeview-launcher"
/// Account name: "tokens"  (stores a JSON-encoded map of clusterName → apiToken)

use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

// In-memory cache: None = not loaded yet. Some(None) = loaded but empty. Some(Some(map)) = loaded with tokens.
static TOKEN_CACHE: OnceLock<Mutex<Option<Option<HashMap<String, String>>>>> = OnceLock::new();

// ── Config file location (same path as the old Electron app) ─────────────────

fn config_dir() -> PathBuf {
    dirs_next::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".edgeview-launcher")
}

fn config_path() -> PathBuf { config_dir().join("config.json") }
fn backup_path() -> PathBuf { config_dir().join("config.json.backup") }
/// Old Electron secure storage file – presence indicates migration needed
fn legacy_enc_path() -> PathBuf { config_dir().join("secure-tokens.enc") }

// ── Keyring helpers ───────────────────────────────────────────────────────────

const SERVICE: &str = "edgeview-launcher-v2";
const ACCOUNT: &str = "tokens";

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Keyring init failed: {e}"))
}

// Protects keychain access to prevent concurrent OS prompts which cause the window to disappear.
static KEYCHAIN_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

// Track last failure time to prevent prompt spam loop
static LAST_FAILURE: OnceLock<Mutex<Option<std::time::Instant>>> = OnceLock::new();

fn get_tokens() -> Result<Option<HashMap<String, String>>, String> {
    println!("[SecureStorage] get_tokens called");
    
    // 1. Try to read from cache (fast path)
    let cache_mutex = TOKEN_CACHE.get_or_init(|| Mutex::new(None));
    {
        let guard = cache_mutex.lock().map_err(|e| e.to_string())?;
        if let Some(cached_val) = &*guard {
            println!("[SecureStorage] Cache hit");
            return Ok(cached_val.clone());
        }
    }

    // 2. Check cooldown to avoid spamming the OS prompt if it just failed
    let failure_mutex = LAST_FAILURE.get_or_init(|| Mutex::new(None));
    {
        let guard = failure_mutex.lock().map_err(|e| e.to_string())?;
        if let Some(last_time) = *guard {
            if last_time.elapsed() < std::time::Duration::from_secs(10) {
                println!("[SecureStorage] Skipping keychain access due to recent failure (cooldown active)");
                return Ok(None);
            }
        }
    }

    println!("[SecureStorage] Cache miss - acquiring keychain lock...");
    
    // 3. Acquire global lock to serialize keychain access
    let _lock = KEYCHAIN_MUTEX.lock().map_err(|e| e.to_string())?;
    
    // 4. Check cache again (double-checked locking) just in case another thread filled it
    {
        let guard = cache_mutex.lock().map_err(|e| e.to_string())?;
        if let Some(cached_val) = &*guard {
            println!("[SecureStorage] Cache hit (after lock)");
            return Ok(cached_val.clone());
        }
    }

    // 5. Check cooldown AGAIN after lock (in case another thread failed while we waited)
    {
        let guard = failure_mutex.lock().map_err(|e| e.to_string())?;
        if let Some(last_time) = *guard {
            if last_time.elapsed() < std::time::Duration::from_secs(10) {
                println!("[SecureStorage] Skipping keychain access due to recent failure (cooldown active)");
                return Ok(None);
            }
        }
    }

    println!("[SecureStorage] Reading from OS keyring (Blocking)...");
    
    // Add delay to prevent race condition with window focus on startup
    #[cfg(target_os = "macos")]
    std::thread::sleep(std::time::Duration::from_millis(500));

    // 6. Read from keychain
    let entry = keyring_entry()?;
    let result = match entry.get_password() {
        Ok(json) => {
            println!("[SecureStorage] Keyring read success");
            let map = serde_json::from_str(&json)
                .map_err(|e| format!("Token JSON corrupt: {e}"))?;
            Ok(Some(map))
        }
        Err(keyring::Error::NoEntry) => {
            println!("[SecureStorage] Keyring entry not found");
            Ok(None)
        },
        Err(e) => {
            // Record failure time to trigger cooldown
            println!("[SecureStorage] Keyring read error: {}", e);
            if let Ok(mut guard) = failure_mutex.lock() {
                *guard = Some(std::time::Instant::now());
            }
            
            // If native authorization failed (e.g. prompt loop issue),
            // try falling back to the 'security' CLI tool.
            // This runs as a separate process and may offer a more stable prompt context.
            if e.to_string().contains("Unable to obtain authorization") {
                 println!("[SecureStorage] Authorization denied. Attempting CLI fallback...");
                 
                 use std::process::Command;
                 let output = Command::new("security")
                    .args(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"])
                    .output();
                 
                 if let Ok(out) = output {
                     if out.status.success() {
                         let password = String::from_utf8_lossy(&out.stdout).trim().to_string();
                         if !password.is_empty() {
                             println!("[SecureStorage] CLI fallback success");
                             if let Ok(map) = serde_json::from_str(&password) {
                                 return Ok(Some(map));
                             }
                         }
                     } else {
                         println!("[SecureStorage] CLI fallback failed: {}", String::from_utf8_lossy(&out.stderr));
                     }
                 }
                 
                 // If fallback also failed, proceed without tokens
                 Ok(None)
            } else {
                 Err(format!("Keyring read failed: {e}"))
            }
        },
    };

    // 7. Update cache if successful
    if let Ok(val) = &result {
        let mut guard = cache_mutex.lock().map_err(|e| e.to_string())?;
        *guard = Some(val.clone());
        println!("[SecureStorage] Cache updated");
    }

    result
}

fn save_tokens(tokens: &HashMap<String, String>) -> Result<(), String> {
    // 1. Acquire global lock
    let _lock = KEYCHAIN_MUTEX.lock().map_err(|e| e.to_string())?;

    // 2. Write to keychain
    let json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    keyring_entry()?.set_password(&json).map_err(|e| format!("Keyring write failed: {e}"))?;

    // 3. Update cache
    let cache_mutex = TOKEN_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache_mutex.lock().map_err(|e| e.to_string())?;
    *guard = Some(Some(tokens.clone()));

    Ok(())
}

// ── Config file helpers ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClusterConfig {
    pub name: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiToken", default)]
    pub api_token: String,
    #[serde(rename = "tokenEncrypted", default)]
    pub token_encrypted: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub clusters: Vec<ClusterConfig>,
    #[serde(rename = "activeCluster", default)]
    pub active_cluster: String,
    #[serde(rename = "recentDevices", default)]
    pub recent_devices: Vec<Value>,
    // Flatten any extra fields so we never strip unknown keys
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, Value>,
}

fn read_config() -> Result<Option<AppConfig>, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {e}"))?;
    serde_json::from_str(&text).map(Some).map_err(|e| format!("Config JSON invalid: {e}"))
}

fn write_config(config: &AppConfig) -> Result<(), String> {
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create config dir: {e}"))?;
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path(), text).map_err(|e| format!("Config write failed: {e}"))
}

// ── Public helper used by sidecar.rs ─────────────────────────────────────────

/// Load config.json and merge in tokens from the OS keychain.
/// Returns None if config.json does not exist yet.
pub fn load_config_with_tokens() -> Result<Option<Value>, String> {
    let mut config = match read_config()? {
        Some(c) => c,
        None => return Ok(None),
    };

    if let Ok(Some(tokens)) = get_tokens() {
        for cluster in &mut config.clusters {
            if let Some(t) = tokens.get(&cluster.name) {
                cluster.api_token = t.clone();
                cluster.token_encrypted = true;
            }
        }
    }

    Ok(Some(serde_json::to_value(config).map_err(|e| e.to_string())?))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

use tauri::{AppHandle, Manager};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub encryption_available: bool,
    pub secure_tokens_exist: bool,
    pub needs_migration: bool,
    pub backup_exists: bool,
    /// True when old Electron `secure-tokens.enc` file is present;
    /// user must re-enter tokens.
    pub requires_reauth: bool,
}

#[tauri::command]
pub fn secure_storage_status() -> StorageStatus {
    // Avoid calling get_tokens() here as it triggers a keychain prompt on macOS
    // causing "white screen" delays and potential race conditions on startup.
    // Instead, rely on config state to infer if tokens should exist.
    
    let config_opt = read_config().ok().flatten();
    let legacy_exists = legacy_enc_path().exists();

    // Check if any cluster expects an encrypted token
    let tokens_exist = config_opt.as_ref()
        .map(|c| c.clusters.iter().any(|cl| cl.token_encrypted))
        .unwrap_or(false);

    // needs_migration: plaintext tokens in config.json
    let needs_migration = config_opt.as_ref()
        .map(|c| c.clusters.iter().any(|cl| !cl.api_token.is_empty() && !cl.token_encrypted))
        .unwrap_or(false);

    StorageStatus {
        encryption_available: true, // keyring crate always provides an implementation
        secure_tokens_exist: tokens_exist,
        needs_migration,
        backup_exists: backup_path().exists(),
        requires_reauth: legacy_exists && !tokens_exist,
    }
}

/// Load settings (config.json merged with keychain tokens) and return as JSON.
/// Async to ensure it runs on a thread pool that doesn't block main loop,
/// and to explicitly wrap the blocking keychain call.
#[tauri::command]
pub async fn secure_storage_get_settings() -> Result<Value, String> {
    // Remove spawn_blocking to execute on the Tauri invoke thread directly.
    // This may help with macOS Keychain prompt window association.
    match load_config_with_tokens()? {
        Some(v) => Ok(serde_json::json!({ "success": true, "data": v })),
        None => Ok(serde_json::json!({ "success": true, "data": null })),
    }
}

/// Save settings: strip apiToken from the on-disk JSON and store them in the
/// OS keychain.  Also pushes updated config to the Go backend if possible.
#[tauri::command]
pub fn secure_storage_save_settings(config: Value) -> Result<Value, String> {
    let mut app_config: AppConfig =
        serde_json::from_value(config.clone()).map_err(|e| format!("Invalid config: {e}"))?;

    // Extract tokens into keychain
    let mut token_map: HashMap<String, String> =
        get_tokens().ok().flatten().unwrap_or_default();

    for cluster in &mut app_config.clusters {
        if !cluster.api_token.is_empty() {
            token_map.insert(cluster.name.clone(), cluster.api_token.clone());
        }
        cluster.api_token = String::new();
        cluster.token_encrypted = token_map.contains_key(&cluster.name);
    }

    save_tokens(&token_map)?;
    write_config(&app_config)?;

    Ok(serde_json::json!({ "success": true }))
}

/// Migrate plaintext tokens from config.json → OS keychain (one-time upgrade).
#[tauri::command]
pub fn secure_storage_migrate() -> Value {
    let config = match read_config() {
        Ok(Some(c)) => c,
        Ok(None) => {
            return serde_json::json!({ "success": false, "error": "Config file not found" });
        }
        Err(e) => {
            return serde_json::json!({ "success": false, "error": e });
        }
    };

    let mut token_map: HashMap<String, String> =
        get_tokens().ok().flatten().unwrap_or_default();

    let mut count = 0u32;
    for cluster in &config.clusters {
        if !cluster.api_token.is_empty() && !cluster.token_encrypted {
            token_map.insert(cluster.name.clone(), cluster.api_token.clone());
            count += 1;
        }
    }

    if count == 0 {
        return serde_json::json!({ "success": false, "error": "No plaintext tokens found to migrate" });
    }

    // Backup before modifying
    if let Ok(text) = fs::read_to_string(config_path()) {
        let _ = fs::write(backup_path(), &text);
    }

    if let Err(e) = save_tokens(&token_map) {
        return serde_json::json!({ "success": false, "error": e });
    }

    // Rewrite config.json without tokens
    let mut updated = config;
    for cluster in &mut updated.clusters {
        cluster.token_encrypted = token_map.contains_key(&cluster.name);
        cluster.api_token = String::new();
    }

    if let Err(e) = write_config(&updated) {
        return serde_json::json!({ "success": false, "error": e });
    }

    serde_json::json!({
        "success": true,
        "message": format!("Migrated {} token(s) to OS keychain", count),
        "tokenCount": count
    })
}

/// Manually trigger injection of secure config into the backend.
/// Should be called by the frontend after it successfully loads settings (and thus unlocks keychain).
#[tauri::command]
pub async fn inject_secure_config(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    
    // 1. Wait for backend port (should be ready quickly if app is loaded)
    let port = state.wait_for_port(5000).await.map_err(|e| e.to_string())?;

    // 2. Load config (uses cached tokens if available)
    let config = match load_config_with_tokens()? {
        Some(c) => c,
        None => return Ok(()), // Nothing to inject
    };

    // 3. Push to backend
    let url = format!("http://localhost:{port}/api/settings");
    match reqwest::Client::new().post(&url).json(&config).send().await {
        Ok(_) => {
            println!("[SecureStorage] Secure configuration injected via command");
            *state.is_configured.lock().unwrap() = true;
            Ok(())
        }
        Err(e) => {
            let msg = format!("Failed to inject config: {e}");
            eprintln!("[SecureStorage] {msg}");
            *state.is_configured.lock().unwrap() = true; // Unblock to avoid stalling
            Err(msg)
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: write a temporary config.json and override config_path() path
    // We test the pure logic (config file parsing + token extraction) directly.

    fn make_config(clusters: Vec<ClusterConfig>) -> AppConfig {
        AppConfig {
            clusters,
            active_cluster: "Test".into(),
            recent_devices: vec![],
            extra: Default::default(),
        }
    }

    #[test]
    fn config_roundtrip_serializes_correctly() {
        let config = make_config(vec![ClusterConfig {
            name: "Prod".into(),
            base_url: "https://example.com".into(),
            api_token: "my-secret-token".into(),
            token_encrypted: false,
        }]);

        let json = serde_json::to_string(&config).expect("serialize");
        let back: AppConfig = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(back.clusters[0].name, "Prod");
        assert_eq!(back.clusters[0].api_token, "my-secret-token");
        assert!(!back.clusters[0].token_encrypted);
    }

    #[test]
    fn token_extraction_strips_from_cluster() {
        let mut cluster = ClusterConfig {
            name: "Prod".into(),
            base_url: "https://example.com".into(),
            api_token: "secret".into(),
            token_encrypted: false,
        };

        let mut map = std::collections::HashMap::new();
        if !cluster.api_token.is_empty() {
            map.insert(cluster.name.clone(), cluster.api_token.clone());
        }
        cluster.api_token = String::new();
        cluster.token_encrypted = map.contains_key(&cluster.name);

        assert!(cluster.api_token.is_empty());
        assert!(cluster.token_encrypted);
        assert_eq!(map["Prod"], "secret");
    }

    #[test]
    fn merge_tokens_into_config() {
        let mut config = make_config(vec![
            ClusterConfig {
                name: "Prod".into(),
                base_url: "https://prod.example.com".into(),
                api_token: String::new(),
                token_encrypted: true,
            },
            ClusterConfig {
                name: "Staging".into(),
                base_url: "https://staging.example.com".into(),
                api_token: String::new(),
                token_encrypted: false,
            },
        ]);

        let mut tokens = std::collections::HashMap::new();
        tokens.insert("Prod".to_string(), "prod-token".to_string());

        for cluster in &mut config.clusters {
            if let Some(t) = tokens.get(&cluster.name) {
                cluster.api_token = t.clone();
            }
        }

        assert_eq!(config.clusters[0].api_token, "prod-token");
        assert_eq!(config.clusters[1].api_token, ""); // no token for Staging
    }

    #[test]
    fn config_json_parses_unknown_fields_without_error() {
        let json = r#"{
            "clusters": [],
            "activeCluster": "Prod",
            "recentDevices": [],
            "someUnknownField": "should-be-preserved"
        }"#;

        let config: AppConfig = serde_json::from_str(json).expect("should parse");
        assert_eq!(config.extra["someUnknownField"], "should-be-preserved");
    }

    #[test]
    fn migration_count_identifies_plaintext_tokens() {
        let clusters = vec![
            ClusterConfig {
                name: "Encrypted".into(),
                base_url: "https://a.com".into(),
                api_token: "token".into(),
                token_encrypted: true, // already encrypted → should not count
            },
            ClusterConfig {
                name: "Plaintext".into(),
                base_url: "https://b.com".into(),
                api_token: "token".into(),
                token_encrypted: false, // plaintext → should count
            },
            ClusterConfig {
                name: "Empty".into(),
                base_url: "https://c.com".into(),
                api_token: String::new(),
                token_encrypted: false,
            },
        ];

        let count = clusters
            .iter()
            .filter(|c| !c.api_token.is_empty() && !c.token_encrypted)
            .count();

        assert_eq!(count, 1);
    }
}
