package cache

import (
	"edgeViewLauncher/internal/zededa"
	"fmt"
	"os"
	"testing"
	"time"
)

// mockFetcher implements ZededaFetcher for testing.
type mockFetcher struct {
	pages    [][]zededa.Node
	projects []zededa.Project
	callIdx  int
}

func (m *mockFetcher) SearchNodesWithToken(query string, limit int, pageToken string, projectID string) (*zededa.SearchResult, error) {
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

func (m *mockFetcher) GetProjects() ([]zededa.Project, error) {
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
