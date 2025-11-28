package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"edgeViewLauncher/internal/config"
	sshInternal "edgeViewLauncher/internal/ssh"
	"edgeViewLauncher/internal/session"

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

func (s *HTTPServer) Start() {
	// Initialize app context
	s.app.startup(context.Background())

	mux := http.NewServeMux()

	// Register routes
	mux.HandleFunc("/api/search-nodes", s.handleSearchNodes)
	mux.HandleFunc("/api/connect", s.handleConnect)
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			s.handleGetSettings(w, r)
		} else {
			s.handleSaveSettings(w, r)
		}
	})
	mux.HandleFunc("/api/device-services", s.handleGetDeviceServices)
	mux.HandleFunc("/api/setup-ssh", s.handleSetupSSH)
	mux.HandleFunc("/api/ssh-status", s.handleGetSSHStatus)
	mux.HandleFunc("/api/disable-ssh", s.handleDisableSSH)
	mux.HandleFunc("/api/reset-edgeview", s.handleResetEdgeView)
	mux.HandleFunc("/api/verify-tunnel", s.handleVerifyTunnel)
	mux.HandleFunc("/api/recent-device", s.handleAddRecentDevice)
	mux.HandleFunc("/api/user-info", s.handleGetUserInfo)
	mux.HandleFunc("/api/enterprise", s.handleGetEnterprise)
	mux.HandleFunc("/api/projects", s.handleGetProjects)
	mux.HandleFunc("/api/session-status", s.handleGetSessionStatus)
	mux.HandleFunc("/api/app-info", s.handleGetAppInfo)
	mux.HandleFunc("/api/start-tunnel", s.handleStartTunnel)
	mux.HandleFunc("/api/tunnel/{id}", s.handleCloseTunnel)
	mux.HandleFunc("/api/tunnels", s.handleListTunnels)
	mux.HandleFunc("/api/ssh/term", s.handleSSHTerminal)

	// Health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	handler := corsMiddleware(mux)

	addr := fmt.Sprintf(":%d", s.port)
	log.Printf("EdgeView HTTP Server starting on %s\n", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}

// handleStartTunnel starts a tunnel to a target IP and port on a node
func (s *HTTPServer) handleStartTunnel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NodeID     string `json:"nodeId"`
		TargetIP   string `json:"targetIP"`
		TargetPort int    `json:"targetPort"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, err)
		return
	}

	port, tunnelID, err := s.app.StartTunnel(req.NodeID, req.TargetIP, req.TargetPort)
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

func (s *HTTPServer) handleListTunnels(w http.ResponseWriter, r *http.Request) {
	nodeID := r.URL.Query().Get("nodeId")
	tunnels := s.app.ListTunnels(nodeID)
	if tunnels == nil {
		// Always return [] instead of null for easier frontend handling
		tunnels = []*session.Tunnel{}
	}
	log.Printf("DEBUG: handleListTunnels nodeId=%s tunnels=%d\n", nodeID, len(tunnels))
	s.sendSuccess(w, tunnels)
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

	// Connect to local SSH proxy
	config := &ssh.ClientConfig{
		User: "root",
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	client, err := ssh.Dial("tcp", fmt.Sprintf("localhost:%d", port), config)
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to connect to SSH proxy (localhost:%d): %v\r\n", port, err)))
		return
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to create SSH session: %v\r\n", err)))
		return
	}
	defer session.Close()

	// Set up PTY
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	// Default size
	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to request PTY: %v\r\n", err)))
		return
	}

	// Pipe Stdin/Stdout/Stderr
	stdin, _ := session.StdinPipe()
	stdout, _ := session.StdoutPipe()
	stderr, _ := session.StderrPipe()

	// Start shell
	if err := session.Shell(); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to start shell: %v\r\n", err)))
		return
	}

	// SSH -> WebSocket (Stdout)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				wsConn.WriteMessage(websocket.TextMessage, buf[:n])
			}
			if err != nil {
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

func main() {
	port := flag.Int("port", 8080, "HTTP server port")
	flag.Parse()

	server := NewHTTPServer(*port)
	server.Start()
}
