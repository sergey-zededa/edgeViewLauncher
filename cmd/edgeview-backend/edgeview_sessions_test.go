package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"edgeViewLauncher/internal/session"
	"edgeViewLauncher/internal/zededa"
)

// realParseClient is a fake ZEDEDA client that parses EdgeView tokens for
// real, so the test exercises the token's dep/num claims end to end.
type realParseClient struct {
	*fakeZededaClient
}

func (c *realParseClient) ParseEdgeViewToken(token string) (*zededa.SessionConfig, error) {
	return (&zededa.Client{}).ParseEdgeViewToken(token)
}

// testJWT builds an unsigned EdgeView-style JWT whose dep claim is dep.
func testJWT(t *testing.T, dep string, num int) string {
	t.Helper()
	payload, err := json.Marshal(map[string]interface{}{"dep": dep, "num": num, "sub": "dev-uuid"})
	if err != nil {
		t.Fatal(err)
	}
	enc := base64.RawURLEncoding.EncodeToString
	return enc([]byte(`{"alg":"none"}`)) + "." + enc(payload) + ".sig"
}

// probeHash mirrors the dispatcher's X-Session-Token for an instance slot.
func probeHash(token string, inst int, full bool) string {
	if inst > 0 {
		token = fmt.Sprintf("%s.%d", token, inst)
	}
	sum := sha256.Sum256([]byte(token))
	if !full {
		return base64.RawURLEncoding.EncodeToString(sum[:16])
	}
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

type probeServer struct {
	mu      sync.Mutex
	replies map[string]string
	probes  int
}

func (p *probeServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Session-Probe") != "true" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	p.mu.Lock()
	p.probes++
	reply, ok := p.replies[r.Header.Get("X-Session-Token")]
	p.mu.Unlock()
	if !ok {
		reply = "no device online\n+++Done+++"
	}
	w.Write([]byte(reply))
}

func (p *probeServer) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.probes
}

func TestGetEdgeViewSessions_LiveSessionProbesSlots(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	ps := &probeServer{}
	srv := httptest.NewServer(ps)
	defer srv.Close()
	token := testJWT(t, "ws://"+strings.TrimPrefix(srv.URL, "http://")+"/api/v1/edge-view", 3)
	ps.replies = map[string]string{
		probeHash(token, 1, true): "can't have more than 2 peers\n+++Done+++",
		probeHash(token, 2, true): "server is connected\n+++Done+++",
	}

	future := fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix())
	client := &realParseClient{&fakeZededaClient{edgeStatus: &zededa.EdgeViewStatus{Token: token, Expiry: future}}}
	mgr := session.NewManager()
	a := newTestApp(client, mgr)

	got, err := a.GetEdgeViewSessions(t.Context(), "node1")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Available || got.MaxSessions != 3 || got.InUse != 1 || got.Free != 1 || got.Offline != 1 || got.Unknown != 0 {
		t.Fatalf("unexpected result: %+v", got)
	}
	wantStates := []session.SlotState{session.SlotBusy, session.SlotFree, session.SlotOffline}
	if len(got.Slots) != 3 {
		t.Fatalf("slots = %+v", got.Slots)
	}
	for i, w := range wantStates {
		if got.Slots[i].Inst != i+1 || got.Slots[i].State != w || got.Slots[i].Ours {
			t.Errorf("slot[%d] = %+v, want inst %d state %s", i, got.Slots[i], i+1, w)
		}
	}

	// JSON contract: field names and lowercase state strings.
	raw, _ := json.Marshal(got)
	for _, frag := range []string{`"available":true`, `"maxSessions":3`, `"inUse":1`, `"free":1`, `"offline":1`, `"unknown":0`,
		`{"inst":1,"state":"busy","ours":false}`} {
		if !strings.Contains(string(raw), frag) {
			t.Errorf("JSON %s missing %s", raw, frag)
		}
	}
}

func TestGetEdgeViewSessions_ReadOnly(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	ps := &probeServer{}
	srv := httptest.NewServer(ps)
	defer srv.Close()
	token := testJWT(t, "ws://"+strings.TrimPrefix(srv.URL, "http://")+"/api/v1/edge-view", 2)
	ps.replies = map[string]string{probeHash(token, 1, true): "server is connected\n+++Done+++"}

	future := fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix())
	client := &realParseClient{&fakeZededaClient{edgeStatus: &zededa.EdgeViewStatus{Token: token, Expiry: future}}}
	mgr := session.NewManager()
	// A cached session holding a different (stale) token must survive: only
	// GetSSHStatus aligns/drops caches.
	mgr.StoreCachedSession("node1", &zededa.SessionConfig{Token: "stale"}, 1234, "t1", time.Now().Add(time.Hour))
	a := newTestApp(client, mgr)

	if _, err := a.GetEdgeViewSessions(t.Context(), "node1"); err != nil {
		t.Fatal(err)
	}
	if cached, ok := mgr.GetCachedSession("node1"); !ok || cached.Config.Token != "stale" {
		t.Fatalf("session cache was mutated: %+v ok=%v", cached, ok)
	}
}

func TestGetEdgeViewSessions_EndedSessionIsUnavailableWithoutProbing(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	ps := &probeServer{}
	srv := httptest.NewServer(ps)
	defer srv.Close()
	token := testJWT(t, "ws://"+strings.TrimPrefix(srv.URL, "http://")+"/api/v1/edge-view", 3)
	future := fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix())
	past := fmt.Sprintf("%d", time.Now().Add(-time.Hour).Unix())

	cases := map[string]*zededa.EdgeViewStatus{
		"empty token":   {Token: "", Expiry: future},
		"expired":       {Token: token, Expiry: past},
		"zero expiry":   {Token: token, Expiry: "0"},
		"unparseable":   {Token: "not-a-jwt", Expiry: "bogus"},
		"no dep claim":  {Token: testJWT(t, "", 3), Expiry: future},
		"nil status ok": nil,
	}
	for name, st := range cases {
		t.Run(name, func(t *testing.T) {
			client := &realParseClient{&fakeZededaClient{edgeStatus: st}}
			a := newTestApp(client, session.NewManager())

			got, err := a.GetEdgeViewSessions(t.Context(), "node1")
			if err != nil {
				t.Fatal(err)
			}
			if got.Available || got.MaxSessions != 0 || got.InUse != 0 || got.Free != 0 || got.Offline != 0 || got.Unknown != 0 {
				t.Fatalf("expected unavailable, got %+v", got)
			}
			if got.Slots == nil || len(got.Slots) != 0 {
				t.Fatalf("slots must be an empty non-nil slice, got %#v", got.Slots)
			}
			raw, _ := json.Marshal(got)
			if !strings.Contains(string(raw), `"slots":[]`) {
				t.Errorf("JSON %s should carry an empty slots array", raw)
			}
		})
	}
	if n := ps.count(); n != 0 {
		t.Fatalf("expected no probes for sessions without a live token, got %d", n)
	}
}

func TestGetEdgeViewSessions_StatusErrorIsReturned(t *testing.T) {
	client := &realParseClient{&fakeZededaClient{edgeStatusErr: zededa.ErrUnauthorized}}
	a := newTestApp(client, session.NewManager())
	if _, err := a.GetEdgeViewSessions(t.Context(), "node1"); err == nil {
		t.Fatal("expected the controller error to propagate")
	}
	if _, err := a.GetEdgeViewSessions(t.Context(), ""); err == nil {
		t.Fatal("expected an error for an empty nodeId")
	}
}

func TestHandleGetEdgeViewSessions(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	ps := &probeServer{}
	srv := httptest.NewServer(ps)
	defer srv.Close()
	token := testJWT(t, "ws://"+strings.TrimPrefix(srv.URL, "http://")+"/api/v1/edge-view", 1)
	ps.replies = map[string]string{probeHash(token, 0, true): "server is connected\n+++Done+++"}

	future := fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix())
	client := &realParseClient{&fakeZededaClient{edgeStatus: &zededa.EdgeViewStatus{Token: token, Expiry: future}}}
	hs := &HTTPServer{app: newTestApp(client, session.NewManager())}

	rr := httptest.NewRecorder()
	hs.handleGetEdgeViewSessions(rr, httptest.NewRequest(http.MethodPost, "/api/edgeview-sessions", strings.NewReader(`{"nodeId":"node1"}`)))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Success bool             `json:"success"`
		Data    EdgeViewSessions `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Success || !resp.Data.Available || resp.Data.MaxSessions != 1 || resp.Data.Free != 1 ||
		len(resp.Data.Slots) != 1 || resp.Data.Slots[0].Inst != 0 {
		t.Fatalf("unexpected response: %s", rr.Body.String())
	}
}
