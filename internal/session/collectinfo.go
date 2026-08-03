package session

import (
	"context"
	"edgeViewLauncher/internal/security"
	"edgeViewLauncher/internal/zededa"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type CollectInfoJob struct {
	ID        string             `json:"id"`
	NodeID    string             `json:"nodeId"`
	Status    string             `json:"status"` // "starting", "downloading", "completed", "failed"
	Progress  int64              `json:"progress"`
	TotalSize int64              `json:"totalSize"`
	Filename  string             `json:"filename"`
	FilePath  string             `json:"filePath"` // Local path
	Error     string             `json:"error"`
	CreatedAt time.Time          `json:"createdAt"`
	Cancel    context.CancelFunc `json:"-"`
}

// copyFile struct matches edgeview libs/edgeview/copyfile.go
type copyFile struct {
	TokenHash []byte `json:"tokenHash"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	DirSize   int64  `json:"dirsize"`
	Sha256    string `json:"sha256"`
	ModTsec   int64  `json:"modtsec"`
}

const (
	startCopyMessage = "+++Start-Copy+++"
	tarCopyDoneMsg   = "+++TarCopyDone+++"
	closeMessage     = "+++Done+++"
)

// StartCollectInfo initiates the collect info process
func (m *Manager) StartCollectInfo(nodeID string) (string, error) {
	fmt.Printf("DEBUG: StartCollectInfo called for node %s\n", nodeID)
	if err := security.ValidateNodeID(nodeID); err != nil {
		return "", err
	}
	// Get cached session
	m.mu.RLock()
	cached, ok := m.sessions[nodeID]
	m.mu.RUnlock()

	if !ok || time.Now().After(cached.ExpiresAt) {
		return "", fmt.Errorf("no active session for node %s", nodeID)
	}

	jobID := fmt.Sprintf("job-%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())

	job := &CollectInfoJob{
		ID:        jobID,
		NodeID:    nodeID,
		Status:    "starting",
		CreatedAt: time.Now(),
		Cancel:    cancel,
	}

	m.collectMu.Lock()
	m.collectJobs[jobID] = job
	m.collectMu.Unlock()

	// Run in background
	go m.runCollectInfo(ctx, job, cached.Config)

	return jobID, nil
}

// GetCollectInfoJob returns the job status
func (m *Manager) GetCollectInfoJob(jobID string) *CollectInfoJob {
	m.collectMu.RLock()
	defer m.collectMu.RUnlock()
	if job, ok := m.collectJobs[jobID]; ok {
		// Return a copy to avoid concurrency issues during JSON marshal
		val := *job
		return &val
	}
	return nil
}

func (m *Manager) runCollectInfo(ctx context.Context, job *CollectInfoJob, config *zededa.SessionConfig) {
	fmt.Printf("DEBUG: runCollectInfo started for job %s\n", job.ID)
	defer func() {
		// Ensure status is updated on exit if not completed
		m.collectMu.Lock()
		if job.Status == "starting" || job.Status == "downloading" {
			if job.Error == "" {
				job.Status = "failed"
				job.Error = "Operation cancelled or terminated unexpectedly"
			}
		}
		m.collectMu.Unlock()
		fmt.Printf("DEBUG: runCollectInfo finished for job %s. Final status: %s, Error: %s\n", job.ID, job.Status, job.Error)
	}()

	// Connect to WebSocket with retry and instance rotation logic (similar to StartProxy)
	var wsConn *websocket.Conn
	var clientIP string
	var err error
	var lastErr error

	// Determine initial instance
	initialInstID := config.InstID
	if config.MaxInst == 1 {
		initialInstID = 0
	} else if config.MaxInst > 1 {
		// Start with InstID 1 for consistency with other tools
		initialInstID = 1
	} else {
		initialInstID = 0
	}

	const maxRetries = 5
	triedInstances := make(map[int]bool)
	currentInstID := initialInstID
	seenNoDeviceOnline := false

	// --- Retry Loop Start ---
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			fmt.Printf("DEBUG: CollectInfo retry attempt %d/%d...\n", attempt, maxRetries)
		}

		// Set Instance ID for this attempt
		config.InstID = currentInstID
		triedInstances[currentInstID] = true

		// Connect
		fmt.Printf("DEBUG: Connecting to EdgeView for collectinfo (InstID: %d)...\n", currentInstID)
		wsConn, clientIP, err = m.connectToEdgeView(config, fmt.Sprintf("collectinfo/i%d", currentInstID))
		if err != nil {
			lastErr = fmt.Errorf("failed to connect: %w", err)

			// Check for specific errors
			if err == ErrBusyInstance {
				fmt.Printf("DEBUG: Instance %d is busy\n", currentInstID)
			} else if err == ErrNoDeviceOnline {
				seenNoDeviceOnline = true
				fmt.Printf("DEBUG: Device not online (attempt %d/%d)\n", attempt, maxRetries)
			} else {
				fmt.Printf("DEBUG: Connection failed: %v\n", err)
			}
		} else {
			// Connected successfully!
			// Send collectinfo command
			query := cmdOpt{
				Version:      edgeViewVersion,
				ClientEPAddr: clientIP,
				System:       "collectinfo",
				IsJSON:       false,
			}

			queryBytes, _ := json.Marshal(query)
			fmt.Println("DEBUG: Sending collectinfo command...")
			if err := sendWrappedMessage(wsConn, queryBytes, config.Key, websocket.TextMessage, config.Enc); err != nil {
				fmt.Printf("DEBUG: Failed to send command: %v\n", err)
				lastErr = fmt.Errorf("failed to send command: %w", err)
				wsConn.Close()
				wsConn = nil
			} else {
				// Success! Break the retry loop
				break
			}
		}

		// If we are here, something failed. Decide whether to rotate instance or backoff.

		// Try to find an untried instance before applying backoff
		if config.MaxInst > 1 {
			foundAlternative := false
			// Try next instance in round-robin fashion
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
				continue // Skip backoff and try immediately
			}

			// All instances tried - reset for next full round
			fmt.Printf("DEBUG: All %d instances have been tried. Will retry with backoff.\n", config.MaxInst)
			triedInstances = make(map[int]bool)
		}

		// Backoff
		if attempt < maxRetries {
			waitTime := time.Duration(1<<uint(attempt)) * time.Second
			fmt.Printf("DEBUG: Waiting %v before next attempt...\n", waitTime)
			time.Sleep(waitTime)
		}
	}
	// --- Retry Loop End ---

	if wsConn == nil {
		finalErr := lastErr
		if seenNoDeviceOnline {
			finalErr = ErrNoDeviceOnline
		}
		if finalErr == nil {
			finalErr = fmt.Errorf("failed after %d attempts", maxRetries)
		}

		fmt.Printf("DEBUG: CollectInfo failed after retries: %v\n", finalErr)
		m.updateJobError(job, finalErr.Error())
		return
	}
	defer wsConn.Close()

	// Read loop
	var file *os.File
	var gotFileInfo bool
	var tarfileDone bool
	var serverSentSize int

	// Create temp directory
	tempDir := os.TempDir()
	downloadDir := filepath.Join(tempDir, "edgeview-downloads", job.NodeID)
	if err := os.MkdirAll(downloadDir, 0755); err != nil {
		m.updateJobError(job, fmt.Sprintf("Failed to create download directory: %v", err))
		return
	}

	// Wait for response
	// Set a reasonable timeout for the *start* of data, but data transfer can take long
	// Some devices take time to generate the tarball, so we use a generous 5-minute timeout
	wsConn.SetReadDeadline(time.Now().Add(5 * time.Minute))

	for {
		select {
		case <-ctx.Done():
			fmt.Println("DEBUG: Context cancelled")
			return
		default:
			// Read message
			mt, msg, err := wsConn.ReadMessage()
			if err != nil {
				if job.Status == "completed" {
					return // Normal exit if we marked it completed
				}
				fmt.Printf("DEBUG: ReadMessage error: %v\n", err)
				m.updateJobError(job, fmt.Sprintf("Connection error: %v", err))
				return
			}

			// Reset deadline for next message (keepalive) to 5 minutes
			// This handles slow transfers or pauses in generation
			wsConn.SetReadDeadline(time.Now().Add(5 * time.Minute))

			// Unwrap
			payload, err := unwrapMessage(msg, config.Key, config.Enc)
			if err != nil {
				fmt.Printf("DEBUG: unwrapMessage error: %v\n", err)
				if err == ErrNoDeviceOnline {
					m.updateJobError(job, "Device offline (no device online)")
					return
				}
				if err == ErrBusyInstance {
					m.updateJobError(job, "Device busy (instance limit reached)")
					return
				}
				// Log but continue?
				fmt.Printf("CollectInfo unwrap error: %v\n", err)
				continue
			}

			// Check for Protocol messages
			// 1. File Info (JSON)
			if !gotFileInfo {
				var info copyFile
				if err := json.Unmarshal(payload, &info); err == nil && info.Name != "" {
					fmt.Printf("DEBUG: Got file info: %+v\n", info)
					gotFileInfo = true

					// Determine total size (Size for file, DirSize for tar)
					totalSize := info.Size
					if info.DirSize > 0 {
						totalSize = info.DirSize
					}

					filename := filepath.Base(info.Name)
					fullPath, err := security.SafeJoin(downloadDir, filename)
					if err != nil {
						m.updateJobError(job, fmt.Sprintf("Rejected unsafe filename %q: %v", info.Name, err))
						return
					}

					m.collectMu.Lock()
					job.Status = "downloading"
					job.Filename = filename
					job.TotalSize = totalSize
					job.FilePath = fullPath
					m.collectMu.Unlock()

					file, err = os.Create(fullPath)
					if err != nil {
						m.updateJobError(job, fmt.Sprintf("Failed to create file: %v", err))
						return
					}
					defer file.Close()

					// Send Start-Copy confirmation
					// Note: edgeview-client uses addEnvelopeAndWriteWss(..., false, false) which signs/encrypts based on state
					// We use sendWrappedMessage which handles config.Enc
					fmt.Println("DEBUG: Sending Start-Copy confirmation")
					if err := sendWrappedMessage(wsConn, []byte(startCopyMessage), config.Key, websocket.BinaryMessage, config.Enc); err != nil {
						m.updateJobError(job, fmt.Sprintf("Failed to send start confirmation: %v", err))
						return
					}
					continue
				}
			}

			// 2. Text Control Messages
			if mt == websocket.TextMessage {
				payloadStr := string(payload)
				// fmt.Printf("DEBUG: Received TextMessage: %s\n", payloadStr)

				if strings.Contains(payloadStr, tarCopyDoneMsg) {
					fmt.Println("DEBUG: Tar copy done")
					tarfileDone = true
					// Extract server sent size if available: "+++TarCopyDone+++ +12345+++"
					re := regexp.MustCompile(`\+(\d+)\+\+\+`)
					match := re.FindStringSubmatch(payloadStr)
					if len(match) >= 2 {
						if s, err := strconv.Atoi(match[1]); err == nil {
							serverSentSize = s
						}
					}
				} else if strings.Contains(payloadStr, closeMessage) {
					// Done
					fmt.Println("DEBUG: Transfer completed")

					if !gotFileInfo {
						// Received close message but never got file info
						fmt.Println("DEBUG: Close message received but no file info")
						m.updateJobError(job, "Remote side finished without sending file info")
						return
					}

					m.collectMu.Lock()
					job.Status = "completed"
					if job.Progress == 0 && serverSentSize > 0 {
						job.Progress = int64(serverSentSize)
					}
					m.collectMu.Unlock()
					return
				} else if !gotFileInfo {
					// Might be log output before file starts? Ignore or log.
					fmt.Printf("CollectInfo ignored text: %s\n", payloadStr)
				}
			}

			// 3. Binary Data (File Content)
			// Wait, edgeview sends file content as BinaryMessage?
			// copyfile.go:167 checks if mtype == websocket.TextMessage.
			// If NOT TextMessage (i.e. Binary), AND !tarfileDone, it writes to file.
			if mt == websocket.BinaryMessage && !tarfileDone && file != nil {
				n, err := file.Write(payload)
				if err != nil {
					m.updateJobError(job, fmt.Sprintf("Write error: %v", err))
					return
				}

				m.collectMu.Lock()
				job.Progress += int64(n)
				m.collectMu.Unlock()
			}
		}
	}
}

func (m *Manager) updateJobError(job *CollectInfoJob, msg string) {
	m.collectMu.Lock()
	job.Status = "failed"
	job.Error = msg
	m.collectMu.Unlock()
}
