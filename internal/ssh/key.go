package ssh

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/ssh"
)

// KeyPair represents a found SSH key pair
type KeyPair struct {
	PrivatePath string
	PublicPath  string
	PublicKey   string // Authorized key format
	Type        string // "ed25519", "ecdsa", "rsa"
}

// EnsureSSHKey ensures that a usable SSH key pair exists.
// It checks for existing keys in ~/.ssh/ and ~/.edgeview/ in order of preference:
// Ed25519 > ECDSA > RSA.
// If no keys are found, it generates a new Ed25519 key in ~/.edgeview/.
// Returns the path to the best private key and its public key content.
func EnsureSSHKey() (string, string, error) {
	keys, err := GetAllPublicKeys()
	if err != nil {
		return "", "", fmt.Errorf("failed to scan for keys: %w", err)
	}

	// Preference order
	preferredTypes := []string{"ed25519", "ecdsa", "rsa"}

	for _, keyType := range preferredTypes {
		for _, key := range keys {
			if key.Type == keyType {
				return key.PrivatePath, key.PublicKey, nil
			}
		}
	}

	// If no keys found, generate a new Ed25519 key
	return generateEd25519Key()
}

// GetAllPublicKeys scans ~/.ssh/ and ~/.edgeview/ for available public keys.
// Returns a list of KeyPair structs.
func GetAllPublicKeys() ([]KeyPair, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get user home dir: %w", err)
	}

	dirs := []string{
		filepath.Join(homeDir, ".ssh"),
		filepath.Join(homeDir, ".edgeview"),
	}

	var foundKeys []KeyPair

	// Common key names to look for
	keyNames := []struct {
		Name string
		Type string
	}{
		{"id_ed25519", "ed25519"},
		{"id_ecdsa", "ecdsa"},
		{"id_rsa", "rsa"},
	}

	for _, dir := range dirs {
		for _, kn := range keyNames {
			privPath := filepath.Join(dir, kn.Name)
			pubPath := filepath.Join(dir, kn.Name+".pub")

			// Check if both exist
			if _, err := os.Stat(privPath); err == nil {
				if _, err := os.Stat(pubPath); err == nil {
					// Read public key
					pubBytes, err := os.ReadFile(pubPath)
					if err == nil {
						foundKeys = append(foundKeys, KeyPair{
							PrivatePath: privPath,
							PublicPath:  pubPath,
							PublicKey:   strings.TrimSpace(string(pubBytes)),
							Type:        kn.Type,
						})
					}
				}
			}
		}
	}

	return foundKeys, nil
}

func generateEd25519Key() (string, string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("failed to get user home dir: %w", err)
	}

	edgeViewDir := filepath.Join(homeDir, ".edgeview")
	if err := os.MkdirAll(edgeViewDir, 0700); err != nil {
		return "", "", fmt.Errorf("failed to create edgeview dir: %w", err)
	}

	privateKeyPath := filepath.Join(edgeViewDir, "id_ed25519")
	publicKeyPath := filepath.Join(edgeViewDir, "id_ed25519.pub")

	// Generate Ed25519 key
	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate key: %w", err)
	}

	// Marshal Private Key (OpenSSH format is preferred for Ed25519, but PEM is standard for Go's x/crypto/ssh)
	// Actually, x/crypto/ssh/MarshalPrivateKey is what we want for OpenSSH private keys,
	// but it returns a Block.
	// Note: standard pem.Encode with "PRIVATE KEY" (PKCS#8) is often used.
	// However, for Ed25519, the standard is often the OpenSSH format.
	// Let's use x509.MarshalPKCS8PrivateKey which is standard.

	privBytes, err := x509.MarshalPKCS8PrivateKey(privKey)
	if err != nil {
		return "", "", fmt.Errorf("failed to marshal private key: %w", err)
	}

	privateKeyPEM := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: privBytes,
	}

	privateKeyFile, err := os.OpenFile(privateKeyPath, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return "", "", fmt.Errorf("failed to create private key file: %w", err)
	}
	defer privateKeyFile.Close()

	if err := pem.Encode(privateKeyFile, privateKeyPEM); err != nil {
		return "", "", fmt.Errorf("failed to write private key: %w", err)
	}

	// Generate Public Key
	sshPubKey, err := ssh.NewPublicKey(pubKey)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate ssh public key: %w", err)
	}
	publicKeyBytes := ssh.MarshalAuthorizedKey(sshPubKey)

	// Save Public Key
	if err := os.WriteFile(publicKeyPath, publicKeyBytes, 0644); err != nil {
		return "", "", fmt.Errorf("failed to write public key file: %w", err)
	}

	return privateKeyPath, string(publicKeyBytes), nil
}
