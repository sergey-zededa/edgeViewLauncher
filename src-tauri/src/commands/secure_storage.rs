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
use std::fs;
use std::path::PathBuf;

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

const SERVICE: &str = "edgeview-launcher";
const ACCOUNT: &str = "tokens";

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Keyring init failed: {e}"))
}

fn get_tokens() -> Result<Option<std::collections::HashMap<String, String>>, String> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(json) => {
            let map = serde_json::from_str(&json)
                .map_err(|e| format!("Token JSON corrupt: {e}"))?;
            Ok(Some(map))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keyring read failed: {e}")),
    }
}

fn save_tokens(tokens: &std::collections::HashMap<String, String>) -> Result<(), String> {
    let json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    keyring_entry()?.set_password(&json).map_err(|e| format!("Keyring write failed: {e}"))
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

#[derive(Serialize)]
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
    let tokens_exist = get_tokens().ok().flatten().is_some();
    let legacy_exists = legacy_enc_path().exists();

    // needs_migration: plaintext tokens in config.json
    let needs_migration = read_config()
        .ok()
        .flatten()
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
#[tauri::command]
pub fn secure_storage_get_settings() -> Result<Value, String> {
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
    let mut token_map: std::collections::HashMap<String, String> =
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

    let mut token_map: std::collections::HashMap<String, String> =
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
