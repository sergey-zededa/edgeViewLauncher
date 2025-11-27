package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type ClusterConfig struct {
	Name     string `json:"name"`
	BaseURL  string `json:"baseUrl"`
	APIToken string `json:"apiToken"`
}

type Config struct {
	BaseURL       string          `json:"baseUrl"`  // Deprecated: use Clusters/ActiveCluster
	APIToken      string          `json:"apiToken"` // Deprecated: use Clusters/ActiveCluster
	RecentDevices []string        `json:"recentDevices"`
	Clusters      []ClusterConfig `json:"clusters"`
	ActiveCluster string          `json:"activeCluster"` // Name of the active cluster
}

func GetConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".edgeview-launcher")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

func Load() (*Config, error) {
	dir, err := GetConfigDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "config.json")

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return &Config{
			Clusters: []ClusterConfig{
				{
					Name:    "Default Cluster",
					BaseURL: "https://zedcontrol.zededa.net",
				},
			},
			ActiveCluster: "Default Cluster",
		}, nil
	}
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	// Migration: If we have legacy config but no clusters, migrate it
	if len(cfg.Clusters) == 0 && cfg.BaseURL != "" {
		cfg.Clusters = []ClusterConfig{
			{
				Name:     "Default Cluster",
				BaseURL:  cfg.BaseURL,
				APIToken: cfg.APIToken,
			},
		}
		cfg.ActiveCluster = "Default Cluster"
		// Clear legacy fields to avoid confusion in future saves (optional, but cleaner)
		cfg.BaseURL = ""
		cfg.APIToken = ""
	} else if len(cfg.Clusters) == 0 {
		// No legacy and no clusters? Initialize default
		cfg.Clusters = []ClusterConfig{
			{
				Name:    "Default Cluster",
				BaseURL: "https://zedcontrol.zededa.net",
			},
		}
		cfg.ActiveCluster = "Default Cluster"
	}

	// Ensure ActiveCluster is valid
	found := false
	for _, c := range cfg.Clusters {
		if c.Name == cfg.ActiveCluster {
			found = true
			break
		}
	}
	if !found && len(cfg.Clusters) > 0 {
		cfg.ActiveCluster = cfg.Clusters[0].Name
	}

	return &cfg, nil
}

func Save(cfg *Config) error {
	dir, err := GetConfigDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "config.json")

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}
