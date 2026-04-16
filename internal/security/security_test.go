package security

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestValidateNodeID(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"abc123", true},
		{"41985110-2EBC-4YPS-N-aa", true},
		{"", false},
		{"../evil", false},
		{"foo/bar", false},
		{"foo bar", false},
		{strings.Repeat("a", 200), false},
	}
	for _, tc := range cases {
		err := ValidateNodeID(tc.in)
		if (err == nil) != tc.want {
			t.Errorf("ValidateNodeID(%q) err=%v want valid=%v", tc.in, err, tc.want)
		}
	}
}

func TestSafeJoin(t *testing.T) {
	base := t.TempDir()
	t.Run("valid filename joins cleanly", func(t *testing.T) {
		got, err := SafeJoin(base, "out.tar.gz")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != filepath.Join(base, "out.tar.gz") {
			t.Errorf("unexpected join: %q", got)
		}
	})
	t.Run("rejects traversal", func(t *testing.T) {
		if _, err := SafeJoin(base, "../etc/passwd"); err == nil {
			t.Error("expected error for traversal")
		}
	})
	t.Run("rejects absolute", func(t *testing.T) {
		if _, err := SafeJoin(base, "/etc/passwd"); err == nil {
			t.Error("expected error for absolute path")
		}
	})
	t.Run("rejects separator", func(t *testing.T) {
		if _, err := SafeJoin(base, "sub/file"); err == nil {
			t.Error("expected error for separator")
		}
	})
	t.Run("rejects empty", func(t *testing.T) {
		if _, err := SafeJoin(base, ""); err == nil {
			t.Error("expected error for empty name")
		}
	})
}

func TestBuildAPIURL(t *testing.T) {
	cases := []struct {
		name, base, endpoint string
		wantErr              bool
		wantContains         string
	}{
		{"https joined", "https://api.example.com", "/api/v1/users/self", false, "https://api.example.com/api/v1/users/self"},
		{"http joined", "http://api.example.com:8080", "/api/v1/x", false, "http://api.example.com:8080/api/v1/x"},
		{"trailing slash", "https://api.example.com/", "/api/v1/x", false, "https://api.example.com/api/v1/x"},
		{"rejects file scheme", "file:///etc/passwd", "/x", true, ""},
		{"rejects gopher", "gopher://example.com", "/x", true, ""},
		{"rejects missing host", "https://", "/x", true, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := BuildAPIURL(tc.base, tc.endpoint)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err=%v wantErr=%v", err, tc.wantErr)
			}
			if !tc.wantErr && !strings.Contains(got, tc.wantContains) {
				t.Errorf("got %q, want containing %q", got, tc.wantContains)
			}
		})
	}
}

func TestTOFUHostKey(t *testing.T) {
	ResetTOFUForTest()
	cb := TOFUHostKey("node-1")
	key1 := &fakeKey{s: "AA"}
	key2 := &fakeKey{s: "BB"}
	if err := cb("host", nil, key1); err != nil {
		t.Fatalf("first-use should accept: %v", err)
	}
	if err := cb("host", nil, key1); err != nil {
		t.Fatalf("matching fingerprint should accept: %v", err)
	}
	if err := cb("host", nil, key2); err == nil {
		t.Fatal("mismatched fingerprint should error")
	}
}

// fakeKey implements ssh.PublicKey for fingerprint distinctness.
type fakeKey struct{ s string }

func (f *fakeKey) Type() string                          { return "ssh-rsa" }
func (f *fakeKey) Marshal() []byte                       { return []byte(f.s) }
func (f *fakeKey) Verify([]byte, *ssh.Signature) error   { return nil }
