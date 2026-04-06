package session

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	internalssh "edgeViewLauncher/internal/ssh"

	"golang.org/x/crypto/ssh"
)

// ComposeDiagnosticsJob tracks a compose runtime diagnostics collection.
type ComposeDiagnosticsJob struct {
	ID        string             `json:"id"`
	NodeID    string             `json:"nodeId"`
	AppName   string             `json:"appName"`
	AppIP     string             `json:"appIP"`
	Status    string             `json:"status"` // "connecting", "running-script", "downloading", "completed", "failed"
	Progress  int64              `json:"progress"`
	TotalSize int64              `json:"totalSize"`
	Filename  string             `json:"filename"`
	FilePath  string             `json:"filePath"`
	Error     string             `json:"error"`
	CreatedAt time.Time          `json:"createdAt"`
	Cancel    context.CancelFunc `json:"-"`
}

// bufferedConn wraps a net.Conn with a pre-read buffer for SSH protocol detection.
type bufferedConn struct {
	net.Conn
	r io.Reader
}

func (b *bufferedConn) Read(p []byte) (int, error) {
	return b.r.Read(p)
}

// shellQuote wraps a string in single quotes, escaping any embedded single quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

// collectInfoOutputRegex matches the script's output line containing the tar.gz path.
var collectInfoOutputRegex = regexp.MustCompile(`runtime info collected to (/tmp/runtime-info[^\s]+\.tar\.gz)`)

// StartComposeDiagnostics initiates a diagnostics collection from a compose runtime VM.
func (m *Manager) StartComposeDiagnostics(nodeID, appName, appIP, username, password string) (string, error) {
	fmt.Printf("DEBUG: StartComposeDiagnostics called for node %s, app %s, ip %s\n", nodeID, appName, appIP)

	// Verify cached session exists
	m.mu.RLock()
	cached, ok := m.sessions[nodeID]
	m.mu.RUnlock()

	if !ok || time.Now().After(cached.ExpiresAt) {
		return "", fmt.Errorf("no active session for node %s", nodeID)
	}

	jobID := fmt.Sprintf("compose-diag-%d", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)

	job := &ComposeDiagnosticsJob{
		ID:        jobID,
		NodeID:    nodeID,
		AppName:   appName,
		AppIP:     appIP,
		Status:    "connecting",
		CreatedAt: time.Now(),
		Cancel:    cancel,
	}

	m.composeDiagMu.Lock()
	m.composeDiagJobs[jobID] = job
	m.composeDiagMu.Unlock()

	go m.runComposeDiagnostics(ctx, job, username, password)

	return jobID, nil
}

// GetComposeDiagnosticsJob returns a copy of the job for status reporting.
func (m *Manager) GetComposeDiagnosticsJob(jobID string) *ComposeDiagnosticsJob {
	m.composeDiagMu.RLock()
	defer m.composeDiagMu.RUnlock()
	if job, ok := m.composeDiagJobs[jobID]; ok {
		val := *job
		return &val
	}
	return nil
}

func (m *Manager) runComposeDiagnostics(ctx context.Context, job *ComposeDiagnosticsJob, username, password string) {
	defer job.Cancel()
	defer func() {
		m.composeDiagMu.Lock()
		if job.Status == "connecting" || job.Status == "running-script" || job.Status == "downloading" {
			if job.Error == "" {
				job.Status = "failed"
				job.Error = "Operation cancelled or terminated unexpectedly"
			}
		}
		m.composeDiagMu.Unlock()
		fmt.Printf("DEBUG: runComposeDiagnostics finished for job %s. Status: %s, Error: %s\n", job.ID, job.Status, job.Error)
	}()

	// Get cached session config
	m.mu.RLock()
	cached, ok := m.sessions[job.NodeID]
	m.mu.RUnlock()
	if !ok {
		m.updateComposeDiagError(job, "Session expired during operation")
		return
	}

	// Step 1: Establish SSH tunnel to compose runtime VM via EdgeView
	// The appIP is the airgapped/internal IP (10.x.x.x) — SSH daemon only listens there.
	fmt.Printf("DEBUG: Starting tunnel to %s:22 for compose diagnostics\n", job.AppIP)

	target := fmt.Sprintf("%s:22", job.AppIP)
	onProgress := func(status string) {
		fmt.Printf("DEBUG: Compose diag tunnel progress: %s\n", status)
	}

	localPort, tunnelID, err := m.StartProxy(ctx, cached.Config, job.NodeID, target, "ssh", onProgress)
	if err != nil {
		m.updateComposeDiagError(job, fmt.Sprintf("Failed to establish tunnel to compose runtime: %v", err))
		return
	}
	fmt.Printf("DEBUG: Tunnel established — local port %d, tunnel ID %s\n", localPort, tunnelID)

	// Ensure tunnel is cleaned up when we're done
	defer func() {
		if tunnelID != "" {
			m.CloseTunnel(tunnelID)
		}
	}()

	// Step 2: SSH connect
	sshClient, err := m.dialSSH(ctx, localPort, username, password)
	if err != nil {
		m.updateComposeDiagError(job, fmt.Sprintf("SSH authentication failed: %v", err))
		return
	}
	defer sshClient.Close()

	m.composeDiagMu.Lock()
	job.Status = "running-script"
	m.composeDiagMu.Unlock()

	// Step 3: Run collect-info.sh and parse output
	fmt.Println("DEBUG: Running collect-info.sh on compose runtime...")
	scriptOutput, err := m.sshExec(ctx, sshClient, "sudo /opt/zededa/bin/collect-info.sh")
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "not found") || strings.Contains(errMsg, "No such file") {
			m.updateComposeDiagError(job, "This runtime version does not support diagnostics collection (collect-info.sh not found)")
		} else {
			m.updateComposeDiagError(job, fmt.Sprintf("Failed to run collect-info.sh: %v", err))
		}
		return
	}

	// Parse output for the tar.gz path
	matches := collectInfoOutputRegex.FindStringSubmatch(scriptOutput)
	if len(matches) < 2 {
		m.updateComposeDiagError(job, fmt.Sprintf("Script completed but no diagnostics file path found in output. Output: %s", truncateOutput(scriptOutput, 500)))
		return
	}
	remoteFilePath := matches[1]
	fmt.Printf("DEBUG: Diagnostics file path: %s\n", remoteFilePath)

	// Step 4: Fix permissions
	fmt.Println("DEBUG: Fixing file permissions...")
	_, err = m.sshExec(ctx, sshClient, fmt.Sprintf("sudo chmod 644 %s", shellQuote(remoteFilePath)))
	if err != nil {
		m.updateComposeDiagError(job, fmt.Sprintf("Failed to fix file permissions: %v", err))
		return
	}

	// Step 5: Get file size
	sizeOutput, err := m.sshExec(ctx, sshClient, fmt.Sprintf("stat -c %%s %s", shellQuote(remoteFilePath)))
	if err != nil {
		m.updateComposeDiagError(job, fmt.Sprintf("Failed to get file size: %v", err))
		return
	}
	fileSize, err := strconv.ParseInt(strings.TrimSpace(sizeOutput), 10, 64)
	if err != nil {
		m.updateComposeDiagError(job, fmt.Sprintf("Failed to parse file size: %v", err))
		return
	}

	filename := filepath.Base(remoteFilePath)

	// Create temp directory for download
	downloadDir := filepath.Join(os.TempDir(), "edgeview-downloads", job.NodeID)
	if err := os.MkdirAll(downloadDir, 0755); err != nil {
		m.updateComposeDiagError(job, fmt.Sprintf("Failed to create download directory: %v", err))
		return
	}
	localFilePath := filepath.Join(downloadDir, filename)

	m.composeDiagMu.Lock()
	job.Status = "downloading"
	job.TotalSize = fileSize
	job.Filename = filename
	job.FilePath = localFilePath
	m.composeDiagMu.Unlock()

	// Step 6: Download via sudo cat over SSH exec channel
	fmt.Printf("DEBUG: Downloading %s (%d bytes)...\n", filename, fileSize)
	err = m.sshDownloadFile(ctx, sshClient, job, remoteFilePath, localFilePath)
	if err != nil {
		m.updateComposeDiagError(job, fmt.Sprintf("Download failed: %v", err))
		return
	}

	// Step 7: Verify downloaded size
	info, err := os.Stat(localFilePath)
	if err != nil {
		m.updateComposeDiagError(job, fmt.Sprintf("Downloaded file verification failed: %v", err))
		return
	}

	m.composeDiagMu.Lock()
	job.Status = "completed"
	job.Progress = info.Size()
	m.composeDiagMu.Unlock()

	fmt.Printf("DEBUG: Compose diagnostics completed. File: %s (%d bytes)\n", localFilePath, info.Size())
}

// dialSSH establishes an SSH connection through a local tunnel port.
func (m *Manager) dialSSH(ctx context.Context, localPort int, username, password string) (*ssh.Client, error) {
	var authMethods []ssh.AuthMethod

	// Load SSH keys for public key auth
	keyPath, _, err := internalssh.EnsureSSHKey()
	if err == nil {
		keyData, err := os.ReadFile(keyPath)
		if err == nil {
			signer, err := ssh.ParsePrivateKey(keyData)
			if err == nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
	}

	// Add password auth
	if password != "" {
		authMethods = append(authMethods, ssh.Password(password))
	}

	// Keyboard-interactive as fallback
	authMethods = append(authMethods, ssh.KeyboardInteractive(
		func(user, instruction string, questions []string, echos []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range questions {
				answers[i] = password
			}
			return answers, nil
		},
	))

	config := &ssh.ClientConfig{
		User:            username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	addr := fmt.Sprintf("localhost:%d", localPort)

	// Dial with context awareness
	dialer := net.Dialer{Timeout: 30 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to SSH tunnel: %w", err)
	}

	// Wait for SSH protocol header (same pattern as handleSSHTerminal)
	peekBuf := make([]byte, 4)
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	if _, err := io.ReadFull(conn, peekBuf); err != nil {
		conn.Close()
		return nil, fmt.Errorf("SSH server did not respond: %w", err)
	}
	conn.SetReadDeadline(time.Time{})

	if string(peekBuf) != "SSH-" {
		restBuf := make([]byte, 1024)
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, _ := conn.Read(restBuf)
		conn.Close()
		return nil, fmt.Errorf("connection rejected: %s", strings.TrimSpace(string(peekBuf)+string(restBuf[:n])))
	}

	// Reconstruct the stream with peeked bytes
	bc := &bufferedConn{
		Conn: conn,
		r:    io.MultiReader(bytes.NewReader(peekBuf), conn),
	}

	c, chans, reqs, err := ssh.NewClientConn(bc, addr, config)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("SSH authentication failed: %w", err)
	}

	return ssh.NewClient(c, chans, reqs), nil
}

// sshExec runs a command over SSH and returns combined stdout/stderr output.
func (m *Manager) sshExec(ctx context.Context, client *ssh.Client, command string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	if err != nil {
		return string(output), fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return string(output), nil
}

// sshDownloadFile streams a remote file to a local path via `sudo cat` over SSH.
func (m *Manager) sshDownloadFile(ctx context.Context, client *ssh.Client, job *ComposeDiagnosticsJob, remotePath, localPath string) error {
	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	stdout, err := session.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	stderrPipe, err := session.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	cmd := fmt.Sprintf("sudo cat %s", shellQuote(remotePath))
	if err := session.Start(cmd); err != nil {
		return fmt.Errorf("failed to start download command: %w", err)
	}

	file, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("failed to create local file: %w", err)
	}
	defer file.Close()

	// Stream data with progress tracking
	buf := make([]byte, 64*1024)
	reader := bufio.NewReaderSize(stdout, 256*1024)

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("operation cancelled")
		default:
		}

		n, readErr := reader.Read(buf)
		if n > 0 {
			if _, writeErr := file.Write(buf[:n]); writeErr != nil {
				return fmt.Errorf("write error: %w", writeErr)
			}
			m.composeDiagMu.Lock()
			job.Progress += int64(n)
			m.composeDiagMu.Unlock()
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return fmt.Errorf("read error: %w", readErr)
		}
	}

	// Wait for command to finish
	if err := session.Wait(); err != nil {
		stderrBytes, _ := io.ReadAll(stderrPipe)
		stderrMsg := strings.TrimSpace(string(stderrBytes))
		if stderrMsg != "" {
			return fmt.Errorf("download command failed: %w (%s)", err, stderrMsg)
		}
		return fmt.Errorf("download command failed: %w", err)
	}

	return nil
}

func (m *Manager) updateComposeDiagError(job *ComposeDiagnosticsJob, msg string) {
	m.composeDiagMu.Lock()
	job.Status = "failed"
	job.Error = msg
	m.composeDiagMu.Unlock()
	fmt.Printf("DEBUG: Compose diagnostics error: %s\n", msg)
}

func truncateOutput(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
