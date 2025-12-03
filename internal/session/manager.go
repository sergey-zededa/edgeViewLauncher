package session

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"edgeViewLauncher/internal/zededa"

	"github.com/gorilla/websocket"
)

// CachedSession stores an active session configuration
type CachedSession struct {
	Config    *zededa.SessionConfig
	Port      int
	ExpiresAt time.Time
}

// Tunnel represents an active persistent tunnel
// Status is a simple lifecycle indicator ("active", "failed", etc.).
// Error holds the last error message when Status == "failed".
type Tunnel struct {
	ID         string
	NodeID     string
	TargetIP   string
	TargetPort int
	LocalPort  int
	Type       string // "SSH", "VNC", "TCP"
	CreatedAt  time.Time
	Cancel     context.CancelFunc
	Status     string
	Error      string

	// Shared WebSocket connection for all TCP clients (reference client architecture)
	wsConn    *websocket.Conn
	wsMu      sync.Mutex // Protects wsConn writes
	clientIP  string     // Client endpoint IP from EdgeView
	config    *zededa.SessionConfig
	channels  map[uint16]chan []byte // ChanNum -> channel for incoming data
	channelMu sync.RWMutex
	nextChan  uint32 // Atomic counter for channel allocation
}

type Manager struct {
	sessions map[string]*CachedSession // key is nodeID
	tunnels  map[string]*Tunnel        // key is tunnel ID
	mu       sync.RWMutex
	tunnelMu sync.RWMutex
}

func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*CachedSession),
		tunnels:  make(map[string]*Tunnel),
	}
}

// GetCachedSession retrieves a cached session if it exists and is valid
func (m *Manager) GetCachedSession(nodeID string) (*CachedSession, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, exists := m.sessions[nodeID]
	if !exists {
		return nil, false
	}

	// Check if session has expired
	if time.Now().After(session.ExpiresAt) {
		return nil, false
	}

	return session, true
}

// StoreCachedSession stores a session configuration
func (m *Manager) StoreCachedSession(nodeID string, config *zededa.SessionConfig, port int, expiresAt time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.sessions[nodeID] = &CachedSession{
		Config:    config,
		Port:      port,
		ExpiresAt: expiresAt,
	}
}

// RegisterTunnel stores a new tunnel in the registry
func (m *Manager) RegisterTunnel(tunnel *Tunnel) {
	m.tunnelMu.Lock()
	defer m.tunnelMu.Unlock()
	m.tunnels[tunnel.ID] = tunnel
}

// FailTunnel marks an existing tunnel as failed and records the error message.
func (m *Manager) FailTunnel(tunnelID string, err error) {
	m.tunnelMu.Lock()
	defer m.tunnelMu.Unlock()

	if tunnel, exists := m.tunnels[tunnelID]; exists {
		tunnel.Status = "failed"
		if err != nil {
			tunnel.Error = err.Error()
		} else {
			tunnel.Error = ""
		}
	}
}

// GetTunnel retrieves a tunnel by ID
func (m *Manager) GetTunnel(tunnelID string) (*Tunnel, bool) {
	m.tunnelMu.RLock()
	defer m.tunnelMu.RUnlock()
	tunnel, exists := m.tunnels[tunnelID]
	return tunnel, exists
}

// CloseTunnel cancels a tunnel's context and removes it from the registry
func (m *Manager) CloseTunnel(tunnelID string) error {
	m.tunnelMu.Lock()
	defer m.tunnelMu.Unlock()

	tunnel, exists := m.tunnels[tunnelID]
	if !exists {
		return fmt.Errorf("tunnel %s not found", tunnelID)
	}

	// Cancel the context to stop the tunnel listener
	if tunnel.Cancel != nil {
		tunnel.Cancel()
	}

	delete(m.tunnels, tunnelID)
	fmt.Printf("DEBUG: Closed tunnel %s (localhost:%d)\n", tunnelID, tunnel.LocalPort)
	return nil
}

// ListTunnels returns all active tunnels for a given node
func (m *Manager) ListTunnels(nodeID string) []*Tunnel {
	m.tunnelMu.RLock()
	defer m.tunnelMu.RUnlock()

	var tunnels []*Tunnel
	for _, tunnel := range m.tunnels {
		if tunnel.NodeID == nodeID {
			tunnels = append(tunnels, tunnel)
		}
	}
	return tunnels
}

// GetAllTunnels returns all active tunnels
func (m *Manager) GetAllTunnels() []*Tunnel {
	m.tunnelMu.RLock()
	defer m.tunnelMu.RUnlock()

	tunnels := make([]*Tunnel, 0, len(m.tunnels))
	for _, tunnel := range m.tunnels {
		tunnels = append(tunnels, tunnel)
	}
	return tunnels
}

const (
	edgeViewVersion = "0.8.6"
	clientIPMsg     = "YourEndPointIPAddr:"
)

var (
	// ErrNoDeviceOnline is returned when EdgeView reports that the
	// device is not currently connected ("no device online").
	ErrNoDeviceOnline = errors.New("device is not connected to EdgeView (no device online)")

	// ErrBusyInstance is returned when EdgeView reports that the
	// instance limit has been reached ("can't have more than 2 peers").
	ErrBusyInstance = errors.New("device instance limit reached (can't have more than 2 peers)")
)

// envelopeMsg matches original EdgeView crypto.go:30-33
type envelopeMsg struct {
	Message    []byte   `json:"message"`
	Sha256Hash [32]byte `json:"sha256Hash"` // MUST be array, not slice!
}

// tcpData matches original EdgeView tcp.go:29-34
type tcpData struct {
	Version   uint16 `json:"version"`
	MappingID uint16 `json:"mappingId"`
	ChanNum   uint16 `json:"chanNum"`
	Data      []byte `json:"data"`
}

type cmdOpt struct {
	Version      string `json:"version"`
	ClientEPAddr string `json:"clientEPAddr"`
	Network      string `json:"network"`
	System       string `json:"system"`
	Pubsub       string `json:"pubsub"`
	Logopt       string `json:"logopt"`
	Timerange    string `json:"timerange"`
	IsJSON       bool   `json:"isJSON"`
	Extraline    int    `json:"extraline"`
	Logtype      string `json:"logtype"`
}

// StartProxy starts a local TCP listener that proxies to the EdgeView WebSocket.
// This implementation matches the reference EdgeView client architecture:
// 1. Establish ONE WebSocket connection upfront
// 2. Send the tcp command and wait for +++tcpSetupOK+++
// 3. Start accepting TCP clients that multiplex over the shared WebSocket
// Returns the local port number and tunnel ID.
func (m *Manager) StartProxy(ctx context.Context, config *zededa.SessionConfig, nodeID string, target string, protocol string) (int, string, error) {
	// Determine the initial instance ID based on MaxInst
	initialInstID := config.InstID
	if config.MaxInst == 1 {
		// Single instance device - must use InstID 0
		initialInstID = 0
		fmt.Printf("DEBUG: Device supports single instance only (MaxInst=1), using InstID=0\n")
	} else if config.MaxInst > 1 {
		// Multi-instance device - start with InstID 1 (reference client typically uses 0 or 1)
		initialInstID = 1
		fmt.Printf("DEBUG: Device supports %d instances (MaxInst=%d), starting with InstID=1\n", config.MaxInst, config.MaxInst)
	} else {
		// Fallback: if MaxInst is not set properly, default to 0
		initialInstID = 0
		fmt.Printf("DEBUG: MaxInst not set, defaulting to InstID=0\n")
	}

	// Start local listener first
	var listener net.Listener
	var err error

	for port := 9001; port <= 9010; port++ {
		listener, err = net.Listen("tcp", fmt.Sprintf("localhost:%d", port))
		if err == nil {
			break
		}
	}

	if listener == nil {
		listener, err = net.Listen("tcp", "localhost:0")
		if err != nil {
			return 0, "", fmt.Errorf("failed to start local listener: %w", err)
		}
	}

	localPort := listener.Addr().(*net.TCPAddr).Port
	fmt.Printf("[%s] Tunnel listening on localhost:%d for target %s (protocol: %s)\n", time.Now().Format("2006-01-02 15:04:05"), localPort, target, protocol)

	// Try to establish WebSocket and get tcpSetupOK with retries
	const maxRetries = 5
	var wsConn *websocket.Conn
	var clientIP string
	var lastErr error

	// Track which instances we've tried in the current attempt
	triedInstances := make(map[int]bool)
	currentInstID := initialInstID

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			fmt.Printf("DEBUG: Retry attempt %d/%d for tunnel setup...\n", attempt, maxRetries)
		}

		// Set the instance ID for this attempt
		config.InstID = currentInstID
		triedInstances[currentInstID] = true

		// Connect to EdgeView
		wsConn, clientIP, err = m.connectToEdgeView(config)
		if err != nil {
			lastErr = fmt.Errorf("failed to connect to EdgeView: %w", err)
			if attempt < maxRetries {
				waitTime := time.Duration(attempt*2) * time.Second
				fmt.Printf("DEBUG: Connection failed, waiting %v before retry...\n", waitTime)
				time.Sleep(waitTime)
				continue
			}
			listener.Close()
			return 0, "", lastErr
		}

		// Send the TCP tunnel command
		query := cmdOpt{
			Version:      edgeViewVersion,
			ClientEPAddr: clientIP,
			Network:      "tcp/" + target,
			IsJSON:       false,
		}
		queryBytes, _ := json.Marshal(query)

		if err := sendWrappedMessage(wsConn, queryBytes, config.Key, websocket.TextMessage); err != nil {
			wsConn.Close()
			lastErr = fmt.Errorf("failed to send tcp command: %w", err)
			if attempt < maxRetries {
				waitTime := time.Duration(attempt) * time.Second
				fmt.Printf("DEBUG: Failed to send command, waiting %v before retry...\n", waitTime)
				time.Sleep(waitTime)
				continue
			}
			listener.Close()
			return 0, "", lastErr
		}

		// Wait for +++tcpSetupOK+++ (with timeout)
		fmt.Printf("DEBUG: Waiting for tcpSetupOK from device (attempt %d/%d)...\n", attempt, maxRetries)
		setupErr := m.waitForTcpSetupOK(wsConn, config.Key, 30*time.Second)
		if setupErr == nil {
			fmt.Println("DEBUG: tcpSetupOK received, tunnel established successfully!")
			break // Success
		}

		// Setup failed - check if it's "no device online" error
		if setupErr == ErrNoDeviceOnline {
			fmt.Printf("DEBUG: Device is not online (attempt %d/%d). The device may not be connected to EdgeView yet.\n", attempt, maxRetries)
		} else {
			fmt.Printf("DEBUG: Tunnel setup failed: %v (attempt %d/%d)\n", setupErr, attempt, maxRetries)
		}

		// Try to find an untried instance before applying backoff
		// We do this for ANY error, not just ErrBusyInstance, because sometimes the server
		// just closes the connection without sending a specific error if the instance is busy
		if config.MaxInst > 1 {
			foundAlternative := false
			// Try next instance in round-robin fashion starting from current+1
			for i := 1; i < config.MaxInst; i++ {
				nextInstID := (currentInstID + i) % config.MaxInst
				if !triedInstances[nextInstID] {
					currentInstID = nextInstID
					foundAlternative = true
					fmt.Printf("DEBUG: Switching to alternative instance %d (previous failed)...\n", currentInstID)
					break
				}
			}

			if foundAlternative {
				// Close current connection and try the alternative instance immediately
				wsConn.Close()
				wsConn = nil
				lastErr = setupErr
				continue // Skip the backoff wait and try immediately
			}

			// All instances tried - reset for next full round
			fmt.Printf("DEBUG: All %d instances have been tried. Will retry with backoff.\n", config.MaxInst)
			triedInstances = make(map[int]bool)
			// Don't reset currentInstID to initial, just keep going round-robin or stay on current
			// But to be safe and consistent, let's reset triedInstances and let the loop continue
			// The next iteration will use currentInstID (which is the last one tried)
			// If we want to start over from initial, we can:
			// currentInstID = initialInstID
		}

		// Setup failed - retry
		wsConn.Close()
		wsConn = nil
		lastErr = setupErr

		if attempt < maxRetries {
			// Exponential backoff: 2s, 4s, 8s, 16s
			// Start faster than before since we removed the initial 20s delay
			waitTime := time.Duration(1<<uint(attempt)) * time.Second
			fmt.Printf("DEBUG: Waiting %v before next attempt...\n", waitTime)
			time.Sleep(waitTime)
		}
	}

	if wsConn == nil {
		listener.Close()
		// Provide a more helpful error message for "no device online"
		if lastErr == ErrNoDeviceOnline {
			return 0, "", fmt.Errorf("device is not connected to EdgeView after %d attempts. Please ensure:\n  1. The device is powered on and connected to the internet\n  2. EdgeView is enabled on the device\n  3. The device has had sufficient time to establish its EdgeView connection (typically 20-30 seconds after enabling)", maxRetries)
		}
		return 0, "", fmt.Errorf("failed to establish tunnel after %d attempts: %w", maxRetries, lastErr)
	}

	// Create Tunnel with shared WebSocket
	tunnelID := fmt.Sprintf("tunnel-%d", time.Now().UnixNano())
	tunnelCtx, cancel := context.WithCancel(context.Background())

	tunnel := &Tunnel{
		ID:        tunnelID,
		NodeID:    nodeID,
		TargetIP:  target,
		LocalPort: localPort,
		Type:      strings.ToUpper(protocol),
		CreatedAt: time.Now(),
		Cancel:    cancel,
		Status:    "active",
		Error:     "",
		wsConn:    wsConn,
		clientIP:  clientIP,
		config:    config,
		channels:  make(map[uint16]chan []byte),
		nextChan:  0,
	}

	m.RegisterTunnel(tunnel)

	// Start the WebSocket reader that dispatches to TCP clients
	go m.tunnelWSReader(tunnelCtx, tunnel)
	// Start keep-alive loop
	go m.tunnelKeepAlive(tunnelCtx, tunnel)

	if protocol == "vnc" {
		// Start HTTP server for WebSocket upgrades
		server := &http.Server{
			Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				upgrader := websocket.Upgrader{
					CheckOrigin: func(r *http.Request) bool { return true },
				}
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					fmt.Printf("Failed to upgrade WS: %v\n", err)
					return
				}

				// Handle this client
				m.handleWSClient(tunnelCtx, conn, tunnel)
			}),
		}

		go func() {
			defer m.CloseTunnel(tunnel.ID)
			if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
				fmt.Printf("HTTP server error: %v\n", err)
			}
		}()

		// Ensure server is closed when context is done
		go func() {
			<-tunnelCtx.Done()
			server.Close()
		}()
	} else {
		// Start accepting TCP client connections
		go m.tunnelAcceptLoop(tunnelCtx, listener, tunnel)
	}

	return localPort, tunnelID, nil
}

// waitForTcpSetupOK waits for the +++tcpSetupOK+++ message from EdgeView
func (m *Manager) waitForTcpSetupOK(wsConn *websocket.Conn, key string, timeout time.Duration) error {
	setupDone := make(chan error, 1)
	go func() {
		for {
			_, msg, err := wsConn.ReadMessage()
			if err != nil {
				setupDone <- fmt.Errorf("ws read error waiting for tcpSetupOK: %w", err)
				return
			}

			payload, err := unwrapMessage(msg, key)
			if err != nil {
				// Check for specific errors returned by unwrapMessage
				if err == ErrBusyInstance {
					setupDone <- ErrBusyInstance
					return
				}
				if err == ErrNoDeviceOnline {
					setupDone <- ErrNoDeviceOnline
					return
				}

				// Check for plain-text errors in the raw message if unwrapMessage didn't catch them specifically
				// (though unwrapMessage should handle most now)
				if strings.Contains(string(msg), "no device online") {
					setupDone <- ErrNoDeviceOnline
					return
				}
				continue // Non-envelope message, ignore
			}

			payloadStr := string(payload)
			if strings.Contains(payloadStr, "+++tcpSetupOK+++") {
				setupDone <- nil
				return
			}
			if strings.Contains(payloadStr, "+++Done+++") {
				setupDone <- fmt.Errorf("device closed connection before tcpSetupOK")
				return
			}
		}
	}()

	select {
	case err := <-setupDone:
		return err
	case <-time.After(timeout):
		return fmt.Errorf("timeout waiting for tcpSetupOK")
	}
}

// LaunchTerminal opens a new terminal window with the SSH command
func (m *Manager) LaunchTerminal(port int, keyPath string) error {
	sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i \"%s\" -p %d root@localhost", keyPath, port)

	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		// macOS: Use osascript to open Terminal.app
		cmd = exec.Command("osascript", "-e", fmt.Sprintf(`tell application "Terminal" to do script "%s"`, sshCmd))
	case "windows":
		// Windows: Use cmd.exe to open a new window with ssh
		// Note: Windows 10+ has built-in OpenSSH
		cmd = exec.Command("cmd", "/c", "start", "cmd", "/k", sshCmd)
	case "linux":
		// Linux: Try common terminal emulators in order of preference
		terminals := []struct {
			name string
			args []string
		}{
			{"gnome-terminal", []string{"--", "bash", "-c", sshCmd + "; exec bash"}},
			{"konsole", []string{"-e", "bash", "-c", sshCmd + "; exec bash"}},
			{"xfce4-terminal", []string{"-e", sshCmd}},
			{"xterm", []string{"-e", sshCmd}},
		}

		for _, term := range terminals {
			if _, err := exec.LookPath(term.name); err == nil {
				cmd = exec.Command(term.name, term.args...)
				break
			}
		}

		if cmd == nil {
			return fmt.Errorf("no supported terminal emulator found (tried gnome-terminal, konsole, xfce4-terminal, xterm)")
		}
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to launch terminal: %w", err)
	}
	return nil
}

// ExecuteCommand executes an EdgeView command and returns the output
func (m *Manager) ExecuteCommand(nodeID string, command string) (string, error) {
	// Get cached session
	m.mu.RLock()
	cached, ok := m.sessions[nodeID]
	m.mu.RUnlock()

	if !ok || time.Now().After(cached.ExpiresAt) {
		return "", fmt.Errorf("no active session for node %s", nodeID)
	}

	config := cached.Config

	// Compute token hash
	tokenToHash := config.Token
	if config.InstID > 0 {
		tokenToHash = fmt.Sprintf("%s.%d", config.Token, config.InstID)
	}
	h := sha256.New()
	h.Write([]byte(tokenToHash))
	hash16 := h.Sum(nil)[:16]
	tokenHash := base64.RawURLEncoding.EncodeToString(hash16)

	// Construct hostname
	hostname, _ := os.Hostname()
	// Reference client does NOT append UUID, only InstID
	if config.InstID > 0 {
		hostname += fmt.Sprintf("-inst-%d", config.InstID)
	}

	// Prepare headers
	headers := http.Header{}
	headers.Add("X-Session-Token", tokenHash)
	headers.Add("X-Hostname", hostname)

	// Connect to WebSocket
	tlsConfig := &tls.Config{InsecureSkipVerify: true}
	netDialer := &net.Dialer{}
	dialer := &websocket.Dialer{
		TLSClientConfig:  tlsConfig,
		NetDialContext:   netDialer.DialContext,
		HandshakeTimeout: 45 * time.Second,
	}

	wsConn, _, err := dialer.Dial(config.URL, headers)
	if err != nil {
		return "", fmt.Errorf("failed to connect: %w", err)
	}
	defer wsConn.Close()

	// Read initial message
	_, _, err = wsConn.ReadMessage()
	if err != nil {
		return "", fmt.Errorf("failed to read initial message: %w", err)
	}

	// Send command
	query := cmdOpt{
		Version: edgeViewVersion,
		System:  command, // "app", "log", etc.
		IsJSON:  false,   // app command returns plain text, not JSON
	}

	fmt.Printf("DEBUG: Sending EdgeView command: %s\n", command)
	queryBytes, err := json.Marshal(query)
	if err != nil {
		return "", fmt.Errorf("failed to marshal query: %w", err)
	}
	fmt.Printf("DEBUG: Query payload: %s\n", string(queryBytes))

	if err := sendWrappedMessage(wsConn, queryBytes, config.Key, websocket.TextMessage); err != nil {
		return "", fmt.Errorf("failed to send query: %w", err)
	}
	fmt.Println("DEBUG: Command sent successfully, waiting for response...")

	// Read response with timeout (increased to 30s for app command which may take longer)
	timeoutDuration := 30 * time.Second
	if command == "app" {
		fmt.Println("DEBUG: Using extended timeout (30s) for app command")
	} else {
		timeoutDuration = 10 * time.Second
	}
	wsConn.SetReadDeadline(time.Now().Add(timeoutDuration))

	var output strings.Builder
	messageCount := 0
	for {
		_, msg, err := wsConn.ReadMessage()
		if err != nil {
			// Timeout or connection closed - return what we have
			fmt.Printf("DEBUG: Stopped reading after %d messages (error: %v)\n", messageCount, err)
			break
		}
		messageCount++
		fmt.Printf("DEBUG: Received message %d, size: %d bytes\n", messageCount, len(msg))

		// Try to unwrap the message
		unwrapped, err := unwrapMessage(msg, config.Key)
		if err == nil {
			fmt.Printf("DEBUG: Message %d unwrapped successfully, size: %d bytes\n", messageCount, len(unwrapped))
			// Show actual content for debugging
			contentPreview := string(unwrapped)
			if len(contentPreview) > 200 {
				contentPreview = contentPreview[:200] + "..."
			}
			fmt.Printf("DEBUG: Message %d content: %s\n", messageCount, contentPreview)
			output.Write(unwrapped)
		} else {
			// Check if it's a known plain-text error message
			msgStr := string(msg)
			if strings.Contains(msgStr, "no device online") || strings.Contains(msgStr, "can't have more than 2 peers") {
				fmt.Printf("DEBUG: Received error message: %s\n", strings.TrimSpace(msgStr))
			} else {
				fmt.Printf("DEBUG: Message %d unwrap failed: %v, using raw\n", messageCount, err)
			}
			// If unwrap fails, use raw message
			output.Write(msg)
		}

		// Continue reading until timeout to get all app data
		// (EdgeView sends device info first, then app instances in subsequent messages)
	}

	fmt.Printf("DEBUG: Total output collected: %d bytes\n", output.Len())

	// Warn if we only got +++Done+++ for app command
	result := output.String()
	if command == "app" && strings.TrimSpace(result) == "+++Done+++" {
		fmt.Println("WARNING: App command returned only '+++Done+++' with no app data!")
		fmt.Println("WARNING: This means the device is not returning application information.")
		fmt.Println("WARNING: Possible causes:")
		fmt.Println("         1. No applications are running on the device")
		fmt.Println("         2. EdgeView app query is not supported on this EVE version")
		fmt.Println("         3. Device needs more time to collect app data (try increasing wait time)")
	}

	return result, nil
}

// QueryDevice sends a command to the device and returns the response
func (m *Manager) QueryDevice(ctx context.Context, config *zededa.SessionConfig, commandType, command string, isJSON bool) (string, error) {

	// Retry loop for Instance ID (in case of "can't have more than 2 peers" error)
	for {
		// 1. Compute Token Hash
		tokenToHash := config.Token
		if config.InstID > 0 {
			tokenToHash = fmt.Sprintf("%s.%d", config.Token, config.InstID)
		}

		h := sha256.New()
		h.Write([]byte(tokenToHash))
		hash16 := h.Sum(nil)[:16]
		tokenHash := base64.RawURLEncoding.EncodeToString(hash16)

		// 2. Construct Hostname
		hostname, _ := os.Hostname()
		// Reference client does NOT append UUID, only InstID
		if config.InstID > 0 {
			hostname += fmt.Sprintf("-inst-%d", config.InstID)
		}

		// 3. Prepare Headers
		headers := http.Header{}
		headers.Add("X-Session-Token", tokenHash)
		headers.Add("X-Hostname", hostname)

		// Connect to WebSocket
		wsConn, resp, err := websocket.DefaultDialer.Dial(config.URL, headers)
		if err != nil {
			if resp != nil {
				return "", fmt.Errorf("failed to connect to websocket (status %d): %w", resp.StatusCode, err)
			}
			return "", fmt.Errorf("failed to connect to websocket: %w", err)
		}

		// --- HANDSHAKE START ---

		// 4. Read Initial IP Message
		_, msg, err := wsConn.ReadMessage()
		if err != nil {
			wsConn.Close()
			return "", fmt.Errorf("failed to read initial message: %w", err)
		}
		msgStr := string(msg)

		clientIP := ""
		if strings.HasPrefix(msgStr, clientIPMsg) {
			parts := strings.SplitN(msgStr, clientIPMsg, 2)
			if len(parts) == 2 {
				clientIP = strings.TrimSpace(parts[1])
			}
		}

		// 5. Send Query Command
		query := cmdOpt{
			Version:      edgeViewVersion,
			ClientEPAddr: clientIP,
			IsJSON:       isJSON,
		}

		switch commandType {
		case "system":
			query.System = command
		case "network":
			query.Network = command
		}

		queryBytes, err := json.Marshal(query)
		if err != nil {
			wsConn.Close()
			return "", fmt.Errorf("failed to marshal query: %w", err)
		}

		if err := sendWrappedMessage(wsConn, queryBytes, config.Key, websocket.TextMessage); err != nil {
			wsConn.Close()
			return "", fmt.Errorf("failed to send query: %w", err)
		}

		// --- HANDSHAKE END ---

		// Check for immediate error (Busy Instance)
		wsConn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, nextMsg, err := wsConn.ReadMessage()
		wsConn.SetReadDeadline(time.Time{}) // Reset deadline

		if err == nil {
			// We received a message immediately. Check if it's an error.
			payload, unwrapErr := unwrapMessage(nextMsg, config.Key)
			if unwrapErr != nil {
				rawMsg := string(nextMsg)

				// Check for "no device online" error FIRST
				if strings.Contains(rawMsg, "no device online") {
					wsConn.Close()
					return "", fmt.Errorf("device is not connected to EdgeView (no device online)")
				}

				if strings.Contains(rawMsg, "can't have more than 2 peers") {
					fmt.Printf("DEBUG: Instance %d is busy. Retrying...\n", config.InstID)
					wsConn.Close()

					// Increment InstID, respecting MaxInst limit
					config.InstID++
					if config.InstID >= config.MaxInst {
						return "", fmt.Errorf("all instances busy (tried up to %d of %d max)", config.InstID, config.MaxInst)
					}
					fmt.Printf("DEBUG: Retrying with InstID=%d (MaxInst=%d)\n", config.InstID, config.MaxInst)
					continue // RETRY LOOP
				}
				// Other unwrap error?
			} else {
				// Valid payload. It might be the response we want!
				payloadStr := string(payload)
				fmt.Printf("DEBUG: Received immediate payload (%d bytes)\n", len(payloadStr))
				// Show full output for debugging
				fmt.Printf("DEBUG: FULL immediate payload:\n%s\n", payloadStr)

				if strings.Contains(payloadStr, "no device online") {
					wsConn.Close()
					return "", fmt.Errorf("device is not connected to EdgeView (no device online)")
				}
				if strings.HasPrefix(payloadStr, "Error:") {
					wsConn.Close()
					return "", fmt.Errorf("server error: %s", payloadStr)
				}

				if isJSON {
					if strings.HasPrefix(payloadStr, "{") || strings.HasPrefix(payloadStr, "[") {
						fmt.Printf("DEBUG: Returning JSON response immediately\n")
						wsConn.Close()
						return payloadStr, nil
					}
					fmt.Printf("DEBUG: Payload doesn't look like JSON, continuing to read loop\n")
				} else {
					if len(payloadStr) > 0 {
						fmt.Printf("DEBUG: Returning text response immediately\n")
						wsConn.Close()
						return payloadStr, nil
					}
					fmt.Printf("DEBUG: Empty payload, continuing to read loop\n")
				}
			}
		}

		// If we didn't get an immediate response (timeout on read), or if the immediate response wasn't the final one (unlikely for simple query?), proceed to read loop.
		// Actually, for 'app' command, the response usually comes quickly.
		// But if we timed out above (err != nil), it means no immediate error, so connection is likely good.

		// Read Response Loop
		wsConn.SetReadDeadline(time.Now().Add(30 * time.Second))

		for {
			_, message, err := wsConn.ReadMessage()
			if err != nil {
				wsConn.Close()
				if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
					return "", fmt.Errorf("device did not respond in time (EdgeView tunnel might be establishing)")
				}
				return "", fmt.Errorf("failed to read response: %w", err)
			}

			// Verify and Unwrap
			payload, err := unwrapMessage(message, config.Key)
			if err != nil {
				// Check for specific server errors (Raw messages)
				msgStr := string(message)
				if strings.Contains(msgStr, "no device online") {
					wsConn.Close()
					return "", fmt.Errorf("device is not connected to EdgeView (no device online)")
				}
				continue
			}

			payloadStr := string(payload)

			// Check for specific server errors (Enveloped messages)
			if strings.Contains(payloadStr, "no device online") {
				wsConn.Close()
				return "", fmt.Errorf("device is not connected to EdgeView (no device online)")
			}
			if strings.HasPrefix(payloadStr, "Error:") {
				wsConn.Close()
				return "", fmt.Errorf("server error: %s", payloadStr)
			}

			// Check if it looks like our response
			if isJSON {
				if strings.HasPrefix(payloadStr, "{") || strings.HasPrefix(payloadStr, "[") {
					wsConn.Close()
					return payloadStr, nil
				}
			} else {
				if len(payloadStr) > 0 {
					wsConn.Close()
					return payloadStr, nil
				}
			}
		}
	}
}

// sendWrappedMessage exactly matches original EdgeView crypto.go:64-84 (signAuthenData)
func sendWrappedMessage(conn *websocket.Conn, payload []byte, key string, messageType int) error {
	envelope := envelopeMsg{
		Message: payload,
	}

	// HMAC-SHA256 Sign (matching original)
	h := hmac.New(sha256.New, []byte(key))
	h.Write(envelope.Message)
	hash := h.Sum(nil)

	// Copy hash into fixed-size array (CRITICAL: original uses copy!)
	n := copy(envelope.Sha256Hash[:], hash)
	if len(hash) != 32 || n != 32 {
		return fmt.Errorf("hash copy bytes not correct: %d", n)
	}

	// Marshal and send
	jdata, err := json.Marshal(envelope)
	if err != nil {
		return err
	}

	return conn.WriteMessage(messageType, jdata)
}

func unwrapMessage(data []byte, key string) ([]byte, error) {
	// First, check for known plain-text error responses that are not
	// wrapped in the usual JSON+HMAC envelope.
	raw := string(data)
	if strings.Contains(raw, "no device online") {
		trimmed := strings.TrimSpace(raw)
		if len(trimmed) > 4096 {
			trimmed = trimmed[:4096] + "... (truncated)"
		}
		fmt.Printf("DEBUG: unwrapMessage detected 'no device online' plain-text response: %s\n", trimmed)
		return nil, ErrNoDeviceOnline
	}

	if strings.Contains(raw, "can't have more than 2 peers") {
		fmt.Printf("DEBUG: unwrapMessage detected 'busy instance' plain-text response\n")
		return nil, ErrBusyInstance
	}

	var envelope envelopeMsg
	if err := json.Unmarshal(data, &envelope); err != nil {
		// Log the full raw message (or a large prefix if extremely long)
		if len(raw) > 4096 {
			raw = raw[:4096] + "... (truncated)"
		}
		fmt.Printf("DEBUG: unwrapMessage failed to unmarshal envelope. Raw data (len=%d): %s\n", len(data), raw)
		return nil, fmt.Errorf("failed to unmarshal envelope: %w", err)
	}

	// Verify HMAC signature (matching original)
	h := hmac.New(sha256.New, []byte(key))
	h.Write(envelope.Message)
	expectedHash := h.Sum(nil)

	// Compare using array slice
	if !hmac.Equal(envelope.Sha256Hash[:], expectedHash) {
		if len(raw) > 4096 {
			raw = raw[:4096] + "... (truncated)"
		}
		fmt.Printf("DEBUG: unwrapMessage HMAC verification failed. Raw data (len=%d): %s\n", len(data), raw)
		return nil, fmt.Errorf("HMAC verification failed")
	}

	return envelope.Message, nil
}

// connectToEdgeView establishes a WebSocket connection to EdgeView
func (m *Manager) connectToEdgeView(config *zededa.SessionConfig) (*websocket.Conn, string, error) {
	// 1. Compute Token Hash
	tokenToHash := config.Token
	if config.InstID > 0 {
		tokenToHash = fmt.Sprintf("%s.%d", config.Token, config.InstID)
	}

	h := sha256.New()
	h.Write([]byte(tokenToHash))
	hash16 := h.Sum(nil)[:16]
	tokenHash := base64.RawURLEncoding.EncodeToString(hash16)

	// Construct hostname
	hostname, _ := os.Hostname()
	// Reference client does NOT append UUID, only InstID
	if config.InstID > 0 {
		hostname += fmt.Sprintf("-inst-%d", config.InstID)
	}

	// 3. Prepare Headers
	headers := http.Header{}
	headers.Add("X-Session-Token", tokenHash)
	headers.Add("X-Hostname", hostname)

	fmt.Printf("DEBUG: Connecting to %s (InstID: %d)\n", config.URL, config.InstID)

	// Connect to WebSocket
	tlsConfig := &tls.Config{
		InsecureSkipVerify: true,
	}
	netDialer := &net.Dialer{}
	dialer := &websocket.Dialer{
		TLSClientConfig:  tlsConfig,
		NetDialContext:   netDialer.DialContext,
		HandshakeTimeout: 45 * time.Second,
	}

	wsConn, resp, err := dialer.Dial(config.URL, headers)
	if err != nil {
		if resp != nil {
			return nil, "", fmt.Errorf("failed to connect to websocket (status %d): %w", resp.StatusCode, err)
		}
		return nil, "", fmt.Errorf("failed to connect to websocket: %w", err)
	}

	// 4. Read Initial IP Message
	_, msg, err := wsConn.ReadMessage()
	if err != nil {
		wsConn.Close()
		return nil, "", fmt.Errorf("failed to read initial message: %w", err)
	}

	initialMsg := string(msg)
	fmt.Printf("DEBUG: Received initial message: %s\n", initialMsg)

	// Extract client IP address from message like "YourEndPointIPAddr:213.47.61.191"
	clientIP := ""
	if strings.HasPrefix(initialMsg, "YourEndPointIPAddr:") {
		clientIP = strings.TrimPrefix(initialMsg, "YourEndPointIPAddr:")
		clientIP = strings.TrimSpace(clientIP)
		fmt.Printf("DEBUG: Extracted client IP: %s\n", clientIP)
	}

	// Store client IP in the connection for later use
	// We'll pass it back via a custom field
	// For now, let's use a simple approach: store in a map keyed by wsConn
	// Actually, let's modify the return signature to return the IP too
	// But that would require changing all callers...
	// Instead, let's store it in the config temporarily
	// Actually, config is passed in, not modified
	// Let me use a different approach: modify connectToEdgeView to return both

	return wsConn, clientIP, nil
}

// tunnelKeepAlive sends periodic ping messages to keep the WebSocket connection alive
func (m *Manager) tunnelKeepAlive(ctx context.Context, tunnel *Tunnel) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	fmt.Printf("TUNNEL[%s] Keep-alive started\n", tunnel.ID)

	for {
		select {
		case <-ctx.Done():
			fmt.Printf("TUNNEL[%s] Keep-alive stopped (context done)\n", tunnel.ID)
			return
		case <-ticker.C:
			tunnel.wsMu.Lock()
			// Send a standard WebSocket Ping message
			err := tunnel.wsConn.WriteMessage(websocket.PingMessage, []byte{})
			tunnel.wsMu.Unlock()
			if err != nil {
				fmt.Printf("TUNNEL[%s] Keep-alive ping failed: %v\n", tunnel.ID, err)
				// If ping fails, the connection is likely dead, so fail the tunnel
				m.FailTunnel(tunnel.ID, err)
				return
			}
		}
	}
}

// tunnelWSReader reads from the shared WebSocket and dispatches data to
// the appropriate TCP client channel based on ChanNum.
func (m *Manager) tunnelWSReader(ctx context.Context, tunnel *Tunnel) {
	defer func() {
		tunnel.wsMu.Lock()
		if tunnel.wsConn != nil {
			tunnel.wsConn.Close()
		}
		tunnel.wsMu.Unlock()

		// Close all client channels
		tunnel.channelMu.Lock()
		for _, ch := range tunnel.channels {
			close(ch)
		}
		tunnel.channels = nil
		tunnel.channelMu.Unlock()
	}()

	for {
		select {
		case <-ctx.Done():
			return
		default:
			_, msg, err := tunnel.wsConn.ReadMessage()
			if err != nil {
				if ctx.Err() == nil {
					fmt.Printf("TUNNEL[%s] WS reader error: %v\n", tunnel.ID, err)
					m.FailTunnel(tunnel.ID, err)
				}
				return
			}

			payload, err := unwrapMessage(msg, tunnel.config.Key)
			if err != nil {
				// Check for plain-text errors
				if strings.Contains(string(msg), "no device online") {
					fmt.Printf("TUNNEL[%s] Device offline\n", tunnel.ID)
					m.FailTunnel(tunnel.ID, ErrNoDeviceOnline)
					return
				}
				continue
			}

			// Check for control messages
			payloadStr := string(payload)
			if strings.Contains(payloadStr, "+++Done+++") {
				fmt.Printf("TUNNEL[%s] Received +++Done+++, closing\n", tunnel.ID)
				return
			}

			// Parse tcpData
			var td tcpData
			if err := json.Unmarshal(payload, &td); err != nil {
				fmt.Printf("TUNNEL[%s] Failed to parse tcpData: %v\n", tunnel.ID, err)
				continue // Not tcpData, skip
			}
			// Data received for channel

			if len(td.Data) > 0 {
				// Dispatch to the appropriate channel
				tunnel.channelMu.RLock()
				ch, ok := tunnel.channels[td.ChanNum]
				tunnel.channelMu.RUnlock()

				if ok {
					select {
					case ch <- td.Data:
					case <-ctx.Done():
						return
					default:
						// Channel full, drop data
					}
				}
			}
		}
	}
}

// tunnelAcceptLoop accepts TCP connections and multiplexes them over the shared WebSocket
func (m *Manager) tunnelAcceptLoop(ctx context.Context, listener net.Listener, tunnel *Tunnel) {
	defer listener.Close()
	defer m.CloseTunnel(tunnel.ID)

	for {
		select {
		case <-ctx.Done():
			return
		default:
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				default:
					time.Sleep(100 * time.Millisecond)
					continue
				}
			}

			// Allocate a channel number for this TCP client
			chanNum := uint16(atomic.AddUint32(&tunnel.nextChan, 1))

			// Create a channel for incoming data from WebSocket
			dataChan := make(chan []byte, 100)
			tunnel.channelMu.Lock()
			if tunnel.channels == nil {
				tunnel.channels = make(map[uint16]chan []byte)
			}
			tunnel.channels[chanNum] = dataChan
			tunnel.channelMu.Unlock()

			// Handle this TCP client
			go m.handleSharedTunnelConnection(ctx, conn, tunnel, chanNum, dataChan)
		}
	}
}

// handleSharedTunnelConnection handles a single TCP client using the shared WebSocket
func (m *Manager) handleSharedTunnelConnection(ctx context.Context, conn net.Conn, tunnel *Tunnel, chanNum uint16, dataChan chan []byte) {
	defer func() {
		conn.Close()
		// Remove our channel
		tunnel.channelMu.Lock()
		delete(tunnel.channels, chanNum)
		tunnel.channelMu.Unlock()
	}()

	// For protocols like VNC that don't send data first, send an empty init packet
	// to trigger the server-side Dial()
	if tunnel.Type == "VNC" {
		initData := tcpData{
			Version:   0,
			MappingID: 1,
			ChanNum:   chanNum,
			Data:      []byte{}, // Empty to trigger dial without sending data
		}
		initBytes, _ := json.Marshal(initData)

		tunnel.wsMu.Lock()
		err := sendWrappedMessage(tunnel.wsConn, initBytes, tunnel.config.Key, websocket.BinaryMessage)
		tunnel.wsMu.Unlock()
		if err != nil {
			fmt.Printf("TUNNEL[%s] ChanNum=%d: Failed to send init packet: %v\n", tunnel.ID, chanNum, err)
			return
		}
		fmt.Printf("TUNNEL[%s] ChanNum=%d: Init packet sent (VNC), starting bidirectional copy\n", tunnel.ID, chanNum)
	}

	done := make(chan struct{})

	// WebSocket -> TCP (via dataChan)
	go func() {
		defer close(done)
		for {
			select {
			case data, ok := <-dataChan:
				if !ok {
					return // Channel closed
				}
				if _, err := conn.Write(data); err != nil {
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	// TCP -> WebSocket
	buf := make([]byte, 64*1024)
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		default:
			conn.SetReadDeadline(time.Now().Add(30 * time.Second))
			n, err := conn.Read(buf)
			if n > 0 {
				td := tcpData{
					Version:   0,
					MappingID: 1,
					ChanNum:   chanNum,
					Data:      buf[:n],
				}
				tdBytes, _ := json.Marshal(td)

				tunnel.wsMu.Lock()
				err := sendWrappedMessage(tunnel.wsConn, tdBytes, tunnel.config.Key, websocket.BinaryMessage)
				tunnel.wsMu.Unlock()
				if err != nil {
					fmt.Printf("TUNNEL[%s] ChanNum=%d: WS write error: %v\n", tunnel.ID, chanNum, err)
					return
				}
			}
			if err != nil {
				if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
					continue
				}
				if err != io.EOF {
					fmt.Printf("TUNNEL[%s] ChanNum=%d: TCP read error: %v\n", tunnel.ID, chanNum, err)
				}
				return
			}
		}
	}
}

// handleWSClient handles a single WebSocket client using the shared WebSocket
func (m *Manager) handleWSClient(ctx context.Context, wsConn *websocket.Conn, tunnel *Tunnel) {
	conn := NewWSConnAdapter(wsConn)

	// Allocate a channel number for this client
	chanNum := uint16(atomic.AddUint32(&tunnel.nextChan, 1))

	// Create a channel for incoming data from WebSocket
	dataChan := make(chan []byte, 100)
	tunnel.channelMu.Lock()
	if tunnel.channels == nil {
		tunnel.channels = make(map[uint16]chan []byte)
	}
	tunnel.channels[chanNum] = dataChan
	tunnel.channelMu.Unlock()

	// Handle this client using the shared logic
	// Note: handleSharedTunnelConnection closes the connection when done
	go m.handleSharedTunnelConnection(ctx, conn, tunnel, chanNum, dataChan)
}
