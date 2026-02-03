package session

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/md5"
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

	// Stats (Atomic)
	bytesSent     int64
	bytesReceived int64
	lastActivity  int64 // Unix nano
}

type Manager struct {
	sessions    map[string]*CachedSession  // key is nodeID
	tunnels     map[string]*Tunnel         // key is tunnel ID
	collectJobs map[string]*CollectInfoJob // key is job ID
	mu          sync.RWMutex
	tunnelMu    sync.RWMutex
	collectMu   sync.RWMutex
}

func NewManager() *Manager {
	return &Manager{
		sessions:    make(map[string]*CachedSession),
		tunnels:     make(map[string]*Tunnel),
		collectJobs: make(map[string]*CollectInfoJob),
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

// InvalidateSession removes a session from the cache
func (m *Manager) InvalidateSession(nodeID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, nodeID)
	fmt.Printf("DEBUG: Invalidated cached session for %s\n", nodeID)
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

// Stats helpers
func (t *Tunnel) AddBytesSent(n int) {
	if n > 0 {
		atomic.AddInt64(&t.bytesSent, int64(n))
		atomic.StoreInt64(&t.lastActivity, time.Now().UnixNano())
	}
}

func (t *Tunnel) AddBytesReceived(n int) {
	if n > 0 {
		atomic.AddInt64(&t.bytesReceived, int64(n))
		atomic.StoreInt64(&t.lastActivity, time.Now().UnixNano())
	}
}

func (t *Tunnel) GetStats() (sent, received int64, lastActivity time.Time) {
	sent = atomic.LoadInt64(&t.bytesSent)
	received = atomic.LoadInt64(&t.bytesReceived)
	nano := atomic.LoadInt64(&t.lastActivity)
	if nano > 0 {
		lastActivity = time.Unix(0, nano)
	}
	return
}

// IsEncrypted returns whether the tunnel is using encryption
func (t *Tunnel) IsEncrypted() bool {
	if t.config == nil {
		return false
	}
	return t.config.Enc
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
	edgeViewVersion = "0.8.4"
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
func (m *Manager) StartProxy(ctx context.Context, config *zededa.SessionConfig, nodeID string, target string, protocol string, onProgress func(string)) (int, string, error) {
	// Helper to safely call progress callback
	reportProgress := func(msg string) {
		if onProgress != nil {
			onProgress(msg)
		}
	}

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

	// fmt.Printf("DEBUG: StartProxy called for node %s -> %s (protocol: %s). Initial InstID: %d (MaxInst: %d)\n", nodeID, target, protocol, initialInstID, config.MaxInst)

	for port := 9001; port <= 9010; port++ {
		listener, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			break
		}
	}

	if listener == nil {
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return 0, "", fmt.Errorf("failed to start local listener: %w", err)
		}
	}

	localPort := listener.Addr().(*net.TCPAddr).Port
	fmt.Printf("[%s] Tunnel listening on 127.0.0.1:%d for target %s (protocol: %s)\n", time.Now().Format("2006-01-02 15:04:05"), localPort, target, protocol)

	// Try to establish WebSocket and get tcpSetupOK with retries
	const maxRetries = 5
	var wsConn *websocket.Conn
	var clientIP string
	var lastErr error

	// Track which instances we've tried in the current attempt
	triedInstances := make(map[int]bool)
	currentInstID := initialInstID
	seenNoDeviceOnline := false

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			fmt.Printf("DEBUG: Retry attempt %d/%d for tunnel setup...\n", attempt, maxRetries)
			reportProgress(fmt.Sprintf("Retrying connection (attempt %d/%d)...", attempt, maxRetries))
		} else {
			reportProgress("Connecting to EdgeView...")
		}

		// Set the instance ID for this attempt
		config.InstID = currentInstID
		triedInstances[currentInstID] = true
		// fmt.Printf("DEBUG: Connecting to EdgeView with Enc=%v\n", config.Enc)

		// Connect to EdgeView
		wsConn, clientIP, err = m.connectToEdgeView(config)
		if err != nil {
			lastErr = fmt.Errorf("failed to connect to EdgeView: %w", err)
			if attempt < maxRetries {
				waitTime := time.Duration(attempt*2) * time.Second
				fmt.Printf("DEBUG: Connection failed, waiting %v before retry...\n", waitTime)
				reportProgress(fmt.Sprintf("Connection failed, retrying in %ds...", int(waitTime.Seconds())))
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

		if err := sendWrappedMessage(wsConn, queryBytes, config.Key, websocket.TextMessage, config.Enc); err != nil {
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
		// fmt.Printf("DEBUG: TCP command sent successfully (InstID: %d)\n", currentInstID)

		// Wait for +++tcpSetupOK+++ (with timeout)
		fmt.Printf("DEBUG: Waiting for tcpSetupOK from device (attempt %d/%d)...\n", attempt, maxRetries)
		reportProgress(fmt.Sprintf("Waiting for device confirmation (attempt %d/%d)...", attempt, maxRetries))
		setupErr := m.waitForTcpSetupOK(wsConn, config.Key, 30*time.Second, config.Enc)
		if setupErr == nil {
			// fmt.Println("DEBUG: tcpSetupOK received, tunnel established successfully!")
			break // Success
		}

		// Setup failed - check if it's "no device online" error
		if setupErr == ErrNoDeviceOnline {
			seenNoDeviceOnline = true
			fmt.Printf("DEBUG: Device is not online (attempt %d/%d). The device may not be connected to EdgeView yet.\n", attempt, maxRetries)
			reportProgress(fmt.Sprintf("Device not online yet (attempt %d/%d)...", attempt, maxRetries))
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
					reportProgress(fmt.Sprintf("Instance busy, switching to instance %d...", currentInstID))
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
			reportProgress(fmt.Sprintf("All instances busy, retrying (attempt %d/%d)...", attempt, maxRetries))
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
			reportProgress(fmt.Sprintf("Waiting %ds before retry...", int(waitTime.Seconds())))
			time.Sleep(waitTime)
		}
	}

	if wsConn == nil {
		listener.Close()
		// If we saw "no device online" at any point, prioritize that error to trigger session refresh
		if seenNoDeviceOnline || lastErr == ErrNoDeviceOnline {
			return 0, "", fmt.Errorf("device is not connected to EdgeView (no device online) after %d attempts", maxRetries)
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

	// Handle protocol-specific logic
	// "vnc" -> WebSocket listener (for in-app noVNC)
	// "vnc-tcp" -> TCP listener (for external VNC) but set Type="VNC" to send init packet
	// "ssh", "tcp" -> TCP listener

	if protocol == "vnc" {
		// Start HTTP server for WebSocket upgrades (In-App VNC)
		server := &http.Server{
			Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				upgrader := websocket.Upgrader{
					CheckOrigin: func(r *http.Request) bool { return true },
				}
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					// fmt.Printf("Failed to upgrade WS: %v\n", err)
					return
				}

				// Handle this client
				m.handleWSClient(tunnelCtx, conn, tunnel)
			}),
		}

		go func() {
			defer m.CloseTunnel(tunnel.ID)
			if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
				fmt.Printf("TUNNEL[%s] VNC server Error: %v\n", tunnel.ID, err)
			}
		}()

		// Ensure server is closed when context is done
		go func() {
			<-tunnelCtx.Done()
			server.Close()
		}()
	} else {
		// Start accepting TCP client connections (SSH, TCP, VNC-TCP)
		// For vnc-tcp, we already set Type="VNC" (via ToUpper of protocol? No, wait)

		// Fix: If protocol was "vnc-tcp", we want the tunnel.Type to be "VNC" so that
		// handleSharedTunnelConnection sends the init packet.
		if protocol == "vnc-tcp" {
			tunnel.Type = "VNC"
		}

		go m.tunnelAcceptLoop(tunnelCtx, listener, tunnel)
	}

	return localPort, tunnelID, nil
}

// waitForTcpSetupOK waits for the +++tcpSetupOK+++ message from EdgeView
func (m *Manager) waitForTcpSetupOK(wsConn *websocket.Conn, key string, timeout time.Duration, encrypt bool) error {
	setupDone := make(chan error, 1)
	go func() {
		for {
			_, msg, err := wsConn.ReadMessage()
			if err != nil {
				setupDone <- fmt.Errorf("ws read error waiting for tcpSetupOK: %w", err)
				return
			}

			// Log raw message length
			// fmt.Printf("DEBUG: waitForTcpSetupOK received raw message (len=%d)\n", len(msg))

			payload, err := unwrapMessage(msg, key, encrypt)
			if err != nil {
				// Check for specific errors returned by unwrapMessage
				if err == ErrBusyInstance {
					setupDone <- ErrBusyInstance
					return
				}
				if err == ErrNoDeviceOnline {
					// fmt.Printf("DEBUG: waitForTcpSetupOK received 'no device online'. Device not yet connected, continuing wait...\n")
					continue
				}

				// Check for plain-text errors in the raw message
				msgStr := string(msg)
				if strings.Contains(msgStr, "no device online") {
					continue
				}

				// FALLBACK: Check if the raw message contains tcpSetupOK
				// Some versions might send this as a raw text frame instead of enveloped
				if strings.Contains(msgStr, "+++tcpSetupOK+++") {
					fmt.Printf("DEBUG: Found tcpSetupOK in raw message (unwrap failed)\n")
					setupDone <- nil
					return
				}

				// Log unwrap failures but CONTINUE waiting unless it's a fatal error
				fmt.Printf("DEBUG: waitForTcpSetupOK unwrap failed: %v. Raw start: %.50q\n", err, msgStr)
				continue
			}

			payloadStr := string(payload)
			fmt.Printf("DEBUG: waitForTcpSetupOK payload: %q\n", payloadStr)

			if strings.Contains(payloadStr, "+++tcpSetupOK+++") {
				setupDone <- nil
				return
			}
			if strings.Contains(payloadStr, "+++Done+++") {
				setupDone <- fmt.Errorf("device closed connection before tcpSetupOK (Payload: %s)", payloadStr)
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
	sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i \"%s\" -p %d root@127.0.0.1", keyPath, port)

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

// GetContainerExecCommand generates the command to exec into a container shell.
// EVE-OS uses containerd, so we use `ctr t exec` to attach to running containers.
// The containerID should be the full container ID or name as known to containerd.
// Returns a command that can be run inside an SSH session to the EVE-OS host.
func GetContainerExecCommand(containerID string, shell string) string {
	if shell == "" {
		// Default to /bin/sh as it's more universally available in containers
		shell = "/bin/sh"
	}

	// Generate a unique exec-id based on timestamp to avoid conflicts
	execID := fmt.Sprintf("shell-%d", time.Now().UnixNano())

	// ctr command to exec into a container:
	// ctr -n <namespace> t exec -t --exec-id <id> <containerID> <shell>
	// For Docker Compose apps on EVE, containers typically run in the "eve" namespace
	// We try /bin/bash first, fall back to /bin/sh
	return fmt.Sprintf("ctr -n eve t exec -t --exec-id %s %s %s", execID, containerID, shell)
}

// GetDockerExecCommand generates the command to exec into a Docker container.
// This is used for APP_TYPE_DOCKER_COMPOSE applications where we tunnel to the
// app runtime and use the native docker CLI.
func GetDockerExecCommand(containerName string, shell string, appID string) string {
	if shell == "" {
		shell = "/bin/sh"
	}

	// For ZEDEDA Docker Compose apps, containers are often prefixed with the App Instance ID.
	// If appID is provided and the container name doesn't already start with it, prefix it.
	finalContainerName := containerName
	if appID != "" && !strings.HasPrefix(containerName, appID) {
		// Try hyphenated prefix first (standard ZEDEDA pattern)
		finalContainerName = fmt.Sprintf("%s-%s", appID, containerName)
	}

	// Standard docker exec command
	return fmt.Sprintf("docker exec -it %s %s", finalContainerName, shell)
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
	initialInstID := config.InstID
	currentInstID := initialInstID

	// Try with instance rotation if needed
	const maxRetries = 3
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		// fmt.Printf("DEBUG: ExecuteCommand (attempt %d/%d) using InstID %d (MaxInst: %d)\n", attempt+1, maxRetries, currentInstID, config.MaxInst)

		// 1. Compute token hash for the current instance
		tokenToHash := config.Token
		if currentInstID > 0 {
			tokenToHash = fmt.Sprintf("%s.%d", config.Token, currentInstID)
		}
		h := sha256.New()
		h.Write([]byte(tokenToHash))
		hash16 := h.Sum(nil)[:16]
		tokenHash := base64.RawURLEncoding.EncodeToString(hash16)

		// 2. Construct hostname (with instance if needed)
		hostname, _ := os.Hostname()
		if currentInstID > 0 {
			hostname += fmt.Sprintf("-inst-%d", currentInstID)
		}

		// 3. Prepare headers
		headers := http.Header{}
		headers.Add("X-Session-Token", tokenHash)
		headers.Add("X-Hostname", hostname)

		// 4. Connect to WebSocket
		tlsConfig := &tls.Config{InsecureSkipVerify: false}
		netDialer := &net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}
		dialer := &websocket.Dialer{
			TLSClientConfig: tlsConfig,
			NetDialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return netDialer.DialContext(ctx, "tcp4", addr)
			},
			HandshakeTimeout: 15 * time.Second, // Faster timeout for command connections
		}

		wsConn, _, err := dialer.Dial(config.URL, headers)
		if err != nil {
			lastErr = fmt.Errorf("failed to connect: %w", err)
			continue // Try next attempt/instance
		}

		// 5. Read initial message and check for immediate errors
		wsConn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, msg, err := wsConn.ReadMessage()
		if err != nil {
			wsConn.Close()
			lastErr = fmt.Errorf("failed to read initial message: %w", err)
			continue
		}

		// Check for plain-text errors in the first message (e.g., Busy Instance)
		if strings.Contains(string(msg), "can't have more than 2 peers") {
			wsConn.Close()
			// fmt.Printf("DEBUG: InstID %d busy. Rotating...\n", currentInstID)
			if config.MaxInst > 1 {
				currentInstID = (currentInstID + 1) % config.MaxInst

				// Update the cached session so the next command starts from the new instance ID
				m.mu.Lock()
				if cached, ok := m.sessions[nodeID]; ok {
					cached.Config.InstID = currentInstID
					// fmt.Printf("DEBUG: Updated cached session for node %s to start with InstID %d\n", nodeID, currentInstID)
				}
				m.mu.Unlock()
			}
			lastErr = ErrBusyInstance
			continue
		}

		// 6. Send command
		query := cmdOpt{
			Version: edgeViewVersion,
			System:  command, // "app", "log", etc.
			IsJSON:  false,   // app command returns plain text, not JSON
		}

		queryBytes, _ := json.Marshal(query)
		if err := sendWrappedMessage(wsConn, queryBytes, config.Key, websocket.TextMessage, config.Enc); err != nil {
			wsConn.Close()
			lastErr = fmt.Errorf("failed to send query: %w", err)
			continue
		}

		// 7. Read response loop
		wsConn.SetReadDeadline(time.Now().Add(30 * time.Second))

		var output strings.Builder
		messageCount := 0
		var commandErr error

		for {
			_, msg, err := wsConn.ReadMessage()
			if err != nil {
				// Connection closed or timeout - break and return what we have
				break
			}
			messageCount++

			// Try to unwrap the message
			unwrapped, err := unwrapMessage(msg, config.Key, config.Enc)
			if err == nil {
				output.Write(unwrapped)
			} else {
				// Handle specific errors returned by unwrapMessage
				if err == ErrBusyInstance {
					commandErr = ErrBusyInstance
					break
				}
				if err == ErrNoDeviceOnline {
					commandErr = ErrNoDeviceOnline
					break
				}
				// Other error, just log and append raw (e.g. banners)
				output.Write(msg)
			}
		}
		wsConn.Close()

		if commandErr == ErrBusyInstance {
			// fmt.Printf("DEBUG: InstID %d busy during execution. Rotating...\n", currentInstID)
			if config.MaxInst > 1 {
				currentInstID = (currentInstID + 1) % config.MaxInst
			}
			lastErr = ErrBusyInstance
			continue
		}
		if commandErr == ErrNoDeviceOnline {
			return "", ErrNoDeviceOnline
		}

		// Successfully read some output
		result := output.String()
		if command == "app" && strings.TrimSpace(result) == "+++Done+++" {
			// This often means we just missed the real data or the device is slow.
			// Treat as retry-able if we have attempts left.
			lastErr = fmt.Errorf("received empty app info")
			continue
		}

		return result, nil
	}

	return "", fmt.Errorf("failed to execute command after %d attempts: %w", maxRetries, lastErr)
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

		if err := sendWrappedMessage(wsConn, queryBytes, config.Key, websocket.TextMessage, config.Enc); err != nil {
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
			payload, unwrapErr := unwrapMessage(nextMsg, config.Key, config.Enc)
			if unwrapErr != nil {
				rawMsg := string(nextMsg)

				// Check for "no device online" error FIRST
				if strings.Contains(rawMsg, "no device online") {
					wsConn.Close()
					return "", fmt.Errorf("device is not connected to EdgeView (no device online)")
				}

				if strings.Contains(rawMsg, "can't have more than 2 peers") {
					// fmt.Printf("DEBUG: Instance %d is busy. Retrying...\n", config.InstID)
					wsConn.Close()

					// Increment InstID, respecting MaxInst limit
					config.InstID++
					if config.InstID >= config.MaxInst {
						return "", fmt.Errorf("all instances busy (tried up to %d of %d max)", config.InstID, config.MaxInst)
					}
					// fmt.Printf("DEBUG: Retrying with InstID=%d (MaxInst=%d)\n", config.InstID, config.MaxInst)
					continue // RETRY LOOP
				}
				// Other unwrap error?
			} else {
				// Valid payload. It might be the response we want!
				payloadStr := string(payload)
				// fmt.Printf("DEBUG: Received immediate payload (%d bytes)\n", len(payloadStr))
				// Show full output for debugging
				// fmt.Printf("DEBUG: FULL immediate payload:\n%s\n", payloadStr)

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
						// fmt.Printf("DEBUG: Returning JSON response immediately\n")
						wsConn.Close()
						return payloadStr, nil
					}
					// fmt.Printf("DEBUG: Payload doesn't look like JSON, continuing to read loop\n")
				} else {
					if len(payloadStr) > 0 {
						// fmt.Println("DEBUG: Requesting EdgeView session...")
						// fmt.Printf("DEBUG: Returning text response immediately\n")
						wsConn.Close()
						return payloadStr, nil
					}
					// fmt.Printf("DEBUG: Empty payload, continuing to read loop\n")
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
			payload, err := unwrapMessage(message, config.Key, config.Enc)
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

// sendWrappedMessage exactly matches original EdgeView crypto.go:64-84 (signAuthenData) and encryption logic
func sendWrappedMessage(conn *websocket.Conn, payload []byte, key string, messageType int, encrypt bool) error {
	envelope := envelopeMsg{}

	if encrypt {
		// Encrypt Data
		nonceHash := sha256.Sum256([]byte(key))
		viBytes := md5.Sum([]byte(key))

		// fmt.Printf("DEBUG: Encrypting with KeyLen=%d, NonceHash=%x, IV=%x\n", len(key), nonceHash[:4], viBytes[:4])

		block, err := aes.NewCipher(nonceHash[:])
		if err != nil {
			return fmt.Errorf("cipher init failed: %w", err)
		}

		cfb := cipher.NewCFBEncrypter(block, viBytes[:])
		cipherText := make([]byte, len(payload))
		cfb.XORKeyStream(cipherText, payload)

		envelope.Message = cipherText
		// Hash of ORIGINAL payload
		hash := sha256.Sum256(payload)
		envelope.Sha256Hash = hash // array assignment
	} else {
		// Sign Only
		envelope.Message = payload
		h := hmac.New(sha256.New, []byte(key))
		h.Write(envelope.Message)
		hash := h.Sum(nil)
		copy(envelope.Sha256Hash[:], hash)
	}

	// Marshal and send
	jdata, err := json.Marshal(envelope)
	if err != nil {
		return err
	}

	return conn.WriteMessage(messageType, jdata)
}

func unwrapMessage(data []byte, key string, encrypt bool) ([]byte, error) {
	// First, check for known plain-text error responses that are not
	// wrapped in the usual JSON+HMAC envelope.
	raw := string(data)
	if strings.Contains(raw, "no device online") {
		trimmed := strings.TrimSpace(raw)
		if len(trimmed) > 4096 {
			trimmed = trimmed[:4096] + "... (truncated)"
		}
		// fmt.Printf("DEBUG: unwrapMessage detected 'no device online' plain-text response: %s\n", trimmed)
		return nil, ErrNoDeviceOnline
	}

	if strings.Contains(raw, "can't have more than 2 peers") {
		fmt.Printf("DEBUG: unwrapMessage detected 'busy instance' plain-text response. Raw length: %d\n", len(raw))
		fmt.Printf("DEBUG: Raw payload: %q\n", raw)
		return nil, ErrBusyInstance
	}

	var envelope envelopeMsg
	if err := json.Unmarshal(data, &envelope); err != nil {
		// Log the full raw message (or a large prefix if extremely long)
		if len(raw) > 4096 {
			raw = raw[:4096] + "... (truncated)"
		}
		// fmt.Printf("DEBUG: unwrapMessage failed to unmarshal envelope. Raw data (len=%d): %s\n", len(data), raw)
		return nil, fmt.Errorf("failed to unmarshal envelope: %w", err)
	}

	if encrypt {
		// Decrypt first
		nonceHash := sha256.Sum256([]byte(key))
		viBytes := md5.Sum([]byte(key))

		block, err := aes.NewCipher(nonceHash[:])
		if err != nil {
			return nil, fmt.Errorf("cipher init failed: %w", err)
		}

		cfb := cipher.NewCFBDecrypter(block, viBytes[:])
		plainText := make([]byte, len(envelope.Message))
		cfb.XORKeyStream(plainText, envelope.Message)

		// Verify Hash (of decrypted payload)
		hash := sha256.Sum256(plainText)
		if !bytes.Equal(envelope.Sha256Hash[:], hash[:]) {
			return nil, fmt.Errorf("encrypted message hash verification failed")
		}

		return plainText, nil
	} else {
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
	headers.Add("X-EdgeView-Version", edgeViewVersion)

	// fmt.Printf("DEBUG: Connecting to %s (InstID: %d)\n", config.URL, config.InstID)
	// fmt.Printf("DEBUG: Headers - X-Hostname: %s, X-Session-Token (hash): %s, X-EdgeView-Version: %s\n", hostname, tokenHash, edgeViewVersion)

	// Connect to WebSocket
	tlsConfig := &tls.Config{
		InsecureSkipVerify: false,
	}
	netDialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	dialer := &websocket.Dialer{
		TLSClientConfig: tlsConfig,
		NetDialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return netDialer.DialContext(ctx, "tcp4", addr)
		},
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

	// Check for known error messages in the initial handshake
	if strings.Contains(initialMsg, "can't have more than 2 peers") {
		wsConn.Close()
		return nil, "", ErrBusyInstance
	}
	if strings.Contains(initialMsg, "no device online") {
		wsConn.Close()
		return nil, "", ErrNoDeviceOnline
	}

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

// attemptTunnelReconnect tries to re-establish the WebSocket connection for a tunnel
// when the device goes offline. Returns true if successful.
func (m *Manager) attemptTunnelReconnect(tunnel *Tunnel) bool {
	const maxReconnectAttempts = 3
	const reconnectDelay = 2 * time.Second

	for attempt := 1; attempt <= maxReconnectAttempts; attempt++ {
		fmt.Printf("TUNNEL[%s] Reconnect attempt %d/%d\n", tunnel.ID, attempt, maxReconnectAttempts)

		// Close old connection
		tunnel.wsMu.Lock()
		if tunnel.wsConn != nil {
			tunnel.wsConn.Close()
			tunnel.wsConn = nil
		}
		tunnel.wsMu.Unlock()

		// Wait before reconnecting
		time.Sleep(reconnectDelay * time.Duration(attempt))

		// Try to establish new connection
		wsConn, clientIP, err := m.connectToEdgeView(tunnel.config)
		if err != nil {
			fmt.Printf("TUNNEL[%s] Reconnect failed: %v\n", tunnel.ID, err)
			continue
		}

		// Send TCP tunnel command
		query := cmdOpt{
			Version:      edgeViewVersion,
			ClientEPAddr: clientIP,
			Network:      "tcp/" + tunnel.TargetIP,
			IsJSON:       false,
		}
		queryBytes, _ := json.Marshal(query)

		if err := sendWrappedMessage(wsConn, queryBytes, tunnel.config.Key, websocket.TextMessage, tunnel.config.Enc); err != nil {
			fmt.Printf("TUNNEL[%s] Reconnect: failed to send tcp command: %v\n", tunnel.ID, err)
			wsConn.Close()
			continue
		}

		// Wait for tcpSetupOK
		if err := m.waitForTcpSetupOK(wsConn, tunnel.config.Key, 30*time.Second, tunnel.config.Enc); err != nil {
			fmt.Printf("TUNNEL[%s] Reconnect: tcpSetupOK failed: %v\n", tunnel.ID, err)
			wsConn.Close()
			continue
		}

		// Success! Update tunnel with new connection
		tunnel.wsMu.Lock()
		tunnel.wsConn = wsConn
		tunnel.clientIP = clientIP
		tunnel.wsMu.Unlock()

		fmt.Printf("TUNNEL[%s] Reconnect successful!\n", tunnel.ID)
		return true
	}

	return false
}

// tunnelKeepAlive sends periodic application-level data to keep the tunnel alive.
// CRITICAL INSIGHTS from analyzing EdgeView source:
// 1. WebSocket PingMessage is ignored by Cloudflare/CDN (they only count data frames)
// 2. TextMessage with tcpData causes device to CLOSE the TCP server (edge-view.go:378-380)
// 3. Must use BinaryMessage for TCP data to be processed correctly
// 4. The DEVICE's keepalive is 90 seconds, but we see ~30s timeouts - cloud may be timing out device connection
func (m *Manager) tunnelKeepAlive(ctx context.Context, tunnel *Tunnel) {
	// Less aggressive: 30 seconds. The observed timeout is ~30-40s, so this should be safe
	// while avoiding flooding the device with keepalives.
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	fmt.Printf("TUNNEL[%s] Keep-alive started (30s BinaryMessage)\n", tunnel.ID)

	keepaliveCount := 0
	for {
		select {
		case <-ctx.Done():
			fmt.Printf("TUNNEL[%s] Keep-alive stopped (context done) after %d keepalives\n", tunnel.ID, keepaliveCount)
			return
		case <-ticker.C:
			tunnel.wsMu.Lock()
			if tunnel.wsConn == nil {
				tunnel.wsMu.Unlock()
				fmt.Printf("TUNNEL[%s] Keep-alive: wsConn is nil (reconnecting?)\n", tunnel.ID)
				continue
			}

			// Find an active channel if one exists, otherwise use 1
			tunnel.channelMu.RLock()
			var activeChan uint16 = 1
			hasChannels := len(tunnel.channels) > 0
			for chanNum := range tunnel.channels {
				activeChan = chanNum
				break
			}
			tunnel.channelMu.RUnlock()

			// Only send keepalive if we have active channels (i.e. an active session using the tunnel)
			// Sending keepalives to an idle tunnel might be confusing the device if it expects data.
			// Actually, EdgeView tunnel logic often requires keepalive on the WebSocket itself.
			// The protocol wrapper (sendWrappedMessage) handles the WebSocket level.
			// Sending tcpData with empty payload is a specific "tunnel application" keepalive.

			// CRITICAL: BinaryMessage with valid channel and empty data
			keepaliveData := tcpData{
				Version:   0,
				MappingID: 1,
				ChanNum:   activeChan,
				Data:      []byte{},
			}
			dataBytes, _ := json.Marshal(keepaliveData)
			err := sendWrappedMessage(tunnel.wsConn, dataBytes, tunnel.config.Key, websocket.BinaryMessage, tunnel.config.Enc)
			tunnel.wsMu.Unlock()

			if err != nil {
				fmt.Printf("TUNNEL[%s] Keep-alive #%d FAILED: %v\n", tunnel.ID, keepaliveCount, err)
				// Don't fail the tunnel immediately on keepalive failure, let the read loop handle disconnects
				// m.FailTunnel(tunnel.ID, err)
				// return
			} else {
				keepaliveCount++
				// Log less frequently
				if keepaliveCount <= 5 || keepaliveCount%20 == 0 {
					fmt.Printf("TUNNEL[%s] Keep-alive #%d sent (chan=%d, hasChannels=%v)\n", tunnel.ID, keepaliveCount, activeChan, hasChannels)
				}
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
			// Send graceful close message using WebSocket Close frame
			// This ensures EdgeView dispatcher knows we're disconnecting intentionally
			fmt.Printf("TUNNEL[%s] Sending WebSocket close frame for graceful shutdown\n", tunnel.ID)
			closeMsg := websocket.FormatCloseMessage(websocket.CloseNormalClosure, "client closing tunnel")
			tunnel.wsConn.WriteControl(websocket.CloseMessage, closeMsg, time.Now().Add(time.Second))
			// Give device time to process close frame before forceful close
			time.Sleep(100 * time.Millisecond)
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

					// Attempt reconnect for abnormal closures (1006) or unexpected EOFs
					// This handles network blips or cloud load balancer timeouts.
					fmt.Printf("TUNNEL[%s] Attempting reconnection after WS error...\n", tunnel.ID)
					if m.attemptTunnelReconnect(tunnel) {
						fmt.Printf("TUNNEL[%s] Reconnection successful, resuming reader loop\n", tunnel.ID)
						continue
					}

					m.FailTunnel(tunnel.ID, err)
				}
				return
			}

			payload, err := unwrapMessage(msg, tunnel.config.Key, tunnel.config.Enc)
			if err != nil {
				// Check for 'no device online' - this means the EdgeView dispatcher
				// lost connection to the device. We need to attempt reconnection.
				if strings.Contains(string(msg), "no device online") {
					fmt.Printf("TUNNEL[%s] Device offline, attempting reconnection...\n", tunnel.ID)

					// Try to reconnect
					if m.attemptTunnelReconnect(tunnel) {
						fmt.Printf("TUNNEL[%s] Reconnection successful, resuming\n", tunnel.ID)
						continue
					} else {
						fmt.Printf("TUNNEL[%s] Reconnection failed, closing tunnel\n", tunnel.ID)
						m.FailTunnel(tunnel.ID, ErrNoDeviceOnline)
						return
					}
				}
				continue
			}

			// Check for control messages
			// NOTE: We only close on +++tcpDone+++ which is the TCP-specific termination signal.
			// +++Done+++ is a generic command output marker and should be IGNORED for TCP tunnels.
			// The info banner from EdgeView ends with +++Done+++ but that does NOT mean the tunnel should close.
			payloadStr := string(payload)
			if strings.Contains(payloadStr, "+++tcpDone+++") {
				fmt.Printf("TUNNEL[%s] Received tcpDone message, closing\n", tunnel.ID)
				return
			}
			// Log when we see +++Done+++ but explicitly ignore it for TCP tunnels
			if strings.Contains(payloadStr, "+++Done+++") {
				fmt.Printf("TUNNEL[%s] Ignoring +++Done+++ message (not +++tcpDone+++)\n", tunnel.ID)
				continue
			}

			// Check for 'Device IPs:' banner which indicates session reset/info
			// If we receive this in the middle of a session, it means the session likely reset
			// and we need to re-establish the tunnel logic.
			if strings.Contains(payloadStr, "Device IPs:") {
				fmt.Printf("TUNNEL[%s] Received session banner (Device IPs). Ignoring to prevent disconnects.\n", tunnel.ID)
				// Previously we treated this as a reset and reconnected, but that caused
				// stable connections to drop if the banner was sent harmlessly (e.g. status update).
				// We now ignore it and let the connection persist.
				continue
			}

			// Parse tcpData
			var td tcpData
			if err := json.Unmarshal(payload, &td); err != nil {
				fmt.Printf("TUNNEL[%s] Failed to parse tcpData: %v. Payload: %q\n", tunnel.ID, err, payloadStr)
				continue // Not tcpData, skip
			}
			// Data received for channel

			if len(td.Data) > 0 {
				tunnel.AddBytesReceived(len(td.Data))

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
	// For protocols like VNC that don't send data first, send an empty init packet
	// to trigger the server-side Dial()
	// UPDATE: Doing this for ALL protocols (SSH included) to ensure the remote
	// socket is open before we send real data. If the first packet is consumed
	// for setup, we don't want it to contain the SSH handshake.

	// Wait a bit to ensure the device has finished setting up the TCP server structures
	time.Sleep(200 * time.Millisecond)

	// RESTORED Init Packet
	// Send empty tcpData to trigger the server-side Dial() for protocols like VNC
	// that don't send data first.
	initMsg := tcpData{
		Version:   0,
		MappingID: 1,
		ChanNum:   chanNum,
		Data:      []byte{},
	}
	initBytes, _ := json.Marshal(initMsg)

	tunnel.wsMu.Lock()
	if tunnel.wsConn != nil {
		if err := sendWrappedMessage(tunnel.wsConn, initBytes, tunnel.config.Key, websocket.BinaryMessage, tunnel.config.Enc); err != nil {
			fmt.Printf("TUNNEL[%s] ChanNum=%d: Failed to send init packet: %v\n", tunnel.ID, chanNum, err)
		} else {
			// fmt.Printf("TUNNEL[%s] ChanNum=%d: Sent init packet (empty tcpData)\n", tunnel.ID, chanNum)
		}
	}
	tunnel.wsMu.Unlock()

	done := make(chan struct{})

	// WebSocket -> TCP (via dataChan)
	go func() {
		defer func() {
			// fmt.Printf("TUNNEL[%s] ChanNum=%d: WS->TCP goroutine exiting\n", tunnel.ID, chanNum)
			close(done)
		}()

		var lastPacket []byte
		packetCount := 0
		for {
			select {
			case data, ok := <-dataChan:
				if !ok {
					// fmt.Printf("TUNNEL[%s] ChanNum=%d: dataChan closed, WS->TCP ending\n", tunnel.ID, chanNum)
					return // Channel closed
				}

				// Deduplicate consecutive packets (specifically for SSH version string issues)
				if bytes.Equal(data, lastPacket) {
					// Check if it's an SSH version string
					if len(data) > 4 && string(data[:4]) == "SSH-" {
						// fmt.Printf("TUNNEL[%s] ChanNum=%d: Dropping duplicate SSH version string packet\n", tunnel.ID, chanNum)
						continue
					}
				}
				lastPacket = make([]byte, len(data))
				copy(lastPacket, data)

				packetCount++

				if _, err := conn.Write(data); err != nil {
					fmt.Printf("TUNNEL[%s] ChanNum=%d: WS->TCP write error: %v\n", tunnel.ID, chanNum, err)
					return
				}
			case <-ctx.Done():
				// fmt.Printf("TUNNEL[%s] ChanNum=%d: Context done, WS->TCP ending\n", tunnel.ID, chanNum)
				return
			}
		}
	}()

	// TCP -> WebSocket
	// Note: For VNC and similar protocols, the server sends data first.
	// The client (noVNC) may not send any data until it receives the RFB handshake.
	// Therefore, we use a longer timeout or no timeout at all.
	buf := make([]byte, 64*1024)
	for {
		select {
		case <-ctx.Done():
			fmt.Printf("TUNNEL[%s] ChanNum=%d: Context done in TCP->WS loop\n", tunnel.ID, chanNum)
			return
		case <-done:
			fmt.Printf("TUNNEL[%s] ChanNum=%d: Done channel signaled in TCP->WS loop\n", tunnel.ID, chanNum)
			return
		default:
			// For VNC tunnels, use a very long timeout (5 minutes) since the user
			// might not interact for a while. For other protocols, 30 seconds is fine.
			timeout := 30 * time.Second
			if tunnel.Type == "VNC" {
				timeout = 5 * time.Minute
			}
			conn.SetReadDeadline(time.Now().Add(timeout))
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
				// Check if connection is being re-established
				if tunnel.wsConn == nil {
					tunnel.wsMu.Unlock()
					fmt.Printf("TUNNEL[%s] ChanNum=%d: WS connection is nil (reconnecting), dropping packet\n", tunnel.ID, chanNum)
					continue
				}

				err := sendWrappedMessage(tunnel.wsConn, tdBytes, tunnel.config.Key, websocket.BinaryMessage, tunnel.config.Enc)
				tunnel.wsMu.Unlock()
				if err != nil {
					fmt.Printf("TUNNEL[%s] ChanNum=%d: WS write error: %v\n", tunnel.ID, chanNum, err)
					return
				}

				// Update stats
				tunnel.AddBytesSent(n)

			}
			if err != nil {
				if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
					continue
				}
				if err != io.EOF {
					fmt.Printf("TUNNEL[%s] ChanNum=%d: TCP read error: %v\n", tunnel.ID, chanNum, err)
				} else {
					fmt.Printf("TUNNEL[%s] ChanNum=%d: TCP EOF (client disconnected)\n", tunnel.ID, chanNum)
				}
				return
			}
		}
	}
}

// handleWSClient handles a single WebSocket client using the shared WebSocket
func (m *Manager) handleWSClient(ctx context.Context, wsConn *websocket.Conn, tunnel *Tunnel) {
	fmt.Printf("TUNNEL[%s] New VNC WebSocket client connected from %s\n", tunnel.ID, wsConn.RemoteAddr())
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
