//nolint:gosec,govet,lll,ineffassign,errcheck,gochecknoglobals
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/zededa/zcommon/zclog"
	"github.com/zededa/zedcloud/libs/edgeview"
	"github.com/zededa/zedcloud/libs/zmsg/device"
)

const (
	fileTransferSleepSec = 2
	// VNC command pattern used to identify VNC sessions for duplicate detection
	edgeviewVNCCommand = "tcp/localhost:4822"
)

type SessionInfo struct {
	DevId       string
	InstNum     uint32
	Command     string
	Pbar        edgeview.PrograssBar
	RequestDone bool
	Cancel      context.CancelFunc
	Buffer      *bytes.Buffer
	Status      string
	Errors      string
	PortMapping uint32
}

var sessionMap = make(map[string]SessionInfo)
var sessionMapMutex sync.Mutex

func runEdgeViewStartTCPHandler(req *device.EdgeviewRequest) (*device.EdgeviewResponse, error) {
	ipaddr, ipport, err := getAddrPortFromCmd(req.Command)
	if err != nil {
		return nil, fmt.Errorf("invalid tcp command: %v", err)
	}
	buf := &bytes.Buffer{}
	// For TCP, the session is long-lived, we can not pass r.Context() otherwise
	// the after the api call is done, the context will be canceled.
	ctx, cancel := context.WithCancel(context.Background())
	// Initialize session first to avoid race conditions
	if err := addSession(req.SessionId, req.DevId, req.InstNum, req.Command, nil, cancel, edgeview.GetEvRetStatusMeaning(edgeview.SessionOnGoing)); err != nil {
		cancel() // Make sure to cancel the context to prevent leaks
		return nil, err
	}
	params := edgeview.ClientParams{
		Instance:  int(req.InstNum),
		JWTToken:  req.Jwt,
		UserInfo:  req.UserInfo,
		Command:   req.Command,
		Buf:       buf,
		KeepState: true,
		SessionID: req.SessionId,
		ByteData:  signingPrivateKey,
	}
	go func() {
		status := edgeview.Edgeview_client(ctx, params, clientStateMap, evtcpMapping, netopts, sysopts)
		fmt.Printf("runEdgeViewStartTCPHandler: Edgeview_client done, status %v\n", edgeview.GetEvRetStatusMeaning(status))
		sessionInfo := getSession(req.SessionId)
		if sessionInfo != nil {
			sessionMapMutex.Lock()
			sessionInfo.RequestDone = true
			sessionInfo.Status = edgeview.GetEvRetStatusMeaning(status)
			sessionMap[req.SessionId] = *sessionInfo
			sessionMapMutex.Unlock()
		}
	}()
	tcpReadyChan := make(chan struct{})
	go func() {
		timeout := 10 * time.Second
		timer := time.After(timeout)
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-timer:
				zclog.Debug(ctx).Msg("timeout: IstcpClientRun() did not return true within 10 seconds")
				sessionInfo := getSession(req.SessionId)
				if sessionInfo != nil {
					sessionMapMutex.Lock()
					sessionInfo.RequestDone = true
					sessionInfo.Status = edgeview.GetEvRetStatusMeaning(edgeview.SessionDone)
					sessionInfo.Errors = "tcp command timed out, cancel the session"
					sessionMap[req.SessionId] = *sessionInfo
					sessionMapMutex.Unlock()
				}
				tcpReadyChan <- struct{}{} // Signal to continue
				return
			case <-ticker.C:
				if edgeview.IstcpClientRun(req.DevId, int(req.InstNum), clientStateMap) {
					tcpReadyChan <- struct{}{} // Signal to continue
					return
				}
			}
		}
	}()

	// Simply block until channel receives a value
	<-tcpReadyChan
	response := new(device.EdgeviewResponse)
	addrport := ipaddr + ":" + strconv.Itoa(ipport)
	localPort := edgeview.GetLocalTCPMappingPort(req.SessionId, addrport, evtcpMapping)
	response.PortMapping = uint32(localPort)
	response.SessionId = req.SessionId
	response.InstNum = req.InstNum
	response.Status = edgeview.GetEvRetStatusMeaning(edgeview.SessionOnGoing)
	sessionInfo := getSession(req.SessionId)
	if sessionInfo != nil {
		sessionMapMutex.Lock()
		sessionInfo.PortMapping = response.PortMapping
		sessionMap[req.SessionId] = *sessionInfo
		sessionMapMutex.Unlock()
	}
	fmt.Printf("runEdgeViewStartTCPHandler: return sessionInfo %+v\n", sessionInfo)
	return response, nil
}

func runEdgeViewCollectInfoHandler(req *device.EdgeviewRequest) (*device.EdgeviewResponse, error) {
	buf := &bytes.Buffer{}
	ctx, cancel := context.WithCancel(context.Background())
	// Create directory in /tmp/download/<req.DevUUID>
	dirPath := filepath.Join("/tmp/download", req.DevId)
	if err := os.MkdirAll(dirPath, os.ModePerm); err != nil {
		cancel() // Make sure to cancel the context to prevent leaks
		return nil, fmt.Errorf("failed to create directory: %v", err)
	}
	// Initialize session first to avoid race conditions
	if err := addSession(req.SessionId, req.DevId, req.InstNum, req.Command, nil, cancel, edgeview.GetEvRetStatusMeaning(edgeview.SessionOnGoing)); err != nil {
		cancel() // Make sure to cancel the context to prevent leaks
		return nil, err
	}

	// Use a fresh progress bar instance; we'll persist it back into the session map after completion.
	pbarPtr := &edgeview.PrograssBar{}

	params := edgeview.ClientParams{
		Instance:  int(req.InstNum),
		JWTToken:  req.Jwt,
		UserInfo:  req.UserInfo,
		Command:   req.Command,
		Buf:       buf,
		KeepState: true,
		SessionID: req.SessionId,
		ByteData:  signingPrivateKey,
		Pbar:      pbarPtr,
	}
	go func() {
		status := edgeview.Edgeview_client(ctx, params, clientStateMap, evtcpMapping, netopts, sysopts)
		sessionInfo := getSession(req.SessionId)
		if sessionInfo != nil {
			// Persist the final progress captured via params.Pbar into the session map
			// only if sessionInfo hasn't already recorded a filename.
			// Note: getSession returns a copy, so we must write it back explicitly.
			if params.Pbar != nil && sessionInfo.Pbar.Filename == "" {
				sessionInfo.Pbar = *params.Pbar
			}
			// If Pbar was filled via params, sessionInfo.Pbar reflects it since we passed its address.
			fileSize, err := getFileSize(sessionInfo)
			sessionMapMutex.Lock()
			sessionInfo.RequestDone = true
			if err == nil {
				sessionInfo.Pbar.CurrSize = fileSize
				if sessionInfo.Pbar.FileSize == 0 {
					sessionInfo.Pbar.FileSize = fileSize
				}
			}
			sessionInfo.Status = edgeview.GetEvRetStatusMeaning(status)
			sessionMap[req.SessionId] = *sessionInfo
			sessionMapMutex.Unlock()
			fmt.Printf("runEdgeViewCollectInfoHandler: Edgeview_client done, status %v, file size %d, sessionInfo %+v\n",
				edgeview.GetEvRetStatusMeaning(status), fileSize, sessionInfo)
		}
		// Ensure progress monitoring goroutine exits promptly
		cancel()
	}()
	go func() {

	waitForTransfer:
		for {
			select {
			case <-ctx.Done(): // close the goroutine if the context is canceled
				return
			default:
				if !edgeview.GetStartFileTransfer(req.GetDevId(), int(req.GetInstNum()), clientStateMap) {
					time.Sleep(time.Duration(fileTransferSleepSec) * time.Second)
					continue
				}
				break waitForTransfer
			}
		}
		for {
			select {
			case <-ctx.Done(): // close the goroutine if the context is canceled
				return
			default:
				var num float64
				pbar := edgeview.GetProgressBar(req.GetDevId(), int(req.GetInstNum()), clientStateMap)
				if pbar == nil || pbar.FileSize == 0 {
					num = 0.0
				} else {
					num = float64(pbar.CurrSize) / float64(pbar.FileSize)
				}
				for num < 1.0 {
					time.Sleep(time.Duration(fileTransferSleepSec) * time.Second)

					pbar = edgeview.GetProgressBar(req.GetDevId(), int(req.GetInstNum()), clientStateMap)
					if pbar == nil || pbar.FileSize == 0 {
						num = 0.0
					} else {
						num = float64(pbar.CurrSize) / float64(pbar.FileSize)
					}
					sessionInfo := getSession(req.GetSessionId())
					if sessionInfo != nil {
						if pbar != nil {
							sessionMapMutex.Lock()
							sessionInfo.Pbar = *pbar
							sessionMap[req.GetSessionId()] = *sessionInfo
							sessionMapMutex.Unlock()
						}
						if sessionInfo.RequestDone {
							fmt.Printf("runEdgeViewCollectInfoHandler: session %s is done, exiting wait loop\n", req.GetSessionId())
							return
						}
					}
				}
			}
		}
	}()

	// Immediate response
	response := &device.EdgeviewResponse{
		SessionId: req.SessionId,
		InstNum:   req.InstNum,
		Status:    edgeview.GetEvRetStatusMeaning(edgeview.SessionOnGoing),
	}
	zclog.Debug(ctx).
		Str("session_id", req.GetSessionId()).
		Uint32("instance_number", req.GetInstNum()).
		Msg("runEdgeViewCollectInfoHandler: started")
	return response, nil
}

func runEdgeviewGenericAsyncHandler(req *device.EdgeviewRequest) (*device.EdgeviewResponse, error) {
	buf := &bytes.Buffer{}
	ctx, cancel := context.WithCancel(context.Background())

	taskdone := make(chan struct{})
	status := edgeview.SessionOnGoing
	params := edgeview.ClientParams{
		Instance:  int(req.InstNum),
		JWTToken:  req.Jwt,
		UserInfo:  req.UserInfo,
		Command:   req.Command,
		Buf:       buf,
		KeepState: true,
		SessionID: req.SessionId,
		ByteData:  signingPrivateKey,
	}
	go func() {
		defer close(taskdone)
		status = edgeview.Edgeview_client(ctx, params, clientStateMap, evtcpMapping, netopts, sysopts)
		zclog.Debug(ctx).
			Str("device_id", req.GetDevId()).
			Uint32("instance_number", req.GetInstNum()).
			Str("status", edgeview.GetEvRetStatusMeaning(status)).
			Msg("runEdgeviewGenericAsyncHandler: task done")
	}()

	response := new(device.EdgeviewResponse)
	response.SessionId = req.SessionId
	response.InstNum = req.InstNum
	response.Status = edgeview.GetEvRetStatusMeaning(status)

	// save the session devId and instNum
	if err := addSession(req.SessionId, req.DevId, req.InstNum, req.Command, buf, cancel, edgeview.GetEvRetStatusMeaning(edgeview.SessionOnGoing)); err != nil {
		cancel() // Make sure to cancel the context to prevent leaks
		return nil, err
	}

	go func() {
		var taskFinished bool
		waitIdx := 0
		for !taskFinished {
			select {
			case <-taskdone:
				taskFinished = true
				sessionInfo := getSession(req.SessionId)
				if sessionInfo != nil {
					sessionMapMutex.Lock()
					sessionInfo.RequestDone = true
					sessionMap[req.SessionId] = *sessionInfo
					sessionMapMutex.Unlock()
					zclog.Debug(ctx).
						Str("session_id", req.GetSessionId()).
						Msg("runEdgeviewGenericAsyncHandler: task done")
				}
			case <-ctx.Done(): // close the goroutine if the context is canceled
				zclog.Debug(ctx).Msg("runEdgeviewGenericAsyncHandler: context canceled, exiting wait loop")
				return
			default:
				time.Sleep(250 * time.Millisecond)
				waitIdx++
			}
		}
	}()

	if status <= edgeview.SessionOnGoing {
		return response, fmt.Errorf("command failed with status %s", edgeview.GetEvRetStatusMeaning(status))
	}
	return response, nil
}

func runEdgeviewGenericHandler(ctx context.Context, req *device.EdgeviewRequest) (*device.EdgeviewResponse, error) {
	buf := &bytes.Buffer{}

	params := edgeview.ClientParams{
		Instance:  int(req.InstNum),
		JWTToken:  req.Jwt,
		UserInfo:  req.UserInfo,
		Command:   req.Command,
		Buf:       buf,
		KeepState: false,
		SessionID: req.SessionId,
		ByteData:  signingPrivateKey,
	}
	// Call Edgeview_client and wait for it to complete
	status := edgeview.Edgeview_client(ctx, params, clientStateMap, evtcpMapping, netopts, sysopts)

	filteredText := getRuturnTextString(req.Command, buf)
	// Prepare the response
	response := new(device.EdgeviewResponse)
	response.InstNum = req.InstNum
	response.RespText = filteredText
	response.Status = edgeview.GetEvRetStatusMeaning(status)

	// Log the status for debugging
	zclog.Debug(ctx).
		Any("status", status).
		Msg("runEdgeviewGenericHandler: returned with status")

	if status <= edgeview.SessionOnGoing {
		return response, fmt.Errorf("command failed with status %s", edgeview.GetEvRetStatusMeaning(status))
	}
	return response, nil
}

func getRuturnTextString(cmd string, buf *bytes.Buffer) string {
	// Process the buffer to skip lines before "<req.Command>"
	fullText := buf.String()
	parts := strings.Fields(cmd)

	searchString := "<" + parts[0] + ">"
	// the Edgeview server side return marker for pub is different
	if len(parts) > 0 && strings.HasPrefix(parts[0], "pub/") {
		searchString = " === Pub/Sub: <"
	}
	lines := strings.Split(fullText, "\n")
	found := false
	filteredText := ""

	for _, line := range lines {
		if found {
			if strings.Contains(line, "+++Done+++") {
				break
			}
			if strings.HasPrefix(line, "content type: text/") {
				continue
			}
			filteredText += line + "\n"
		} else if strings.Contains(line, searchString) {
			found = true
		}
	}
	if !found {
		filteredText = fullText
	}
	return filteredText
}

// Helper function to check if a directory is empty
func isDirEmpty(dir string) (bool, error) {
	f, err := os.Open(dir)
	if err != nil {
		return false, err
	}
	defer f.Close()

	// Read directory entries
	_, err = f.Readdir(1)
	if err == io.EOF {
		return true, nil
	}
	return false, err
}

func getSession(sessionID string) *SessionInfo {
	sessionMapMutex.Lock()
	sessionInfo, exists := sessionMap[sessionID]
	sessionMapMutex.Unlock()

	//fmt.Printf("getSession: sessionID %s, sessionInfo %+v\n", sessionID, sessionInfo)
	if !exists {
		fmt.Printf("getSession: session not found\n")
		return nil
	}

	return &sessionInfo
}

func getAddrPortFromCmd(cmd string) (string, int, error) {
	// Check if the command starts with "tcp/"
	if !strings.HasPrefix(cmd, "tcp/") {
		return "", 0, errors.New("invalid TCP command format")
	}

	// Remove the "tcp/" prefix
	cmd = strings.TrimPrefix(cmd, "tcp/")

	// Split the remaining string by ":"
	parts := strings.Split(cmd, ":")
	if len(parts) != 2 {
		return "", 0, errors.New("invalid TCP command format")
	}

	// Extract the IP address and port
	ip := parts[0]
	portStr := parts[1]

	// Convert the port string to an integer
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return "", 0, errors.New("invalid port number")
	}

	return ip, port, nil
}

// generateSessionId generates a random session Id.
func generateSessionId() (string, error) {
	b := make([]byte, 16) // 16 bytes = 128 bits
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func addSession(sessionID string, devId string, instNum uint32, cmd string,
	buf *bytes.Buffer, cancel context.CancelFunc, status string) error {
	sessionMapMutex.Lock()
	defer sessionMapMutex.Unlock()

	// Check if this is a VNC session and if there's already one for this device
	if strings.Contains(cmd, edgeviewVNCCommand) {
		for _, session := range sessionMap {
			if session.DevId == devId && strings.Contains(session.Command, edgeviewVNCCommand) {
				zclog.Debug(context.TODO()).
					Str("device_id", devId).
					Str("command", session.Command).
					Msg("Prevented duplicate VNC session for the device: already has session with command")
				return fmt.Errorf("the device %s has another VNC session already ongoing", devId)
			}
		}
	}

	sessionMap[sessionID] = SessionInfo{
		DevId:   devId,
		InstNum: instNum,
		Command: cmd,
		Cancel:  cancel,
		Buffer:  buf,
		Status:  status,
	}

	return nil
}

func removeSession(sessionID string) {
	sessionMapMutex.Lock()
	defer sessionMapMutex.Unlock()

	delete(sessionMap, sessionID)
}

// getFileSize returns the size of the file at the given filePath in bytes.
func getFileSize(sessionInfo *SessionInfo) (int64, error) {
	if sessionInfo == nil {
		return 0, errors.New("sessionInfo is nil")
	}
	filePath := filepath.Join("/tmp/download", sessionInfo.DevId, sessionInfo.Pbar.Filename)
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return 0, err
	}
	return fileInfo.Size(), nil
}

// sendTrigtoChan removed (unused)

func cleanUpCollectInfoFile(sessionId, dirPath, filePath string) {
	// Delete the file after serving it
	if err := os.Remove(filePath); err != nil {
		zclog.Debug(context.TODO()).Err(err).Msg("error deleting file")
	} else {
		zclog.Debug(context.TODO()).Str("file_path", filePath).Msg("file deleted")

		// Check if the directory is empty
		isEmpty, err := isDirEmpty(dirPath)
		if err != nil {
			zclog.Error(context.TODO()).Err(err).Msg("checking if directory is empty")
		} else if isEmpty {
			// Delete the directory if it is empty
			if err := os.Remove(dirPath); err != nil {
				zclog.Error(context.TODO()).Err(err).Str("directory_name", dirPath).Msg("deleting directory")
			}
		}
	}
	// Remove the session from the map after the file is served
	removeSession(sessionId)
}
