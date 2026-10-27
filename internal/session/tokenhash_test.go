package session

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"edgeViewLauncher/internal/zededa"

	"github.com/gorilla/websocket"
)

// fakeDispatcher answers probes like zdispatcher: replies are keyed by the
// X-Session-Token hash; unknown hashes get "no device online".
type fakeDispatcher struct {
	mu       sync.Mutex
	replies  map[string]string
	probes   []string // X-Session-Token of every probe, in order
	noProbes bool     // behave like a dispatcher that predates probing
}

func (d *fakeDispatcher) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if d.noProbes || r.Header.Get("X-Session-Probe") != "true" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	hash := r.Header.Get("X-Session-Token")
	d.mu.Lock()
	d.probes = append(d.probes, hash)
	reply, ok := d.replies[hash]
	d.mu.Unlock()
	if !ok {
		reply = probeNoDeviceMsg + "\n+++Done+++"
	}
	w.Write([]byte(reply))
}

func (d *fakeDispatcher) probeCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.probes)
}

func newFakeDispatcher(t *testing.T, replies map[string]string) (*fakeDispatcher, *zededa.SessionConfig) {
	t.Helper()
	d := &fakeDispatcher{replies: replies}
	srv := httptest.NewServer(d)
	t.Cleanup(srv.Close)
	cfg := &zededa.SessionConfig{
		URL:   "ws://" + strings.TrimPrefix(srv.URL, "http://") + "/api/v1/edge-view",
		Token: "header.payload.signature",
	}
	return d, cfg
}

const (
	serverConnectedReply = probeServerConnectedMsg + "\n+++Done+++"
)

func TestTokenHashForms(t *testing.T) {
	sum := sha256.Sum256([]byte("tok.2"))
	if got, want := tokenHash("tok", 2, true), base64.RawURLEncoding.EncodeToString(sum[:]); got != want {
		t.Errorf("full hash = %q, want %q", got, want)
	}
	if got, want := tokenHash("tok", 2, false), base64.RawURLEncoding.EncodeToString(sum[:16]); got != want {
		t.Errorf("short hash = %q, want %q", got, want)
	}
	// Instance 0 (single-instance mode) hashes the bare token.
	bare := sha256.Sum256([]byte("tok"))
	if got, want := tokenHash("tok", 0, false), base64.RawURLEncoding.EncodeToString(bare[:16]); got != want {
		t.Errorf("inst-0 hash = %q, want %q", got, want)
	}
}

func TestProbeURL(t *testing.T) {
	cases := map[string]string{
		"wss://zedcloud.example/api/v1/edge-view": "https://zedcloud.example/api/v1/edge-view",
		"ws://127.0.0.1:9000/api/v1/edge-view":    "http://127.0.0.1:9000/api/v1/edge-view",
	}
	for in, want := range cases {
		if got := probeURL(in); got != want {
			t.Errorf("probeURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSessionTokenHashUsesFullHashForEVE173(t *testing.T) {
	token := "header.payload.signature"
	full := tokenHash(token, 1, true)
	d, cfg := newFakeDispatcher(t, map[string]string{full: serverConnectedReply})
	m := NewManager()

	if got := m.sessionTokenHash(context.Background(), cfg, 1); got != full {
		t.Fatalf("got %q, want full hash %q", got, full)
	}
	// Cached: the next dial (any instance) doesn't probe again.
	before := d.probeCount()
	if got := m.sessionTokenHash(context.Background(), cfg, 2); got != tokenHash(token, 2, true) {
		t.Fatalf("instance 2 got %q, want its full hash", got)
	}
	if d.probeCount() != before {
		t.Fatalf("expected the cached form to be reused without probing")
	}
}

func TestSessionTokenHashFallsBackToShortHashForOlderEVE(t *testing.T) {
	token := "header.payload.signature"
	short := tokenHash(token, 0, false)
	d, cfg := newFakeDispatcher(t, map[string]string{short: serverConnectedReply})
	m := NewManager()

	if got := m.sessionTokenHash(context.Background(), cfg, 0); got != short {
		t.Fatalf("got %q, want short hash %q", got, short)
	}
	if d.probes[0] != tokenHash(token, 0, true) || d.probes[1] != short {
		t.Fatalf("expected full then short probe, got %v", d.probes)
	}
}

func TestSessionTokenHashTreatsBusySlotAsRegistered(t *testing.T) {
	token := "header.payload.signature"
	full := tokenHash(token, 1, true)
	_, cfg := newFakeDispatcher(t, map[string]string{full: probeBusyMsg})
	m := NewManager()

	// A busy slot still proves the form; instance rotation handles the rest.
	if got := m.sessionTokenHash(context.Background(), cfg, 1); got != full {
		t.Fatalf("got %q, want full hash %q", got, full)
	}
}

func TestSessionTokenHashDeviceOfflineIsNotCached(t *testing.T) {
	token := "header.payload.signature"
	d, cfg := newFakeDispatcher(t, map[string]string{})
	m := NewManager()

	if got := m.sessionTokenHash(context.Background(), cfg, 0); got != tokenHash(token, 0, false) {
		t.Fatalf("offline device: got %q, want the short-hash fallback", got)
	}
	// The device comes online on EVE 17.3+: the next dial must find it.
	d.mu.Lock()
	d.replies[tokenHash(token, 0, true)] = serverConnectedReply
	d.mu.Unlock()
	if got := m.sessionTokenHash(context.Background(), cfg, 0); got != tokenHash(token, 0, true) {
		t.Fatalf("after device connected: got %q, want full hash", got)
	}
}

func TestSessionTokenHashWithoutProbeSupport(t *testing.T) {
	token := "header.payload.signature"
	d, cfg := newFakeDispatcher(t, nil)
	d.noProbes = true
	m := NewManager()

	if got := m.sessionTokenHash(context.Background(), cfg, 0); got != tokenHash(token, 0, false) {
		t.Fatalf("got %q, want short-hash fallback", got)
	}
}

func TestHashFormCacheExpires(t *testing.T) {
	var c hashFormCache
	c.put("tok", true)
	if full, ok := c.get("tok"); !ok || !full {
		t.Fatalf("expected fresh entry, got full=%v ok=%v", full, ok)
	}
	c.mu.Lock()
	c.forms["tok"] = hashForm{full: true, at: time.Now().Add(-hashFormTTL - time.Second)}
	c.mu.Unlock()
	if _, ok := c.get("tok"); ok {
		t.Fatalf("expected stale entry to be ignored")
	}
}

func TestConnectToEdgeViewDialsWithDiscoveredFullHash(t *testing.T) {
	token := "header.payload.signature"
	full := tokenHash(token, 0, true)
	var dialedWith string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Session-Probe") == "true" {
			if r.Header.Get("X-Session-Token") == full {
				w.Write([]byte(serverConnectedReply))
			} else {
				w.Write([]byte(probeNoDeviceMsg))
			}
			return
		}
		dialedWith = r.Header.Get("X-Session-Token")
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		conn.WriteMessage(websocket.TextMessage, []byte(clientIPMsg+"203.0.113.7"))
	}))
	defer srv.Close()

	cfg := &zededa.SessionConfig{URL: "ws://" + strings.TrimPrefix(srv.URL, "http://"), Token: token}
	conn, clientIP, err := NewManager().connectToEdgeView(context.Background(), cfg, "test")
	if err != nil {
		t.Fatalf("connectToEdgeView: %v", err)
	}
	conn.Close()
	if dialedWith != full {
		t.Fatalf("dialed with X-Session-Token %q, want full hash %q", dialedWith, full)
	}
	if clientIP != "203.0.113.7" {
		t.Fatalf("client IP = %q", clientIP)
	}
}

// A stalled dispatcher must not hold a dial past its caller's deadline (the
// StartProxyMulti round deadline, or the user's Cancel).
func TestSessionTokenHashHonoursContext(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()
	defer close(release)

	cfg := &zededa.SessionConfig{URL: "ws://" + strings.TrimPrefix(srv.URL, "http://"), Token: "header.payload.signature"}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	got := NewManager().sessionTokenHash(ctx, cfg, 0)
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("probe ignored the context: took %v", elapsed)
	}
	if got != tokenHash(cfg.Token, 0, false) {
		t.Fatalf("expected the short-hash fallback, got %q", got)
	}
}
