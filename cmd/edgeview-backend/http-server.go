package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"edgeViewLauncher/internal/config"
	"edgeViewLauncher/internal/session"
	sshInternal "edgeViewLauncher/internal/ssh"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

type HTTPServer struct {
	app  *App
	port int
}

func NewHTTPServer(port int) *HTTPServer {
	return &HTTPServer{
		app:  NewApp(),
		port: port,
	}
}

// Request/Response types
type SearchNodesRequest struct {
	Query string `json:"query"`
}

type ConnectRequest struct {
	NodeID           string `json:"nodeId"`
	UseInAppTerminal bool   `json:"useInApp"`
}

type SaveSettingsRequest struct {
	Clusters      []config.ClusterConfig `json:"clusters"`
	ActiveCluster string                 `json:"activeCluster"`
}

type NodeIDRequest struct {
	NodeID   string `json:"nodeId"`
	NodeName string `json:"nodeName"` // Optional, used for some API calls
}

type SetVGAEnabledRequest struct {
	NodeID  string `json:"nodeId"`
	Enabled bool   `json:"enabled"`
}

type SetUSBEnabledRequest struct {
	NodeID  string `json:"nodeId"`
	Enabled bool   `json:"enabled"`
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func (s *HTTPServer) handleSearchNodes(w http.ResponseWriter, r *http.Request) {
	var req SearchNodesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	nodes, err := s.app.SearchNodes(req.Query)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, nodes)
}

func (s *HTTPServer) handleConnect(w http.ResponseWriter, r *http.Request) {
	var req ConnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	result, err := s.app.ConnectToNode(req.NodeID, req.UseInAppTerminal)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]string{"message": result})
}

func (s *HTTPServer) handleGetSettings(w http.ResponseWriter, _ *http.Request) {
	settings := s.app.GetSettings()
	s.sendSuccess(w, settings)
}

func (s *HTTPServer) handleGetUserInfo(w http.ResponseWriter, r *http.Request) {
	userInfo := s.app.GetUserInfo()
	s.sendSuccess(w, userInfo)
}

func (s *HTTPServer) handleGetEnterprise(w http.ResponseWriter, r *http.Request) {
	ent, err := s.app.GetEnterprise()
	if err != nil {
		s.sendError(w, err)
		return
	}
	s.sendSuccess(w, ent)
}

func (s *HTTPServer) handleGetProjects(w http.ResponseWriter, r *http.Request) {
	proj, err := s.app.GetProjects()
	if err != nil {
		s.sendError(w, err)
		return
	}
	s.sendSuccess(w, proj)
}

func (s *HTTPServer) handleSaveSettings(w http.ResponseWriter, r *http.Request) {
	var req SaveSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	err := s.app.SaveSettings(req.Clusters, req.ActiveCluster)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]bool{"saved": true})
}

func (s *HTTPServer) handleGetDeviceServices(w http.ResponseWriter, r *http.Request) {
	var req NodeIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	// Use NodeName if provided, otherwise fallback to NodeID (though API likely needs Name)
	target := req.NodeName
	if target == "" {
		target = req.NodeID
	}

	services, err := s.app.GetDeviceServices(req.NodeID, target)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, services)
}

func (s *HTTPServer) handleSetupSSH(w http.ResponseWriter, r *http.Request) {
	var req NodeIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	err := s.app.SetupSSH(req.NodeID)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]bool{"setup": true})
}

func (s *HTTPServer) handleGetSSHStatus(w http.ResponseWriter, r *http.Request) {
	var req NodeIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	status := s.app.GetSSHStatus(req.NodeID)
	s.sendSuccess(w, status)
}

func (s *HTTPServer) handleDisableSSH(w http.ResponseWriter, r *http.Request) {
	var req NodeIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	err := s.app.DisableSSH(req.NodeID)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]bool{"disabled": true})
}

func (s *HTTPServer) handleSetVGAEnabled(w http.ResponseWriter, r *http.Request) {
	var req SetVGAEnabledRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	err := s.app.SetVGAEnabled(req.NodeID, req.Enabled)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]bool{"vgaEnabled": req.Enabled})
}

func (s *HTTPServer) handleSetUSBEnabled(w http.ResponseWriter, r *http.Request) {
	var req SetUSBEnabledRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	err := s.app.SetUSBEnabled(req.NodeID, req.Enabled)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]bool{"usbEnabled": req.Enabled})
}

type SetConsoleEnabledRequest struct {
	NodeID  string `json:"nodeId"`
	Enabled bool   `json:"enabled"`
}

func (s *HTTPServer) handleSetConsoleEnabled(w http.ResponseWriter, r *http.Request) {
	var req SetConsoleEnabledRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	err := s.app.SetConsoleEnabled(req.NodeID, req.Enabled)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]bool{"consoleEnabled": req.Enabled})
}

func (s *HTTPServer) handleResetEdgeView(w http.ResponseWriter, r *http.Request) {
	var req NodeIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	err := s.app.ResetEdgeView(req.NodeID)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]bool{"reset": true})
}

func (s *HTTPServer) handleVerifyTunnel(w http.ResponseWriter, r *http.Request) {
	var req NodeIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	err := s.app.VerifyEdgeViewTunnel(req.NodeID)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]bool{"connected": true})
}

func (s *HTTPServer) handleAddRecentDevice(w http.ResponseWriter, r *http.Request) {
	var req NodeIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	s.app.AddRecentDevice(req.NodeID)
	s.sendSuccess(w, map[string]bool{"added": true})
}

func (s *HTTPServer) handleGetSessionStatus(w http.ResponseWriter, r *http.Request) {
	var req NodeIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	status := s.app.GetSessionStatus(req.NodeID)
	s.sendSuccess(w, status)
}

func (s *HTTPServer) handleGetAppInfo(w http.ResponseWriter, r *http.Request) {
	var req NodeIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	appInfo, err := s.app.GetAppInfo(req.NodeID)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]string{"output": appInfo})
}

// Helper methods
func (s *HTTPServer) sendSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(APIResponse{
		Success: true,
		Data:    data,
	})
}

func (s *HTTPServer) sendError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	json.NewEncoder(w).Encode(APIResponse{
		Success: false,
		Error:   err.Error(),
	})
}

// CORS middleware
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// GetFreePort asks the kernel for a free open port that is ready to use.
func GetFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func (s *HTTPServer) Start() {
	// Initialize app context
	s.app.startup(context.Background())

	// Log version to verify build update
	log.Printf("EdgeView Backend Version: 0.1.1")

	router := mux.NewRouter()

	// Register routes
	router.HandleFunc("/api/search-nodes", s.handleSearchNodes)
	router.HandleFunc("/api/connect", s.handleConnect)
	router.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			s.handleGetSettings(w, r)
		} else {
			s.handleSaveSettings(w, r)
		}
	})
	router.HandleFunc("/api/device-services", s.handleGetDeviceServices)
	router.HandleFunc("/api/setup-ssh", s.handleSetupSSH)
	router.HandleFunc("/api/ssh-status", s.handleGetSSHStatus)
	router.HandleFunc("/api/disable-ssh", s.handleDisableSSH)
	router.HandleFunc("/api/reset-edgeview", s.handleResetEdgeView)
	router.HandleFunc("/api/verify-tunnel", s.handleVerifyTunnel)
	router.HandleFunc("/api/recent-device", s.handleAddRecentDevice)
	router.HandleFunc("/api/user-info", s.handleGetUserInfo)
	router.HandleFunc("/api/enterprise", s.handleGetEnterprise)
	router.HandleFunc("/api/projects", s.handleGetProjects)
	router.HandleFunc("/api/session-status", s.handleGetSessionStatus)
	router.HandleFunc("/api/app-info", s.handleGetAppInfo)
	router.HandleFunc("/api/start-tunnel", s.handleStartTunnel)
	router.NewRoute().Path("/api/tunnel/{id}").Methods("DELETE").HandlerFunc(s.handleCloseTunnel)
	router.HandleFunc("/api/tunnels", s.handleListTunnels)
	router.HandleFunc("/api/ssh/term", s.handleSSHTerminal)
	router.HandleFunc("/api/connection-progress", s.handleGetConnectionProgress)
	router.HandleFunc("/api/verify-token", s.handleVerifyToken)
	router.HandleFunc("/api/set-vga", s.handleSetVGAEnabled)
	router.HandleFunc("/api/set-usb", s.handleSetUSBEnabled)
	router.HandleFunc("/api/set-console", s.handleSetConsoleEnabled)

	// Health check
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	handler := corsMiddleware(router)

	// If port is 0, find a free port explicitly first
	// This avoids issues on some Windows systems where binding to "127.0.0.1:0"
	// returns 0 as the port number.
	if s.port == 0 {
		freePort, err := GetFreePort()
		if err != nil {
			log.Fatalf("Failed to find a free port: %v", err)
		}
		s.port = freePort
		log.Printf("Found free port: %d", s.port)
	}

	addr := fmt.Sprintf("127.0.0.1:%d", s.port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen on %s: %v", addr, err)
	}

	// Get the actual port to be sure
	actualAddr := listener.Addr().(*net.TCPAddr)
	actualPort := actualAddr.Port

	if actualPort == 0 {
		listener.Close()
		log.Fatalf("CRITICAL ERROR: Listener reported port 0 on %s. This is invalid.", addr)
	}

	// Use log.Printf (stderr) instead of fmt.Printf (stdout) for reliable
	// output on Windows where stdout may be buffered
	log.Printf("EdgeView HTTP Server starting on :%d", actualPort)

	log.Fatal(http.Serve(listener, handler))
}

// handleStartTunnel starts a tunnel to a target IP and port on a node
func (s *HTTPServer) handleStartTunnel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NodeID     string `json:"nodeId"`
		TargetIP   string `json:"targetIP"`
		TargetPort int    `json:"targetPort"`
		Protocol   string `json:"protocol"` // Optional: "vnc", "ssh", "tcp"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	port, tunnelID, err := s.app.StartTunnel(req.NodeID, req.TargetIP, req.TargetPort, req.Protocol)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]interface{}{
		"port":     port,
		"tunnelId": tunnelID,
	})
}

func (s *HTTPServer) handleCloseTunnel(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	tunnelID := vars["id"]

	if tunnelID == "" {
		s.sendError(w, fmt.Errorf("missing tunnel ID"))
		return
	}

	if err := s.app.CloseTunnel(tunnelID); err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]bool{"closed": true})
}

// TunnelInfo is the JSON shape returned by /api/tunnels.
// NOTE: Field names are capitalized to match the existing
// frontend expectations (t.ID, t.NodeID, t.TargetIP, etc.).
type TunnelInfo struct {
	ID        string    `json:"ID"`
	NodeID    string    `json:"NodeID"`
	NodeName  string    `json:"NodeName,omitempty"`
	ProjectID string    `json:"ProjectID,omitempty"`
	Type      string    `json:"Type"`
	TargetIP  string    `json:"TargetIP"`
	LocalPort int       `json:"LocalPort"`
	CreatedAt time.Time `json:"CreatedAt"`
	Status    string    `json:"Status,omitempty"`
	Error     string    `json:"Error,omitempty"`
}

func (s *HTTPServer) handleListTunnels(w http.ResponseWriter, r *http.Request) {
	nodeID := r.URL.Query().Get("nodeId")
	tunnels := s.app.ListTunnels(nodeID)
	if tunnels == nil {
		// Always return [] instead of null for easier frontend handling
		tunnels = []*session.Tunnel{}
	}

	infos := make([]TunnelInfo, 0, len(tunnels))
	for _, t := range tunnels {
		name, projectID := s.app.GetNodeMeta(t.NodeID)
		infos = append(infos, TunnelInfo{
			ID:        t.ID,
			NodeID:    t.NodeID,
			NodeName:  name,
			ProjectID: projectID,
			Type:      t.Type,
			TargetIP:  t.TargetIP,
			LocalPort: t.LocalPort,
			CreatedAt: t.CreatedAt,
			Status:    t.Status,
			Error:     t.Error,
		})
	}

	s.sendSuccess(w, infos)
}

// handleSSHTerminal upgrades the connection to WebSocket and proxies it to the local SSH port
func (s *HTTPServer) handleSSHTerminal(w http.ResponseWriter, r *http.Request) {
	// Upgrade to WebSocket
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer wsConn.Close()

	// Get local proxy port from query param (default 55780)
	portStr := r.URL.Query().Get("port")
	port := 55780
	if portStr != "" {
		fmt.Sscanf(portStr, "%d", &port)
	}

	// Get SSH Key
	keyPath, _, err := sshInternal.EnsureSSHKey()
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nError finding SSH key: %v\r\n", err)))
		return
	}

	key, err := os.ReadFile(keyPath)
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nError reading SSH key: %v\r\n", err)))
		return
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nError parsing SSH key: %v\r\n", err)))
		return
	}

	// Get username from query param (default "root")
	user := r.URL.Query().Get("user")
	if user == "" {
		user = "root"
	}

	// Get password from query param
	password := r.URL.Query().Get("password")

	// Build auth methods based on what's available
	// For application containers that don't accept public keys, prioritize password auth
	var authMethods []ssh.AuthMethod
	if password != "" {
		// When password is provided, use it FIRST (before public key)
		// Many application containers only accept password authentication
		authMethods = append(authMethods, ssh.Password(password))
		// Also add KeyboardInteractive for servers that use ChallengeResponse
		authMethods = append(authMethods, ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) (answers []string, err error) {
			answers = make([]string, len(questions))
			for i := range questions {
				answers[i] = password
			}
			return answers, nil
		}))
		// Fallback to public key if password fails (for EVE-OS compatibility)
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else {
		// No password provided - try public key first (for EVE-OS)
		// Then enable keyboard-interactive for application containers
		authMethods = []ssh.AuthMethod{
			ssh.PublicKeys(signer),
			ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) (answers []string, err error) {
				// This allows interactive password authentication
				// However, since we're in a WebSocket handler (not connected to a real TTY),
				// we cannot prompt the user directly.
				// The SSH library will fail with "no supported methods" if the server requires this.
				log.Printf("SSH: Server requested keyboard-interactive auth, but no password provided")
				return nil, fmt.Errorf("keyboard-interactive authentication requires password")
			}),
		}
	}

	// Connect to local SSH proxy
	config := &ssh.ClientConfig{
		User:            user,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	client, err := ssh.Dial("tcp", fmt.Sprintf("localhost:%d", port), config)
	if err != nil {
		log.Printf("SSH: Authentication failed for %s@localhost:%d: %v", user, port, err)
		// Check if it's an authentication error
		if strings.Contains(err.Error(), "unable to authenticate") {
			if password == "" {
				// User didn't provide password - this is likely an app container that needs one
				wsConn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[1;33mAuthentication failed.\x1b[0m\r\n"))
				wsConn.WriteMessage(websocket.TextMessage, []byte("\r\nThis application requires password authentication.\r\n"))
				wsConn.WriteMessage(websocket.TextMessage, []byte("Please close this window and provide a password when connecting.\r\n\r\n"))
			} else {
				// User provided password but it was rejected
				wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[1;31mAuthentication failed:\x1b[0m %v\r\n", err)))
			}
		} else {
			wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to connect to SSH proxy (localhost:%d): %v\r\n", port, err)))
		}
		return
	}
	defer client.Close()
	log.Printf("SSH: Connected %s@localhost:%d", user, port)

	// NOTE: SSH-level keepalives (keepalive@openssh.com) are DISABLED because they
	// cause session resets when connecting to EVE-OS (localhost:22). The SSH keepalive
	// response from the device's SSH daemon somehow triggers EdgeView to reset.
	// Interestingly, VNC and SSH to apps (container IPs) work fine with just tunnel keepalives.
	// The tunnel-level keepalive in manager.go handles keeping the connection alive.

	session, err := client.NewSession()
	if err != nil {
		log.Printf("SSH: Failed to create session for user %s on port %d: %v", user, port, err)
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to create SSH session: %v\r\n", err)))
		return
	}
	defer func() {
		session.Close()
		log.Printf("SSH: Session closed %s@localhost:%d", user, port)
	}()

	// Set up PTY
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	// Default size
	cols := 80
	rows := 24
	if colsStr := r.URL.Query().Get("cols"); colsStr != "" {
		fmt.Sscanf(colsStr, "%d", &cols)
	}
	if rowsStr := r.URL.Query().Get("rows"); rowsStr != "" {
		fmt.Sscanf(rowsStr, "%d", &rows)
	}

	if err := session.RequestPty("xterm", rows, cols, modes); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to request PTY: %v\r\n", err)))
		return
	}

	// Pipe Stdin/Stdout/Stderr
	stdin, _ := session.StdinPipe()
	stdout, _ := session.StdoutPipe()
	stderr, _ := session.StderrPipe()

	// Start shell
	if err := session.Shell(); err != nil {
		log.Printf("SSH: Failed to start shell: %v", err)
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to start shell: %v\r\n", err)))
		return
	}

	// SSH -> WebSocket (Stdout)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				wsConn.WriteMessage(websocket.BinaryMessage, buf[:n])
			}
			if err != nil {
				wsConn.Close() // Force close WebSocket on SSH error
				return
			}
		}
	}()

	// SSH -> WebSocket (Stderr)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				wsConn.WriteMessage(websocket.TextMessage, buf[:n])
			}
			if err != nil {
				log.Printf("SSH->WS: Stderr error: %v", err)
				wsConn.Close() // Force close WebSocket on SSH error
				return
			}
		}
	}()

	// WebSocket -> SSH (Stdin + Resize)
	type WSMessage struct {
		Type string `json:"type"` // "input" or "resize"
		Data string `json:"data,omitempty"`
		Cols int    `json:"cols,omitempty"`
		Rows int    `json:"rows,omitempty"`
	}

	for {
		_, msg, err := wsConn.ReadMessage()
		if err != nil {
			break
		}

		var wsMsg WSMessage
		if err := json.Unmarshal(msg, &wsMsg); err != nil {
			// Maybe raw input?
			log.Printf("WS->SSH: Raw input %d bytes", len(msg))
			stdin.Write(msg)
			continue
		}

		switch wsMsg.Type {
		case "resize":
			session.WindowChange(wsMsg.Rows, wsMsg.Cols)
		case "input":
			stdin.Write([]byte(wsMsg.Data))
		default:
			// Fallback for raw data if not JSON
			stdin.Write(msg)
		}
	}
}

func (s *HTTPServer) handleGetConnectionProgress(w http.ResponseWriter, r *http.Request) {
	nodeID := r.URL.Query().Get("nodeId")
	if nodeID == "" {
		s.sendError(w, fmt.Errorf("nodeId parameter is required"))
		return
	}

	status := s.app.GetConnectionProgress(nodeID)
	s.sendSuccess(w, map[string]string{"status": status})
}

func (s *HTTPServer) handleVerifyToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token   string `json:"token"`
		BaseURL string `json:"baseUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	info, err := s.app.VerifyToken(req.Token, req.BaseURL)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, info)
}

func main() {
	port := flag.Int("port", 8080, "HTTP server port")
	flag.Parse()

	server := NewHTTPServer(*port)
	server.Start()
}
