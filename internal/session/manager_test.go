package session

import (
	"errors"
	"testing"
	"time"

	"edgeViewLauncher/internal/zededa"
)

func TestCachedSessionExpiryAndRetrieval(t *testing.T) {
	m := NewManager()

	// Expired session should not be returned
	expired := time.Now().Add(-time.Minute)
	m.StoreCachedSession("node-expired", &zededa.SessionConfig{URL: "wss://example"}, 0, expired)

	if _, ok := m.GetCachedSession("node-expired"); ok {
		t.Fatalf("expected expired session to be treated as missing")
	}

	// Valid session should be returned
	valid := time.Now().Add(time.Hour)
	m.StoreCachedSession("node-valid", &zededa.SessionConfig{URL: "wss://example2"}, 55780, valid)

	s, ok := m.GetCachedSession("node-valid")
	if !ok {
		t.Fatalf("expected valid session to be found")
	}
	if s.Port != 55780 {
		t.Fatalf("expected port 55780, got %d", s.Port)
	}
}

func TestTunnelRegistryLifecycle(t *testing.T) {
	m := NewManager()

	t1 := &Tunnel{ID: "t1", NodeID: "nodeA", LocalPort: 1001}
	t2 := &Tunnel{ID: "t2", NodeID: "nodeB", LocalPort: 1002}

	m.RegisterTunnel(t1)
	m.RegisterTunnel(t2)

	if got, ok := m.GetTunnel("t1"); !ok || got.ID != "t1" {
		t.Fatalf("expected to retrieve tunnel t1")
	}

	listA := m.ListTunnels("nodeA")
	if len(listA) != 1 || listA[0].ID != "t1" {
		t.Fatalf("expected 1 tunnel for nodeA, got %+v", listA)
	}

	all := m.GetAllTunnels()
	if len(all) != 2 {
		t.Fatalf("expected 2 tunnels in registry, got %d", len(all))
	}

	if err := m.CloseTunnel("t1"); err != nil {
		t.Fatalf("CloseTunnel returned error: %v", err)
	}
	if _, ok := m.GetTunnel("t1"); ok {
		t.Fatalf("expected tunnel t1 to be removed after CloseTunnel")
	}
}

func TestFailTunnel(t *testing.T) {
	m := NewManager()
	t1 := &Tunnel{ID: "t1", NodeID: "nodeA", Status: "active"}
	m.RegisterTunnel(t1)

	// Mark as failed
	errMsg := "connection reset"
	m.FailTunnel("t1", errors.New(errMsg))

	// Verify status update
	failed, ok := m.GetTunnel("t1")
	if !ok {
		t.Fatalf("expected tunnel t1 to exist")
	}
	if failed.Status != "failed" {
		t.Errorf("expected status 'failed', got %q", failed.Status)
	}
	if failed.Error != errMsg {
		t.Errorf("expected error %q, got %q", errMsg, failed.Error)
	}
}

func TestTunnelStats(t *testing.T) {
	tunnel := &Tunnel{}

	// Initial check
	sent, received, lastAct := tunnel.GetStats()
	if sent != 0 || received != 0 {
		t.Errorf("expected 0 stats, got sent=%d received=%d", sent, received)
	}
	if !lastAct.IsZero() {
		t.Errorf("expected zero last activity, got %v", lastAct)
	}

	// Add stats
	tunnel.AddBytesSent(100)
	time.Sleep(1 * time.Millisecond) // Ensure time moves forward
	tunnel.AddBytesReceived(200)

	sent, received, lastAct = tunnel.GetStats()
	if sent != 100 {
		t.Errorf("expected sent 100, got %d", sent)
	}
	if received != 200 {
		t.Errorf("expected received 200, got %d", received)
	}
	if lastAct.IsZero() {
		t.Errorf("expected non-zero last activity")
	}

	// Verify last activity updates
	time.Sleep(1 * time.Millisecond)
	before := lastAct
	tunnel.AddBytesSent(50)
	_, _, after := tunnel.GetStats()
	if !after.After(before) {
		t.Errorf("expected last activity to update")
	}
}
