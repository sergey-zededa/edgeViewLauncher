package session

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"edgeViewLauncher/internal/zededa"

	"github.com/gorilla/websocket"
)

func TestCachedSessionExpiryAndRetrieval(t *testing.T) {
	m := NewManager()

	// Expired session should not be returned
	expired := time.Now().Add(-time.Minute)
	m.StoreCachedSession("node-expired", &zededa.SessionConfig{URL: "wss://example"}, 0, "", expired)

	if _, ok := m.GetCachedSession("node-expired"); ok {
		t.Fatalf("expected expired session to be treated as missing")
	}

	// Valid session should be returned
	valid := time.Now().Add(time.Hour)
	m.StoreCachedSession("node-valid", &zededa.SessionConfig{URL: "wss://example2"}, 55780, "", valid)

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

// --- StartProxyMulti orchestration tests ---
//
// These tests exercise the round-robin / parallel probe logic by injecting
// a fake tryAttempt via tryAttemptOverride. They never establish a real
// WebSocket; on failure paths the override returns a nil wsConn and an
// error, on the (rare) success paths they don't reach finalizeTunnel because
// every test forces all probes to fail.

type probeCall struct {
	target string
	instID int
	round  int // round index inferred from call order; not the arg
}

// newRecordingManager returns a Manager with a stubbed tryProxyAttempt that
// records each call and returns the error produced by `respond`. Backoff
// between rounds is collapsed to ~0 so tests run instantly.
func newRecordingManager(maxRounds int, respond func(call probeCall) error) (*Manager, *[]probeCall, *sync.Mutex) {
	m := NewManager()
	m.maxRoundsOverride = maxRounds
	m.roundBackoffOverride = func(round int) time.Duration { return time.Millisecond }

	var (
		mu    sync.Mutex
		calls []probeCall
	)
	m.tryAttemptOverride = func(ctx context.Context, cfg *zededa.SessionConfig, target string, instID int) (*websocket.Conn, string, error) {
		mu.Lock()
		// We don't know the round from inside; the caller infers it from
		// position in the recorded slice. Record raw target+instID here.
		c := probeCall{target: target, instID: instID}
		calls = append(calls, c)
		mu.Unlock()
		return nil, "", respond(c)
	}
	return m, &calls, &mu
}

func TestStartProxyMulti_RejectsEmptyCandidates(t *testing.T) {
	m := NewManager()
	_, _, err := m.StartProxyMulti(context.Background(), &zededa.SessionConfig{MaxInst: 2}, "node-x", nil, 22, "ssh", nil)
	if err == nil {
		t.Fatalf("expected error for empty candidate list")
	}
}

// Each round must touch every candidate IP once before backoff/retry.
func TestStartProxyMulti_RoundRobinAcrossIPs(t *testing.T) {
	candidates := []string{"127.0.0.1", "10.0.0.1", "192.168.1.1"}
	m, callsPtr, mu := newRecordingManager(2, func(c probeCall) error {
		return errors.New("synthetic failure")
	})

	cfg := &zededa.SessionConfig{MaxInst: 2}
	_, _, err := m.StartProxyMulti(context.Background(), cfg, "n1", candidates, 22, "ssh", nil)
	if err == nil {
		t.Fatalf("expected error when all probes fail")
	}

	mu.Lock()
	calls := append([]probeCall(nil), *callsPtr...)
	mu.Unlock()

	// 2 rounds × 3 candidates = 6 total probes.
	if len(calls) != 6 {
		t.Fatalf("expected 6 total probes (2 rounds × 3 IPs), got %d:\n%+v", len(calls), calls)
	}

	// Within each 3-call round, every IP must appear exactly once. Order
	// within a round can vary because parallel goroutines race; what we
	// guarantee is "every IP probed in this round before any IP gets a
	// second probe."
	for _, round := range [][]probeCall{calls[0:3], calls[3:6]} {
		seen := map[string]bool{}
		for _, c := range round {
			ip := stripPort(c.target)
			if seen[ip] {
				t.Fatalf("IP %s probed twice in the same round before round-robin completed:\n%+v", ip, calls)
			}
			seen[ip] = true
		}
		for _, want := range candidates {
			if !seen[want] {
				t.Fatalf("candidate %s missing from round, got round=%+v full=%+v", want, round, calls)
			}
		}
	}
}

// MaxInst caps how many goroutines run concurrently inside a single batch.
func TestStartProxyMulti_ParallelBatchCappedByMaxInst(t *testing.T) {
	const maxInst = 2
	candidates := []string{"a", "b", "c"} // 3 candidates, MaxInst=2 → batches [a,b] then [c]

	var (
		concurrent     int32
		peakConcurrent int32
	)
	m := NewManager()
	m.maxRoundsOverride = 1
	m.roundBackoffOverride = func(round int) time.Duration { return time.Millisecond }
	m.tryAttemptOverride = func(ctx context.Context, cfg *zededa.SessionConfig, target string, instID int) (*websocket.Conn, string, error) {
		now := atomic.AddInt32(&concurrent, 1)
		// Track high-water mark.
		for {
			peak := atomic.LoadInt32(&peakConcurrent)
			if now <= peak || atomic.CompareAndSwapInt32(&peakConcurrent, peak, now) {
				break
			}
		}
		// Hold the slot briefly so siblings overlap.
		time.Sleep(20 * time.Millisecond)
		atomic.AddInt32(&concurrent, -1)
		return nil, "", errors.New("synthetic failure")
	}

	cfg := &zededa.SessionConfig{MaxInst: maxInst}
	_, _, err := m.StartProxyMulti(context.Background(), cfg, "n1", candidates, 22, "ssh", nil)
	if err == nil {
		t.Fatalf("expected error when all probes fail")
	}

	// Expect exactly MaxInst probes overlapping in batch 1; batch 2 has
	// only one entry so concurrency drops to 1. So peak == MaxInst.
	if got := atomic.LoadInt32(&peakConcurrent); got != int32(maxInst) {
		t.Fatalf("expected peak concurrency %d (= MaxInst), got %d", maxInst, got)
	}
}

// Parallel slots in one batch must use distinct InstIDs, otherwise EdgeView
// rejects the second peer.
func TestStartProxyMulti_BatchSlotsUseDistinctInstIDs(t *testing.T) {
	const maxInst = 2
	candidates := []string{"a", "b"}

	type observation struct {
		target string
		instID int
	}
	var (
		mu   sync.Mutex
		obs  []observation
		hold = make(chan struct{}) // released after both probes have entered
		wg   sync.WaitGroup
	)
	wg.Add(2)

	m := NewManager()
	m.maxRoundsOverride = 1
	m.roundBackoffOverride = func(round int) time.Duration { return time.Millisecond }
	m.tryAttemptOverride = func(ctx context.Context, cfg *zededa.SessionConfig, target string, instID int) (*websocket.Conn, string, error) {
		mu.Lock()
		obs = append(obs, observation{target: target, instID: instID})
		mu.Unlock()
		wg.Done()
		<-hold
		return nil, "", errors.New("synthetic failure")
	}

	go func() {
		wg.Wait()
		close(hold)
	}()

	cfg := &zededa.SessionConfig{MaxInst: maxInst}
	_, _, _ = m.StartProxyMulti(context.Background(), cfg, "n1", candidates, 22, "ssh", nil)

	mu.Lock()
	defer mu.Unlock()
	if len(obs) != 2 {
		t.Fatalf("expected 2 observed probes, got %d", len(obs))
	}
	if obs[0].instID == obs[1].instID {
		t.Fatalf("parallel batch slots reused InstID %d (both probes), expected distinct IDs", obs[0].instID)
	}
}

// External-policy denial must short-circuit out of the round loop entirely.
func TestStartProxyMulti_ExternalPolicyShortCircuits(t *testing.T) {
	candidates := []string{"a", "b"}
	m, callsPtr, mu := newRecordingManager(5, func(c probeCall) error {
		return ErrExternalPolicyDenied
	})

	cfg := &zededa.SessionConfig{MaxInst: 2}
	_, _, err := m.StartProxyMulti(context.Background(), cfg, "n1", candidates, 22, "ssh", nil)
	if err != ErrExternalPolicyDenied {
		t.Fatalf("expected ErrExternalPolicyDenied, got %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	// Both slots in batch 1 race; the *second* result is observed. So we'd
	// see exactly len(candidates) probes from round 1 — never a round 2.
	if got := len(*callsPtr); got > len(candidates) {
		t.Fatalf("expected at most %d probes (one round) on policy denial, got %d", len(candidates), got)
	}
}

func stripPort(target string) string {
	for i := len(target) - 1; i >= 0; i-- {
		if target[i] == ':' {
			return target[:i]
		}
	}
	return target
}

// TestStoreCachedSessionTunnelIDPreserved verifies that the new TunnelID field
// round-trips through StoreCachedSession / GetCachedSession.
func TestStoreCachedSessionTunnelIDPreserved(t *testing.T) {
	m := NewManager()
	expires := time.Now().Add(time.Hour)
	m.StoreCachedSession("nodeA", &zededa.SessionConfig{URL: "wss://x"}, 12345, "tunnel-abc", expires)

	s, ok := m.GetCachedSession("nodeA")
	if !ok {
		t.Fatalf("expected cached session to exist")
	}
	if s.Port != 12345 {
		t.Errorf("expected port 12345, got %d", s.Port)
	}
	if s.TunnelID != "tunnel-abc" {
		t.Errorf("expected TunnelID 'tunnel-abc', got %q", s.TunnelID)
	}
}

// TestCloseTunnelClearsCachedPort verifies that closing a tunnel zeroes the
// matching cached session's Port/TunnelID while preserving Config + ExpiresAt.
func TestCloseTunnelClearsCachedPort(t *testing.T) {
	m := NewManager()
	expires := time.Now().Add(time.Hour)
	cfg := &zededa.SessionConfig{URL: "wss://x"}
	m.StoreCachedSession("nodeA", cfg, 12345, "t1", expires)
	m.RegisterTunnel(&Tunnel{ID: "t1", NodeID: "nodeA", LocalPort: 12345, Status: "active"})

	if err := m.CloseTunnel("t1"); err != nil {
		t.Fatalf("CloseTunnel: %v", err)
	}

	s, ok := m.GetCachedSession("nodeA")
	if !ok {
		t.Fatalf("expected cached session to remain after CloseTunnel")
	}
	if s.Port != 0 {
		t.Errorf("expected Port to be cleared, got %d", s.Port)
	}
	if s.TunnelID != "" {
		t.Errorf("expected TunnelID to be cleared, got %q", s.TunnelID)
	}
	if s.Config != cfg {
		t.Errorf("expected Config to be preserved")
	}
	if !s.ExpiresAt.Equal(expires) {
		t.Errorf("expected ExpiresAt to be preserved")
	}
}

// TestFailTunnelClearsCachedPort verifies that marking a tunnel failed also
// invalidates the cached port (same teardown semantics as CloseTunnel).
func TestFailTunnelClearsCachedPort(t *testing.T) {
	m := NewManager()
	expires := time.Now().Add(time.Hour)
	m.StoreCachedSession("nodeA", &zededa.SessionConfig{URL: "wss://x"}, 12345, "t1", expires)
	m.RegisterTunnel(&Tunnel{ID: "t1", NodeID: "nodeA", LocalPort: 12345, Status: "active"})

	m.FailTunnel("t1", errors.New("boom"))

	s, ok := m.GetCachedSession("nodeA")
	if !ok {
		t.Fatalf("expected cached session to remain after FailTunnel")
	}
	if s.Port != 0 || s.TunnelID != "" {
		t.Errorf("expected Port/TunnelID cleared, got Port=%d TunnelID=%q", s.Port, s.TunnelID)
	}
}

// TestStartProxyMulti_ReturnsOnFirstWinnerWithoutWaitingForStragglers verifies
// that raceBatch does not block on slow sibling probes once a winner is found.
// Before this fix, SSH establishment was gated on the slowest goroutine in
// the batch — typically an unreachable IPv6 link-local that took 15–30s to
// fail at the dialer level even after batchCtx was cancelled.
func TestStartProxyMulti_ReturnsOnFirstWinnerWithoutWaitingForStragglers(t *testing.T) {
	const slowProbeDuration = 750 * time.Millisecond
	candidates := []string{"fast", "slow"}

	m := NewManager()
	m.maxRoundsOverride = 1
	m.roundBackoffOverride = func(round int) time.Duration { return time.Millisecond }
	m.tryAttemptOverride = func(ctx context.Context, cfg *zededa.SessionConfig, target string, instID int) (*websocket.Conn, string, error) {
		// "fast" succeeds in ~5ms; "slow" sleeps slowProbeDuration even if
		// ctx is cancelled (mimics an OS dial that doesn't respect cancel).
		// We return (nil, "", nil) on success so StartProxyMulti's wsConn!=nil
		// guard skips finalizeTunnel — we only care about timing here.
		if strings.HasPrefix(target, "fast:") {
			time.Sleep(5 * time.Millisecond)
			return nil, "", nil
		}
		time.Sleep(slowProbeDuration)
		return nil, "", nil
	}

	cfg := &zededa.SessionConfig{MaxInst: 2}
	start := time.Now()
	_, _, _ = m.StartProxyMulti(context.Background(), cfg, "n1", candidates, 22, "ssh", nil)
	elapsed := time.Since(start)

	// Without the fix, raceBatch waited for both goroutines, so elapsed would
	// be ~slowProbeDuration. With the fix, it returns as soon as "fast" wins.
	// 250ms threshold gives a generous margin while still proving we didn't
	// wait the full 750ms.
	if elapsed > 250*time.Millisecond {
		t.Fatalf("StartProxyMulti took %v; expected to return promptly after fast probe (slow probe is %v)", elapsed, slowProbeDuration)
	}
}

// TestCloseTunnelLeavesUnrelatedCachedSessionsAlone verifies the cache helper
// only zeroes the entry whose TunnelID matches the closed tunnel.
func TestCloseTunnelLeavesUnrelatedCachedSessionsAlone(t *testing.T) {
	m := NewManager()
	expires := time.Now().Add(time.Hour)
	m.StoreCachedSession("nodeA", &zededa.SessionConfig{URL: "wss://a"}, 1001, "t1", expires)
	m.StoreCachedSession("nodeB", &zededa.SessionConfig{URL: "wss://b"}, 2002, "t2", expires)
	m.RegisterTunnel(&Tunnel{ID: "t1", NodeID: "nodeA", LocalPort: 1001, Status: "active"})
	m.RegisterTunnel(&Tunnel{ID: "t2", NodeID: "nodeB", LocalPort: 2002, Status: "active"})

	if err := m.CloseTunnel("t1"); err != nil {
		t.Fatalf("CloseTunnel: %v", err)
	}

	if s, _ := m.GetCachedSession("nodeA"); s.Port != 0 {
		t.Errorf("nodeA Port should be cleared, got %d", s.Port)
	}
	s, _ := m.GetCachedSession("nodeB")
	if s.Port != 2002 || s.TunnelID != "t2" {
		t.Errorf("nodeB cache should be untouched, got Port=%d TunnelID=%q", s.Port, s.TunnelID)
	}
}
