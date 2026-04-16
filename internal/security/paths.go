// Package security provides small input validators used to break user-controlled
// data flows flagged by static analyzers (CodeQL) and to add defense-in-depth
// against path traversal, SSRF, and host-key confusion attacks.
package security

import (
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

// nodeIDPattern accepts IDs that look like ZEDEDA device IDs: UUIDs or short
// alphanumeric tokens. Anything outside this charset is rejected so NodeID can
// safely be used in filesystem paths.
var nodeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// ValidateNodeID returns an error if id contains characters that could escape
// a filesystem path or exceed a sane length bound.
func ValidateNodeID(id string) error {
	if !nodeIDPattern.MatchString(id) {
		return fmt.Errorf("invalid node id")
	}
	return nil
}

// SafeJoin joins base with a single filename, rejecting names that contain
// path separators, traversal sequences, or that resolve outside base.
// It returns the joined absolute-style path suitable for passing to os.Create
// or os.Stat.
func SafeJoin(base, name string) (string, error) {
	if name == "" {
		return "", errors.New("empty filename")
	}
	// Reject any name with a path separator before cleaning so the caller
	// cannot sneak through os-native separators on either platform.
	if strings.ContainsRune(name, '/') || strings.ContainsRune(name, filepath.Separator) {
		return "", errors.New("filename must not contain path separators")
	}
	cleaned := filepath.Clean(name)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "..") {
		return "", errors.New("filename must not traverse")
	}
	if filepath.IsAbs(cleaned) {
		return "", errors.New("filename must not be absolute")
	}
	joined := filepath.Join(base, cleaned)
	absBase, err := filepath.Abs(base)
	if err != nil {
		return "", err
	}
	absJoined, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	prefix := absBase + string(filepath.Separator)
	if absJoined != absBase && !strings.HasPrefix(absJoined, prefix) {
		return "", errors.New("resolved path escapes base directory")
	}
	return joined, nil
}
