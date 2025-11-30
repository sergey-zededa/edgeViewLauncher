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

// StartProxy starts a local TCP listener that proxies to the EdgeView WebSocket
// Returns the local port number and tunnel ID. Tunnels are keyed by the
// ZEDEDA device node ID so they can be listed per-device from the UI.
func (m *Manager) StartProxy(ctx context.Context, config *zededa.SessionConfig, nodeID string, target string) (int, string, error) {
	// ALWAYS use InstID=2 to avoid conflicts with reference client (usually uses 1)
	// and to avoid session conflicts when creating fresh sessions
	config.InstID = 2
	config.MaxInst = 3

	// Start local TCP listener
	// Try preferred ports 9001-9010 first (matching reference client behavior)
	var listener net.Listener
	var err error

	for port := 9001; port <= 9010; port++ {
		listener, err = net.Listen("tcp", fmt.Sprintf("localhost:%d", port))
		if err == nil {
			break
		}
	}

	// Fallback to random port if preferred ports are taken
	if listener == nil {
		listener, err = net.Listen("tcp", "localhost:0")
		if err != nil {
			return 0, "", fmt.Errorf("failed to start local listener: %w", err)
		}
	}

	localPort := listener.Addr().(*net.TCPAddr).Port
	fmt.Printf("[%s] Persistent Proxy listening on localhost:%d for target %s\n", time.Now().Format("2006-01-02 15:04:05"), localPort, target)

	// Create Tunnel
	// Generate a simple unique ID
	tunnelID := fmt.Sprintf("tunnel-%d", time.Now().UnixNano())

	// Create a background context for the tunnel (independent of the request context)
	tunnelCtx, cancel := context.WithCancel(context.Background())

	// IMPORTANT: key the tunnel by the ZEDEDA device nodeID, not the
	// session UUID, so that /api/tunnels?nodeId=<deviceId> returns the
	// expected per-device tunnel list in the UI.
	tunnel := &Tunnel{
		ID:        tunnelID,
		NodeID:    nodeID,
		TargetIP:  target, // Storing full target string for now (ip:port)
		LocalPort: localPort,
		Type:      "TCP", // Default type for generic tunnels
		CreatedAt: time.Now(),
		Cancel:    cancel,
		Status:    "active",
		Error:     "",
	}

	// Register Tunnel
	fmt.Printf("DEBUG: Registering tunnel %s for nodeID %s target %s on localhost:%d\n", tunnelID, nodeID, target, localPort)
	m.RegisterTunnel(tunnel)

	// Start Accept Loop in background
	go m.tunnelAcceptLoop(tunnelCtx, listener, config, target, tunnelID)

	return localPort, tunnelID, nil
}

// LaunchTerminal opens a new terminal window with the SSH command
func (m *Manager) LaunchTerminal(port int, keyPath string) error {
	sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i %s -p %d root@localhost", keyPath, port)

	// Launch Terminal.app on macOS
	cmd := exec.Command("osascript", "-e", fmt.Sprintf(`tell application "Terminal" to do script "%s"`, sshCmd))
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
	startInstID := config.InstID

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

					// Default to Instance 2 to avoid conflict with reference client (usually Inst 1)
					// and to avoid "zombie" sessions from previous failed attempts
					config.InstID = 2
					config.MaxInst = 3 // Assuming standard limit
					maxLimit := config.MaxInst
					if maxLimit == 0 {
						maxLimit = startInstID + 5
					}

					if config.InstID > maxLimit {
						return "", fmt.Errorf("all instances busy (tried up to %d)", maxLimit)
					}
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

// handleTunnelConnection handles a single TCP client connection for a persistent tunnel
func (m *Manager) handleTunnelConnection(ctx context.Context, conn net.Conn, config *zededa.SessionConfig, target string, tunnelID string) {
	const tunnelDebug = false

	defer conn.Close()

	remoteAddr := conn.RemoteAddr()
	fmt.Printf("TUNNEL[%s] New TCP client from %s -> target %s (InstID=%d)\n", tunnelID, remoteAddr, target, config.InstID)

	var bytesTCPToWS int64
	var bytesWSToTCP int64

	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		// Create a cancellable context for this attempt's proxy loops
		proxyCtx, proxyCancel := context.WithCancel(ctx)

		// 1. Connect to EdgeView
		fmt.Printf("TUNNEL[%s] Connecting to EdgeView URL=%s (InstID=%d) (Attempt %d/%d)\n", tunnelID, config.URL, config.InstID, attempt, maxRetries)
		wsConn, clientIP, err := m.connectToEdgeView(config)
		if err != nil {
			fmt.Printf("TUNNEL[%s] ERROR: Failed to connect to EdgeView: %v\n", tunnelID, err)
			proxyCancel()
			if attempt < maxRetries {
				time.Sleep(1 * time.Second)
				continue
			}
			m.FailTunnel(tunnelID, err)
			return
		}

		// 2. Send Initial Query
		query := cmdOpt{
			Version:      edgeViewVersion,
			ClientEPAddr: clientIP,
			Network:      "tcp/" + target,
			IsJSON:       false, // Must be false for TCP tunnels
		}

		queryBytes, err := json.Marshal(query)
		if err != nil {
			fmt.Printf("TUNNEL[%s] ERROR: Failed to marshal query: %v\n", tunnelID, err)
			wsConn.Close()
			proxyCancel()
			m.FailTunnel(tunnelID, err)
			return
		}

		fmt.Printf("TUNNEL[%s] Sending EdgeView tcp query: %s\n", tunnelID, query.Network)
		if err := sendWrappedMessage(wsConn, queryBytes, config.Key, websocket.TextMessage); err != nil {
			fmt.Printf("TUNNEL[%s] ERROR: Failed to send query: %v\n", tunnelID, err)
			wsConn.Close()
			proxyCancel()
			if attempt < maxRetries {
				time.Sleep(1 * time.Second)
				continue
			}
			m.FailTunnel(tunnelID, err)
			return
		}
		fmt.Printf("TUNNEL[%s] Initial tcp query sent - starting proxy loops\n", tunnelID)

		// 3. Start Bidirectional Proxy
		errChan := make(chan error, 2)

		// Shared state for setup completion (accessed by both goroutines)
		var tcpSetupComplete int32 // 0 = false, 1 = true (atomic)

		// Buffer for data received before setup completes (for SSH clients that send immediately)
		var preSetupBuffer []byte
		var preSetupMutex sync.Mutex

		// TCP -> WebSocket
		go func() {
			defer proxyCancel() // Ensure cleanup if this loop exits
			buf := make([]byte, 64*1024)
			for {
				select {
				case <-proxyCtx.Done():
					return
				default:
					// Use deadline to make Read interruptible
					conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
					n, err := conn.Read(buf)
					if n > 0 {
						// fmt.Printf("TUNNEL[%s] DEBUG: TCP->WS Read %d bytes\n", tunnelID, n)

						// Wait for setup to complete before forwarding data
						// This prevents SSH clients from sending data before initialization packet
						if atomic.LoadInt32(&tcpSetupComplete) == 0 {
							// fmt.Printf("TUNNEL[%s] DEBUG: Buffering %d bytes - waiting for tcpSetupComplete\n", tunnelID, n)
							preSetupMutex.Lock()
							preSetupBuffer = append(preSetupBuffer, buf[:n]...)
							preSetupMutex.Unlock()
							continue
						}

						// Check if we have buffered data to send first
						preSetupMutex.Lock()
						if len(preSetupBuffer) > 0 {
							// fmt.Printf("TUNNEL[%s] DEBUG: Sending %d buffered bytes first\n", tunnelID, len(preSetupBuffer))

							// Send buffered data
							td := tcpData{
								Version:   0,
								MappingID: 1,
								ChanNum:   1,
								Data:      preSetupBuffer,
							}
							tdBytes, _ := json.Marshal(td)
							if err := sendWrappedMessage(wsConn, tdBytes, config.Key, websocket.BinaryMessage); err != nil {
								preSetupMutex.Unlock()
								fmt.Printf("TUNNEL[%s] ERROR: ws write error sending buffered data: %v\n", tunnelID, err)
								errChan <- fmt.Errorf("ws write error: %w", err)
								return
							}
							atomic.AddInt64(&bytesTCPToWS, int64(len(preSetupBuffer)))
							// fmt.Printf("TUNNEL[%s] DEBUG: Sent %d buffered bytes to WS (Binary)\n", tunnelID, len(preSetupBuffer))

							// Clear buffer
							preSetupBuffer = nil
						}
						preSetupMutex.Unlock()

						atomic.AddInt64(&bytesTCPToWS, int64(n))

						// Wrap in tcpData struct (matching EVE protocol)
						td := tcpData{
							Version:   0, // MUST be 0 to match EVE reference
							MappingID: 1, // MUST be 1 for single mapping
							ChanNum:   1, // MUST be 1 for single channel
							Data:      buf[:n],
						}
						tdBytes, _ := json.Marshal(td)

						// Debug: Print payload
						// fmt.Printf("TUNNEL[%s] DEBUG: Sending tcpData: %s\n", tunnelID, string(tdBytes))

						// Send as BinaryMessage (required by EVE for tcpData)
						if err := sendWrappedMessage(wsConn, tdBytes, config.Key, websocket.BinaryMessage); err != nil {
							fmt.Printf("TUNNEL[%s] ERROR: ws write error after sending %d bytes TCP->WS: %v\n", tunnelID, atomic.LoadInt64(&bytesTCPToWS), err)
							errChan <- fmt.Errorf("ws write error: %w", err)
							return
						}
						// fmt.Printf("TUNNEL[%s] DEBUG: Sent %d bytes to WS (Binary)\n", tunnelID, n)
					}
					if err != nil {
						if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
							// Timeout is expected, check context and continue
							if proxyCtx.Err() != nil {
								return
							}
							continue
						}
						if err != io.EOF {
							fmt.Printf("TUNNEL[%s] ERROR: tcp read error after %d bytes TCP->WS: %v\n", tunnelID, atomic.LoadInt64(&bytesTCPToWS), err)
							errChan <- fmt.Errorf("tcp read error: %w", err)
						} else {
							fmt.Printf("TUNNEL[%s] TCP client closed connection (EOF) after %d bytes TCP->WS\n", tunnelID, atomic.LoadInt64(&bytesTCPToWS))
							errChan <- fmt.Errorf("EOF")
						}
						return
					}
				}
			}
		}()

		// WebSocket -> TCP
		go func() {
			defer proxyCancel()
			for {
				select {
				case <-proxyCtx.Done():
					return
				default:
					_, message, err := wsConn.ReadMessage()
					// fmt.Printf("TUNNEL[%s] DEBUG: WebSocket ReadMessage returned: size=%d, err=%v\n", tunnelID, len(message), err)
					if err != nil {
						// If context is cancelled, ignore read error
						if proxyCtx.Err() != nil {
							return
						}
						fmt.Printf("TUNNEL[%s] ERROR: ws read error after WS->TCP=%d, TCP->WS=%d bytes: %v\n", tunnelID, atomic.LoadInt64(&bytesWSToTCP), atomic.LoadInt64(&bytesTCPToWS), err)
						errChan <- fmt.Errorf("ws read error: %w", err)
						return
					}

					// Unwrap
					payload, err := unwrapMessage(message, config.Key)
					// fmt.Printf("TUNNEL[%s] DEBUG: unwrapMessage returned: payloadSize=%d, err=%v\n", tunnelID, len(payload), err)
					if err != nil {
						// Treat explicit "no device online" as a fatal error for this tunnel (trigger retry)
						if errors.Is(err, ErrNoDeviceOnline) || strings.Contains(string(message), "no device online") {
							// fmt.Printf("TUNNEL[%s] DEBUG: EdgeView reported 'no device online' for tunnel\n", tunnelID)
							errChan <- ErrNoDeviceOnline
							return
						}

						// fmt.Printf("TUNNEL[%s] DEBUG: unwrapMessage failed (non-enveloped or corrupt frame): %v\n", tunnelID, err)
						continue
					}

					// Detect control messages such as +++Done+++ that are not tcpData
					trimmed := strings.TrimSpace(string(payload))
					if trimmed == "+++Done+++" {
						// fmt.Printf("TUNNEL[%s] DEBUG: Received EdgeView close marker '+++Done+++'; stopping WS->TCP loop\n", tunnelID)
						errChan <- io.EOF
						return
					}

					if strings.Contains(trimmed, "+++tcpSetupOK+++") {
						if tunnelDebug {
							fmt.Printf("TUNNEL[%s] DEBUG: Received tcpSetupOK banner - TCP relay is now active\n", tunnelID)
						}
						atomic.StoreInt32(&tcpSetupComplete, 1)

						// CRITICAL: Send initialization packet to trigger server-side Dial()
						// The EVE protocol requires the CLIENT to send first data packet
						// For VNC (and other protocols), this triggers the server to connect to the target
						// See eve/edgeview-client/tcp.go lines 189-197 (justEnterVNC flag)

						// Add delay to avoid race condition where server prints tcpSetupOK before initializing maps
						time.Sleep(1 * time.Second)

						initData := tcpData{
							Version:   0,        // Zero value - matches EVE implementation
							MappingID: 1,        // First mapping
							ChanNum:   1,        // First channel
							Data:      []byte{}, // EMPTY - triggers server Dial without sending data to target
						}
						initBytes, _ := json.Marshal(initData)

						// Add small delay to avoid overwhelming EVE
						time.Sleep(100 * time.Millisecond)

						if err := sendWrappedMessage(wsConn, initBytes, config.Key, websocket.BinaryMessage); err != nil {
							fmt.Printf("TUNNEL[%s] ERROR: Failed to send initialization packet: %v\n", tunnelID, err)
							errChan <- err
							return
						}

						continue
					}

					// After setup is complete, EdgeView sends tcpData JSON frames for
					// TCP payload. We should NEVER forward arbitrary non-tcpData payloads
					// directly to the SSH/VNC client, since those can contain control
					// messages (e.g. +++tcpSetupOK+++, diagnostics) rather than raw
					// application bytes. Doing so corrupts the SSH handshake and
					// results in errors like "invalid packet length" or "message
					// authentication code incorrect".
					var td tcpData
					if err := json.Unmarshal(payload, &td); err != nil {
						// Not a tcpData frame – treat as a control/diagnostic message
						// and DO NOT forward it to the TCP client.
						if tunnelDebug {
							prefix := string(payload)
							if len(prefix) > 200 {
								prefix = prefix[:200] + "..."
							}
							fmt.Printf("TUNNEL[%s] DEBUG: Ignoring non-tcpData payload (setupComplete=%d): %q\n", tunnelID, atomic.LoadInt32(&tcpSetupComplete), prefix)
						}
						continue
					}
					
					// JSON tcpData received (used for single or multiple TCP targets)
					if len(td.Data) > 0 {
						// CRITICAL: Only forward data AFTER tcpSetupComplete is set
						// This prevents early tcpData frames (if any) from corrupting the SSH handshake
						if atomic.LoadInt32(&tcpSetupComplete) == 0 {
							if tunnelDebug {
								fmt.Printf("TUNNEL[%s] DEBUG: Ignoring tcpData (%d bytes) before tcpSetupComplete\n", tunnelID, len(td.Data))
							}
							continue
						}
						atomic.AddInt64(&bytesWSToTCP, int64(len(td.Data)))
						
						_, err := conn.Write(td.Data)
						if err != nil {
							fmt.Printf("TUNNEL[%s] ERROR: tcp write error after WS->TCP=%d bytes: %v\\n", tunnelID, atomic.LoadInt64(&bytesWSToTCP), err)
							errChan <- err
							return
						}
					}
				}
			}
		}()

		// Wait for error or context cancel
		select {
		case err := <-errChan:
			proxyCancel() // Stop the loops
			wsConn.Close()

			// Check if this was a "device not ready" error (+++Done+++ before tcpSetupOK)
			// This happens when device hasn't established EdgeView connection yet
			if err == io.EOF && atomic.LoadInt32(&tcpSetupComplete) == 0 {
				fmt.Printf("TUNNEL[%s] WARNING: Device not ready yet (got +++Done+++ before tcpSetupOK)\\n", tunnelID)
				if attempt < maxRetries {
					// Wait longer for device to come online (exponential backoff)
					// Use a larger base delay to give the device more time between retries,
					// especially for SSH where the daemon may start slowly under load.
					waitTime := time.Duration(attempt*10) * time.Second
					fmt.Printf("TUNNEL[%s] WARNING: Retrying in %v... (Attempt %d/%d)\n", tunnelID, waitTime, attempt, maxRetries)
					time.Sleep(waitTime)
					continue // Retry the outer loop
				}
				m.FailTunnel(tunnelID, fmt.Errorf("device did not come online after %d attempts", maxRetries))
				return // Exit the function
			}

			// Check if we should retry for ErrNoDeviceOnline
			if errors.Is(err, ErrNoDeviceOnline) {
				fmt.Printf("TUNNEL[%s] WARNING: EdgeView session failed with 'no device online'. Retrying... (Attempt %d/%d)\n", tunnelID, attempt, maxRetries)
				if attempt < maxRetries {
					time.Sleep(1 * time.Second)
					continue // Retry the outer loop
				}
			}

			// Fatal error or max retries reached
			if err != io.EOF {
				fmt.Printf("TUNNEL[%s] Connection closed with error: %v\n", tunnelID, err)
				m.FailTunnel(tunnelID, err) // Fail the tunnel on a non-retryable error
			} else {
				fmt.Printf("TUNNEL[%s] Connection closed cleanly\n", tunnelID)
			}
			proxyCancel()
			wsConn.Close()
			return // Exit the function

		case <-ctx.Done():
			fmt.Printf("TUNNEL[%s] Context cancelled, closing tunnel\n", tunnelID)
			proxyCancel()
			wsConn.Close()
			return // Exit the function
		}
	}
}

// tunnelAcceptLoop accepts connections for a persistent tunnel
func (m *Manager) tunnelAcceptLoop(ctx context.Context, listener net.Listener, config *zededa.SessionConfig, target string, tunnelID string) {
	defer listener.Close()
	defer m.CloseTunnel(tunnelID)

	fmt.Printf("DEBUG: Tunnel %s listening on %s\n", tunnelID, listener.Addr())

	for {
		select {
		case <-ctx.Done():
			fmt.Printf("DEBUG: Tunnel %s closed\n", tunnelID)
			return
		default:
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				default:
					// Accept error - likely listener closed
					time.Sleep(100 * time.Millisecond)
					continue
				}
			}

			// Handle connection in background
			go m.handleTunnelConnection(ctx, conn, config, target, tunnelID)
		}
	}
}
