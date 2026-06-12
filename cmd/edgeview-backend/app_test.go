package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"edgeViewLauncher/internal/config"
	"edgeViewLauncher/internal/session"
	"edgeViewLauncher/internal/zededa"
)

// --- Test doubles ---

type fakeZededaClient struct {
	initSessionScript string
	initSessionErr    error

	parseCfg *zededa.SessionConfig
	parseErr error

	addSSHKeyErr error

	// EdgeView status & control
	edgeStatus    *zededa.EdgeViewStatus
	edgeStatusErr error
	disableErr    error
	stopErr       error
	startErr      error

	// Cloud API for apps/services
	deviceApps    []zededa.AppInstance
	deviceErr     error
	appDetails    map[string]*zededa.AppInstanceStatus
	appConfigs    map[string]*zededa.AppInstanceConfig
	appDetailsErr error

	// Network Instances
	networkInstances   map[string]*zededa.NetworkInstanceStatus
	networkInstanceErr error

	updateExternalPolicyErr error

	// Device status (network interfaces & IPs) used for SSH candidate IP
	// discovery in ConnectToNode.
	deviceStatus    *zededa.DeviceStatus
	deviceStatusErr error
}

func (f *fakeZededaClient) GetEnterprise() (*zededa.Enterprise, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeZededaClient) GetProjects() ([]zededa.Project, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeZededaClient) GetProjectsCtx(ctx context.Context) ([]zededa.Project, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeZededaClient) SearchNodes(query string, limit, skip int, projectID string) (*zededa.SearchResult, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeZededaClient) SearchNodesWithToken(query string, limit int, pageToken string, projectID string) (*zededa.SearchResult, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeZededaClient) SearchNodesWithTokenCtx(ctx context.Context, query string, limit int, pageToken string, projectID string) (*zededa.SearchResult, error) {
	return nil, errors.New("not implemented")
}
func (f *fakeZededaClient) UpdateConfig(baseURL, token string) {}
func (f *fakeZededaClient) InitSession(targetID string) (string, error) {
	return f.initSessionScript, f.initSessionErr
}
func (f *fakeZededaClient) ParseEdgeViewScript(script string) (*zededa.SessionConfig, error) {
	return f.parseCfg, f.parseErr
}
func (f *fakeZededaClient) ParseEdgeViewToken(token string) (*zededa.SessionConfig, error) {
	return f.parseCfg, f.parseErr
}
func (f *fakeZededaClient) AddSSHKeyToDevice(nodeID, pubKey string) error { return f.addSSHKeyErr }
func (f *fakeZededaClient) GetEdgeViewStatus(nodeID string) (*zededa.EdgeViewStatus, error) {
	if f.edgeStatusErr != nil {
		return nil, f.edgeStatusErr
	}
	return f.edgeStatus, nil
}
func (f *fakeZededaClient) DisableSSH(nodeID, ourKey string) error { return f.disableErr }
func (f *fakeZededaClient) StopEdgeView(nodeID string) error {
	return f.stopErr
}
func (f *fakeZededaClient) StartEdgeView(nodeID string) error {
	return f.startErr
}
func (f *fakeZededaClient) GetDeviceAppInstances(deviceID, deviceName string) ([]zededa.AppInstance, error) {
	return f.deviceApps, f.deviceErr
}
func (f *fakeZededaClient) GetAppInstanceDetails(id string) (*zededa.AppInstanceDetails, error) {
	if f.appDetailsErr != nil {
		return nil, f.appDetailsErr
	}
	if f.appDetails == nil {
		return nil, nil
	}
	return (*zededa.AppInstanceDetails)(f.appDetails[id]), nil
}

func (f *fakeZededaClient) GetAppInstanceConfig(id string) (*zededa.AppInstanceConfig, error) {
	if f.appDetailsErr != nil {
		return nil, f.appDetailsErr
	}
	if f.appConfigs == nil {
		return nil, nil
	}
	return f.appConfigs[id], nil
}

func (f *fakeZededaClient) GetNetworkInstanceDetails(niID string) (*zededa.NetworkInstanceStatus, error) {
	if f.networkInstanceErr != nil {
		return nil, f.networkInstanceErr
	}
	if f.networkInstances == nil {
		return nil, nil
	}
	return f.networkInstances[niID], nil
}

func (f *fakeZededaClient) GetDeviceStatus(nodeID string) (*zededa.DeviceStatus, error) {
	if f.deviceStatusErr != nil {
		return nil, f.deviceStatusErr
	}
	if f.deviceStatus != nil {
		return f.deviceStatus, nil
	}
	return nil, errors.New("not implemented")
}

func (f *fakeZededaClient) GetDevice(nodeID string) (map[string]interface{}, error) {
	// Minimal stub used by App.GetNodeMeta; tests that rely on metadata
	// can configure behavior later if needed. For now, return a basic
	// device with no name/project to avoid impacting existing tests.
	return map[string]interface{}{}, nil
}

func (f *fakeZededaClient) VerifyToken(token string) (*zededa.TokenInfo, error) {
	return &zededa.TokenInfo{Valid: true, Subject: "test-user"}, nil
}

func (f *fakeZededaClient) SetVGAEnabled(nodeID string, enabled bool) error {
	return nil
}

func (f *fakeZededaClient) SetUSBEnabled(nodeID string, enabled bool) error {
	return nil
}

func (f *fakeZededaClient) SetConsoleEnabled(nodeID string, enabled bool) error {
	return nil
}

func (f *fakeZededaClient) UpdateEdgeViewExternalPolicy(nodeID string, enable bool) error {
	return f.updateExternalPolicyErr
}

// newTestApp creates a properly initialized App for testing
func newTestApp(client zededaAPI, sessMgr sessionAPI) *App {
	return &App{
		config:             &config.Config{},
		zededaClient:       client,
		sessionManager:     sessMgr,
		enrichmentCache:    make(map[string]AppEnrichment),
		nodeMetaCache:      make(map[string]NodeMeta),
		connectionProgress: make(map[string]string),
		enrichingJobs:      make(map[string]chan struct{}),
		connectionCancels:  make(map[string]context.CancelFunc),
	}
}

type fakeSessionManager struct {
	cached  map[string]*session.CachedSession
	tunnels map[string]*session.Tunnel

	startProxyPort int
	startProxyID   string
	startProxyErr  error

	// Last arguments StartProxyMulti was invoked with (nil if never called).
	lastMultiCandidateIPs []string
	lastMultiTargetPort   int

	launched bool
}

func (m *fakeSessionManager) GetCachedSession(nodeID string) (*session.CachedSession, bool) {
	if m.cached == nil {
		return nil, false
	}
	s, ok := m.cached[nodeID]
	return s, ok
}

func (m *fakeSessionManager) GetTunnel(tunnelID string) (*session.Tunnel, bool) {
	if m.tunnels == nil {
		return nil, false
	}
	t, ok := m.tunnels[tunnelID]
	return t, ok
}

func (m *fakeSessionManager) StoreCachedSession(nodeID string, cfg *zededa.SessionConfig, port int, tunnelID string, expiresAt time.Time) {
	if m.cached == nil {
		m.cached = make(map[string]*session.CachedSession)
	}
	m.cached[nodeID] = &session.CachedSession{Config: cfg, Port: port, TunnelID: tunnelID, ExpiresAt: expiresAt}
}

func (m *fakeSessionManager) StartProxy(ctx context.Context, cfg *zededa.SessionConfig, nodeID string, target string, protocol string, onProgress func(string)) (int, string, error) {
	return m.startProxyPort, m.startProxyID, m.startProxyErr
}

func (m *fakeSessionManager) StartProxyMulti(ctx context.Context, cfg *zededa.SessionConfig, nodeID string, candidateIPs []string, targetPort int, protocol string, onProgress func(string)) (int, string, error) {
	m.lastMultiCandidateIPs = append([]string(nil), candidateIPs...)
	m.lastMultiTargetPort = targetPort
	return m.startProxyPort, m.startProxyID, m.startProxyErr
}

func (m *fakeSessionManager) LaunchTerminal(port int, keyPath string) error {
	m.launched = true
	return nil
}

func (m *fakeSessionManager) ExecuteCommand(nodeID string, command string) (string, error) {
	return "", errors.New("not implemented")
}

func (m *fakeSessionManager) CloseTunnel(tunnelID string) error { return nil }

func (m *fakeSessionManager) ListTunnels(nodeID string) []*session.Tunnel { return nil }

func (m *fakeSessionManager) GetAllTunnels() []*session.Tunnel { return nil }

func (m *fakeSessionManager) InvalidateSession(nodeID string) {
	if m.cached != nil {
		delete(m.cached, nodeID)
	}
}

func (m *fakeSessionManager) StartCollectInfo(nodeID string) (string, error) {
	return "job-123", nil
}

func (m *fakeSessionManager) GetCollectInfoJob(jobID string) *session.CollectInfoJob {
	return &session.CollectInfoJob{
		ID:        jobID,
		NodeID:    "node-1",
		Status:    "completed",
		Filename:  "test-file.tar.gz",
		FilePath:  "/tmp/test-file.tar.gz",
		TotalSize: 1024,
		Progress:  1024,
	}
}

func (m *fakeSessionManager) StartComposeDiagnostics(nodeID, appName, appIP, username, password string) (string, error) {
	return "compose-diag-123", nil
}

func (m *fakeSessionManager) GetComposeDiagnosticsJob(jobID string) *session.ComposeDiagnosticsJob {
	return &session.ComposeDiagnosticsJob{
		ID:        jobID,
		NodeID:    "node-1",
		Status:    "completed",
		Filename:  "runtime-info-test.tar.gz",
		FilePath:  "/tmp/runtime-info-test.tar.gz",
		TotalSize: 2048,
		Progress:  2048,
	}
}

// --- Existing tests ---

// TestAddRecentDevice verifies ordering, de-duplication and max length.
func TestAddRecentDevice(t *testing.T) {
	// Use a temp HOME so config.Save() writes into an isolated directory.
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	a := newTestApp(nil, nil)
	a.config.RecentDevices = []string{"node1", "node2"}

	a.AddRecentDevice("node3")
	a.AddRecentDevice("node1") // move existing to front

	got := a.config.RecentDevices
	want := []string{"node1", "node3", "node2"}
	if len(got) != len(want) {
		t.Fatalf("expected %d recent devices, got %d", len(want), len(got))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("index %d: expected %q, got %q", i, want[i], got[i])
		}
	}

	// Ensure list is capped at 10 items
	for i := 0; i < 20; i++ {
		a.AddRecentDevice("node-" + string('a'+rune(i)))
	}
	if len(a.config.RecentDevices) != 10 {
		t.Fatalf("expected recent devices to be capped at 10, got %d", len(a.config.RecentDevices))
	}
}

// TestGetUserInfo ensures enterprise and cluster URL are derived from config.
func TestGetUserInfo(t *testing.T) {
	a := newTestApp(nil, nil)
	a.config.Clusters = []config.ClusterConfig{
		{Name: "Second Foundation", BaseURL: "https://zedcontrol.hummingbird.zededa.net", APIToken: "sf-enterprise:abc123"},
	}
	a.config.ActiveCluster = "Second Foundation"

	info := a.GetUserInfo()
	if got := info["enterprise"]; got != "sf-enterprise" {
		t.Fatalf("expected enterprise 'sf-enterprise', got %q", got)
	}
	if got := info["clusterUrl"]; got != "https://zedcontrol.hummingbird.zededa.net" {
		t.Fatalf("unexpected clusterUrl: %q", got)
	}
}

// TestGetSessionStatus exercises the happy path using the real session.Manager API.
func TestGetSessionStatus(t *testing.T) {
	m := session.NewManager()
	a := newTestApp(nil, m)

	// No cached session -> inactive
	status := a.GetSessionStatus("node1")
	if status.Active {
		t.Fatalf("expected inactive session, got active=true")
	}

	// Store a cached session and verify it is surfaced
	expiresAt := time.Now().Add(time.Hour)
	m.StoreCachedSession("node1", &zededa.SessionConfig{URL: "wss://example"}, 55780, "tunnel-test", expiresAt)

	status = a.GetSessionStatus("node1")
	if !status.Active {
		t.Fatalf("expected active session, got active=false")
	}
	if status.Port != 55780 {
		t.Fatalf("expected port 55780, got %d", status.Port)
	}
	if status.ExpiresAt == "" {
		t.Fatalf("expected non-empty ExpiresAt")
	}
}

// TestConnectToNode_LiveCachedTunnelIsReused verifies that when a cached
// session points at a still-active proxy tunnel, ConnectToNode (native terminal)
// returns the cached port and tunnel ID without invoking StartProxyMulti.
func TestConnectToNode_LiveCachedTunnelIsReused(t *testing.T) {
	fakeClient := &fakeZededaClient{}
	fakeSess := &fakeSessionManager{
		cached: map[string]*session.CachedSession{
			"node1": {
				Config:    &zededa.SessionConfig{URL: "wss://example"},
				Port:      55780,
				TunnelID:  "tunnel-cached",
				ExpiresAt: time.Now().Add(time.Hour),
			},
		},
		tunnels: map[string]*session.Tunnel{
			"tunnel-cached": {ID: "tunnel-cached", NodeID: "node1", LocalPort: 55780, Status: "active"},
		},
		// If StartProxyMulti is invoked we'd return these — but it must NOT be invoked.
		startProxyPort: 60000,
		startProxyID:   "tunnel-fresh",
	}

	a := newTestApp(fakeClient, fakeSess)

	port, tunnelID, err := a.ConnectToNode("node1", false, "")
	if err != nil {
		t.Fatalf("ConnectToNode returned error: %v", err)
	}
	if port != 55780 {
		t.Errorf("expected cached port 55780 to be reused, got %d", port)
	}
	if tunnelID != "tunnel-cached" {
		t.Errorf("expected cached tunnel ID 'tunnel-cached' to be returned, got %q", tunnelID)
	}
	if fakeSess.lastMultiCandidateIPs != nil {
		t.Errorf("expected StartProxyMulti NOT to be called on cache reuse, but candidates were %v", fakeSess.lastMultiCandidateIPs)
	}
}

// TestConnectToNode_DeadCachedTunnelTriggersFreshProxy verifies that when a
// cached session's TunnelID no longer maps to an active tunnel (e.g. the
// goroutine died and CloseTunnel/FailTunnel never fired), ConnectToNode
// detects it via the GetTunnel check and starts a fresh proxy instead of
// returning a stale port.
func TestConnectToNode_DeadCachedTunnelTriggersFreshProxy(t *testing.T) {
	fakeClient := &fakeZededaClient{
		deviceStatus: &zededa.DeviceStatus{
			NetStatusList: []zededa.NetStatus{
				{Up: true, IfName: "eth0", IPs: []string{"192.168.1.10"}},
			},
		},
	}
	fakeSess := &fakeSessionManager{
		cached: map[string]*session.CachedSession{
			"node1": {
				Config:    &zededa.SessionConfig{URL: "wss://example"},
				Port:      55780,
				TunnelID:  "tunnel-dead",
				ExpiresAt: time.Now().Add(time.Hour),
			},
			// tunnels map is nil — tunnel-dead is not registered, simulating
			// a teardown that left the cache pointing at a vanished tunnel.
		},
		startProxyPort: 60000,
		startProxyID:   "tunnel-fresh",
	}

	a := newTestApp(fakeClient, fakeSess)

	port, tunnelID, err := a.ConnectToNode("node1", false, "")
	if err != nil {
		t.Fatalf("ConnectToNode returned error: %v", err)
	}
	if fakeSess.lastMultiCandidateIPs == nil {
		t.Fatalf("expected StartProxyMulti to be invoked when cached tunnel is dead, but it was not")
	}
	if port != 60000 {
		t.Errorf("expected fresh port 60000, got %d (looks like stale cache was returned)", port)
	}
	if tunnelID != "tunnel-fresh" {
		t.Errorf("expected fresh tunnel ID 'tunnel-fresh', got %q", tunnelID)
	}
}

// TestConnectToNode_ReturnsTunnelID verifies that ConnectToNode propagates the tunnel ID
// returned by the session manager when starting a new proxy.
func TestConnectToNode_ReturnsTunnelID(t *testing.T) {
	fakeClient := &fakeZededaClient{
		initSessionScript: "edgeview -token tok",
		parseCfg:          &zededa.SessionConfig{URL: "wss://example", Token: "tok"},
	}
	fakeSess := &fakeSessionManager{
		startProxyPort: 9001,
		startProxyID:   "tunnel-123",
	}

	a := newTestApp(fakeClient, fakeSess)

	// Simulate "In-App Terminal" which always creates a new proxy
	port, tunnelID, err := a.ConnectToNode("node2", true, "")
	if err != nil {
		t.Fatalf("ConnectToNode returned error: %v", err)
	}

	if port != 9001 {
		t.Errorf("expected port 9001, got %d", port)
	}
	if tunnelID != "tunnel-123" {
		t.Errorf("expected tunnel ID 'tunnel-123', got %q", tunnelID)
	}
}

// TestConnectToNode_StartProxyMultiReceivesAllCandidateIPs ensures ConnectToNode
// passes the full candidate-IP list (loopback + every "up" management IP from
// GetDeviceStatus) to StartProxyMulti, so the session layer can probe them in
// round-robin / parallel rather than waterfalling 5 retries through the first.
func TestConnectToNode_StartProxyMultiReceivesAllCandidateIPs(t *testing.T) {
	fakeClient := &fakeZededaClient{
		initSessionScript: "edgeview -token tok",
		parseCfg:          &zededa.SessionConfig{URL: "wss://example", Token: "tok", MaxInst: 2},
		deviceStatus: &zededa.DeviceStatus{
			NetStatusList: []zededa.NetStatus{
				{Up: true, IfName: "eth0", IPs: []string{"192.168.1.10"}},
				{Up: true, IfName: "eth1", IPs: []string{"10.0.0.5"}},
				// "down" interface should be ignored.
				{Up: false, IfName: "wlan0", IPs: []string{"172.16.0.1"}},
			},
		},
	}
	fakeSess := &fakeSessionManager{
		startProxyPort: 9001,
		startProxyID:   "tunnel-multi",
	}

	a := newTestApp(fakeClient, fakeSess)

	port, tunnelID, err := a.ConnectToNode("node-multi", true, "")
	if err != nil {
		t.Fatalf("ConnectToNode returned error: %v", err)
	}
	if port != 9001 || tunnelID != "tunnel-multi" {
		t.Fatalf("unexpected return values: port=%d tunnelID=%q", port, tunnelID)
	}

	if fakeSess.lastMultiTargetPort != 22 {
		t.Errorf("expected target port 22 (SSH), got %d", fakeSess.lastMultiTargetPort)
	}

	want := []string{"127.0.0.1", "192.168.1.10", "10.0.0.5"}
	if got := fakeSess.lastMultiCandidateIPs; !equalStringSlices(got, want) {
		t.Errorf("candidate IPs mismatch:\n  got:  %v\n  want: %v", got, want)
	}
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestStartTunnel_CreatesSessionWhenMissing ensures StartTunnel calls InitSession
// and ParseEdgeViewScript when there is no cached session, and then invokes StartProxy
// on the session manager.
func TestStartTunnel_CreatesSessionWhenMissing(t *testing.T) {
	cfg := &zededa.SessionConfig{URL: "wss://example", Token: "tok", UUID: "dev", InstID: 1, MaxInst: 2, Key: "k"}
	fakeClient := &fakeZededaClient{
		initSessionScript: "edgeview -token tok",
		parseCfg:          cfg,
	}
	fakeSess := &fakeSessionManager{
		startProxyPort: 60001,
		startProxyID:   "tunnel-xyz",
	}

	a := newTestApp(fakeClient, fakeSess)

	port, tunnelID, err := a.StartTunnel("nodeA", "192.168.0.10", 5900, "")
	if err != nil {
		t.Fatalf("StartTunnel returned error: %v", err)
	}
	if port != 60001 || tunnelID != "tunnel-xyz" {
		t.Fatalf("unexpected tunnel result: port=%d id=%s", port, tunnelID)
	}

	if _, ok := fakeSess.cached["nodeA"]; !ok {
		t.Fatalf("expected session to be cached for nodeA")
	}
}

// TestGetDeviceServices_UsesCloudAPIAndEdgeViewCache verifies that GetDeviceServices
// builds service entries from Cloud API and then overlays cached EdgeView enrichment
// data when present.
func TestGetDeviceServices_UsesCloudAPIAndEdgeViewCache(t *testing.T) {
	apps := []zededa.AppInstance{{ID: "app1", Name: "svc", RunState: "RUNNING"}}
	status := &zededa.AppInstanceStatus{
		ID:            "app1",
		Name:          "svc",
		RunState:      "RUNNING",
		NetStatusList: []zededa.NetStatus{{Up: true, IPs: []string{"10.0.0.5"}}},
	}
	config := &zededa.AppInstanceConfig{
		ID:            "app1",
		Name:          "svc",
		VMInfo:        zededa.VMInfo{VNC: true, VNCDisplay: 1},
		DockerCompose: "version: '3.9'\nservices:\n  app:\n    image: alpine",
	}

	fakeClient := &fakeZededaClient{
		deviceApps: apps,
		appDetails: map[string]*zededa.AppInstanceStatus{"app1": status},
		appConfigs: map[string]*zededa.AppInstanceConfig{"app1": config},
	}

	a := newTestApp(fakeClient, &fakeSessionManager{})
	a.enrichmentCache = map[string]AppEnrichment{
		"app1": {UUID: "app1", IPs: []string{"10.0.0.99"}, VNCPort: 5902, State: "Running"},
	}

	jsonStr, err := a.GetDeviceServices("node1", "deviceName")
	if err != nil {
		t.Fatalf("GetDeviceServices returned error: %v", err)
	}

	var parsed struct {
		Services []struct {
			Name          string   `json:"name"`
			Status        string   `json:"status"`
			IPs           []string `json:"ips"`
			VNCPort       int      `json:"vncPort"`
			EdgeViewState string   `json:"edgeViewState"`
			DockerCompose string   `json:"dockerCompose"`
		} `json:"services"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		t.Fatalf("failed to parse JSON: %v", err)
	}
	if len(parsed.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(parsed.Services))
	}

	svc := parsed.Services[0]
	if svc.Name != "svc" || svc.Status != "RUNNING" {
		t.Fatalf("unexpected service metadata: %+v", svc)
	}
	if len(svc.IPs) == 0 || svc.IPs[0] != "10.0.0.5" {
		t.Fatalf("expected primary IP from Cloud API, got %+v", svc.IPs)
	}
	// VNCPort comes from Cloud API (5900 + display) but may be overridden by
	// enrichment cache; here we only assert it is non-zero.
	if svc.VNCPort == 0 {
		t.Fatalf("expected non-zero VNCPort, got 0")
	}
	if svc.DockerCompose == "" {
		t.Fatalf("expected non-empty DockerCompose")
	}
}

// TestConnectToNode_InitSessionError surfaces InitSession failures when no cached session exists.
func TestConnectToNode_InitSessionError(t *testing.T) {
	fakeClient := &fakeZededaClient{
		initSessionErr: errors.New("boom"),
	}
	fakeSess := &fakeSessionManager{}

	a := newTestApp(fakeClient, fakeSess)

	_, _, err := a.ConnectToNode("node-err", true, "")
	if err == nil || !strings.Contains(err.Error(), "failed to init session") {
		t.Fatalf("expected init-session error to be propagated, got: %v", err)
	}
}

// TestStartTunnel_InitSessionError verifies StartTunnel surfaces InitSession failures
// when there is no cached session.
func TestStartTunnel_InitSessionError(t *testing.T) {
	fakeClient := &fakeZededaClient{
		initSessionErr: errors.New("boom"),
	}
	fakeSess := &fakeSessionManager{}

	a := newTestApp(fakeClient, fakeSess)

	_, _, err := a.StartTunnel("node-err", "10.0.0.1", 5900, "")
	if err == nil || !strings.Contains(err.Error(), "no active session found") {
		t.Fatalf("expected no-active-session error, got: %v", err)
	}
}

// TestStartTunnel_StartProxyRetriesAndFails ensures that StartTunnel retries on
// transient "no device online" errors and eventually returns a wrapped error.
func TestStartTunnel_StartProxyRetriesAndFails(t *testing.T) {
	fakeClient := &fakeZededaClient{
		initSessionScript: "edgeview -token tok",
		parseCfg:          &zededa.SessionConfig{URL: "wss://example", Token: "tok"},
	}
	fakeSess := &fakeSessionManager{
		startProxyErr: errors.New("no device online"),
	}

	a := newTestApp(fakeClient, fakeSess)

	_, _, err := a.StartTunnel("node-offline", "10.0.0.1", 5900, "")
	if err == nil || !strings.Contains(err.Error(), "failed to start tunnel after") {
		t.Fatalf("expected retry failure error, got: %v", err)
	}
}

// TestStartTunnel_ReusesSessionAndUpdatesCache ensures that if a session exists in Cloud API,
// StartTunnel reuses it AND updates the local cache with the fresh configuration (e.g. Enc flag).
func TestStartTunnel_ReusesSessionAndUpdatesCache(t *testing.T) {
	// Setup: Cache is empty for this node (simulating cold start or expired session)
	fakeSess := &fakeSessionManager{
		cached:         make(map[string]*session.CachedSession),
		startProxyPort: 60002,
		startProxyID:   "tunnel-reuse",
	}

	// Setup: Cloud API has fresh session with Enc=true
	freshCfg := &zededa.SessionConfig{URL: "wss://new", Token: "new", Enc: true}
	fakeClient := &fakeZededaClient{
		edgeStatus: &zededa.EdgeViewStatus{
			Token:   "new-token",
			DispURL: "wss://new",
		},
		parseCfg: freshCfg,
	}

	a := newTestApp(fakeClient, fakeSess)

	// Action
	port, _, err := a.StartTunnel("node-reuse", "10.0.0.1", 5900, "")
	if err != nil {
		t.Fatalf("StartTunnel returned error: %v", err)
	}

	// Assertions
	if port != 60002 {
		t.Errorf("expected port 60002, got %d", port)
	}

	// Verify InitSession was NOT called (we reused)
	if fakeClient.initSessionScript != "" {
		t.Errorf("expected InitSession NOT to be called, but it was")
	}

	// CRITICAL: Verify cache was updated with fresh config (Enc=true)
	cached, ok := fakeSess.cached["node-reuse"]
	if !ok {
		t.Fatalf("session removed from cache?")
	}
	if !cached.Config.Enc {
		t.Errorf("expected cached config Enc=true (updated), got false (stale)")
	}
	if cached.Config.Token != "new" {
		t.Errorf("expected cached token 'new', got %q", cached.Config.Token)
	}
}

// TestGetDeviceServices_APIError ensures Cloud API failures are surfaced cleanly.
func TestGetDeviceServices_APIError(t *testing.T) {
	fakeClient := &fakeZededaClient{
		deviceErr: errors.New("timeout"),
	}

	a := newTestApp(fakeClient, &fakeSessionManager{})

	_, err := a.GetDeviceServices("node1", "dev")
	if err == nil || !strings.Contains(err.Error(), "failed to get app instances") {
		t.Fatalf("expected app-instances error, got: %v", err)
	}
}

// --- SSH-related orchestration tests ---

// TestSetupSSH_Success ensures SetupSSH calls EnsureSSHKey and AddSSHKeyToDevice
// and does not return an error.
func TestSetupSSH_Success(t *testing.T) {
	// Isolate HOME so we don't touch real keys.
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	// Create a dummy key pair so EnsureSSHKey finds it.
	sshDir := filepath.Join(tmpHome, ".ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		t.Fatalf("mkdir .ssh: %v", err)
	}
	privPath := filepath.Join(sshDir, "id_ed25519")
	pubPath := privPath + ".pub"
	if err := os.WriteFile(privPath, []byte("dummy"), 0o600); err != nil {
		t.Fatalf("write priv: %v", err)
	}
	pubContents := "ssh-ed25519 AAAATESTKEY test@local"
	if err := os.WriteFile(pubPath, []byte(pubContents), 0o644); err != nil {
		t.Fatalf("write pub: %v", err)
	}

	fakeClient := &fakeZededaClient{}
	a := newTestApp(fakeClient, nil)

	if err := a.SetupSSH("node1"); err != nil {
		t.Fatalf("SetupSSH returned error: %v", err)
	}
}

// TestGetSSHStatus_DisabledWhenNoDeviceKey ensures that when device has no SSH key,
// status is reported as disabled.
func TestGetSSHStatus_DisabledWhenNoDeviceKey(t *testing.T) {
	fakeClient := &fakeZededaClient{
		edgeStatus: &zededa.EdgeViewStatus{
			SSHKey:      "",
			MaxSessions: 2,
			Expiry:      "12345",
			DebugKnob:   true,
		},
	}

	a := newTestApp(fakeClient, &fakeSessionManager{})

	st := a.GetSSHStatus("node1")
	if st.Status != "disabled" {
		t.Fatalf("expected status 'disabled', got %q", st.Status)
	}
	if st.MaxSessions != 2 || st.Expiry != "12345" || !st.DebugKnob {
		t.Fatalf("unexpected EdgeView metadata: %+v", st)
	}
}

// TestGetSSHStatus_EnabledOnKeyMatch ensures that if device SSH key matches one of the
// local public keys, status is reported as enabled.
func TestGetSSHStatus_EnabledOnKeyMatch(t *testing.T) {
	// Temp HOME to avoid touching real ~/.ssh
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	sshDir := filepath.Join(tmpHome, ".ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		t.Fatalf("mkdir .ssh: %v", err)
	}
	privPath := filepath.Join(sshDir, "id_ed25519")
	pubPath := privPath + ".pub"
	pubContents := "ssh-ed25519 AAAATESTKEY test@local"
	if err := os.WriteFile(privPath, []byte("dummy"), 0o600); err != nil {
		t.Fatalf("write priv: %v", err)
	}
	if err := os.WriteFile(pubPath, []byte(pubContents+"\n"), 0o644); err != nil {
		t.Fatalf("write pub: %v", err)
	}

	fakeClient := &fakeZededaClient{
		edgeStatus: &zededa.EdgeViewStatus{
			SSHKey:      pubContents,
			MaxSessions: 1,
			Expiry:      "99999",
			DebugKnob:   false,
		},
	}

	a := newTestApp(fakeClient, &fakeSessionManager{})

	st := a.GetSSHStatus("node1")
	if st.Status != "enabled" {
		t.Fatalf("expected status 'enabled', got %q", st.Status)
	}
}

// TestDisableSSH_PropagatesError checks that DisableSSH surfaces client errors.
func TestDisableSSH_PropagatesError(t *testing.T) {
	fakeClient := &fakeZededaClient{disableErr: errors.New("fail")}

	a := newTestApp(fakeClient, nil)

	if err := a.DisableSSH("node1"); err == nil || !strings.Contains(err.Error(), "failed to disable ssh") {
		t.Fatalf("expected wrapped disable error, got: %v", err)
	}
}

// TestResetEdgeView_PropagatesErrors verifies both stop and start errors are surfaced.
func TestResetEdgeView_PropagatesErrors(t *testing.T) {
	// StartEdgeView failure
	fakeClient2 := &fakeZededaClient{startErr: errors.New("start-fail")}
	a2 := newTestApp(fakeClient2, nil)
	if err := a2.ResetEdgeView("node1"); err == nil || !strings.Contains(err.Error(), "failed to start EdgeView") {
		t.Fatalf("expected start error, got: %v", err)
	}
}

// TestResetEdgeView_InvalidatesCache verifies that a successful reset clears the
// locally cached session. Otherwise reset only recycles the cloud-side session
// while the stale local cache keeps reporting the dead session as active,
// leaving the UI stuck and unable to recover (the bug this fixes).
func TestResetEdgeView_InvalidatesCache(t *testing.T) {
	sess := &fakeSessionManager{}
	// stopErr (ignored by reset) is set only to skip the 2s propagation sleep
	// that runs when StopEdgeView succeeds.
	a := newTestApp(&fakeZededaClient{stopErr: errors.New("already stopped")}, sess)
	sess.StoreCachedSession("node1", &zededa.SessionConfig{URL: "wss://example"}, 0, "", time.Now().Add(time.Hour))

	if _, ok := sess.GetCachedSession("node1"); !ok {
		t.Fatalf("precondition: expected cached session before reset")
	}
	if err := a.ResetEdgeView("node1"); err != nil {
		t.Fatalf("ResetEdgeView returned error: %v", err)
	}
	if _, ok := sess.GetCachedSession("node1"); ok {
		t.Fatalf("expected cached session to be invalidated after reset")
	}
}

// TestParseAppInfo verifies we can extract enrichment data from a representative snippet.
func TestParseAppInfo(t *testing.T) {
	sample := `- app uuid 123e4567-e89b-12d3-a456-426614174000
state: 115, something else
VIF IP: [{192.168.0.62 8}]
VNC enabled: true, VNC display id: 1, other
Applog disabled: true
== app:`

	result := ParseAppInfo(sample)
	if len(result) != 1 {
		t.Fatalf("expected 1 app enrichment, got %d", len(result))
	}

	enrich, ok := result["123e4567-e89b-12d3-a456-426614174000"]
	if !ok {
		t.Fatalf("expected app UUID key to be present")
	}
	if enrich.State != "Running" {
		t.Fatalf("expected state 'Running', got %q", enrich.State)
	}
	if len(enrich.IPs) != 1 || enrich.IPs[0] != "192.168.0.62" {
		t.Fatalf("unexpected IPs: %+v", enrich.IPs)
	}
	if enrich.VNCPort != 5901 {
		t.Fatalf("expected VNCPort 5901, got %d", enrich.VNCPort)
	}
	if !enrich.AppLogDisabled {
		t.Fatalf("expected AppLogDisabled=true")
	}

	// Ensure result is JSON-marshalable to catch struct tag mistakes
	if _, err := json.Marshal(enrich); err != nil {
		t.Fatalf("failed to marshal enrichment to JSON: %v", err)
	}
}

// --- sortIPv4First ---

func TestSortIPv4First_MixedFamilies(t *testing.T) {
	in := []string{"fd00::1", "127.0.0.1", "192.168.1.10", "fe80::1"}
	got := sortIPv4First(in)
	want := []string{"127.0.0.1", "192.168.1.10", "fd00::1", "fe80::1"}
	if !equalStrings(got, want) {
		t.Errorf("sortIPv4First(%v)\n  got:  %v\n  want: %v", in, got, want)
	}
}

func TestSortIPv4First_AllIPv4_Unchanged(t *testing.T) {
	in := []string{"127.0.0.1", "10.0.0.1", "192.168.1.10"}
	got := sortIPv4First(in)
	if !equalStrings(got, in) {
		t.Errorf("expected unchanged, got %v", got)
	}
}

func TestSortIPv4First_AllIPv6_Unchanged(t *testing.T) {
	in := []string{"::1", "fd00::1", "fe80::1"}
	got := sortIPv4First(in)
	if !equalStrings(got, in) {
		t.Errorf("expected unchanged, got %v", got)
	}
}

func TestSortIPv4First_IPv4MappedTreatedAsIPv4(t *testing.T) {
	in := []string{"fd00::1", "::ffff:192.0.2.1"}
	got := sortIPv4First(in)
	want := []string{"::ffff:192.0.2.1", "fd00::1"}
	if !equalStrings(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestSortIPv4First_HandlesGarbageGracefully(t *testing.T) {
	in := []string{"not-an-ip", "10.0.0.1"}
	got := sortIPv4First(in)
	want := []string{"10.0.0.1", "not-an-ip"}
	if !equalStrings(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

// TestConnectToNode_PrefersIPv4ManagementIPs verifies that when the device
// status returns IPv6 ahead of IPv4 in its NetStatusList, ConnectToNode
// reorders the candidate list so IPv4 (loopback first, then mgmt IPv4)
// reaches StartProxyMulti before IPv6. Routable IPv6 (fd00::/8 here) is kept
// at the back; link-local IPv6 (fe80::/10) is dropped entirely by the
// dropLinkLocalIPv6 step that runs before the sort.
func TestConnectToNode_PrefersIPv4ManagementIPs(t *testing.T) {
	fakeClient := &fakeZededaClient{
		initSessionScript: "edgeview -token tok",
		parseCfg:          &zededa.SessionConfig{URL: "wss://example", Token: "tok", MaxInst: 2},
		deviceStatus: &zededa.DeviceStatus{
			NetStatusList: []zededa.NetStatus{
				// IPv6 first in the API response — this is exactly the
				// pathological order the sort exists to fix. fe80::1 is
				// link-local and should be dropped before the sort runs.
				{Up: true, IfName: "eth0", IPs: []string{"fd00::5", "192.168.1.10"}},
				{Up: true, IfName: "eth1", IPs: []string{"fe80::1", "10.0.0.5"}},
			},
		},
	}
	fakeSess := &fakeSessionManager{
		startProxyPort: 9001,
		startProxyID:   "tunnel-v4",
	}

	a := newTestApp(fakeClient, fakeSess)
	if _, _, err := a.ConnectToNode("node-v4-pref", true, ""); err != nil {
		t.Fatalf("ConnectToNode returned error: %v", err)
	}

	got := fakeSess.lastMultiCandidateIPs
	want := []string{"127.0.0.1", "192.168.1.10", "10.0.0.5", "fd00::5"}
	if !equalStrings(got, want) {
		t.Errorf("candidate IP order:\n  got:  %v\n  want: %v", got, want)
	}
}

// --- dropLinkLocalIPv6 ---

func TestDropLinkLocalIPv6_RemovesFe80(t *testing.T) {
	in := []string{"127.0.0.1", "fe80::1", "192.168.1.1", "fe80::ab38:13eb:e4c5:8b8e"}
	got := dropLinkLocalIPv6(in)
	want := []string{"127.0.0.1", "192.168.1.1"}
	if !equalStrings(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestDropLinkLocalIPv6_KeepsRoutableIPv6(t *testing.T) {
	in := []string{"fd00::5", "::1", "2001:db8::1"}
	got := dropLinkLocalIPv6(in)
	if !equalStrings(got, in) {
		t.Errorf("expected unchanged, got %v", got)
	}
}

func TestDropLinkLocalIPv6_KeepsIPv4LinkLocalAndGarbage(t *testing.T) {
	// 169.254.0.0/16 is IPv4 link-local but we explicitly only filter IPv6
	// here; non-IP strings pass through too (the upstream sort sends them
	// to the IPv6 bucket where they fail probing harmlessly).
	in := []string{"169.254.1.5", "not-an-ip", "10.0.0.1"}
	got := dropLinkLocalIPv6(in)
	if !equalStrings(got, in) {
		t.Errorf("expected unchanged, got %v", got)
	}
}

func TestDropLinkLocalIPv6_HandlesEmpty(t *testing.T) {
	if got := dropLinkLocalIPv6(nil); len(got) != 0 {
		t.Errorf("nil input should yield empty result, got %v", got)
	}
	if got := dropLinkLocalIPv6([]string{}); len(got) != 0 {
		t.Errorf("empty input should yield empty result, got %v", got)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
