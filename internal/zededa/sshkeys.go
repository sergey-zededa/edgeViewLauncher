package zededa

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"
)

// AuthorizedKey is one parsed entry from the EVE-OS `debug.enable.ssh` value.
// EVE-OS writes that value verbatim into /run/authorized_keys, so the format
// is the standard OpenSSH authorized_keys format: one key per line, each line
// of the shape "<type> <base64-blob> [comment...]". We parse defensively —
// any line we cannot recognize is preserved as Raw with Valid=false so an
// audit display can still show it.
type AuthorizedKey struct {
	// Type is the SSH key algorithm, e.g. "ssh-ed25519", "ssh-rsa",
	// "ecdsa-sha2-nistp256".
	Type string `json:"type"`
	// Blob is the base64-encoded key material. Together with Type it
	// uniquely identifies the key — the comment portion is metadata only.
	Blob string `json:"blob"`
	// Comment is the optional human-readable trailer (often user@host).
	Comment string `json:"comment"`
	// Raw is the original line as it appeared in the value (untrimmed).
	// Useful when re-emitting the multi-line value verbatim so we don't
	// reformat lines we didn't intend to touch.
	Raw string `json:"-"`
	// Fingerprint is the SHA256 fingerprint in OpenSSH format
	// ("SHA256:..."), or empty if the line did not parse.
	Fingerprint string `json:"fingerprint,omitempty"`
	// Valid is true if Type and Blob were extracted successfully.
	Valid bool `json:"valid"`
}

// Identity is the type+blob pair used to compare two keys regardless of
// their comments. OpenSSH considers two authorized_keys lines to be the
// same key when their type+blob match — the comment is purely metadata
// and may legitimately differ (e.g. "me@laptop" vs "me@desktop" for the
// same private key copied around). We mirror that behavior so the
// launcher does not duplicate or fail to find its own key just because
// the user renamed their host.
func (k AuthorizedKey) Identity() string {
	return k.Type + " " + k.Blob
}

// ParseAuthorizedKeys splits an authorized_keys-formatted string into one
// AuthorizedKey per non-empty, non-comment line. Empty lines and lines
// starting with '#' are skipped (they are not valid SSH keys and we don't
// want them in audit output). Whitespace at the start/end of each line
// is trimmed. CR/LF line endings are tolerated.
func ParseAuthorizedKeys(value string) []AuthorizedKey {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	// Normalize line endings to LF so split works for CRLF input too.
	normalized := strings.ReplaceAll(value, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")

	var out []AuthorizedKey
	for _, rawLine := range strings.Split(normalized, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		entry := AuthorizedKey{Raw: rawLine}
		// authorized_keys lines can begin with options (e.g.
		// `command="…",no-pty ssh-ed25519 AAAA…`). We don't try to
		// honor the options — just locate the first token that looks
		// like a public key type. If none of the tokens look like a
		// type, mark the line invalid but keep it.
		fields := strings.Fields(line)
		typeIdx := -1
		for i, f := range fields {
			if isSSHKeyType(f) {
				typeIdx = i
				break
			}
		}
		if typeIdx < 0 || typeIdx+1 >= len(fields) {
			out = append(out, entry)
			continue
		}
		entry.Type = fields[typeIdx]
		entry.Blob = fields[typeIdx+1]
		if typeIdx+2 < len(fields) {
			entry.Comment = strings.Join(fields[typeIdx+2:], " ")
		}
		entry.Valid = true
		entry.Fingerprint = sshFingerprintSHA256(entry.Blob)
		out = append(out, entry)
	}
	return out
}

// isSSHKeyType returns true for tokens that match the well-known
// authorized_keys public-key algorithm prefixes. Keeping this conservative
// means we won't mistake an option-string field for a key type.
func isSSHKeyType(token string) bool {
	switch {
	case strings.HasPrefix(token, "ssh-"):
		// ssh-rsa, ssh-dss, ssh-ed25519, ssh-ed448
		return true
	case strings.HasPrefix(token, "ecdsa-sha2-"):
		// ecdsa-sha2-nistp256/384/521
		return true
	case strings.HasPrefix(token, "sk-"):
		// sk-ssh-ed25519@openssh.com, sk-ecdsa-sha2-nistp256@openssh.com
		return true
	}
	return false
}

// sshFingerprintSHA256 returns the OpenSSH-style "SHA256:..." fingerprint
// for a base64-encoded key blob, or empty on decode failure. Matches the
// output of `ssh-keygen -lf` so an admin can grep the device's
// authorized_keys for an audit entry.
func sshFingerprintSHA256(blobB64 string) string {
	blob, err := base64.StdEncoding.DecodeString(blobB64)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(blob)
	// OpenSSH strips the trailing '=' padding.
	enc := base64.StdEncoding.EncodeToString(sum[:])
	return "SHA256:" + strings.TrimRight(enc, "=")
}

// AppendOrReplaceKey returns a new authorized_keys string with newKey
// guaranteed to be present exactly once. If a line with the same
// type+blob identity already exists, it is replaced in place (preserving
// its position relative to other lines) so we don't accidentally promote
// our key to the end or change line ordering for the audit display.
// Otherwise newKey is appended as a new line. Other admins' keys are
// preserved untouched.
func AppendOrReplaceKey(value, newKey string) string {
	newKey = strings.TrimSpace(newKey)
	if newKey == "" {
		return value
	}
	parsed := ParseAuthorizedKeys(newKey)
	if len(parsed) == 0 || !parsed[0].Valid {
		// Caller passed something we can't recognize — be safe and
		// just return the existing value unchanged rather than
		// corrupting the device config.
		return value
	}
	newID := parsed[0].Identity()

	existing := ParseAuthorizedKeys(value)
	if len(existing) == 0 {
		return newKey
	}

	replaced := false
	lines := make([]string, 0, len(existing)+1)
	for _, k := range existing {
		if k.Valid && k.Identity() == newID {
			lines = append(lines, newKey)
			replaced = true
		} else {
			// Preserve the original raw text for keys we didn't touch.
			lines = append(lines, strings.TrimRight(k.Raw, " \t"))
		}
	}
	if !replaced {
		lines = append(lines, newKey)
	}
	return strings.Join(lines, "\n")
}

// RemoveKey returns a new authorized_keys string with all lines matching
// removeKey's type+blob identity removed. Other lines are preserved.
// Returns "" when no lines remain (caller can then drop the configItem
// to fully disable SSH on the device).
func RemoveKey(value, removeKey string) string {
	parsed := ParseAuthorizedKeys(removeKey)
	if len(parsed) == 0 || !parsed[0].Valid {
		return value
	}
	targetID := parsed[0].Identity()

	existing := ParseAuthorizedKeys(value)
	if len(existing) == 0 {
		return ""
	}
	lines := make([]string, 0, len(existing))
	for _, k := range existing {
		if k.Valid && k.Identity() == targetID {
			continue
		}
		lines = append(lines, strings.TrimRight(k.Raw, " \t"))
	}
	return strings.Join(lines, "\n")
}

// ContainsKey reports whether `value` already lists a key with the same
// type+blob identity as `target`.
func ContainsKey(value, target string) bool {
	parsed := ParseAuthorizedKeys(target)
	if len(parsed) == 0 || !parsed[0].Valid {
		return false
	}
	targetID := parsed[0].Identity()
	for _, k := range ParseAuthorizedKeys(value) {
		if k.Valid && k.Identity() == targetID {
			return true
		}
	}
	return false
}
