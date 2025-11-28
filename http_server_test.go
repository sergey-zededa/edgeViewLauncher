package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"edgeViewLauncher/internal/config"
	"edgeViewLauncher/internal/session"
	"edgeViewLauncher/internal/zededa"
)

// newTestServer constructs an HTTPServer with a minimally configured App
// suitable for handler-level tests without any external ZEDEDA/EdgeView calls.
func newTestServer(t *testing.T) *HTTPServer {
	// Ensure any implicit config.Save calls write into a temporary HOME.
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	a := &App{
		config: &config.Config{
			Clusters: []config.ClusterConfig{
				{Name: "Second Foundation", BaseURL: "https://zedcontrol.hummingbird.zededa.net", APIToken: "sf-enterprise:abc123"},
			},
			ActiveCluster: "Second Foundation",
		},
		sessionManager: session.NewManager(),
		// enrichmentCache and ctx are not needed for these tests
		enrichmentCache: make(map[string]AppEnrichment),
	}

	// Prime one cached session used by the session-status handler.
	expiresAt := time.Now().Add(time.Hour)
	a.sessionManager.StoreCachedSession("node-1", &zededa.SessionConfig{URL: "wss://example"}, 55780, expiresAt)

	return &HTTPServer{app: a, port: 0}
}

func TestHandleGetUserInfo(t *testing.T) {
	srv := newTestServer(t)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/user-info", nil)

	srv.handleGetUserInfo(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var resp APIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success=true, got false (error=%s)", resp.Error)
	}

	data, ok := resp.Data.(map[string]interface{})
	if !ok {
		// If json package decoded into map[string]interface{}, perform second marshal/unmarshal.
		raw, _ := json.Marshal(resp.Data)
		if err := json.Unmarshal(raw, &data); err != nil {
			t.Fatalf("failed to coerce data into map: %v", err)
		}
	}

	if data["clusterName"] != "Second Foundation" {
		t.Fatalf("expected clusterName 'Second Foundation', got %v", data["clusterName"])
	}
}

func TestHandleGetSessionStatus(t *testing.T) {
	srv := newTestServer(t)

	body, err := json.Marshal(NodeIDRequest{NodeID: "node-1"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/session-status", bytes.NewReader(body))

	srv.handleGetSessionStatus(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var resp APIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success=true, got false (error=%s)", resp.Error)
	}

	// Coerce Data into a map to inspect fields.
	raw, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("re-marshal data: %v", err)
	}
	var status map[string]interface{}
	if err := json.Unmarshal(raw, &status); err != nil {
		t.Fatalf("unmarshal status: %v", err)
	}

	if active, _ := status["active"].(bool); !active {
		t.Fatalf("expected active=true in session status")
	}
}

func TestHandleAddRecentDevice(t *testing.T) {
	srv := newTestServer(t)

	body, err := json.Marshal(NodeIDRequest{NodeID: "node-xyz"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/recent-device", bytes.NewReader(body))

	// HOME is already redirected in newTestServer; just invoke the handler.
	srv.handleAddRecentDevice(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	// Ensure the device ID was added to in-memory config.
	found := false
	for _, id := range srv.app.config.RecentDevices {
		if id == "node-xyz" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected node-xyz to be present in RecentDevices")
	}
}
