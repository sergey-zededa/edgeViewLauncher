package cache

import (
	"context"
	"crypto/sha256"
	"edgeViewLauncher/internal/config"
	"edgeViewLauncher/internal/zededa"
	"encoding/json"
	"errors"
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
// The Ctx variants allow the cache to abort an in-flight refresh when the
// user switches clusters, instead of blocking SwitchCluster for the full
// duration of a 20–30s pagination sweep.
type ZededaFetcher interface {
	SearchNodesWithTokenCtx(ctx context.Context, query string, limit int, pageToken string, projectID string) (*zededa.SearchResult, error)
	GetProjectsCtx(ctx context.Context) ([]zededa.Project, error)
}

// Manager owns the device/project cache lifecycle for one cluster at a time.
type Manager struct {
	mu         sync.RWMutex
	cache      *ClusterCache
	cluster    string
	stopCh     chan struct{}
	stopped    chan struct{} // closed when background goroutine exits
	refreshing atomic.Bool

	// refreshCancel cancels the context passed into the current Refresh call.
	// Guarded by refreshMu so StopBackground and a concurrent Refresh can't
	// race on reading/writing the cancel func.
	refreshMu     sync.Mutex
	refreshCancel context.CancelFunc
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
// If a refresh is already in progress this call is a no-op — concurrent
// refreshes would race to overwrite m.cache and the disk file.
func (m *Manager) Refresh(client ZededaFetcher) error {
	return m.RefreshCtx(context.Background(), client)
}

// RefreshCtx is the context-aware variant. When ctx is cancelled the pagination
// loop exits early and m.cache is NOT overwritten, so an aborted refresh from a
// previous cluster can never poison the new cluster's cache.
func (m *Manager) RefreshCtx(ctx context.Context, client ZededaFetcher) error {
	if client == nil {
		return fmt.Errorf("no API client available")
	}

	// Dedupe: if a refresh is already running, skip. Saves API calls and avoids
	// two goroutines racing to write m.cache.
	if !m.refreshing.CompareAndSwap(false, true) {
		return nil
	}
	defer m.refreshing.Store(false)

	// Install the cancel func so StopBackground (and SwitchCluster) can abort us.
	refreshCtx, cancel := context.WithCancel(ctx)
	m.refreshMu.Lock()
	m.refreshCancel = cancel
	m.refreshMu.Unlock()
	defer func() {
		m.refreshMu.Lock()
		m.refreshCancel = nil
		m.refreshMu.Unlock()
		cancel()
	}()

	// Snapshot the cluster this refresh was launched for. If SwitchCluster has
	// changed m.cluster by the time we finish, we must NOT persist results.
	m.mu.RLock()
	launchCluster := m.cluster
	m.mu.RUnlock()

	// Fetch devices and projects in parallel
	var devices []CachedDevice
	var devErr error
	var projList []zededa.Project
	var projErr error

	var wg sync.WaitGroup
	wg.Add(2)

	// Goroutine 1: Fetch all devices via pagination
	go func() {
		defer wg.Done()
		pageToken := ""
		for {
			if refreshCtx.Err() != nil {
				devErr = refreshCtx.Err()
				return
			}
			var result *zededa.SearchResult
			var err error
			for attempt := 0; attempt < 2; attempt++ {
				result, err = client.SearchNodesWithTokenCtx(refreshCtx, "", 200, pageToken, "")
				if err == nil {
					break
				}
				if errors.Is(err, context.Canceled) {
					devErr = err
					return
				}
				log.Printf("[Cache] Device fetch attempt %d failed: %v", attempt+1, err)
				select {
				case <-refreshCtx.Done():
					devErr = refreshCtx.Err()
					return
				case <-time.After(time.Duration(attempt+1) * time.Second):
				}
			}
			if err != nil {
				devErr = fmt.Errorf("fetching devices: %w", err)
				return
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
			if result.NextToken == "" || pageCount < 200 {
				break
			}
			pageToken = result.NextToken
		}
	}()

	// Goroutine 2: Fetch all projects
	go func() {
		defer wg.Done()
		for attempt := 0; attempt < 2; attempt++ {
			if refreshCtx.Err() != nil {
				projErr = refreshCtx.Err()
				return
			}
			projList, projErr = client.GetProjectsCtx(refreshCtx)
			if projErr == nil {
				return
			}
			if errors.Is(projErr, context.Canceled) {
				return
			}
			log.Printf("[Cache] Project fetch attempt %d failed: %v", attempt+1, projErr)
			select {
			case <-refreshCtx.Done():
				projErr = refreshCtx.Err()
				return
			case <-time.After(time.Duration(attempt+1) * time.Second):
			}
		}
	}()

	wg.Wait()

	// Cancelled mid-flight: drop the partial result, do not touch the cache.
	// This is what prevents a stale cluster-A refresh from writing cluster-B's
	// cache file after the user switched.
	if refreshCtx.Err() != nil {
		return refreshCtx.Err()
	}

	if devErr != nil {
		return devErr
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
	// Guard: the cluster may have been switched while we were fetching. Only
	// commit the result if the manager is still on the cluster we started for.
	if m.cluster != launchCluster {
		m.mu.Unlock()
		log.Printf("[Cache] Refresh result discarded: cluster changed %q → %q during fetch", launchCluster, m.cluster)
		return nil
	}
	m.cache = &ClusterCache{
		Devices:   devices,
		Projects:  projects,
		UpdatedAt: now,
	}
	m.mu.Unlock()

	if err := m.Save(); err != nil {
		log.Printf("[Cache] Warning: failed to save cache to disk: %v", err)
	}

	log.Printf("[Cache] Refreshed %s: %d devices, %d projects", launchCluster, len(devices), len(projects))
	return nil
}

// SwitchCluster cancels any in-flight refresh, loads the new cluster's cache,
// and returns. This is the primary path the UI depends on for an instant switch.
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
			select {
			case <-stopCh:
				return
			default:
			}
			err := m.Refresh(client)
			if err == nil {
				break
			}
			if errors.Is(err, context.Canceled) {
				return
			}
			log.Printf("[Cache] Initial refresh attempt %d failed: %v", retries+1, err)

			delay := time.Duration(retries+1) * time.Second
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
				if err := m.Refresh(client); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("[Cache] Background refresh failed: %v", err)
				}
			}
		}
	}()
}

// StopBackground cancels any in-flight refresh and stops the background loop.
// It returns once the goroutine has exited.
func (m *Manager) StopBackground() {
	m.mu.Lock()
	stopCh := m.stopCh
	stopped := m.stopped
	m.stopCh = nil
	m.stopped = nil
	m.mu.Unlock()

	// Cancel any in-flight refresh so the goroutine can exit quickly instead of
	// draining a 20–30s pagination sweep.
	m.refreshMu.Lock()
	if m.refreshCancel != nil {
		m.refreshCancel()
	}
	m.refreshMu.Unlock()

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
