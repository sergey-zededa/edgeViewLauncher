package cache

import (
	"context"
	"edgeViewLauncher/internal/zededa"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// mockFetcher implements ZededaFetcher for testing.
type mockFetcher struct {
	mu         sync.Mutex
	pages      [][]zededa.Node
	projects   []zededa.Project
	callIdx    int
	pageDelay  time.Duration // per-page artificial delay for cancellation tests
	pageCalls  atomic.Int32  // number of search calls made
	projCalls  atomic.Int32  // number of project calls made
	projDelay  time.Duration
}

func (m *mockFetcher) SearchNodesWithTokenCtx(ctx context.Context, query string, limit int, pageToken string, projectID string) (*zededa.SearchResult, error) {
	m.pageCalls.Add(1)
	if m.pageDelay > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(m.pageDelay):
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.callIdx >= len(m.pages) {
		return &zededa.SearchResult{}, nil
	}
	nodes := m.pages[m.callIdx]
	m.callIdx++
	nextToken := ""
	if m.callIdx < len(m.pages) {
		nextToken = "next"
	}
	return &zededa.SearchResult{Nodes: nodes, NextToken: nextToken}, nil
}

func (m *mockFetcher) GetProjectsCtx(ctx context.Context) ([]zededa.Project, error) {
	m.projCalls.Add(1)
	if m.projDelay > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(m.projDelay):
		}
	}
	return m.projects, nil
}

func TestLoadSaveRoundTrip(t *testing.T) {
	// Use temp dir for config
	tmpDir := t.TempDir()
	os.Setenv("HOME", tmpDir)
	defer os.Unsetenv("HOME")

	// Ensure the config dir exists
	os.MkdirAll(tmpDir+"/.edgeview-launcher", 0700)

	mgr := NewManager()

	// Load non-existent cluster → nil cache
	if err := mgr.Load("test-cluster"); err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if mgr.Get() != nil {
		t.Fatal("expected nil cache for non-existent cluster")
	}

	// Set cache manually and save
	mgr.mu.Lock()
	mgr.cache = &ClusterCache{
		Devices: []CachedDevice{
			{ID: "d1", Name: "Device1", Project: "p1", Status: "online"},
			{ID: "d2", Name: "Device2", Project: "p2", Status: "offline"},
		},
		Projects: []CachedProject{
			{ID: "p1", Name: "Project1"},
		},
		UpdatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	mgr.mu.Unlock()

	if err := mgr.Save(); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Load into a new manager
	mgr2 := NewManager()
	if err := mgr2.Load("test-cluster"); err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	cc := mgr2.Get()
	if cc == nil {
		t.Fatal("expected non-nil cache after load")
	}
	if len(cc.Devices) != 2 {
		t.Fatalf("expected 2 devices, got %d", len(cc.Devices))
	}
	if cc.Devices[0].Name != "Device1" {
		t.Fatalf("expected Device1, got %s", cc.Devices[0].Name)
	}
	if len(cc.Projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(cc.Projects))
	}
}

func TestRefreshMultiplePages(t *testing.T) {
	tmpDir := t.TempDir()
	os.Setenv("HOME", tmpDir)
	defer os.Unsetenv("HOME")
	os.MkdirAll(tmpDir+"/.edgeview-launcher", 0700)

	// First page must have exactly 200 items (the page size) so the
	// pagination loop continues to the second page.
	firstPage := make([]zededa.Node, 200)
	for i := range firstPage {
		firstPage[i] = zededa.Node{ID: fmt.Sprintf("n%d", i), Name: fmt.Sprintf("Node%d", i), Project: "p1", Status: "online"}
	}
	secondPage := []zededa.Node{
		{ID: "n200", Name: "Node200", Project: "p2", Status: "online"},
	}

	fetcher := &mockFetcher{
		pages: [][]zededa.Node{firstPage, secondPage},
		projects: []zededa.Project{
			{ID: "p1", Name: "ProjectA"},
			{ID: "p2", Name: "ProjectB"},
		},
	}

	mgr := NewManager()
	mgr.mu.Lock()
	mgr.cluster = "multi-page-cluster"
	mgr.mu.Unlock()

	if err := mgr.Refresh(fetcher); err != nil {
		t.Fatalf("Refresh failed: %v", err)
	}

	cc := mgr.Get()
	if cc == nil {
		t.Fatal("expected non-nil cache after refresh")
	}
	if len(cc.Devices) != 201 {
		t.Fatalf("expected 201 devices, got %d", len(cc.Devices))
	}
	if len(cc.Projects) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(cc.Projects))
	}
	if !cc.UpdatedAt.After(time.Time{}) {
		t.Fatal("expected non-zero UpdatedAt")
	}
}

func TestSwitchCluster(t *testing.T) {
	tmpDir := t.TempDir()
	os.Setenv("HOME", tmpDir)
	defer os.Unsetenv("HOME")
	os.MkdirAll(tmpDir+"/.edgeview-launcher", 0700)

	mgr := NewManager()

	// Save cache for cluster A
	mgr.mu.Lock()
	mgr.cluster = "cluster-a"
	mgr.cache = &ClusterCache{
		Devices:   []CachedDevice{{ID: "a1", Name: "DevA"}},
		Projects:  []CachedProject{},
		UpdatedAt: time.Now(),
	}
	mgr.mu.Unlock()
	mgr.Save()

	// Save cache for cluster B
	mgr.mu.Lock()
	mgr.cluster = "cluster-b"
	mgr.cache = &ClusterCache{
		Devices:   []CachedDevice{{ID: "b1", Name: "DevB"}, {ID: "b2", Name: "DevB2"}},
		Projects:  []CachedProject{},
		UpdatedAt: time.Now(),
	}
	mgr.mu.Unlock()
	mgr.Save()

	// Switch to cluster A
	mgr.SwitchCluster("cluster-a")
	cc := mgr.Get()
	if cc == nil || len(cc.Devices) != 1 || cc.Devices[0].Name != "DevA" {
		t.Fatal("expected cluster-a cache after switch")
	}

	// Switch to cluster B
	mgr.SwitchCluster("cluster-b")
	cc = mgr.Get()
	if cc == nil || len(cc.Devices) != 2 || cc.Devices[0].Name != "DevB" {
		t.Fatal("expected cluster-b cache after switch")
	}
}

func TestIsRefreshing(t *testing.T) {
	mgr := NewManager()
	if mgr.IsRefreshing() {
		t.Fatal("expected not refreshing initially")
	}
}

// TestSwitchClusterCancelsInFlightRefresh guarantees the fix for the 20–30s
// stale-data bug: when a refresh for the old cluster is mid-pagination and the
// user switches clusters, SwitchCluster must return promptly and must not let
// the aborted refresh overwrite the new cluster's cache.
func TestSwitchClusterCancelsInFlightRefresh(t *testing.T) {
	tmpDir := t.TempDir()
	os.Setenv("HOME", tmpDir)
	defer os.Unsetenv("HOME")
	os.MkdirAll(tmpDir+"/.edgeview-launcher", 0700)

	// Slow fetcher that takes 2s per page — plenty of time to cancel.
	pages := make([][]zededa.Node, 5)
	for i := range pages {
		page := make([]zededa.Node, 200)
		for j := range page {
			page[j] = zededa.Node{ID: fmt.Sprintf("old-%d-%d", i, j), Name: "old"}
		}
		pages[i] = page
	}
	fetcher := &mockFetcher{
		pages:     pages,
		projects:  []zededa.Project{{ID: "p", Name: "OldProj"}},
		pageDelay: 2 * time.Second,
	}

	mgr := NewManager()
	mgr.SwitchCluster("cluster-a")

	// Start a background refresh for cluster A that will take >10s to complete.
	mgr.StartBackground(fetcher, 10*time.Minute)

	// Give the goroutine a moment to start fetching.
	time.Sleep(100 * time.Millisecond)
	if !mgr.IsRefreshing() {
		t.Fatal("expected refresh to be in progress")
	}

	// Pre-populate disk cache for cluster B so SwitchCluster has something to load.
	mgrB := NewManager()
	mgrB.mu.Lock()
	mgrB.cluster = "cluster-b"
	mgrB.cache = &ClusterCache{
		Devices:   []CachedDevice{{ID: "b1", Name: "NewDev"}},
		Projects:  []CachedProject{{ID: "bp", Name: "NewProj"}},
		UpdatedAt: time.Now(),
	}
	mgrB.mu.Unlock()
	mgrB.Save()

	// Switch to B. This must return within ~500ms even though the cluster-A
	// refresh would have taken ≥10s.
	start := time.Now()
	mgr.SwitchCluster("cluster-b")
	elapsed := time.Since(start)
	if elapsed > 1500*time.Millisecond {
		t.Fatalf("SwitchCluster took %v — expected near-instant cancellation", elapsed)
	}

	// The loaded cache must be cluster B's data, not mixed with the aborted
	// cluster-A refresh.
	cc := mgr.Get()
	if cc == nil {
		t.Fatal("expected non-nil cache after switch to cluster-b")
	}
	if len(cc.Devices) != 1 || cc.Devices[0].Name != "NewDev" {
		t.Fatalf("expected cluster-b cache, got %+v", cc.Devices)
	}

	// Give the aborted goroutine a moment to finish its deferred cleanup,
	// then confirm cluster B's disk cache wasn't clobbered by the abort.
	time.Sleep(200 * time.Millisecond)
	mgrCheck := NewManager()
	if err := mgrCheck.Load("cluster-b"); err != nil {
		t.Fatalf("Load cluster-b: %v", err)
	}
	cc = mgrCheck.Get()
	if cc == nil || len(cc.Devices) != 1 || cc.Devices[0].Name != "NewDev" {
		t.Fatalf("cluster-b disk cache was corrupted by aborted refresh: %+v", cc)
	}
}

// TestRefreshDedupe ensures two concurrent Refresh() calls don't both hit the API.
func TestRefreshDedupe(t *testing.T) {
	tmpDir := t.TempDir()
	os.Setenv("HOME", tmpDir)
	defer os.Unsetenv("HOME")
	os.MkdirAll(tmpDir+"/.edgeview-launcher", 0700)

	fetcher := &mockFetcher{
		pages: [][]zededa.Node{{
			{ID: "n1", Name: "N1"},
		}},
		projects:  []zededa.Project{{ID: "p1", Name: "P1"}},
		pageDelay: 200 * time.Millisecond,
	}

	mgr := NewManager()
	mgr.mu.Lock()
	mgr.cluster = "dedupe-cluster"
	mgr.mu.Unlock()

	// Launch two refreshes concurrently.
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); mgr.Refresh(fetcher) }()
	// Tiny sleep so the first one wins the CAS.
	time.Sleep(10 * time.Millisecond)
	go func() { defer wg.Done(); mgr.Refresh(fetcher) }()
	wg.Wait()

	if got := fetcher.pageCalls.Load(); got != 1 {
		t.Fatalf("expected 1 page call (dedupe), got %d", got)
	}
}
