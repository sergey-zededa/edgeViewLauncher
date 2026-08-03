package main

import (
	"context"
	"edgeViewLauncher/internal/cache"
	"edgeViewLauncher/internal/config"
	"errors"
	"edgeViewLauncher/internal/session"
	"edgeViewLauncher/internal/ssh"
	"edgeViewLauncher/internal/zededa"
	"encoding/json"
	"fmt"
	"net"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"
)

// zededaAPI defines the subset of zededa.Client used by App.
type zededaAPI interface {
	GetEnterprise() (*zededa.Enterprise, error)
	GetProjects() ([]zededa.Project, error)
	GetProjectsCtx(ctx context.Context) ([]zededa.Project, error)
	SearchNodes(query string, limit, skip int, projectID string) (*zededa.SearchResult, error)                                                                       // legacy compat
	SearchNodesWithToken(query string, limit int, pageToken string, projectID string) (*zededa.SearchResult, error)                                                  // cursor-based
	SearchNodesWithTokenCtx(ctx context.Context, query string, limit int, pageToken string, projectID string) (*zededa.SearchResult, error)
	UpdateConfig(baseURL, token string)
	InitSession(targetID string) (string, error)
	ParseEdgeViewScript(script string) (*zededa.SessionConfig, error)
	ParseEdgeViewToken(token string) (*zededa.SessionConfig, error)
	AddSSHKeyToDevice(nodeID, pubKey string) error
	GetEdgeViewStatus(nodeID string) (*zededa.EdgeViewStatus, error)
	DisableSSH(nodeID, ourKey string) error
	StopEdgeView(nodeID string) error
	StartEdgeView(nodeID string) error
	SetVGAEnabled(nodeID string, enabled bool) error
	SetUSBEnabled(nodeID string, enabled bool) error
	SetConsoleEnabled(nodeID string, enabled bool) error
	GetDeviceAppInstances(deviceID, deviceName string) ([]zededa.AppInstance, error)
	GetAppInstanceDetails(appInstanceID string) (*zededa.AppInstanceDetails, error)
	GetAppInstanceConfig(appInstanceID string) (*zededa.AppInstanceConfig, error)
	GetNetworkInstanceDetails(niID string) (*zededa.NetworkInstanceStatus, error)
	GetDevice(nodeID string) (map[string]interface{}, error)
	GetDeviceStatus(nodeID string) (*zededa.DeviceStatus, error)
	VerifyToken(token string) (*zededa.TokenInfo, error)
	UpdateEdgeViewExternalPolicy(nodeID string, enable bool) error
}

// sessionAPI defines the subset of session.Manager used by App.
type sessionAPI interface {
	GetCachedSession(nodeID string) (*session.CachedSession, bool)
	GetTunnel(tunnelID string) (*session.Tunnel, bool)
	StoreCachedSession(nodeID string, config *zededa.SessionConfig, port int, tunnelID string, expiresAt time.Time)
	// StartProxy starts a persistent EdgeView proxy for the given device nodeID and target.
	StartProxy(ctx context.Context, config *zededa.SessionConfig, nodeID string, target string, protocol string, onProgress func(string)) (int, string, error)
	// StartProxyMulti probes multiple candidate IPs (round-robin per round,
	// up to MaxInst probes in parallel per round) and returns the first
	// successful tunnel. Used for SSH where the EVE-OS host is reachable via
	// any of several management interfaces.
	StartProxyMulti(ctx context.Context, config *zededa.SessionConfig, nodeID string, candidateIPs []string, targetPort int, protocol string, onProgress func(string)) (int, string, error)
	LaunchTerminal(port int, keyPath string) error
	ExecuteCommand(nodeID string, command string) (string, error)
	CloseTunnel(tunnelID string) error
	ListTunnels(nodeID string) []*session.Tunnel
	GetAllTunnels() []*session.Tunnel
	InvalidateSession(nodeID string)
	StartCollectInfo(nodeID string) (string, error)
	GetCollectInfoJob(jobID string) *session.CollectInfoJob
	StartComposeDiagnostics(nodeID, appName, appIP, username, password string) (string, error)
	GetComposeDiagnosticsJob(jobID string) *session.ComposeDiagnosticsJob
}

// App struct
type App struct {
	ctx            context.Context
	config         *config.Config
	zededaClient   zededaAPI
	sessionManager sessionAPI
	mu             sync.RWMutex

	// Connection progress tracking
	connectionProgress map[string]string // nodeID -> status message
	progressMu         sync.RWMutex

	// Per-node cancel handles for in-flight ConnectToNode / StartTunnel
	// attempts. Populated when an attempt starts, cleared on completion
	// or after CancelConnection fires. Guarded by progressMu.
	connectionCancels map[string]context.CancelFunc

	// Cache for app enrichments (IPs, VNC ports)
	enrichmentCache map[string]AppEnrichment // Key: App UUID
	enrichmentMu    sync.RWMutex

	// Cache for node metadata (device name, project ID) used to enrich
	// tunnel listings without repeatedly calling the Cloud API.
	nodeMetaCache map[string]NodeMeta // Key: device/node UUID
	nodeMetaMu    sync.RWMutex

	// Cache for token info (user email, expiry)
	tokenInfoCache *zededa.TokenInfo

	// Track currently enriching nodes to avoid redundant work and allow waiting
	enrichingJobs map[string]chan struct{}
	enrichingMu_  sync.Mutex

	// Device/project cache
	deviceCache *cache.Manager
}

// NewApp creates a new App application struct
func NewApp() *App {
	cfg, _ := config.Load() // Ignore error for now, use default

	// Find active cluster config
	baseURL := "https://zedcontrol.zededa.net" // Default
	apiToken := ""

	if cfg.ActiveCluster != "" {
		for _, c := range cfg.Clusters {
			if c.Name == cfg.ActiveCluster {
				baseURL = c.BaseURL
				apiToken = c.APIToken
				break
			}
		}
	} else if len(cfg.Clusters) > 0 {
		// Fallback to first cluster
		baseURL = cfg.Clusters[0].BaseURL
		apiToken = cfg.Clusters[0].APIToken
	} else {
		// Legacy fallback
		if cfg.BaseURL != "" {
			baseURL = cfg.BaseURL
		}
		if cfg.APIToken != "" {
			apiToken = cfg.APIToken
		}
	}

	a := &App{
		config:             cfg,
		zededaClient:       zededa.NewClient(baseURL, apiToken),
		sessionManager:     session.NewManager(),
		enrichmentCache:    make(map[string]AppEnrichment),
		nodeMetaCache:      make(map[string]NodeMeta),
		connectionProgress: make(map[string]string),
		enrichingJobs:      make(map[string]chan struct{}),
		connectionCancels:  make(map[string]context.CancelFunc),
		deviceCache:        cache.NewManager(),
	}

	// Load disk cache for the active cluster
	if cfg.ActiveCluster != "" {
		a.deviceCache.SwitchCluster(cfg.ActiveCluster)
	}

	return a
}

// SetConnectionProgress updates the connection status for a node
func (a *App) SetConnectionProgress(nodeID, status string) {
	a.progressMu.Lock()
	defer a.progressMu.Unlock()
	a.connectionProgress[nodeID] = status
}

// GetConnectionProgress returns the current connection status for a node
func (a *App) GetConnectionProgress(nodeID string) string {
	a.progressMu.RLock()
	defer a.progressMu.RUnlock()
	return a.connectionProgress[nodeID]
}

// beginConnection creates a cancellable child context for an in-flight
// ConnectToNode / StartTunnel attempt, keyed by nodeID. If a prior attempt is
// still tracked, it is cancelled first so only one is in flight per node. The
// returned cleanup function deregisters the cancel and should be called once
// the attempt completes.
func (a *App) beginConnection(nodeID string) (context.Context, func()) {
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)

	a.progressMu.Lock()
	if prev, ok := a.connectionCancels[nodeID]; ok && prev != nil {
		prev()
	}
	a.connectionCancels[nodeID] = cancel
	a.progressMu.Unlock()

	cleanup := func() {
		a.progressMu.Lock()
		if cur, ok := a.connectionCancels[nodeID]; ok {
			// Only remove if this is still our cancel — avoid clobbering a
			// newer in-flight attempt that replaced us.
			if &cur == &cancel || sameFunc(cur, cancel) {
				delete(a.connectionCancels, nodeID)
			}
		}
		a.progressMu.Unlock()
		cancel()
	}
	return ctx, cleanup
}

// sameFunc is a best-effort pointer comparison of two CancelFuncs. Since Go
// does not allow == on funcs, we compare via reflect.ValueOf.Pointer.
func sameFunc(a, b context.CancelFunc) bool {
	return reflect.ValueOf(a).Pointer() == reflect.ValueOf(b).Pointer()
}

// CancelConnection cancels any in-flight ConnectToNode / StartTunnel for the
// given nodeID. Safe to call when no attempt is running.
func (a *App) CancelConnection(nodeID string) {
	a.progressMu.Lock()
	cancel, ok := a.connectionCancels[nodeID]
	if ok {
		delete(a.connectionCancels, nodeID)
	}
	a.progressMu.Unlock()
	if ok && cancel != nil {
		cancel()
		a.SetConnectionProgress(nodeID, "Cancelled")
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// GetSettings returns the current configuration
func (a *App) GetSettings() *config.Config {
	return a.config
}

// SaveSettings updates the configuration
func (a *App) SaveSettings(clusters []config.ClusterConfig, activeCluster string) error {
	a.config.Clusters = clusters
	a.config.ActiveCluster = activeCluster

	// Find active cluster to update client
	var activeConfig config.ClusterConfig
	found := false
	for _, c := range clusters {
		if c.Name == activeCluster {
			activeConfig = c
			found = true
			break
		}
	}

	if found {
		// Update client with new active cluster settings
		a.zededaClient.UpdateConfig(activeConfig.BaseURL, activeConfig.APIToken)

		// Clear cached token info and re-fetch for the new cluster
		a.mu.Lock()
		a.tokenInfoCache = nil
		a.mu.Unlock()
		a.fetchTokenInfo(activeConfig.APIToken)

		// Switch device cache to the new cluster and start background refresh
		a.deviceCache.SwitchCluster(activeCluster)
		if activeConfig.APIToken != "" {
			a.deviceCache.StartBackground(a.zededaClient, 75*time.Second)
		}
	}

	return config.Save(a.config)
}

// GetDeviceCache returns the current device/project cache.
func (a *App) GetDeviceCache() *cache.ClusterCache {
	return a.deviceCache.Get()
}

// IsDeviceCacheRefreshing returns true if a cache refresh is in progress.
func (a *App) IsDeviceCacheRefreshing() bool {
	return a.deviceCache.IsRefreshing()
}

// RefreshDeviceCache triggers an async cache refresh.
func (a *App) RefreshDeviceCache() {
	go a.deviceCache.Refresh(a.zededaClient)
}

// GetUserInfo returns cluster URL and enterprise for display
func (a *App) GetUserInfo() map[string]string {
	enterprise := "Unknown"
	tokenOwner := ""
	tokenExpiry := ""
	tokenRole := ""
	lastLogin := ""

	// Get active cluster details
	var apiToken, baseURL string
	for _, c := range a.config.Clusters {
		if c.Name == a.config.ActiveCluster {
			apiToken = c.APIToken
			baseURL = c.BaseURL
			break
		}
	}

	// API token format: enterpriseId:token
	if apiToken != "" {
		parts := strings.Split(apiToken, ":")
		if len(parts) >= 2 {
			enterprise = parts[0]
		}

		// Check if we have cached token info
		a.mu.RLock()
		cachedInfo := a.tokenInfoCache
		a.mu.RUnlock()

		if cachedInfo != nil && cachedInfo.Subject != "" {
			tokenOwner = cachedInfo.Subject
			if !cachedInfo.ExpiresAt.IsZero() {
				tokenExpiry = cachedInfo.ExpiresAt.Format(time.RFC3339)
			}
			if cachedInfo.Role != "" {
				tokenRole = cachedInfo.Role
			}
			if !cachedInfo.LastLogin.IsZero() {
				lastLogin = cachedInfo.LastLogin.Format(time.RFC3339)
			}
		} else {
			// Trigger async fetch if not cached
			go a.fetchTokenInfo(apiToken)
		}
	}

	return map[string]string{
		"clusterUrl":  baseURL,
		"enterprise":  enterprise,
		"clusterName": a.config.ActiveCluster,
		"tokenOwner":  tokenOwner,
		"tokenExpiry": tokenExpiry,
		"tokenRole":   tokenRole,
		"lastLogin":   lastLogin,
	}
}

// fetchTokenInfo fetches token info in background and caches it
func (a *App) fetchTokenInfo(apiToken string) {
	if a.zededaClient == nil {
		return
	}
	tokenInfo, err := a.zededaClient.VerifyToken(apiToken)
	if err != nil {
		return
	}
	if tokenInfo != nil {
		a.mu.Lock()
		a.tokenInfoCache = tokenInfo
		a.mu.Unlock()
	}
}

// GetEnterprise returns enterprise information
func (a *App) GetEnterprise() (*zededa.Enterprise, error) {
	return a.zededaClient.GetEnterprise()
}

// GetProjects returns list of all projects
func (a *App) GetProjects() ([]zededa.Project, error) {
	return a.zededaClient.GetProjects()
}

// SearchNodes searches for nodes matching the query
func (a *App) SearchNodes(query string, limit int, pageToken string, projectID string, nodeID string) (*zededa.SearchResult, error) {
	if nodeID != "" {
		// Fetch a specific node using its status endpoint
		status, err := a.zededaClient.GetDeviceStatus(nodeID)
		if err != nil || status == nil {
			// Not found or error -> return empty search result
			return &zededa.SearchResult{Nodes: []zededa.Node{}}, nil
		}
		
		// Convert DeviceStatus to Node format for the frontend
		runState := strings.TrimSpace(status.RunState)
		nodeStatus := "offline"
		if runState == "RUN_STATE_ONLINE" || runState == "ONLINE" {
			nodeStatus = "online"
		} else {
			nodeStatus = strings.TrimPrefix(runState, "RUN_STATE_")
			nodeStatus = strings.ToLower(nodeStatus)
		}
		
		return &zededa.SearchResult{
			Nodes: []zededa.Node{{
				ID:       status.ID,
				Name:     status.Name,
				Project:  status.ProjectID,
				Status:   nodeStatus,
				EdgeView: true,
			}},
		}, nil
	}
	return a.zededaClient.SearchNodesWithToken(query, limit, pageToken, projectID)
}

// AddRecentDevice adds a device ID to the recent list
func (a *App) AddRecentDevice(nodeID string) {
	// Remove if already exists to move to top
	var newRecent []string
	for _, id := range a.config.RecentDevices {
		if id != nodeID {
			newRecent = append(newRecent, id)
		}
	}
	// Prepend
	newRecent = append([]string{nodeID}, newRecent...)

	// Limit to 10
	if len(newRecent) > 10 {
		newRecent = newRecent[:10]
	}

	a.config.RecentDevices = newRecent
	config.Save(a.config)
}

// ConnectToNode initiates a session to the node. If targetIP is non-empty, the
// proxy is restricted to that single management IP instead of probing every
// candidate returned by the Cloud API.
func (a *App) ConnectToNode(nodeID string, useInAppTerminal bool, targetIP string) (int, string, error) {
	fmt.Printf("ConnectToNode called for %s (In-App: %v, TargetIP: %q)\n", nodeID, useInAppTerminal, targetIP)
	a.SetConnectionProgress(nodeID, "Initializing connection...")

	ctx, releaseConnection := a.beginConnection(nodeID)
	defer releaseConnection()

	var sessionConfig *zededa.SessionConfig
	var port int
	var tunnelID string
	var needNewProxy bool

	// Check if we have a cached session
	a.SetConnectionProgress(nodeID, "Checking for cached session...")
	if cached, ok := a.sessionManager.GetCachedSession(nodeID); ok {
		// For native terminal, try to reuse the cached proxy port — but only
		// after verifying the underlying tunnel is still alive. The teardown
		// paths in session.Manager (CloseTunnel/FailTunnel) clear cached.Port
		// when their tunnel dies, so cached.Port>0 normally implies liveness.
		// This GetTunnel check is belt-and-braces against any future teardown
		// path that forgets to invalidate the cache.
		if !useInAppTerminal && cached.Port > 0 && cached.TunnelID != "" {
			if t, exists := a.sessionManager.GetTunnel(cached.TunnelID); exists && t.Status == "active" {
				fmt.Printf("Reusing cached proxy on port %d (tunnel %s)\n", cached.Port, cached.TunnelID)
				port = cached.Port
				tunnelID = cached.TunnelID
				needNewProxy = false
			} else {
				fmt.Printf("Cached port %d is stale (tunnel %s gone) — starting fresh proxy\n", cached.Port, cached.TunnelID)
				sessionConfig = cached.Config
				needNewProxy = true
			}
		} else {
			// For in-app terminal, always create new proxy (old one died with window)
			fmt.Println("Using cached session config, creating new proxy")
			sessionConfig = cached.Config
			needNewProxy = true
		}
	} else {
		// No cached session - check if API says one is already active
		// This avoids re-enabling EdgeView if the user just closed the window but session is still valid
		// fmt.Println("No local cached session, checking Cloud API status...")

		// We need to get the actual EdgeView Status which contains the JWT and URL.
		evStatus, err := a.zededaClient.GetEdgeViewStatus(nodeID)
		if err == nil && evStatus != nil && evStatus.Token != "" && evStatus.DispURL != "" {
			// fmt.Println("Found active EdgeView session from API, reusing token...")

			// We need to extract the 'Key' from the JWT payload because it's required for envelope signing.
			// The API response doesn't give us the raw signing key (that's only in InitSession response usually),
			// BUT the JWT 'key' claim is the nonce used for session isolation, which matches what we need.
			// Let's reuse ParseEdgeViewToken which decodes the JWT and populates SessionConfig.

			sc, parseErr := a.zededaClient.ParseEdgeViewToken(evStatus.Token)
			if parseErr == nil {
				sessionConfig = sc
				// Ensure URL is correct (API might return raw dispUrl without wss://)
				if !strings.HasPrefix(sessionConfig.URL, "wss://") && !strings.HasPrefix(sessionConfig.URL, "ws://") {
					// Use the logic from ParseEdgeViewToken or just prefer what we have if ParseEdgeViewToken handled it.
					// Actually ParseEdgeViewToken uses claims.Dep.
					// If claims.Dep is missing, we fall back to evStatus.DispURL
					if sessionConfig.URL == "" {
						sessionConfig.URL = evStatus.DispURL
						// fixup protocol
						if !strings.HasPrefix(sessionConfig.URL, "http") && !strings.HasPrefix(sessionConfig.URL, "ws") {
							sessionConfig.URL = "wss://" + sessionConfig.URL
						}
					}
				}
				// fmt.Printf("Reused active session. URL: %s\n", sessionConfig.URL)
			} else {
				fmt.Printf("Failed to parse active token: %v\n", parseErr)
			}
		}

		if sessionConfig == nil {
			// Need to get new script/session
			fmt.Println("No cached session or key missing, requesting new EdgeView script...")
			a.SetConnectionProgress(nodeID, "Requesting new EdgeView session from Cloud...")
			script, err := a.zededaClient.InitSession(nodeID)
			if err != nil {
				fmt.Printf("InitSession failed: %v\n", err)
				a.SetConnectionProgress(nodeID, "Error: Failed to init session")
				return 0, "", fmt.Errorf("failed to init session: %w", err)
			}
			// fmt.Println("EdgeView enabled, script received.")

			// Parse the script to get Session Config
			// fmt.Println("Parsing script...")
			sessionConfig, err = a.zededaClient.ParseEdgeViewScript(script)
			if err != nil {
				fmt.Printf("ParseEdgeViewScript failed: %v\n", err)
				a.SetConnectionProgress(nodeID, "Error: Failed to parse script")
				return 0, "", fmt.Errorf("failed to parse script: %w", err)
			}
			// fmt.Printf("Script parsed. URL: %s\n", sessionConfig.URL)
		}

		fmt.Println("DEBUG: Requesting EdgeView session...")
		a.SetConnectionProgress(nodeID, "Connecting to EdgeView...")
		// No artificial delay - rely on retries in StartProxy

		needNewProxy = true
	}

	// Start new proxy if needed
	if needNewProxy {
		// fmt.Println("Starting proxy...")
		a.SetConnectionProgress(nodeID, "Starting local secure proxy...")

		var candidateIPs []string
		if targetIP != "" {
			// User selected a specific management IP — restrict probing to it.
			candidateIPs = []string{targetIP}
			fmt.Printf("DEBUG: Restricted to user-selected IP: %s\n", targetIP)
		} else {
			// 1. Gather candidate IPs
			// Always try localhost first
			candidateIPs = []string{"127.0.0.1"}

			// Fetch device status to find other management IPs
			status, err := a.zededaClient.GetDeviceStatus(nodeID)
			if err == nil && status != nil {
				for _, ns := range status.NetStatusList {
					if ns.Up {
						for _, ip := range ns.IPs {
							if ip != "" && ip != "127.0.0.1" {
								candidateIPs = append(candidateIPs, ip)
							}
						}
					}
				}
			} else {
				fmt.Printf("Warning: Failed to fetch device status for IP discovery: %v\n", err)
			}

			// Remove duplicates
			candidateIPs = uniqueStrings(candidateIPs)
			// Drop IPv6 link-local (fe80::/10) — they never work through the
			// EdgeView relay (no scope ID) and the dispatcher silently times them
			// out, eating a probe slot and dragging the round to its 10s ceiling.
			candidateIPs = dropLinkLocalIPv6(candidateIPs)
			// Prefer IPv4 (incl. 127.0.0.1) over IPv6: with MaxInst parallel probes
			// per round, an IPv6 address early in the API response would push IPv4
			// candidates into round 2 and behind exponential backoff. Stable sort
			// preserves the existing within-family order.
			candidateIPs = sortIPv4First(candidateIPs)
			fmt.Printf("DEBUG: Candidate IPs for SSH: %v\n", candidateIPs)
		}

		// Probe every candidate IP in parallel batches (sized by MaxInst) per
		// round, instead of waterfalling 5 retries through one IP at a time.
		// First IP to answer wins.
		port, tunnelID, err := a.sessionManager.StartProxyMulti(
			ctx, sessionConfig, nodeID, candidateIPs, 22, "ssh",
			func(status string) {
				a.SetConnectionProgress(nodeID, status)
			},
		)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				a.SetConnectionProgress(nodeID, "Cancelled")
				return 0, "", err
			}
			a.SetConnectionProgress(nodeID, "Error: Connection failed on all interfaces")
			return 0, "", fmt.Errorf("failed to start proxy on any candidate IP: %w", err)
		}
		fmt.Printf("Successfully connected via candidate set %v\n", candidateIPs)

		// Cache the session config (always cache token/URL, cache port only for native terminal)
		portToCache := 0
		tunnelIDToCache := ""
		if !useInAppTerminal {
			portToCache = port
			tunnelIDToCache = tunnelID
		}
		expiresAt := time.Now().Add(4*time.Hour + 50*time.Minute)
		a.sessionManager.StoreCachedSession(nodeID, sessionConfig, portToCache, tunnelIDToCache, expiresAt)
		if useInAppTerminal {
			// fmt.Println("Session config cached (proxy will close with window)")
		} else {
			// fmt.Printf("Session and proxy cached until %s\n", expiresAt.Format(time.RFC3339))
		}
		
		// Return success values
		a.SetConnectionProgress(nodeID, "Connected")
		return port, tunnelID, nil
	}

	// Launch the terminal if requested
	if !useInAppTerminal {
		// DEPRECATED: Backend terminal launching is replaced by frontend/Electron `openExternalTerminal`.
		// We log this but do not attempt to launch from Go to avoid platform inconsistencies and double-launches.
		// fmt.Println("Native terminal launch requested (handled by frontend).")
		a.SetConnectionProgress(nodeID, "Ready for native terminal")
	} else {
		// fmt.Println("In-app terminal requested, skipping native launch.")
	}

	a.SetConnectionProgress(nodeID, "Connected")
	return port, tunnelID, nil
}

// StartTunnel starts a TCP tunnel to a specific IP and port on the device
// protocol is optional: "vnc", "ssh", "tcp". If empty, it's inferred from port.
func (a *App) StartTunnel(nodeID, targetIP string, targetPort int, protocol string) (int, string, error) {
	// callID := time.Now().UnixNano()
	// fmt.Printf("StartTunnel[%d] called for %s -> %s:%d (protocol: %s)\n", callID, nodeID, targetIP, targetPort, protocol)

	ctx, releaseConnection := a.beginConnection(nodeID)
	defer releaseConnection()

	// Get cached session
	cached, ok := a.sessionManager.GetCachedSession(nodeID)
	if !ok {
		// fmt.Println("DEBUG: No cached session found, checking Cloud API status...")

		var sessionConfig *zededa.SessionConfig

		// Check if API says one is already active (reuse logic from ConnectToNode)
		evStatus, err := a.zededaClient.GetEdgeViewStatus(nodeID)
		if err == nil && evStatus != nil && evStatus.Token != "" && evStatus.DispURL != "" {
			// fmt.Println("Found active EdgeView session from API, reusing token...")
			sc, parseErr := a.zededaClient.ParseEdgeViewToken(evStatus.Token)
			if parseErr == nil {
				sessionConfig = sc
				// Ensure URL is correct
				if !strings.HasPrefix(sessionConfig.URL, "wss://") && !strings.HasPrefix(sessionConfig.URL, "ws://") {
					if sessionConfig.URL == "" {
						sessionConfig.URL = evStatus.DispURL
						if !strings.HasPrefix(sessionConfig.URL, "http") && !strings.HasPrefix(sessionConfig.URL, "ws") {
							sessionConfig.URL = "wss://" + sessionConfig.URL
						}
					}
				}
				// Force update of cached session with potentially newer info (e.g. encryption)
				// We don't change expiration or port yet, just the config
				// But we need to use the existing cache's expiry if available, or set a new one?
				// Since we are reusing an active session, let's refresh the expiry in our cache too.
				newExpires := time.Now().Add(4*time.Hour + 50*time.Minute)

				// Preserve port if reusing for same purpose (but here we are starting a new tunnel so port is dynamic)
				// Actually, StartTunnel doesn't care about cached port unless it's reusing the whole session for the SAME tunnel.
				// Here we just want to update the config.

				a.sessionManager.StoreCachedSession(nodeID, sessionConfig, 0, "", newExpires)
				// Re-fetch to ensure 'cached' variable points to the updated data
				cached, _ = a.sessionManager.GetCachedSession(nodeID)

				// fmt.Printf("Reused active session. URL: %s\n", sessionConfig.URL)
			} else {
				fmt.Printf("Failed to parse active token: %v\n", parseErr)
			}
		}

		if sessionConfig == nil {
			// fmt.Println("DEBUG: No active session found or invalid, creating new one for tunnel...")
			// Try to create a new session
			script, err := a.zededaClient.InitSession(nodeID)
			if err != nil {
				return 0, "", fmt.Errorf("no active session found and failed to create one: %w", err)
			}

			sessionConfig, err = a.zededaClient.ParseEdgeViewScript(script)
			if err != nil {
				return 0, "", fmt.Errorf("failed to parse session script: %w", err)
			}
		}

		expiresAt := time.Now().Add(4*time.Hour + 50*time.Minute)
		a.sessionManager.StoreCachedSession(nodeID, sessionConfig, 0, "", expiresAt)
		cached, _ = a.sessionManager.GetCachedSession(nodeID)

		// Give device MORE time to establish stable connection
		fmt.Println("DEBUG: Requesting EdgeView session...")
	}

	// Infer protocol if not specified
	if protocol == "" {
		protocol = "tcp"
		if targetPort >= 5900 && targetPort <= 5999 {
			protocol = "vnc"
		}
	}

	// Construct target string (e.g., "192.168.0.1:5900")
	// Note: StartProxy will prepend "tcp/" to this
	target := fmt.Sprintf("%s:%d", targetIP, targetPort)

	// Try to start proxy with retry for transient "no device online" errors
	maxRetries := 3
	var port int
	var tunnelID string
	var err error

	// Progress callback wrapper
	onProgress := func(status string) {
		a.SetConnectionProgress(nodeID, status)
	}

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if ctx.Err() != nil {
			a.SetConnectionProgress(nodeID, "Cancelled")
			return 0, "", ctx.Err()
		}
		fmt.Printf("DEBUG: Starting tunnel (attempt %d/%d)...\n", attempt, maxRetries)

		port, tunnelID, err = a.sessionManager.StartProxy(ctx, cached.Config, nodeID, target, protocol, onProgress)

		if err == nil {
			fmt.Printf("Tunnel started on localhost:%d -> %s (ID: %s)\n", port, target, tunnelID)
			return port, tunnelID, nil
		}

		if errors.Is(err, context.Canceled) {
			a.SetConnectionProgress(nodeID, "Cancelled")
			return 0, "", err
		}

		// External policy denial — don't retry, return immediately with user-friendly message
		if errors.Is(err, session.ErrExternalPolicyDenied) {
			return 0, "", err
		}

		// Handle "no device online" specifically (or timeouts which might be same cause)
		if strings.Contains(err.Error(), "no device online") || strings.Contains(err.Error(), "timeout waiting for tcpSetupOK") {
			fmt.Printf("DEBUG: Device offline or timeout (attempt %d/%d)...\n", attempt, maxRetries)

			// If this was the last attempt, try one final hail-mary: refresh the session
			// This handles cases where the session token is stale on the dispatcher side
			if attempt == maxRetries {
				fmt.Println("DEBUG: Last attempt failed with 'no device online'. Forcefully refreshing session...")
				a.sessionManager.InvalidateSession(nodeID)
				onProgress("Refreshing session (device unreachable)...")

				// Init new session
				script, initErr := a.zededaClient.InitSession(nodeID)
				if initErr != nil {
					fmt.Printf("DEBUG: Failed to init fresh session: %v\n", initErr)
					// Return original error
					break
				}

				// Parse and store
				newConfig, parseErr := a.zededaClient.ParseEdgeViewScript(script)
				if parseErr != nil {
					fmt.Printf("DEBUG: Failed to parse fresh script: %v\n", parseErr)
					break
				}

				expiresAt := time.Now().Add(4*time.Hour + 50*time.Minute)
				a.sessionManager.StoreCachedSession(nodeID, newConfig, 0, "", expiresAt)
				cached = &session.CachedSession{Config: newConfig, ExpiresAt: expiresAt} // Update local var

				// One more try with fresh session
				fmt.Println("DEBUG: Retrying with fresh session...")
				onProgress("Retrying with new session...")
				port, tunnelID, err = a.sessionManager.StartProxy(ctx, cached.Config, nodeID, target, protocol, onProgress)
				if err == nil {
					fmt.Printf("Tunnel started on localhost:%d -> %s (ID: %s) after session refresh\n", port, target, tunnelID)
					return port, tunnelID, nil
				}
				if errors.Is(err, context.Canceled) {
					a.SetConnectionProgress(nodeID, "Cancelled")
					return 0, "", err
				}
			} else {
				// Standard backoff for intermediate attempts
				timer := time.NewTimer(2 * time.Second)
				select {
				case <-timer.C:
				case <-ctx.Done():
					timer.Stop()
					a.SetConnectionProgress(nodeID, "Cancelled")
					return 0, "", ctx.Err()
				}
				continue
			}
		}

		// Other error, don't retry
		break
	}

	return 0, "", fmt.Errorf("failed to start tunnel after %d attempts: %w", maxRetries, err)
}

// CloseTunnel closes a persistent tunnel
func (a *App) CloseTunnel(tunnelID string) error {
	return a.sessionManager.CloseTunnel(tunnelID)
}

// ListTunnels returns all active tunnels for a node
func (a *App) ListTunnels(nodeID string) []*session.Tunnel {
	if nodeID == "" {
		return a.sessionManager.GetAllTunnels()
	}
	return a.sessionManager.ListTunnels(nodeID)
}

// SessionStatus represents the EdgeView session state
type SessionStatus struct {
	Active      bool   `json:"active"`
	ExpiresAt   string `json:"expiresAt,omitempty"` // RFC3339 format
	Port        int    `json:"port,omitempty"`
	IsEncrypted bool   `json:"isEncrypted"`
}

// GetSessionStatus returns the cached session status for a node
func (a *App) GetSessionStatus(nodeID string) SessionStatus {
	cached, ok := a.sessionManager.GetCachedSession(nodeID)
	if !ok {
		return SessionStatus{Active: false}
	}

	enc := false
	if cached.Config != nil {
		enc = cached.Config.Enc
	}
	fmt.Printf("DEBUG: GetSessionStatus for %s: Active=true, Enc=%v\n", nodeID, enc)

	return SessionStatus{
		Active:      true,
		ExpiresAt:   cached.ExpiresAt.Format(time.RFC3339),
		Port:        cached.Port,
		IsEncrypted: enc,
	}
}

// GetAppInfo executes the 'app' command on the device via EdgeView
func (a *App) GetAppInfo(nodeID string) (string, error) {
	return a.sessionManager.ExecuteCommand(nodeID, "app")
}

// GetNodeMeta returns device name and project ID for the given nodeID,
// using a small in-memory cache backed by the ZEDEDA Cloud API.
func (a *App) GetNodeMeta(nodeID string) (string, string) {
	if nodeID == "" {
		return "", ""
	}

	// Fast path: cache hit
	a.nodeMetaMu.RLock()
	if meta, ok := a.nodeMetaCache[nodeID]; ok {
		// Keep metadata reasonably fresh but avoid hammering the API.
		if time.Since(meta.UpdatedAt) < 10*time.Minute {
			a.nodeMetaMu.RUnlock()
			return meta.Name, meta.ProjectID
		}
	}
	a.nodeMetaMu.RUnlock()

	// Slow path: fetch from Cloud API
	device, err := a.zededaClient.GetDevice(nodeID)
	if err != nil {
		fmt.Printf("DEBUG: GetNodeMeta failed for %s: %v\n", nodeID, err)
		return "", ""
	}

	name, _ := device["name"].(string)
	projectID, _ := device["projectId"].(string)

	// Update cache
	a.nodeMetaMu.Lock()
	a.nodeMetaCache[nodeID] = NodeMeta{
		Name:      name,
		ProjectID: projectID,
		UpdatedAt: time.Now(),
	}
	a.nodeMetaMu.Unlock()

	return name, projectID
}

// NodeMeta holds cached device metadata for enriching tunnels/UI.
type NodeMeta struct {
	Name      string
	ProjectID string
	UpdatedAt time.Time
}

// AppEnrichment contains enriched app data from EdgeView
type AppEnrichment struct {
	UUID           string   `json:"uuid"`
	IPs            []string `json:"ips"`
	VNCPort        int      `json:"vncPort"`
	State          string   `json:"state"`
	AppLogDisabled bool     `json:"appLogDisabled"`
}

// ParseAppInfo parses the EdgeView app command output
func ParseAppInfo(output string) map[string]AppEnrichment {
	result := make(map[string]AppEnrichment)

	lines := strings.Split(output, "\n")
	var currentApp *AppEnrichment

	fmt.Printf("DEBUG: Parsing %d lines of output\n", len(lines))

	for i, line := range lines {
		line = strings.TrimSpace(line)

		// Debug log for potential app lines
		if strings.Contains(strings.ToLower(line), "app uuid") || strings.Contains(line, "VIF IP") {
			fmt.Printf("DEBUG: Line %d: %s\n", i, line)
		}

		// Parse app UUID
		// Handle both "- app uuid" and just "app uuid" or case variations
		if strings.Contains(strings.ToLower(line), "app uuid") {
			parts := strings.Fields(line)
			// Look for the UUID part (usually the last one, or after 'uuid')
			for j, part := range parts {
				if part == "uuid" && j+1 < len(parts) {
					uuid := parts[j+1]
					// Simple validation that it looks like a UUID
					if len(uuid) > 20 {
						fmt.Printf("DEBUG: Found app UUID: %s\n", uuid)
						currentApp = &AppEnrichment{UUID: uuid, IPs: []string{}}
					}
				}
			}
			// Fallback: try last part if it looks like UUID
			if currentApp == nil && len(parts) >= 3 {
				uuid := parts[len(parts)-1]
				if len(uuid) > 20 {
					fmt.Printf("DEBUG: Found app UUID (fallback): %s\n", uuid)
					currentApp = &AppEnrichment{UUID: uuid, IPs: []string{}}
				}
			}
		}

		// Parse VIF IP addresses
		if currentApp != nil && strings.Contains(line, "VIF IP:") {
			// Extract IPs from format: VIF IP: [{192.168.0.62 8} {192.168.0.11 32}]
			start := strings.Index(line, "[")
			end := strings.Index(line, "]")
			if start != -1 && end != -1 {
				ipsStr := line[start+1 : end]
				// Parse IP entries like {192.168.0.62 8}
				ipEntries := strings.Split(ipsStr, "}")
				for _, entry := range ipEntries {
					entry = strings.TrimSpace(entry)
					if strings.HasPrefix(entry, "{") {
						parts := strings.Fields(entry[1:])
						if len(parts) > 0 {
							ip := parts[0]
							currentApp.IPs = append(currentApp.IPs, ip)
							fmt.Printf("DEBUG: Found IP for %s: %s\n", currentApp.UUID, ip)
						}
					}
				}
			}
		}

		// Parse domain state
		if currentApp != nil && strings.Contains(line, "state:") {
			parts := strings.Split(line, ",")
			if len(parts) > 0 {
				statePart := strings.TrimSpace(parts[0])
				stateFields := strings.Fields(statePart)
				if len(stateFields) >= 2 {
					stateNum := stateFields[1]
					// Map state numbers to readable names
					switch stateNum {
					case "115":
						currentApp.State = "Running"
					case "1":
						currentApp.State = "Halted"
					default:
						currentApp.State = "State " + stateNum
					}
					fmt.Printf("DEBUG: Found state for %s: %s (%s)\n", currentApp.UUID, currentApp.State, stateNum)
				}
			}
		}

		// Parse VNC info
		if currentApp != nil && strings.Contains(line, "VNC enabled:") {
			if strings.Contains(line, "VNC enabled: true") {
				// Extract VNC display
				if strings.Contains(line, "VNC display id:") {
					parts := strings.Split(line, "VNC display id:")
					if len(parts) >= 2 {
						displayStr := strings.TrimSpace(strings.Split(parts[1], ",")[0])
						var displayNum int
						if _, err := fmt.Sscanf(displayStr, "%d", &displayNum); err == nil {
							currentApp.VNCPort = 5900 + displayNum
							fmt.Printf("DEBUG: Found VNC for %s: %d\n", currentApp.UUID, currentApp.VNCPort)
						}
					}
				}
			}
		}

		// Parse applog disabled (can appear on separate line)
		if currentApp != nil && strings.Contains(line, "Applog disabled:") {
			currentApp.AppLogDisabled = strings.Contains(line, "Applog disabled: true")
		}

		// When we hit the next app or end, save current app
		// Check for "== app:" or just empty lines as separators
		if currentApp != nil && currentApp.UUID != "" && (strings.Contains(line, "== app:") || (line == "" && i > 0)) {
			if len(currentApp.IPs) > 0 || currentApp.State != "" {
				result[currentApp.UUID] = *currentApp
				fmt.Printf("DEBUG: Saved app %s\n", currentApp.UUID)
			}
			// Don't nil currentApp on empty line immediately, wait for next app start or end
			if strings.Contains(line, "== app:") {
				currentApp = nil
			}
		}
	}

	// Save last app if exists
	if currentApp != nil && currentApp.UUID != "" {
		if len(currentApp.IPs) > 0 || currentApp.State != "" {
			result[currentApp.UUID] = *currentApp
			fmt.Printf("DEBUG: Saved last app %s\n", currentApp.UUID)
		}
	}

	return result
}

// SetupSSH generates a key if needed and pushes it to the device
func (a *App) SetupSSH(nodeID string) error {
	fmt.Printf("DEBUG: SetupSSH called for node %s\n", nodeID)

	// 1. Ensure Local Key
	_, pubKey, err := ssh.EnsureSSHKey()
	if err != nil {
		fmt.Printf("DEBUG: EnsureSSHKey failed: %v\n", err)
		return fmt.Errorf("failed to ensure local ssh key: %w", err)
	}

	// 2. Push to Device
	fmt.Printf("DEBUG: Pushing SSH key to device...\n")
	if err := a.zededaClient.AddSSHKeyToDevice(nodeID, pubKey); err != nil {
		fmt.Printf("DEBUG: AddSSHKeyToDevice failed: %v\n", err)
		return fmt.Errorf("failed to add ssh key to device: %w", err)
	}

	fmt.Printf("DEBUG: SetupSSH completed successfully\n")
	return nil
}

// EnableExternalPolicy enables/disables external policy on a device
func (a *App) EnableExternalPolicy(nodeID string, enable bool) error {
	return a.zededaClient.UpdateEdgeViewExternalPolicy(nodeID, enable)
}

// SetVGAEnabled enables or disables VGA access on a device
func (a *App) SetVGAEnabled(nodeID string, enabled bool) error {
	return a.zededaClient.SetVGAEnabled(nodeID, enabled)
}

// SetUSBEnabled enables or disables USB access on a device
func (a *App) SetUSBEnabled(nodeID string, enabled bool) error {
	return a.zededaClient.SetUSBEnabled(nodeID, enabled)
}

// SetConsoleEnabled enables or disables Console access on the device
func (a *App) SetConsoleEnabled(nodeID string, enabled bool) error {
	return a.zededaClient.SetConsoleEnabled(nodeID, enabled)
}

type SSHStatus struct {
	Status         string `json:"status"`
	PublicKey      string `json:"publicKey"`
	MaxSessions    int    `json:"maxSessions"`
	Expiry         string `json:"expiry"`
	DebugKnob      bool   `json:"debugKnob"`
	VGAEnabled     bool   `json:"vgaEnabled"`
	USBEnabled     bool   `json:"usbEnabled"`
	ConsoleEnabled bool     `json:"consoleEnabled"`
	IsEncrypted    bool     `json:"isEncrypted"`
	ExternalPolicy bool     `json:"externalPolicy"`
	ManagementIPs  []string `json:"managementIPs"`
	// AuthorizedKeys is the parsed list of keys currently in
	// debug.enable.ssh on the device. Used by the audit panel in the UI;
	// the entry with IsLauncherKey=true is the one this launcher manages.
	AuthorizedKeys []AuthorizedKeyInfo `json:"authorizedKeys"`
}

// AuthorizedKeyInfo is the audit-friendly view of one SSH key listed on
// the device. We expose type / fingerprint / comment rather than the full
// blob to keep the UI compact while still allowing an operator to verify
// the key with `ssh-keygen -lf authorized_keys`.
type AuthorizedKeyInfo struct {
	Type           string `json:"type"`
	Fingerprint    string `json:"fingerprint"`
	Comment        string `json:"comment"`
	IsLauncherKey  bool   `json:"isLauncherKey"`
	Valid          bool   `json:"valid"`
}

// GetSSHStatus returns the current SSH status of the node
func (a *App) GetSSHStatus(nodeID string) *SSHStatus {
	// Get detailed status from ZEDEDA
	evStatus, err := a.zededaClient.GetEdgeViewStatus(nodeID)
	if err != nil {
		fmt.Printf("Error getting EdgeView status: %v\n", err)
		return &SSHStatus{Status: "unknown"}
	}

	// Parse the device's authorized-keys value into a list. The string
	// stored in debug.enable.ssh is written verbatim to the device's
	// /run/authorized_keys, so it can carry many keys — only some of
	// which are ours.
	parsedKeys := zededa.ParseAuthorizedKeys(evStatus.SSHKey)

	var localPubKey string
	if _, lk, err := ssh.EnsureSSHKey(); err == nil {
		localPubKey = lk
	} else {
		fmt.Printf("Warning: Failed to load local SSH key: %v\n", err)
	}
	launcherID := ""
	if localPubKey != "" {
		if lk := zededa.ParseAuthorizedKeys(localPubKey); len(lk) > 0 && lk[0].Valid {
			launcherID = lk[0].Identity()
		}
	}

	// status is:
	//   "disabled"  -> field is empty/whitespace
	//   "enabled"   -> our key is one of the lines
	//   "mismatch"  -> device has keys, but ours is not among them
	status := "disabled"
	if len(parsedKeys) > 0 {
		if launcherID != "" && containsIdentity(parsedKeys, launcherID) {
			status = "enabled"
		} else {
			status = "mismatch"
		}
	}

	// Audit-friendly list for the UI.
	authorizedKeys := make([]AuthorizedKeyInfo, 0, len(parsedKeys))
	for _, k := range parsedKeys {
		info := AuthorizedKeyInfo{
			Type:        k.Type,
			Fingerprint: k.Fingerprint,
			Comment:     k.Comment,
			Valid:       k.Valid,
		}
		if launcherID != "" && k.Valid && k.Identity() == launcherID {
			info.IsLauncherKey = true
		}
		authorizedKeys = append(authorizedKeys, info)
	}

	sshStatus := &SSHStatus{
		Status:         status,
		PublicKey:      evStatus.SSHKey,
		MaxSessions:    evStatus.MaxSessions,
		Expiry:         evStatus.Expiry,
		DebugKnob:      evStatus.DebugKnob,
		VGAEnabled:     evStatus.VGAEnabled,
		USBEnabled:     evStatus.USBEnabled,
		ConsoleEnabled: evStatus.ConsoleEnabled,
		IsEncrypted:    evStatus.IsEncrypted,
		ExternalPolicy: evStatus.ExternalPolicy,
		AuthorizedKeys: authorizedKeys,
	}

	// Fetch management IPs for display
	// We do this in parallel or just sequentially since it's a status check
	deviceStatus, err := a.zededaClient.GetDeviceStatus(nodeID)
	if err == nil && deviceStatus != nil {
		var ips []string
		for _, ns := range deviceStatus.NetStatusList {
			if ns.Up {
				for _, ip := range ns.IPs {
					if ip != "" && ip != "127.0.0.1" {
						ips = append(ips, ip)
					}
				}
			}
		}
		sshStatus.ManagementIPs = uniqueStrings(ips)
	}

	// Override expiry with cached session if available and valid
	if cached, ok := a.sessionManager.GetCachedSession(nodeID); ok {
		if time.Now().Before(cached.ExpiresAt) {
			sshStatus.Expiry = fmt.Sprintf("%d", cached.ExpiresAt.Unix())
		}
	}

	return sshStatus
}

// containsIdentity reports whether any parsed authorized-key has the
// given type+blob identity.
func containsIdentity(keys []zededa.AuthorizedKey, id string) bool {
	for _, k := range keys {
		if k.Valid && k.Identity() == id {
			return true
		}
	}
	return false
}

// DisableSSH removes the launcher's own SSH key from the device. Other
// keys (operator-added) are preserved; if no keys remain, the underlying
// configItem is dropped which fully disables SSH on EVE-OS.
func (a *App) DisableSSH(nodeID string) error {
	_, localPubKey, err := ssh.EnsureSSHKey()
	if err != nil {
		return fmt.Errorf("failed to load local SSH key: %w", err)
	}
	if err := a.zededaClient.DisableSSH(nodeID, localPubKey); err != nil {
		return fmt.Errorf("failed to disable ssh: %w", err)
	}
	return nil
}

// ResetEdgeView recycles the EdgeView session to clear stuck connections
func (a *App) ResetEdgeView(nodeID string) error {
	// Attempt to stop EdgeView - ignore errors as it may already be inactive
	if err := a.zededaClient.StopEdgeView(nodeID); err != nil {
		fmt.Printf("Warning: Could not stop EdgeView (may already be inactive): %v\n", err)
		// Not returning error - continue to attempt start
	} else {
		// If stop succeeded, wait briefly for propagation
		time.Sleep(2 * time.Second)
	}

	// Always attempt to start EdgeView (idempotent operation)
	if err := a.zededaClient.StartEdgeView(nodeID); err != nil {
		return fmt.Errorf("failed to start EdgeView: %w", err)
	}

	// Drop the locally cached session so the next connect re-mints from the
	// freshly recycled cloud session. Without this, reset only recycles the
	// cloud-side dispatcher while the stale local cache keeps reporting the
	// dead session as active, leaving the UI stuck and unable to recover.
	a.sessionManager.InvalidateSession(nodeID)

	return nil
}

func (a *App) GetDeviceServices(nodeID, deviceName string) (string, error) {
	// Use Cloud API to fetch app instances (deviceName enables server-side filter)
	apps, err := a.zededaClient.GetDeviceAppInstances(nodeID, deviceName)
	if err != nil {
		return "", fmt.Errorf("failed to get app instances: %w", err)
	}

	// Transform and enrich with Cloud API (immediate, reliable)
	//
	// ParentAppID is the app instance ID of the docker runtime hosting a
	// APP_TYPE_DOCKER_COMPOSE instance, and is empty for every other app as well
	// as for compose apps whose runtime could not be identified unambiguously.
	type Service struct {
		Name           string                 `json:"name"`
		Status         string                 `json:"status"`
		ID             string                 `json:"id"`
		IPs            []string               `json:"ips,omitempty"`
		VNCPort        int                    `json:"vncPort,omitempty"`
		EdgeViewState  string                 `json:"edgeViewState,omitempty"`
		Containers     []zededa.ContainerInfo `json:"containers,omitempty"`
		AppType        string                 `json:"appType,omitempty"`
		DeploymentType string                 `json:"deploymentType,omitempty"`
		ParentAppID    string                 `json:"parentAppId,omitempty"`
		DockerCompose  string                 `json:"dockerCompose,omitempty"`
		AppVersion     string                 `json:"appVersion,omitempty"`
		InternalIPs    []string               `json:"internalIps,omitempty"`
		Error          string                 `json:"error,omitempty"`
	}

	type ServicesResponse struct {
		Services []Service `json:"services"`
		Error    string    `json:"error,omitempty"`
	}

	// 1. Fetch details for all apps
	appDetails := make(map[string]*zededa.AppInstanceStatus)
	appConfigs := make(map[string]*zededa.AppInstanceConfig)

	for _, app := range apps {
		fmt.Printf("DEBUG: Fetching Cloud API status for app %s (ID: %s)...\n", app.Name, app.ID)
		status, err := a.zededaClient.GetAppInstanceDetails(app.ID)
		if err != nil {
			fmt.Printf("DEBUG: Failed to get status for app %s: %v\n", app.Name, err)
			continue
		}
		appDetails[app.ID] = (*zededa.AppInstanceStatus)(status)

		// fmt.Printf("DEBUG: Fetching Cloud API config for app %s...\n", app.Name)
		config, err := a.zededaClient.GetAppInstanceConfig(app.ID)
		if err != nil {
			// fmt.Printf("DEBUG: Failed to get config for app %s: %v\n", app.Name, err)
		} else {
			appConfigs[app.ID] = config
		}

	}

	// 2. Build services list.
	//
	// Each service is first populated with only the IPs it reports for itself.
	// Compose apps report no IP of their own, so they inherit their runtime's IP
	// further down — but only after that runtime has been identified, and only for
	// compose apps. Handing every IP-less app the IPs of some arbitrary runtime
	// fabricates an IP overlap that the parent/child grouping then reads as
	// evidence of nesting.
	var services []Service
	composeInfos := make([]composeAppInfo, 0, len(apps))
	for _, app := range apps {
		svc := Service{
			Name:   app.Name,
			Status: app.RunState,
			ID:     app.ID,
		}

		// App version will be populated from config.UserDefinedVersion below

		status, hasStatus := appDetails[app.ID]
		config, hasConfig := appConfigs[app.ID]

		if hasStatus {
			var ips []string

			// a) Check NetStatusList (Newer API)
			for _, ns := range status.NetStatusList {
				for _, ip := range ns.IPs {
					if ip != "" && ip != "<nil>" {
						ips = append(ips, ip)
					}
				}
			}

			// b) Check Interfaces from Config (Older API/interfaces)
			if hasConfig {
				for _, adapter := range config.Interfaces {
					if v, ok := adapter["ipaddr"].(string); ok && v != "" {
						ips = append(ips, v)
					} else if v, ok := adapter["ipAddr"].(string); ok && v != "" {
						ips = append(ips, v)
					}
				}
			}

			// c) Check Container Runtime IPs
			for _, container := range status.Containers {
				for _, pm := range container.PortMaps {
					if pm.RuntimeIP != "" && pm.RuntimeIP != "0.0.0.0" {
						ips = append(ips, pm.RuntimeIP)
					}
				}
			}

			svc.IPs = uniqueStrings(ips)
			svc.Containers = status.Containers
			svc.AppType = status.AppType
			svc.DeploymentType = status.DeploymentType

			// Network instances this app is attached to. A compose app and the
			// runtime hosting it sit on the same network instance, which is a far
			// stronger parent signal than an IP (see resolveComposeParents).
			var netInstIDs []string
			if hasConfig {
				for _, iface := range config.Interfaces {
					if id, ok := iface["netinstid"].(string); ok && id != "" {
						netInstIDs = append(netInstIDs, id)
					}
				}
			}
			composeInfos = append(composeInfos, composeAppInfo{
				ID:             app.ID,
				AppType:        svc.AppType,
				DeploymentType: svc.DeploymentType,
				OwnIPs:         svc.IPs,
				NetInstIDs:     uniqueStrings(netInstIDs),
			})

			if hasConfig {
				svc.DockerCompose = config.DockerCompose
				if config.UserDefinedVersion != "" {
					svc.AppVersion = config.UserDefinedVersion
				}
			}
			fmt.Printf("DEBUG-VER: App %s appType=%s deploymentType=%s appVersion=%q\n", app.Name, svc.AppType, status.DeploymentType, svc.AppVersion)

			// Identify internal (airgapped) IPs by correlating:
			//   config.Interfaces[i].netinstid → GetNetworkInstanceDetails → kind
			//   config.Interfaces[i].intfname  → status.NetStatusList[j].ifName → ipAddrs
			var internalIPs []string
			if hasConfig {
				for _, iface := range config.Interfaces {
					netInstID, _ := iface["netinstid"].(string)
					if netInstID == "" {
						continue
					}
					ni, err := a.zededaClient.GetNetworkInstanceDetails(netInstID)
					if err != nil {
						fmt.Printf("DEBUG-NET: App %s, failed to get NetInst %s: %v\n", app.Name, netInstID, err)
						continue
					}
					fmt.Printf("DEBUG-NET: App %s, NetInst %s, Kind=%s, Name=%s\n", app.Name, netInstID, ni.Kind, ni.Name)

					if ni.Kind != "NETWORK_INSTANCE_KIND_LOCAL" {
						continue
					}

					// Find matching status entry by interface name
					intfName, _ := iface["intfname"].(string)
					for _, ns := range status.NetStatusList {
						if ns.IfName == intfName && intfName != "" {
							fmt.Printf("DEBUG-NET: App %s, LOCAL network %s matched ifName=%s, IPs=%v\n", app.Name, ni.Name, intfName, ns.IPs)
							internalIPs = append(internalIPs, ns.IPs...)
							break
						}
					}

					// Fallback: if interface name didn't match, try by index
					if len(internalIPs) == 0 {
						for i, cfgIf := range config.Interfaces {
							cfgNetInstID, _ := cfgIf["netinstid"].(string)
							if cfgNetInstID == netInstID && i < len(status.NetStatusList) {
								fmt.Printf("DEBUG-NET: App %s, LOCAL network %s matched by index=%d, IPs=%v\n", app.Name, ni.Name, i, status.NetStatusList[i].IPs)
								internalIPs = append(internalIPs, status.NetStatusList[i].IPs...)
								break
							}
						}
					}
				}
			}
			svc.InternalIPs = uniqueStrings(internalIPs)
			fmt.Printf("DEBUG-NET: App %s final IPs=%v, InternalIPs=%v\n", app.Name, svc.IPs, svc.InternalIPs)

			// Extract VNC info (from Config)
			if hasConfig && config.VMInfo.VNC {
				svc.VNCPort = 5900 + config.VMInfo.VNCDisplay
			} else {
			// Fallback: Check containers
				for _, c := range status.Containers {
					for _, pm := range c.PortMaps {
						if (pm.PublicPort >= 5900 && pm.PublicPort <= 5999) || (pm.PrivatePort >= 5900 && pm.PrivatePort <= 5999) {
							if pm.PublicPort >= 5900 && pm.PublicPort <= 5999 {
								svc.VNCPort = pm.PublicPort
							} else {
								svc.VNCPort = pm.PrivatePort
							}
							fmt.Printf("DEBUG: Found inferred VNC port %d for app %s\n", svc.VNCPort, app.Name)
							break
						}
					}
					if svc.VNCPort > 0 {
						break
					}
				}
			}

			// Extract Error Info
			if len(status.ErrInfo) > 0 {
				var errs []string
				for _, e := range status.ErrInfo {
					if e.Description != "" {
						errs = append(errs, e.Description)
					}
				}
				if len(errs) > 0 {
					svc.Error = strings.Join(errs, "; ")
				}
			}
		}

		// Initial Cache check
		a.enrichmentMu.RLock()
		if cached, ok := a.enrichmentCache[app.ID]; ok {
			if cached.VNCPort > 0 {
				svc.VNCPort = cached.VNCPort
			}
			if len(svc.IPs) == 0 {
				svc.IPs = cached.IPs
			}
			svc.EdgeViewState = cached.State
		}
		a.enrichmentMu.RUnlock()

		services = append(services, svc)
	}

	// 2b. Attribute each compose app to the docker runtime hosting it, then let it
	// inherit that runtime's IPs — a compose app is reached at its runtime's
	// address. Inheritance stays scoped to compose apps that reported no IP of
	// their own, so an unrelated VM never displays a runtime's IP.
	composeParents := resolveComposeParents(composeInfos)
	ipsByAppID := make(map[string][]string, len(services))
	for _, svc := range services {
		ipsByAppID[svc.ID] = svc.IPs
	}
	for i := range services {
		parentID, ok := composeParents[services[i].ID]
		if !ok {
			continue
		}
		services[i].ParentAppID = parentID
		if len(services[i].IPs) == 0 {
			services[i].IPs = ipsByAppID[parentID]
		}
	}

	/*
		// 3. Start/Subscribe to Background Enrichment
		a.enrichingMu_.Lock()
		jobChan, inProgress := a.enrichingJobs[nodeID]
		if !inProgress {
			jobChan = make(chan struct{})
			a.enrichingJobs[nodeID] = jobChan
			a.enrichingMu_.Unlock()
			go func(nodeID string, ch chan struct{}) {
				defer func() {
					a.enrichingMu_.Lock()
					delete(a.enrichingJobs, nodeID)
					a.enrichingMu_.Unlock()
					close(ch)
				}()

				// Background Enrichment Logic (Init session, Execute 'app' command, Update Cache)
				session, ok := a.sessionManager.GetCachedSession(nodeID)
				if !ok || time.Now().After(session.ExpiresAt) {
					script, err := a.zededaClient.InitSession(nodeID)
					if err == nil {
						sc, err := a.zededaClient.ParseEdgeViewScript(script)
						if err == nil {
							a.sessionManager.StoreCachedSession(nodeID, sc, 0, "", time.Now().Add(5*time.Hour))
							time.Sleep(3 * time.Second)
						}
					}
				}

				maxRetries := 5
				for i := 0; i < maxRetries; i++ {
					output, err := a.GetAppInfo(nodeID)
					if err == nil && !strings.Contains(output, "can't have more than 2 peers") {
						enrichments := ParseAppInfo(output)
						if len(enrichments) > 0 {
							a.enrichmentMu.Lock()
							for id, e := range enrichments {
								a.enrichmentCache[id] = e
							}
							a.enrichmentMu.Unlock()
							break
						}
					}
					time.Sleep(2 * time.Second)
				}
			}(nodeID, jobChan)
		} else {
			a.enrichingMu_.Unlock()
		}

		// Wait up to 3s for data
		waitTime := 1000 * time.Millisecond
		if _, warm := a.sessionManager.GetCachedSession(nodeID); warm {
			waitTime = 3000 * time.Millisecond
		}
		select {
		case <-jobChan:
		case <-time.After(waitTime):
		}
	*/

	// Final Enrichment Merge
	a.enrichmentMu.RLock()
	for i := range services {
		if cached, ok := a.enrichmentCache[services[i].ID]; ok {
			if cached.VNCPort > 0 {
				services[i].VNCPort = cached.VNCPort
			}
			if len(services[i].IPs) == 0 {
				services[i].IPs = cached.IPs
			}
			services[i].EdgeViewState = cached.State
		}
	}
	a.enrichmentMu.RUnlock()

	jsonBytes, _ := json.Marshal(ServicesResponse{Services: services})
	// for _, s := range services {
	// 	fmt.Printf("DEBUG: Final Service Result: %s (ID: %s), VNC: %d, IPs: %v\n", s.Name, s.ID, s.VNCPort, s.IPs)
	// }
	return string(jsonBytes), nil
}

// VerifyEdgeViewTunnel checks if the EdgeView tunnel is active by sending a simple query
func (a *App) VerifyEdgeViewTunnel(nodeID string) error {
	// DISABLED: Tunnel verification is unreliable and causes timeouts
	// The SSH status check is sufficient to verify EdgeView is enabled
	// Users can still connect via SSH successfully even if this check would fail
	return nil
}

// StartCollectInfo starts a collect info job
func (a *App) StartCollectInfo(nodeID string) (string, error) {
	fmt.Printf("DEBUG: App.StartCollectInfo calling session manager for %s\n", nodeID)
	// Check if we have a cached session
	_, ok := a.sessionManager.GetCachedSession(nodeID)
	if !ok {
		// fmt.Println("DEBUG: No cached session found for CollectInfo, checking Cloud API status...")

		// Check Cloud API status to revive session
		evStatus, err := a.zededaClient.GetEdgeViewStatus(nodeID)
		if err == nil && evStatus != nil && evStatus.Token != "" && evStatus.DispURL != "" {
			// fmt.Println("Found active EdgeView session from API, reusing token...")

			sc, parseErr := a.zededaClient.ParseEdgeViewToken(evStatus.Token)
			if parseErr == nil {
				// Ensure URL is correct
				if !strings.HasPrefix(sc.URL, "wss://") && !strings.HasPrefix(sc.URL, "ws://") {
					if sc.URL == "" {
						sc.URL = evStatus.DispURL
						if !strings.HasPrefix(sc.URL, "http") && !strings.HasPrefix(sc.URL, "ws") {
							sc.URL = "wss://" + sc.URL
						}
					}
				}

				// Revive session in cache
				expiresAt := time.Now().Add(4*time.Hour + 50*time.Minute)
				a.sessionManager.StoreCachedSession(nodeID, sc, 0, "", expiresAt)
				fmt.Printf("Revived active session for CollectInfo. URL: %s\n", sc.URL)
			} else {
				return "", fmt.Errorf("failed to parse active token: %w", parseErr)
			}
		} else {
			return "", fmt.Errorf("no active EdgeView session found")
		}
	}

	return a.sessionManager.StartCollectInfo(nodeID)
}

// GetCollectInfoJob returns the job status
func (a *App) GetCollectInfoJob(jobID string) *session.CollectInfoJob {
	return a.sessionManager.GetCollectInfoJob(jobID)
}

// StartComposeDiagnostics starts a diagnostics collection from a compose runtime VM.
func (a *App) StartComposeDiagnostics(nodeID, appName, appIP, username, password string) (string, error) {
	fmt.Printf("DEBUG: App.StartComposeDiagnostics for node %s, app %s, ip %s\n", nodeID, appName, appIP)

	// Ensure we have a cached session (revive from Cloud API if needed)
	_, ok := a.sessionManager.GetCachedSession(nodeID)
	if !ok {
		evStatus, err := a.zededaClient.GetEdgeViewStatus(nodeID)
		if err == nil && evStatus != nil && evStatus.Token != "" && evStatus.DispURL != "" {
			sc, parseErr := a.zededaClient.ParseEdgeViewToken(evStatus.Token)
			if parseErr == nil {
				if !strings.HasPrefix(sc.URL, "wss://") && !strings.HasPrefix(sc.URL, "ws://") {
					if sc.URL == "" {
						sc.URL = evStatus.DispURL
						if !strings.HasPrefix(sc.URL, "http") && !strings.HasPrefix(sc.URL, "ws") {
							sc.URL = "wss://" + sc.URL
						}
					}
				}
				expiresAt := time.Now().Add(4*time.Hour + 50*time.Minute)
				a.sessionManager.StoreCachedSession(nodeID, sc, 0, "", expiresAt)
			} else {
				return "", fmt.Errorf("failed to parse active token: %w", parseErr)
			}
		} else {
			return "", fmt.Errorf("no active EdgeView session found")
		}
	}

	return a.sessionManager.StartComposeDiagnostics(nodeID, appName, appIP, username, password)
}

// GetComposeDiagnosticsJob returns the compose diagnostics job status
func (a *App) GetComposeDiagnosticsJob(jobID string) *session.ComposeDiagnosticsJob {
	return a.sessionManager.GetComposeDiagnosticsJob(jobID)
}

// VerifyToken checks if the provided token is valid
func (a *App) VerifyToken(token, baseURL string) (*zededa.TokenInfo, error) {
	token = strings.TrimSpace(token)
	if baseURL != "" {
		tempClient := zededa.NewClient(strings.TrimSpace(baseURL), token)
		return tempClient.VerifyToken(token)
	}
	return a.zededaClient.VerifyToken(token)
}

// sortIPv4First returns a stable reordering of ips with IPv4 addresses first
// and IPv6 addresses last. Within each family the original order is preserved
// (so loopback stays first and the device-status interface order is honored).
// IPv4-mapped IPv6 ("::ffff:192.0.2.1") classifies as IPv4 because that form
// is IPv4 traffic on the wire. Strings that don't parse as IPs bucket with
// IPv6 (last-resort) so unexpected input never blocks IPv4 probes.
func sortIPv4First(ips []string) []string {
	out := append([]string(nil), ips...)
	sort.SliceStable(out, func(i, j int) bool {
		return isIPv4(out[i]) && !isIPv4(out[j])
	})
	return out
}

func isIPv4(s string) bool {
	ip := net.ParseIP(s)
	return ip != nil && ip.To4() != nil
}

// isLinkLocalIPv6 reports whether s is an IPv6 link-local address (fe80::/10).
// These addresses require a scope identifier (e.g. fe80::1%eth0) to be dialed
// and never work as raw candidates when the EdgeView dispatcher tries to
// reach them through the cloud relay — they just sit silent and burn the
// per-probe timeout. False for IPv4 (including 169.254.0.0/16, which we
// don't filter here) and for unparseable strings.
func isLinkLocalIPv6(s string) bool {
	ip := net.ParseIP(s)
	if ip == nil || ip.To4() != nil {
		return false
	}
	return ip.IsLinkLocalUnicast()
}

// dropLinkLocalIPv6 returns ips with every IPv6 link-local address removed.
// Logs the dropped entries so the diagnostic trail makes the filter visible
// when a user wonders why their fe80:: address wasn't probed.
func dropLinkLocalIPv6(ips []string) []string {
	var dropped []string
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		if isLinkLocalIPv6(ip) {
			dropped = append(dropped, ip)
			continue
		}
		out = append(out, ip)
	}
	if len(dropped) > 0 {
		fmt.Printf("DEBUG: Dropped IPv6 link-local candidates (unreachable through EdgeView relay): %v\n", dropped)
	}
	return out
}

const (
	appTypeDockerCompose        = "APP_TYPE_DOCKER_COMPOSE"
	deploymentTypeDockerRuntime = "DEPLOYMENT_TYPE_DOCKER_RUNTIME"
)

// composeAppInfo carries the per-app-instance facts needed to decide which
// docker runtime an APP_TYPE_DOCKER_COMPOSE instance is nested under.
type composeAppInfo struct {
	ID             string
	AppType        string
	DeploymentType string
	// OwnIPs are the IPs the instance reported for itself. Only self-reported
	// IPs can prove parentage — an IP inherited from another instance says
	// nothing about who hosts this one.
	OwnIPs []string
	// NetInstIDs are the network instances the instance is attached to.
	NetInstIDs []string
}

// resolveComposeParents maps each APP_TYPE_DOCKER_COMPOSE instance ID to the ID
// of the docker runtime instance hosting it.
//
// The ZEDEDA app-instance API exposes no explicit child→runtime reference, so
// parentage is correlated from the strongest evidence available, in order:
//
//  1. the compose app shares a network instance with exactly one runtime
//  2. the compose app shares a self-reported IP with exactly one runtime
//  3. the device has exactly one docker runtime, so there is no ambiguity
//
// Only instances that actually declare DEPLOYMENT_TYPE_DOCKER_RUNTIME are
// candidates: a K3s or standalone VM cannot host a compose app, and treating one
// as a candidate is what previously nested compose apps under an unrelated VM.
//
// A signal matching two or more runtimes is ambiguous and is skipped rather than
// resolved to whichever happened to be listed first. When nothing resolves, the
// app is left unparented on purpose — rendering a compose app at the top level is
// better than nesting it under the wrong runtime.
func resolveComposeParents(apps []composeAppInfo) map[string]string {
	runtimes := make([]composeAppInfo, 0, len(apps))
	for _, app := range apps {
		if app.ID != "" && app.AppType != appTypeDockerCompose && app.DeploymentType == deploymentTypeDockerRuntime {
			runtimes = append(runtimes, app)
		}
	}

	parents := make(map[string]string)
	if len(runtimes) == 0 {
		return parents
	}

	for _, app := range apps {
		if app.ID == "" || app.AppType != appTypeDockerCompose {
			continue
		}

		if id, ok := soleRuntimeMatching(runtimes, func(rt composeAppInfo) bool {
			return stringsOverlap(rt.NetInstIDs, app.NetInstIDs)
		}); ok {
			parents[app.ID] = id
			continue
		}

		if id, ok := soleRuntimeMatching(runtimes, func(rt composeAppInfo) bool {
			return stringsOverlap(rt.OwnIPs, app.OwnIPs)
		}); ok {
			parents[app.ID] = id
			continue
		}

		if len(runtimes) == 1 {
			parents[app.ID] = runtimes[0].ID
		}
	}
	return parents
}

// soleRuntimeMatching returns the one runtime satisfying match. Zero or multiple
// matches yield no answer, so the caller can fall through to a weaker signal.
func soleRuntimeMatching(runtimes []composeAppInfo, match func(composeAppInfo) bool) (string, bool) {
	found := ""
	for _, rt := range runtimes {
		if !match(rt) {
			continue
		}
		if found != "" {
			return "", false
		}
		found = rt.ID
	}
	return found, found != ""
}

// stringsOverlap reports whether a and b share at least one non-empty value.
func stringsOverlap(a, b []string) bool {
	if len(a) == 0 || len(b) == 0 {
		return false
	}
	seen := make(map[string]struct{}, len(a))
	for _, v := range a {
		if v != "" {
			seen[v] = struct{}{}
		}
	}
	for _, v := range b {
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			return true
		}
	}
	return false
}

// uniqueStrings returns a slice with duplicates removed
func uniqueStrings(input []string) []string {
	keys := make(map[string]bool)
	list := []string{}
	for _, entry := range input {
		if entry == "" || entry == "<nil>" {
			continue
		}
		if _, value := keys[entry]; !value {
			keys[entry] = true
			list = append(list, entry)
		}
	}
	return list
}
