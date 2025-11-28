package ssh

import (
    "os"
    "path/filepath"
    "testing"
)

// TestGenerateEd25519KeyAndEnsureSSHKey exercises the happy path of key generation
// and EnsureSSHKey() discovery using a temp HOME directory.
func TestGenerateEd25519KeyAndEnsureSSHKey(t *testing.T) {
    tmp := t.TempDir()
    t.Setenv("HOME", tmp)

    privPath, pubKey, err := generateEd25519Key()
    if err != nil {
        t.Fatalf("generateEd25519Key returned error: %v", err)
    }
    if privPath == "" || pubKey == "" {
        t.Fatalf("expected non-empty private path and public key")
    }

    // Files should exist
    if _, err := os.Stat(privPath); err != nil {
        t.Fatalf("expected private key to exist at %s: %v", privPath, err)
    }
    pubPath := filepath.Join(filepath.Dir(privPath), "id_ed25519.pub")
    if _, err := os.Stat(pubPath); err != nil {
        t.Fatalf("expected public key to exist at %s: %v", pubPath, err)
    }

    // EnsureSSHKey should now discover and return this key instead of generating a new one.
    gotPriv, gotPub, err := EnsureSSHKey()
    if err != nil {
        t.Fatalf("EnsureSSHKey returned error: %v", err)
    }
    if gotPriv != privPath {
        t.Fatalf("expected EnsureSSHKey to return private path %s, got %s", privPath, gotPriv)
    }
    if gotPub == "" {
        t.Fatalf("expected EnsureSSHKey to return non-empty public key")
    }
}