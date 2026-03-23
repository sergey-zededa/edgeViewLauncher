package cache

import (
	"crypto/sha256"
	"edgeViewLauncher/internal/config"
	"edgeViewLauncher/internal/zededa"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// CachedDevice is a minimal representation stored on disk.
type CachedDevice struct {
	ID      string `json:"i"`
	Name    string `json:"n"`
	Project string `json:"p"`
	Status  string `json:"s"`
}

// CachedProject is a minimal representation stored on disk.
type CachedProject struct {
	ID   string `json:"i"`
	Name string `json:"n"`
}

// ClusterCache holds the device/project data for a single cluster.
type ClusterCache struct {
	Devices   []CachedDevice  `json:"d"`
	Projects  []CachedProject `json:"p"`
	UpdatedAt time.Time       `json:"t"`
}

// ZededaFetcher is the subset of the zededa client needed by the cache.
type ZededaFetcher interface {
	SearchNodesWithToken(query string, limit int, pageToken string, projectID string) (*zededa.SearchResult, error)
	GetProjects() ([]zededa.Project, error)
}

// Manager owns the device/project cache lifecycle for one cluster at a time.
type Manager struct {
	mu         sync.RWMutex
	cache      *ClusterCache
	cluster    string
	stopCh     chan struct{}
	stopped    chan struct{} // closed when background goroutine exits
	refreshing atomic.Bool
}

// NewManager creates a new cache Manager.
func NewManager() *Manager {
	return &Manager{}
}

// Get returns the current in-memory cache (may be nil).
func (m *Manager) Get() *ClusterCache {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cache
}

// IsRefreshing returns true while a background refresh is in progress.
func (m *Manager) IsRefreshing() bool {
	return m.refreshing.Load()
}

// Load reads the disk cache for the given cluster into memory.
func (m *Manager) Load(clusterName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.cluster = clusterName

	path, err := cacheFilePath(clusterName)
	if err != nil {
		return err
	}

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		m.cache = nil
		return nil
	}
	if err != nil {
		return err
	}

	var cc ClusterCache
	if err := json.Unmarshal(data, &cc); err != nil {
		m.cache = nil
		return nil // treat corrupt cache as empty
	}
	m.cache = &cc
	return nil
}

// Save writes the current in-memory cache to disk.
func (m *Manager) Save() error {
	m.mu.RLock()
	cc := m.cache
	cluster := m.cluster
	m.mu.RUnlock()

	if cc == nil || cluster == "" {
		return nil
	}

	path, err := cacheFilePath(cluster)
	if err != nil {
		return err
	}

	data, err := json.Marshal(cc)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// Refresh fetches all devices and projects from the API and updates the cache.
func (m *Manager) Refresh(client ZededaFetcher) error {
	if client == nil {
		return fmt.Errorf("no API client available")
	}

	m.refreshing.Store(true)
	defer m.refreshing.Store(false)

	// Fetch all devices via pagination, with per-page retry
	var devices []CachedDevice
	pageToken := ""
	for {
		var result *zededa.SearchResult
		var err error
		for attempt := 0; attempt < 3; attempt++ {
			result, err = client.SearchNodesWithToken("", 200, pageToken, "")
			if err == nil {
				break
			}
			log.Printf("[Cache] Device fetch attempt %d failed: %v", attempt+1, err)
			time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
		}
		if err != nil {
			return fmt.Errorf("fetching devices: %w", err)
		}
		pageCount := len(result.Nodes)
		for _, n := range result.Nodes {
			devices = append(devices, CachedDevice{
				ID:      n.ID,
				Name:    n.Name,
				Project: n.Project,
				Status:  n.Status,
			})
		}
		// Stop if no next cursor or if we got fewer results than the page size
		if result.NextToken == "" || pageCount < 200 {
			break
		}
		pageToken = result.NextToken
	}

	// Fetch all projects with retry
	var projList []zededa.Project
	var projErr error
	for attempt := 0; attempt < 3; attempt++ {
		projList, projErr = client.GetProjects()
		if projErr == nil {
			break
		}
		log.Printf("[Cache] Project fetch attempt %d failed: %v", attempt+1, projErr)
		time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
	}
	if projErr != nil {
		return fmt.Errorf("fetching projects: %w", projErr)
	}
	projects := make([]CachedProject, len(projList))
	for i, p := range projList {
		projects[i] = CachedProject{ID: p.ID, Name: p.Name}
	}

	now := time.Now().UTC()

	m.mu.Lock()
	m.cache = &ClusterCache{
		Devices:   devices,
		Projects:  projects,
		UpdatedAt: now,
	}
	m.mu.Unlock()

	if err := m.Save(); err != nil {
		log.Printf("[Cache] Warning: failed to save cache to disk: %v", err)
	}

	log.Printf("[Cache] Refreshed: %d devices, %d projects", len(devices), len(projects))
	return nil
}

// SwitchCluster stops any background refresh, loads the new cluster's cache, and returns.
func (m *Manager) SwitchCluster(clusterName string) {
	m.StopBackground()

	if err := m.Load(clusterName); err != nil {
		log.Printf("[Cache] Warning: failed to load cache for %q: %v", clusterName, err)
	}
}

// StartBackground starts a goroutine that refreshes the cache immediately and
// then at the given interval. It is safe to call multiple times; previous
// goroutines are stopped first.
func (m *Manager) StartBackground(client ZededaFetcher, interval time.Duration) {
	m.StopBackground()

	m.mu.Lock()
	m.stopCh = make(chan struct{})
	m.stopped = make(chan struct{})
	m.mu.Unlock()

	stopCh := m.stopCh
	stopped := m.stopped

	go func() {
		defer close(stopped)

		// Initial refresh with short retries on failure.
		// The first call often races with config injection at startup,
		// so a transient 500 is expected — retry quickly before falling
		// back to the normal long-interval ticker.
		for retries := 0; retries < 3; retries++ {
			err := m.Refresh(client)
			if err == nil {
				break
			}
			log.Printf("[Cache] Initial refresh attempt %d failed: %v", retries+1, err)

			delay := time.Duration(retries+1) * 5 * time.Second
			select {
			case <-stopCh:
				return
			case <-time.After(delay):
			}
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				if err := m.Refresh(client); err != nil {
					log.Printf("[Cache] Background refresh failed: %v", err)
				}
			}
		}
	}()
}

// StopBackground stops the background refresh goroutine and waits for it to exit.
func (m *Manager) StopBackground() {
	m.mu.Lock()
	stopCh := m.stopCh
	stopped := m.stopped
	m.stopCh = nil
	m.stopped = nil
	m.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
		if stopped != nil {
			<-stopped
		}
	}
}

// cacheFilePath returns the path to the cache file for a given cluster name.
func cacheFilePath(clusterName string) (string, error) {
	dir, err := config.GetConfigDir()
	if err != nil {
		return "", err
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(clusterName)))[:8]
	return filepath.Join(dir, fmt.Sprintf("cache-%s.json", hash)), nil
}
