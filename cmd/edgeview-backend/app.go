package main

import (
	"context"
	"edgeViewLauncher/internal/config"
	"edgeViewLauncher/internal/session"
	"edgeViewLauncher/internal/ssh"
	"edgeViewLauncher/internal/zededa"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

// zededaAPI defines the subset of zededa.Client used by App.
type zededaAPI interface {
	GetEnterprise() (*zededa.Enterprise, error)
	GetProjects() ([]zededa.Project, error)
	SearchNodes(query string) ([]zededa.Node, error)
	UpdateConfig(baseURL, token string)
	InitSession(targetID string) (string, error)
	ParseEdgeViewScript(script string) (*zededa.SessionConfig, error)
	ParseEdgeViewToken(token string) (*zededa.SessionConfig, error)
	AddSSHKeyToDevice(nodeID, pubKey string) error
	GetEdgeViewStatus(nodeID string) (*zededa.EdgeViewStatus, error)
	DisableSSH(nodeID string) error
	StopEdgeView(nodeID string) error
	StartEdgeView(nodeID string) error
	SetVGAEnabled(nodeID string, enabled bool) error
	SetUSBEnabled(nodeID string, enabled bool) error
	SetConsoleEnabled(nodeID string, enabled bool) error
	GetDeviceAppInstances(deviceID string) ([]zededa.AppInstance, error)
	GetAppInstanceDetails(appInstanceID string) (*zededa.AppInstanceDetails, error)
	GetDevice(nodeID string) (map[string]interface{}, error)
	VerifyToken(token string) (*zededa.TokenInfo, error)
}

// sessionAPI defines the subset of session.Manager used by App.
type sessionAPI interface {
	GetCachedSession(nodeID string) (*session.CachedSession, bool)
	StoreCachedSession(nodeID string, config *zededa.SessionConfig, port int, expiresAt time.Time)
	// StartProxy starts a persistent EdgeView proxy for the given device nodeID and target.
	StartProxy(ctx context.Context, config *zededa.SessionConfig, nodeID string, target string, protocol string) (int, string, error)
	LaunchTerminal(port int, keyPath string) error
	ExecuteCommand(nodeID string, command string) (string, error)
	CloseTunnel(tunnelID string) error
	ListTunnels(nodeID string) []*session.Tunnel
	GetAllTunnels() []*session.Tunnel
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

	// Cache for app enrichments (IPs, VNC ports)
	enrichmentCache map[string]AppEnrichment // Key: App UUID
	enrichmentMu    sync.RWMutex

	// Cache for node metadata (device name, project ID) used to enrich
	// tunnel listings without repeatedly calling the Cloud API.
	nodeMetaCache map[string]NodeMeta // Key: device/node UUID
	nodeMetaMu    sync.RWMutex

	// Cache for token info (user email, expiry)
	tokenInfoCache *zededa.TokenInfo
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

	return &App{
		config:             cfg,
		zededaClient:       zededa.NewClient(baseURL, apiToken),
		sessionManager:     session.NewManager(),
		enrichmentCache:    make(map[string]AppEnrichment),
		nodeMetaCache:      make(map[string]NodeMeta),
		connectionProgress: make(map[string]string),
	}
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
		// Update client with new active cluster settings
		a.zededaClient.UpdateConfig(activeConfig.BaseURL, activeConfig.APIToken)
	}

	return config.Save(a.config)
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
func (a *App) SearchNodes(query string) ([]zededa.Node, error) {
	return a.zededaClient.SearchNodes(query)
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

// ConnectToNode initiates a session to the node
func (a *App) ConnectToNode(nodeID string, useInAppTerminal bool) (string, error) {
	fmt.Printf("ConnectToNode called for %s (In-App: %v)\n", nodeID, useInAppTerminal)
	a.SetConnectionProgress(nodeID, "Initializing connection...")

	var sessionConfig *zededa.SessionConfig
	var port int
	var needNewProxy bool

	// Check if we have a cached session
	a.SetConnectionProgress(nodeID, "Checking for cached session...")
	if cached, ok := a.sessionManager.GetCachedSession(nodeID); ok {
		// For native terminal, try to reuse the cached proxy port
		if !useInAppTerminal && cached.Port > 0 {
			fmt.Printf("Reusing cached proxy on port %d\n", cached.Port)
			port = cached.Port
			needNewProxy = false
			// No need to update cache when reusing everything
		} else {
			// For in-app terminal, always create new proxy (old one died with window)
			fmt.Println("Using cached session config, creating new proxy")
			sessionConfig = cached.Config
			needNewProxy = true
		}
	} else {
		// No cached session - check if API says one is already active
		// This avoids re-enabling EdgeView if the user just closed the window but session is still valid
		fmt.Println("No local cached session, checking Cloud API status...")
		
		// We need to get the actual EdgeView Status which contains the JWT and URL.
		evStatus, err := a.zededaClient.GetEdgeViewStatus(nodeID)
		if err == nil && evStatus != nil && evStatus.Token != "" && evStatus.DispURL != "" {
			fmt.Println("Found active EdgeView session from API, reusing token...")
			
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
				fmt.Printf("Reused active session. URL: %s\n", sessionConfig.URL)
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
				return "", fmt.Errorf("failed to init session: %w", err)
			}
			fmt.Println("EdgeView enabled, script received.")

			// Parse the script to get Session Config
			fmt.Println("Parsing script...")
			sessionConfig, err = a.zededaClient.ParseEdgeViewScript(script)
			if err != nil {
				fmt.Printf("ParseEdgeViewScript failed: %v\n", err)
				a.SetConnectionProgress(nodeID, "Error: Failed to parse script")
				return "", fmt.Errorf("failed to parse script: %w", err)
			}
			fmt.Printf("Script parsed. URL: %s\n", sessionConfig.URL)
		}

		fmt.Println("DEBUG: Requesting EdgeView session...")
		a.SetConnectionProgress(nodeID, "Connecting to EdgeView...")
		// No artificial delay - rely on retries in StartProxy

		needNewProxy = true
	}

	// Start new proxy if needed
	if needNewProxy {
		fmt.Println("Starting proxy...")
		a.SetConnectionProgress(nodeID, "Starting local secure proxy...")
		var err error
		var tunnelID string
		// Default to SSH (tcp/localhost:22)
		port, tunnelID, err = a.sessionManager.StartProxy(a.ctx, sessionConfig, nodeID, "localhost:22", "ssh")
		if err != nil {
			fmt.Printf("StartProxy failed: %v\n", err)
			a.SetConnectionProgress(nodeID, "Error: Failed to start proxy")
			return "", fmt.Errorf("failed to start proxy: %w", err)
		}
		fmt.Printf("Proxy started on port %d (Tunnel ID: %s)\n", port, tunnelID)

		// Cache the session config (always cache token/URL, cache port only for native terminal)
		portToCache := 0
		if !useInAppTerminal {
			portToCache = port
		}
		expiresAt := time.Now().Add(4*time.Hour + 50*time.Minute)
		a.sessionManager.StoreCachedSession(nodeID, sessionConfig, portToCache, expiresAt)
		if useInAppTerminal {
			fmt.Println("Session config cached (proxy will close with window)")
		} else {
			fmt.Printf("Session and proxy cached until %s\n", expiresAt.Format(time.RFC3339))
		}
	}

	// Launch the terminal if requested
	if !useInAppTerminal {
		// DEPRECATED: Backend terminal launching is replaced by frontend/Electron `openExternalTerminal`.
		// We log this but do not attempt to launch from Go to avoid platform inconsistencies and double-launches.
		fmt.Println("Native terminal launch requested (handled by frontend).")
		a.SetConnectionProgress(nodeID, "Ready for native terminal")
	} else {
		fmt.Println("In-app terminal requested, skipping native launch.")
	}

	a.SetConnectionProgress(nodeID, "Connected")
	return fmt.Sprintf("Session started on port %d", port), nil
}

// StartTunnel starts a TCP tunnel to a specific IP and port on the device
// protocol is optional: "vnc", "ssh", "tcp". If empty, it's inferred from port.
func (a *App) StartTunnel(nodeID, targetIP string, targetPort int, protocol string) (int, string, error) {
	fmt.Printf("StartTunnel called for %s -> %s:%d (protocol: %s)\n", nodeID, targetIP, targetPort, protocol)

	// Get cached session
	cached, ok := a.sessionManager.GetCachedSession(nodeID)
	if !ok {
		fmt.Println("DEBUG: No cached session found, checking Cloud API status...")

		var sessionConfig *zededa.SessionConfig

		// Check if API says one is already active (reuse logic from ConnectToNode)
		evStatus, err := a.zededaClient.GetEdgeViewStatus(nodeID)
		if err == nil && evStatus != nil && evStatus.Token != "" && evStatus.DispURL != "" {
			fmt.Println("Found active EdgeView session from API, reusing token...")
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
				fmt.Printf("Reused active session. URL: %s\n", sessionConfig.URL)
			} else {
				fmt.Printf("Failed to parse active token: %v\n", parseErr)
			}
		}

		if sessionConfig == nil {
			fmt.Println("DEBUG: No active session found or invalid, creating new one for tunnel...")
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
		a.sessionManager.StoreCachedSession(nodeID, sessionConfig, 0, expiresAt)
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

	for attempt := 1; attempt <= maxRetries; attempt++ {
		fmt.Printf("DEBUG: Starting tunnel (attempt %d/%d)...\n", attempt, maxRetries)

		port, tunnelID, err = a.sessionManager.StartProxy(a.ctx, cached.Config, nodeID, target, protocol)

		if err == nil {
			fmt.Printf("Tunnel started on localhost:%d -> %s (ID: %s)\n", port, target, tunnelID)
			return port, tunnelID, nil
		}

		// This path is unlikely to be hit for "no device online" since StartProxy is async,
		// but keeping it for completeness if StartProxy logic changes.
		if strings.Contains(err.Error(), "no device online") && attempt < maxRetries {
			fmt.Printf("DEBUG: Device offline, retrying in 2 seconds... (attempt %d/%d)\n", attempt, maxRetries)
			time.Sleep(2 * time.Second)
			continue
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
	Active    bool   `json:"active"`
	ExpiresAt string `json:"expiresAt,omitempty"` // RFC3339 format
	Port      int    `json:"port,omitempty"`
}

// GetSessionStatus returns the cached session status for a node
func (a *App) GetSessionStatus(nodeID string) SessionStatus {
	cached, ok := a.sessionManager.GetCachedSession(nodeID)
	if !ok {
		return SessionStatus{Active: false}
	}

	return SessionStatus{
		Active:    true,
		ExpiresAt: cached.ExpiresAt.Format(time.RFC3339),
		Port:      cached.Port,
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
	ConsoleEnabled bool   `json:"consoleEnabled"`
}

// GetSSHStatus returns the current SSH status of the node
func (a *App) GetSSHStatus(nodeID string) *SSHStatus {
	// Get detailed status from ZEDEDA
	evStatus, err := a.zededaClient.GetEdgeViewStatus(nodeID)
	if err != nil {
		fmt.Printf("Error getting EdgeView status: %v\n", err)
		return &SSHStatus{Status: "unknown"}
	}

	status := "disabled"
	if evStatus.SSHKey != "" {
		status = "enabled"
	}

	// Check for key mismatch
	if status == "enabled" {
		_, localPubKey, err := ssh.EnsureSSHKey()
		if err == nil {
			// Normalize keys for comparison (trim whitespace)
			deviceKey := strings.TrimSpace(evStatus.SSHKey)
			localKey := strings.TrimSpace(localPubKey)

			// Simple comparison - if they don't match, it's a mismatch
			// Note: This assumes the key type and content are identical strings.
			// For more robust comparison we might need to parse them, but exact string match is usually sufficient for keys generated/managed by this tool.
			if deviceKey != localKey {
				status = "mismatch"
			}
		} else {
			fmt.Printf("Warning: Failed to get local SSH key for comparison: %v\n", err)
		}
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
	}

	// Override expiry with cached session if available and valid
	if cached, ok := a.sessionManager.GetCachedSession(nodeID); ok {
		if time.Now().Before(cached.ExpiresAt) {
			sshStatus.Expiry = fmt.Sprintf("%d", cached.ExpiresAt.Unix())
		}
	}

	return sshStatus
}

// DisableSSH disables SSH access on the device
func (a *App) DisableSSH(nodeID string) error {
	if err := a.zededaClient.DisableSSH(nodeID); err != nil {
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

	return nil
}

// GetDeviceServices queries the device for running applications using the Cloud API
// and enriches it with real-time EdgeView data if a session is active
func (a *App) GetDeviceServices(nodeID, deviceName string) (string, error) {
	// Use Cloud API to fetch app instances
	apps, err := a.zededaClient.GetDeviceAppInstances(nodeID)
	if err != nil {
		return "", fmt.Errorf("failed to get app instances: %w", err)
	}

	// Transform and enrich with Cloud API (immediate, reliable)
	type Service struct {
		Name          string   `json:"name"`
		Status        string   `json:"status"`
		ID            string   `json:"id"`
		IPs           []string `json:"ips,omitempty"`
		VNCPort       int      `json:"vncPort,omitempty"`
		EdgeViewState string   `json:"edgeViewState,omitempty"` // This will be populated by background task
	}

	type ServicesResponse struct {
		Services []Service `json:"services"`
		Error    string    `json:"error,omitempty"`
	}

	// 1. Fetch details for all apps and find Docker Runtime IP
	appDetails := make(map[string]*zededa.AppInstanceDetails)
	var dockerRuntimeIPs []string

	for _, app := range apps {
		fmt.Printf("DEBUG: Fetching Cloud API details for app %s...\n", app.Name)
		if details, err := a.zededaClient.GetAppInstanceDetails(app.ID); err == nil {
			appDetails[app.ID] = details

			// Check if this is the Docker Runtime instance
			if details.DeploymentType == "DEPLOYMENT_TYPE_DOCKER_RUNTIME" {
				// Extract IPs
				for _, adapter := range details.NetworkAdapters {
					if ipAddr, ok := adapter["ipaddr"].(string); ok && ipAddr != "" {
						dockerRuntimeIPs = append(dockerRuntimeIPs, ipAddr)
					}
				}
				if len(dockerRuntimeIPs) > 0 {
					fmt.Printf("DEBUG: Found Docker Runtime IPs from app %s: %v\n", app.Name, dockerRuntimeIPs)
				}
			}
		} else {
			fmt.Printf("DEBUG: Cloud API failed for app %s: %v\n", app.Name, err)
		}
	}

	// 2. Build services list with IP inheritance
	var services []Service
	for _, app := range apps {
		svc := Service{
			Name:   app.Name,
			Status: app.RunState,
			ID:     app.ID,
		}

		// Primary enrichment: Cloud API
		if details, ok := appDetails[app.ID]; ok {
			// Extract own IPs
			var ips []string
			for _, adapter := range details.NetworkAdapters {
				if ipAddr, ok := adapter["ipaddr"].(string); ok && ipAddr != "" {
					ips = append(ips, ipAddr)
				}
			}

			if len(ips) > 0 {
				svc.IPs = ips
				fmt.Printf("DEBUG: Found own IPs for app %s: %v\n", app.Name, ips)
			} else if details.AppType == "APP_TYPE_DOCKER_COMPOSE" && len(dockerRuntimeIPs) > 0 {
				// Inherit IPs from Docker Runtime
				svc.IPs = dockerRuntimeIPs
				fmt.Printf("DEBUG: Inherited Docker Runtime IPs for app %s: %v\n", app.Name, dockerRuntimeIPs)
			}

			// Extract VNC info from Cloud API
			if details.VMInfo.VNC {
				svc.VNCPort = 5900 + details.VMInfo.VNCDisplay
				fmt.Printf("DEBUG: Found VNC port %d for app %s (from Cloud API)\n", svc.VNCPort, app.Name)
			}
		}

		// Secondary enrichment: Check cache (from background EdgeView)
		a.enrichmentMu.RLock()
		if cached, ok := a.enrichmentCache[app.ID]; ok {
			// Use cached IPs if Cloud API failed
			if len(svc.IPs) == 0 && len(cached.IPs) > 0 {
				fmt.Printf("DEBUG: Using cached EdgeView IPs for app %s\n", app.Name)
				svc.IPs = cached.IPs
			}
			// Always use cached VNC/State (Cloud API doesn't have these)
			svc.VNCPort = cached.VNCPort
			svc.EdgeViewState = cached.State
		}
		a.enrichmentMu.RUnlock()

		services = append(services, svc)
	}

	// Start EdgeView enrichment in background (optional VNC port, state)
	// This runs async and doesn't block the response
	// TODO: Background EdgeView enrichment disabled temporarily to avoid InstID conflicts with TCP tunnels
	// The Cloud API already provides all essential data (IPs, VNC port, status)
	// EdgeView enrichment was only adding minor state differences
	/*
		go func() {
			fmt.Println("DEBUG: Starting background EdgeView enrichment...")

			// Try to get or create session
			cached, ok := a.sessionManager.GetCachedSession(nodeID)
			if !ok || time.Now().After(cached.ExpiresAt) { // Check if session is expired
				script, err := a.zededaClient.InitSession(nodeID)
				if err != nil {
					fmt.Printf("DEBUG: Background enrichment: failed to init session: %v\n", err)
					return
				}

				sessionConfig, err := a.zededaClient.ParseEdgeViewScript(script)
				if err != nil {
					fmt.Printf("DEBUG: Background enrichment: failed to parse script: %v\n", err)
					return
				}

				expiresAt := time.Now().Add(4*time.Hour + 50*time.Minute)
				a.sessionManager.StoreCachedSession(nodeID, sessionConfig, 0, expiresAt)
				cached, _ = a.sessionManager.GetCachedSession(nodeID) // Re-fetch cached session

				// Wait for device to connect
				fmt.Println("DEBUG: Background enrichment: Waiting 5 seconds for device to establish EdgeView connection...")
				time.Sleep(5 * time.Second)
			}

			// Try EdgeView app command (with retries)
			maxRetries := 3 // Reduced retries since this is optional
			var enrichments map[string]AppEnrichment
			for i := 0; i < maxRetries; i++ {
				fmt.Printf("DEBUG: Background EdgeView enrichment attempt %d/%d\n", i+1, maxRetries)
				appOutput, err := a.GetAppInfo(nodeID)
				if err != nil {
					fmt.Printf("DEBUG: Background enrichment: GetAppInfo failed: %v\n", err)
					time.Sleep(2 * time.Second)
					continue
				}

				if strings.Contains(appOutput, "can't have more than 2 peers") {
					fmt.Println("DEBUG: Background enrichment: All EdgeView sessions occupied")
					break // Don't retry for this error
				} else if strings.Contains(appOutput, "no device online") {
					fmt.Println("DEBUG: Background enrichment: Device not yet online, waiting...")
					time.Sleep(2 * time.Second)
					continue
				} else if strings.TrimSpace(appOutput) == "+++Done+++" {
					// Device returned only +++Done+++ with no data - retry
					fmt.Printf("DEBUG: Background enrichment: Device returned only +++Done+++ (attempt %d/%d), retrying...\n", i+1, maxRetries)
					time.Sleep(2 * time.Second)
					continue
				}

				// Success - parse enrichment data
				enrichments = ParseAppInfo(appOutput)
				fmt.Printf("DEBUG: Background enrichment successful, got data for %d apps\n", len(enrichments))

				// Update cache
				a.enrichmentMu.Lock()
				for id, enrich := range enrichments {
					a.enrichmentCache[id] = enrich
				}
				a.enrichmentMu.Unlock()

				// TODO: In Phase 2, notify frontend via WebSocket/SSE/polling
				// For now, enrichment is stored but not pushed to UI
				break
			}

			// Update cached services with EdgeView data
			if enrichments != nil {
				for i := range services {
					if enrichment, ok := enrichments[services[i].ID]; ok {
						services[i].VNCPort = enrichment.VNCPort
						services[i].EdgeViewState = enrichment.State
						// Note: IPs are prioritized from Cloud API, so we don't overwrite them here
					}
				}
			}

			fmt.Println("DEBUG: Background EdgeView enrichment completed")
		}()
	*/

	// Return immediately with Cloud API data
	response := ServicesResponse{
		Services: services,
		// EdgeView error is handled asynchronously, not returned in initial response
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return "", fmt.Errorf("failed to marshal services: %w", err)
	}

	fmt.Printf("DEBUG: Returning %d services with Cloud API data (%d bytes)\n", len(services), len(jsonBytes))
	return string(jsonBytes), nil
}

// VerifyEdgeViewTunnel checks if the EdgeView tunnel is active by sending a simple query
func (a *App) VerifyEdgeViewTunnel(nodeID string) error {
	// DISABLED: Tunnel verification is unreliable and causes timeouts
	// The SSH status check is sufficient to verify EdgeView is enabled
	// Users can still connect via SSH successfully even if this check would fail
	return nil
}

// VerifyToken checks if the provided token is valid
func (a *App) VerifyToken(token, baseURL string) (*zededa.TokenInfo, error) {
	// If a specific baseURL is provided (e.g. from settings form), use a temporary client
	if baseURL != "" {
		// Create a temp client to verify against the specified URL
		tempClient := zededa.NewClient(baseURL, "")
		return tempClient.VerifyToken(token)
	}

	// Otherwise use the configured client
	return a.zededaClient.VerifyToken(token)
}
