package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
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

	port, tunnelID, err := s.app.ConnectToNode(req.NodeID, req.UseInAppTerminal)
	if err != nil {
		s.sendError(w, err)
		return
	}

	s.sendSuccess(w, map[string]interface{}{
		"port":     port,
		"tunnelId": tunnelID,
		"message":  fmt.Sprintf("Session started on port %d", port),
	})
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

var (
	// Version is set via ldflags during build
	Version = "dev"
)

// BufferedConn wraps net.Conn to allow peeking/buffering reads
type BufferedConn struct {
	net.Conn
	r io.Reader
}

func (b *BufferedConn) Read(p []byte) (n int, err error) {
	return b.r.Read(p)
}

func (s *HTTPServer) Start() {
	// Initialize app context
	s.app.startup(context.Background())

	// Log version to verify build update
	log.Printf("EdgeView Backend Version: %s", Version)

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
	Status      string    `json:"Status,omitempty"`
	Error       string    `json:"Error,omitempty"`
	IsEncrypted bool      `json:"IsEncrypted"`
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
			ID:          t.ID,
			NodeID:      t.NodeID,
			NodeName:    name,
			ProjectID:   projectID,
			Type:        t.Type,
			TargetIP:    t.TargetIP,
			LocalPort:   t.LocalPort,
			CreatedAt:   t.CreatedAt,
			Status:      t.Status,
			Error:       t.Error,
			IsEncrypted: t.IsEncrypted(), // Helper method we'll add to Tunnel
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

	// Channels for coordinating IO
	type resizeMsg struct {
		Cols int
		Rows int
	}
	
	// Buffered channels to prevent blocking the reader
	inputChan := make(chan []byte, 100)
	resizeChan := make(chan resizeMsg, 10)
	authResponseChan := make(chan string, 1)
	
	// Atomic flag to track if we are in auth phase or shell phase
	// 0 = Auth Phase, 1 = Shell Phase
	// We use a channel for synchronization instead of atomics for simpler logic
	isShellActive := make(chan struct{})

	// Start WebSocket Reader Loop IMMEDIATELY
	// This ensures we can receive password input while ssh.Dial is blocking
	go func() {
		defer close(inputChan)
		
		type WSMessage struct {
			Type string `json:"type"` // "input" or "resize"
			Data string `json:"data,omitempty"`
			Cols int    `json:"cols,omitempty"`
			Rows int    `json:"rows,omitempty"`
		}

		for {
			_, msg, err := wsConn.ReadMessage()
			if err != nil {
				return
			}

			var wsMsg WSMessage
			if err := json.Unmarshal(msg, &wsMsg); err != nil {
				// Raw input fallback
				select {
				case <-isShellActive:
					// Shell is active, send as raw input
					inputChan <- msg
				default:
					// Still in auth phase?
					// If we are waiting for auth, this might be the password
					// Try to send to auth channel non-blocking
					select {
					case authResponseChan <- string(msg):
					default:
						// No one listening for auth, drop or buffer?
					}
				}
				continue
			}

			switch wsMsg.Type {
			case "resize":
				resizeChan <- resizeMsg{Cols: wsMsg.Cols, Rows: wsMsg.Rows}
			case "input":
				data := []byte(wsMsg.Data)
				select {
				case <-isShellActive:
					// Normal shell input
					inputChan <- data
				default:
					// Auth input
					// Check if we can send to auth channel
					select {
					case authResponseChan <- wsMsg.Data:
					default:
						// If auth is not waiting, buffer it for shell later? 
						// Or just drop if it's spurious input.
						// For robustness, let's try to send to inputChan anyway, 
						// the shell reader will pick it up after auth.
						// BUT we must be careful not to confuse the auth handler.
						// Current strategy: Only send to authChan if auth is pending.
					}
				}
			}
		}
	}()

	// Build auth methods
	var authMethods []ssh.AuthMethod
	if password != "" {
		// Existing logic: Password provided upfront
		authMethods = append(authMethods, ssh.Password(password))
		authMethods = append(authMethods, ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) (answers []string, err error) {
			answers = make([]string, len(questions))
			for i := range questions {
				answers[i] = password
			}
			return answers, nil
		}))
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else {
		// New Logic: Interactive Auth
		authMethods = []ssh.AuthMethod{
			ssh.PublicKeys(signer),
			ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) (answers []string, err error) {
				// If no questions, just return
				if len(questions) == 0 {
					return nil, nil
				}

				// Prompt user for each question
				answers = make([]string, len(questions))
				for i, question := range questions {
					// Format prompt cleanly
					prompt := fmt.Sprintf("\r\n%s", question)
					if instruction != "" {
						prompt = fmt.Sprintf("\r\n%s\r\n%s", instruction, question)
					}
					
					// Send prompt to frontend
					// We use a simple text message that xterm.js will render
					// Ideally frontend should handle password hiding, but xterm.js doesn't natively support "password mode" easily via raw text
					// For now, it will echo. We can send specific escape codes to hide cursor/text if needed, but simple is better first.
					wsConn.WriteMessage(websocket.TextMessage, []byte(prompt))

					// Wait for response - buffer input until newline
					var answerBuf []rune
				inputLoop:
					for {
						select {
						case chunk := <-authResponseChan:
							for _, r := range chunk {
								switch r {
								case '\r', '\n':
									// Enter pressed, we're done
									// Echo a newline so the user sees the prompt move down
									wsConn.WriteMessage(websocket.TextMessage, []byte("\r\n"))
									break inputLoop
								case 127, 8: // Backspace (DEL) or BS
									if len(answerBuf) > 0 {
										answerBuf = answerBuf[:len(answerBuf)-1]
									}
								default:
									// Append regular character
									answerBuf = append(answerBuf, r)
									// Do NOT echo password characters
								}
							}
						case <-time.After(60 * time.Second):
							return nil, fmt.Errorf("authentication timed out")
						}
					}
					answers[i] = string(answerBuf)
				}
				return answers, nil
			}),
		}
	}

	// Connect to local SSH proxy
	config := &ssh.ClientConfig{
		User:            user,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second, // Increased timeout for interactive
	}

	// Dial raw TCP first to peek at the protocol header
	rawConn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", port), 5*time.Second)
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to connect to SSH proxy: %v\r\n", err)))
		return
	}
	defer rawConn.Close()

	// Peek at the first few bytes to check for SSH version string vs plaintext error
	// The standard requires the server to send "SSH-2.0-..."
	peekBuf := make([]byte, 4)
	rawConn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadFull(rawConn, peekBuf); err != nil {
		rawConn.SetReadDeadline(time.Time{}) // Reset deadline
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to read protocol header: %v\r\n", err)))
		return
	}
	rawConn.SetReadDeadline(time.Time{}) // Reset deadline

	// Check if it looks like SSH
	if string(peekBuf) != "SSH-" {
		// Not SSH - likely a plaintext error message from EdgeView device
		// Read the rest of the message to show the user
		restBuf := make([]byte, 1024)
		rawConn.SetReadDeadline(time.Now().Add(2 * time.Second))
		n2, _ := rawConn.Read(restBuf) // Ignore error, just get what we can
		
		fullMsg := string(peekBuf) + string(restBuf[:n2])
		cleanMsg := strings.TrimSpace(fullMsg)
		
		log.Printf("SSH: Protocol mismatch. Received: %q", cleanMsg)
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[1;31mConnection rejected by device:\x1b[0m %s\r\n", cleanMsg)))
		return
	}

	// It looks like SSH! Reconstruct the stream using a BufferedConn
	// This "puts back" the bytes we peeked so the SSH library can read them
	sshConn := &BufferedConn{
		Conn: rawConn,
		r:    io.MultiReader(bytes.NewReader(peekBuf), rawConn),
	}

	// Establish SSH connection on existing socket
	c, chans, reqs, err := ssh.NewClientConn(sshConn, fmt.Sprintf("localhost:%d", port), config)
	if err != nil {
		log.Printf("SSH: Authentication failed: %v", err)
		errMsg := err.Error()
		if strings.Contains(errMsg, "unexpected message type 51") || strings.Contains(errMsg, "handshake failed") {
			wsConn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[1;33mAuthentication Failed: The device rejected the SSH key.\x1b[0m\r\n"))
			wsConn.WriteMessage(websocket.TextMessage, []byte("If you recently updated the key, the device may still be applying the configuration.\r\n"))
			wsConn.WriteMessage(websocket.TextMessage, []byte("Please wait 1-2 minutes and try again.\r\n"))
		} else if strings.Contains(err.Error(), "unable to authenticate") {
			wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[1;31mAuthentication failed:\x1b[0m %v\r\n", err)))
		} else {
			wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to connect: %v\r\n", err)))
		}
		return
	}
	client := ssh.NewClient(c, chans, reqs)
	defer client.Close()
	
	// Signal that shell phase is active
	close(isShellActive)
	
	log.Printf("SSH: Connected %s@localhost:%d", user, port)

	session, err := client.NewSession()
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to create session: %v\r\n", err)))
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
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nFailed to start shell: %v\r\n", err)))
		return
	}

	// Handle Resizes
	go func() {
		for msg := range resizeChan {
			session.WindowChange(msg.Rows, msg.Cols)
		}
	}()

	// SSH -> WebSocket (Stdout)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				wsConn.WriteMessage(websocket.BinaryMessage, buf[:n])
			}
			if err != nil {
				wsConn.Close()
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

	// WebSocket -> SSH (Stdin)
	for data := range inputChan {
		stdin.Write(data)
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
