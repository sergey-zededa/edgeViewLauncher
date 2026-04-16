package security

import (
	"fmt"
	"net"
	"sync"

	"golang.org/x/crypto/ssh"
)

// tofuStore caches the first host-key fingerprint observed for a given key.
// Subsequent connections must present the same fingerprint or the callback
// returns an error. This is an in-memory trust-on-first-use cache — it resets
// on process restart, which is fine for a short-lived desktop app but means
// persistent MITM attacks against a single session are still possible.
type tofuStore struct {
	mu      sync.Mutex
	entries map[string]string
}

var defaultTOFU = &tofuStore{entries: map[string]string{}}

// TOFUHostKey returns a HostKeyCallback scoped to the supplied key (typically a
// NodeID). The first connection records the remote host's public-key
// fingerprint; subsequent connections must match. This is materially stronger
// than ssh.InsecureIgnoreHostKey() for our use case (a localhost tunnel inside
// an authenticated EdgeView session where host-key pinning at build time is
// not possible because each edge device has a unique key).
func TOFUHostKey(scope string) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		fp := ssh.FingerprintSHA256(key)
		defaultTOFU.mu.Lock()
		defer defaultTOFU.mu.Unlock()
		known, ok := defaultTOFU.entries[scope]
		if !ok {
			defaultTOFU.entries[scope] = fp
			return nil
		}
		if known != fp {
			return fmt.Errorf("host key mismatch for %s (expected %s, got %s)", scope, known, fp)
		}
		return nil
	}
}

// ResetTOFUForTest clears the TOFU store; intended for tests only.
func ResetTOFUForTest() {
	defaultTOFU.mu.Lock()
	defer defaultTOFU.mu.Unlock()
	defaultTOFU.entries = map[string]string{}
}
