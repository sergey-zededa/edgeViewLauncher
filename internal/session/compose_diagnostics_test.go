package session

import (
	"testing"
	"time"

	"edgeViewLauncher/internal/zededa"
)

func TestShellQuote(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"/tmp/simple.tar.gz", "'/tmp/simple.tar.gz'"},
		{"/tmp/file with spaces.tar.gz", "'/tmp/file with spaces.tar.gz'"},
		{"/tmp/file'with'quotes.tar.gz", "'/tmp/file'\"'\"'with'\"'\"'quotes.tar.gz'"},
		{"", "''"},
		{"/tmp/normal-file-v1-2026-03-25.tar.gz", "'/tmp/normal-file-v1-2026-03-25.tar.gz'"},
		{"; rm -rf /", "'; rm -rf /'"},
		{"$(whoami)", "'$(whoami)'"},
		{"`id`", "'`id`'"},
	}

	for _, tt := range tests {
		got := shellQuote(tt.input)
		if got != tt.expected {
			t.Errorf("shellQuote(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestCollectInfoOutputRegex(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantPath string
		wantOK   bool
	}{
		{
			name:     "standard output",
			input:    "runtime info collected to /tmp/runtime-info-v1-23128370-96ed-44d1-afe8-cf5798aa3481-2026-03-25-15-46-57.tar.gz",
			wantPath: "/tmp/runtime-info-v1-23128370-96ed-44d1-afe8-cf5798aa3481-2026-03-25-15-46-57.tar.gz",
			wantOK:   true,
		},
		{
			name:     "with surrounding output",
			input:    "some log lines\ntar: file removed\nruntime info collected to /tmp/runtime-info-v1-abc-123.tar.gz\nmore output",
			wantPath: "/tmp/runtime-info-v1-abc-123.tar.gz",
			wantOK:   true,
		},
		{
			name:   "no match in output",
			input:  "some random log output without the expected line",
			wantOK: false,
		},
		{
			name:   "empty output",
			input:  "",
			wantOK: false,
		},
		{
			name:     "minimal filename",
			input:    "runtime info collected to /tmp/runtime-info-v1.tar.gz",
			wantPath: "/tmp/runtime-info-v1.tar.gz",
			wantOK:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matches := collectInfoOutputRegex.FindStringSubmatch(tt.input)
			if tt.wantOK {
				if len(matches) < 2 {
					t.Fatalf("expected match, got none")
				}
				if matches[1] != tt.wantPath {
					t.Errorf("got path %q, want %q", matches[1], tt.wantPath)
				}
			} else {
				if len(matches) >= 2 {
					t.Errorf("expected no match, got %q", matches[1])
				}
			}
		})
	}
}

func TestTruncateOutput(t *testing.T) {
	tests := []struct {
		input    string
		maxLen   int
		expected string
	}{
		{"short", 10, "short"},
		{"exactly10!", 10, "exactly10!"},
		{"this is longer than ten", 10, "this is lo..."},
		{"", 5, ""},
	}

	for _, tt := range tests {
		got := truncateOutput(tt.input, tt.maxLen)
		if got != tt.expected {
			t.Errorf("truncateOutput(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.expected)
		}
	}
}

func TestStartComposeDiagnostics_NoSession(t *testing.T) {
	m := NewManager()

	_, err := m.StartComposeDiagnostics("nonexistent-node", "app1", "10.0.0.1", "root", "pass")
	if err == nil {
		t.Fatal("expected error for missing session")
	}
	if got := err.Error(); got != "no active session for node nonexistent-node" {
		t.Errorf("unexpected error: %s", got)
	}
}

func TestStartComposeDiagnostics_ExpiredSession(t *testing.T) {
	m := NewManager()

	expired := time.Now().Add(-time.Minute)
	m.StoreCachedSession("node-1", &zededa.SessionConfig{URL: "wss://example"}, 0, "", expired)

	_, err := m.StartComposeDiagnostics("node-1", "app1", "10.0.0.1", "root", "pass")
	if err == nil {
		t.Fatal("expected error for expired session")
	}
}

func TestStartComposeDiagnostics_CreatesJob(t *testing.T) {
	m := NewManager()

	valid := time.Now().Add(time.Hour)
	m.StoreCachedSession("node-1", &zededa.SessionConfig{URL: "wss://example", Token: "tok"}, 0, "", valid)

	jobID, err := m.StartComposeDiagnostics("node-1", "myapp", "10.0.0.5", "wcsuser", "secret")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if jobID == "" {
		t.Fatal("expected non-empty job ID")
	}

	// Verify job was stored
	job := m.GetComposeDiagnosticsJob(jobID)
	if job == nil {
		t.Fatal("expected job to be retrievable")
	}
	if job.NodeID != "node-1" {
		t.Errorf("expected nodeID node-1, got %s", job.NodeID)
	}
	if job.AppName != "myapp" {
		t.Errorf("expected appName myapp, got %s", job.AppName)
	}
	if job.AppIP != "10.0.0.5" {
		t.Errorf("expected appIP 10.0.0.5, got %s", job.AppIP)
	}
	if job.Status != "connecting" && job.Status != "failed" {
		// It will quickly transition to "failed" because there's no real EdgeView server
		t.Errorf("expected status connecting or failed, got %s", job.Status)
	}
}

func TestGetComposeDiagnosticsJob_NotFound(t *testing.T) {
	m := NewManager()

	job := m.GetComposeDiagnosticsJob("nonexistent")
	if job != nil {
		t.Error("expected nil for nonexistent job")
	}
}

func TestGetComposeDiagnosticsJob_ReturnsCopy(t *testing.T) {
	m := NewManager()

	valid := time.Now().Add(time.Hour)
	m.StoreCachedSession("node-1", &zededa.SessionConfig{URL: "wss://example", Token: "tok"}, 0, "", valid)

	jobID, _ := m.StartComposeDiagnostics("node-1", "app1", "10.0.0.1", "root", "")

	// Get the job twice — modifying one should not affect the other
	job1 := m.GetComposeDiagnosticsJob(jobID)
	job2 := m.GetComposeDiagnosticsJob(jobID)

	if job1 == nil || job2 == nil {
		t.Fatal("expected both job copies to exist")
	}

	job1.Status = "modified"
	if job2.Status == "modified" {
		t.Error("modifying one copy should not affect the other")
	}
}

func TestComposeDiagnosticsJob_InitialStatus(t *testing.T) {
	m := NewManager()

	valid := time.Now().Add(time.Hour)
	m.StoreCachedSession("node-1", &zededa.SessionConfig{URL: "wss://example", Token: "tok"}, 0, "", valid)

	jobID, err := m.StartComposeDiagnostics("node-1", "app1", "10.0.0.1", "root", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Immediately after creation, job should be in "connecting" status
	job := m.GetComposeDiagnosticsJob(jobID)
	if job == nil {
		t.Fatal("expected job to exist immediately after creation")
	}
	// The background goroutine may have already started, so status could be
	// "connecting" or "failed" (if StartProxy fails quickly)
	validStatuses := map[string]bool{"connecting": true, "failed": true}
	if !validStatuses[job.Status] {
		t.Errorf("expected status connecting or failed, got %q", job.Status)
	}
}
