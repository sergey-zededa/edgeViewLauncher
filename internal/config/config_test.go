package config

import (
    "encoding/json"
    "os"
    "path/filepath"
    "testing"
)

// TestLoadCreatesDefaultWhenMissing ensures a sane default config is created
// when no config file exists.
func TestLoadCreatesDefaultWhenMissing(t *testing.T) {
    t.Helper()

    tmpDir := t.TempDir()
    t.Setenv("HOME", tmpDir)

    cfg, err := Load()
    if err != nil {
        t.Fatalf("Load() returned error: %v", err)
    }
    if len(cfg.Clusters) != 1 {
        t.Fatalf("expected 1 default cluster, got %d", len(cfg.Clusters))
    }
    if cfg.ActiveCluster == "" {
        t.Fatalf("expected ActiveCluster to be set")
    }
}

// TestSaveAndReloadRoundTrip verifies that Save writes a JSON file which
// Load can parse back into an equivalent config.
func TestSaveAndReloadRoundTrip(t *testing.T) {
    tmpDir := t.TempDir()
    t.Setenv("HOME", tmpDir)

    cfg := &Config{
        RecentDevices: []string{"node1", "node2"},
        Clusters: []ClusterConfig{
            {Name: "Cluster A", BaseURL: "https://example", APIToken: "entA:token"},
            {Name: "Cluster B", BaseURL: "https://example2", APIToken: "entB:token"},
        },
        ActiveCluster: "Cluster B",
    }

    if err := Save(cfg); err != nil {
        t.Fatalf("Save() returned error: %v", err)
    }

    // Sanity check that file exists and is valid JSON
    dir, err := GetConfigDir()
    if err != nil {
        t.Fatalf("GetConfigDir() error: %v", err)
    }
    raw, err := os.ReadFile(filepath.Join(dir, "config.json"))
    if err != nil {
        t.Fatalf("failed to read saved config: %v", err)
    }
    var decoded map[string]interface{}
    if err := json.Unmarshal(raw, &decoded); err != nil {
        t.Fatalf("saved config is not valid JSON: %v", err)
    }

    loaded, err := Load()
    if err != nil {
        t.Fatalf("Load() after Save() returned error: %v", err)
    }

    if loaded.ActiveCluster != cfg.ActiveCluster {
        t.Fatalf("expected ActiveCluster %q, got %q", cfg.ActiveCluster, loaded.ActiveCluster)
    }
    if len(loaded.Clusters) != len(cfg.Clusters) {
        t.Fatalf("expected %d clusters, got %d", len(cfg.Clusters), len(loaded.Clusters))
    }
}