package main

import (
	"bytes"
	"edgeViewLauncher/internal/session"
	"edgeViewLauncher/internal/zededa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestHandleStartCollectInfo(t *testing.T) {
	srv := newTestServer(t)

	// Setup active session
	expiresAt := time.Now().Add(time.Hour)
	srv.app.sessionManager.StoreCachedSession("node-1", &zededa.SessionConfig{URL: "wss://example.com", Token: "test-token"}, 0, expiresAt)

	// Request body
	reqBody := NodeIDRequest{NodeID: "node-1"}
	body, _ := json.Marshal(reqBody)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/collect-info/start", bytes.NewReader(body))

	// Execute
	srv.handleStartCollectInfo(rr, req)

	// Verify
	if rr.Code != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v", rr.Code, http.StatusOK)
	}

	var resp APIResponse
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if !resp.Success {
		t.Errorf("expected success, got error: %v", resp.Error)
	}

	data := resp.Data.(map[string]interface{})
	if data["jobId"] == "" {
		t.Error("expected jobId in response")
	}
}

func TestHandleGetCollectInfoStatus(t *testing.T) {
	srv := newTestServer(t)

	// Manually inject a job or rely on StartCollectInfo
	// Since we can't inject easily, we rely on StartCollectInfo which creates a job
	// and returns the ID.
	expiresAt := time.Now().Add(time.Hour)
	srv.app.sessionManager.StoreCachedSession("node-1", &zededa.SessionConfig{URL: "wss://example.com", Token: "test-token"}, 0, expiresAt)
	
	jobID, _ := srv.app.StartCollectInfo("node-1")
	
	// Request
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/collect-info/status?jobId="+jobID, nil)

	srv.handleGetCollectInfoStatus(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v", rr.Code, http.StatusOK)
	}

	var resp APIResponse
	json.Unmarshal(rr.Body.Bytes(), &resp)
	
	dataStr, _ := json.Marshal(resp.Data)
	var jobResp session.CollectInfoJob
	json.Unmarshal(dataStr, &jobResp)

	if jobResp.ID != jobID {
		t.Errorf("expected job ID %s, got %s", jobID, jobResp.ID)
	}
}

func TestHandleDownloadCollectInfo(t *testing.T) {
	srv := newTestServer(t)

	// We need a completed job pointing to a real file
	tmpFile, err := os.CreateTemp("", "collect-test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())
	tmpFile.WriteString("test content")
	tmpFile.Close()

	// Inject job (Hack: using reflection or just creating one via StartCollectInfo and hoping we can modify it?)
	// Since we can't easily modify the job inside Manager (it's protected), we might face issues here.
	// BUT, `GetCollectInfoJob` returns a pointer to a copy. We can't modify the internal state.
	
	// Alternative: Mock the App interface? HTTPServer uses *App struct directly.
	// We might need to refactor App to use an interface for SessionManager to mock it.
	// OR: Just verify the 404/400 cases which are easier.
	
	// Case 1: Job not found
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/collect-info/download?jobId=invalid", nil)
	srv.handleDownloadCollectInfo(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404 for invalid job, got %v", rr.Code)
	}

	// Case 2: Job found but not completed
	// We can start a job, it will be "starting" or "failed" (likely failed quickly due to connection error in test)
	expiresAt := time.Now().Add(time.Hour)
	srv.app.sessionManager.StoreCachedSession("node-1", &zededa.SessionConfig{URL: "wss://example.com", Token: "test-token"}, 0, expiresAt)
	jobID, _ := srv.app.StartCollectInfo("node-1")
	
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/collect-info/download?jobId="+jobID, nil)
	srv.handleDownloadCollectInfo(rr, req)
	
	// It should be 400 Bad Request because status is not completed
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for incomplete job, got %v", rr.Code)
	}
}
