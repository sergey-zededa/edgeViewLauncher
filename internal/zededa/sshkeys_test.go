package zededa

import (
	"strings"
	"testing"
)

// Two real-looking ed25519 keys with the same identity but different
// comments. These are NOT secret — the private halves don't exist and
// the public blob is fine to bake into a test fixture.
const (
	launcherKey       = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGfhdd+6fcQQbTwPQP9FbLf7r3bzxl/T7axQjIKLgPoy launcher@host"
	launcherSameBlob  = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGfhdd+6fcQQbTwPQP9FbLf7r3bzxl/T7axQjIKLgPoy renamed@laptop"
	adminKey          = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDifferentKeyMaterialForRSAExample admin@ops"
	otherEdKey        = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPDifferentBlobAltogetherzzzzzzzzzzzzzzzz other@user"
	withOptionsKey    = `command="echo hi",no-pty ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPDifferentBlobAltogetherzzzzzzzzzzzzzzzz tagged@host`
	invalidKey        = "this is not a key"
	ed25519FpExpected = "SHA256:" // we only check the prefix; the actual value is computed
)

func TestParseAuthorizedKeys_SingleKey(t *testing.T) {
	got := ParseAuthorizedKeys(launcherKey)
	if len(got) != 1 {
		t.Fatalf("expected 1 key, got %d", len(got))
	}
	k := got[0]
	if !k.Valid {
		t.Fatalf("expected valid key, got Valid=false (raw=%q)", k.Raw)
	}
	if k.Type != "ssh-ed25519" {
		t.Errorf("Type: got %q want ssh-ed25519", k.Type)
	}
	if k.Comment != "launcher@host" {
		t.Errorf("Comment: got %q want launcher@host", k.Comment)
	}
	if !strings.HasPrefix(k.Fingerprint, ed25519FpExpected) || len(k.Fingerprint) < 20 {
		t.Errorf("Fingerprint looks wrong: %q", k.Fingerprint)
	}
}

func TestParseAuthorizedKeys_MultilineAndComments(t *testing.T) {
	value := strings.Join([]string{
		"# this is a comment",
		"",
		launcherKey,
		"  ", // whitespace-only line
		adminKey,
		"# trailing comment",
	}, "\n")
	got := ParseAuthorizedKeys(value)
	if len(got) != 2 {
		t.Fatalf("expected 2 keys (comments + blanks ignored), got %d", len(got))
	}
	if got[0].Type != "ssh-ed25519" || got[1].Type != "ssh-rsa" {
		t.Errorf("got types [%q, %q]", got[0].Type, got[1].Type)
	}
}

func TestParseAuthorizedKeys_CRLF(t *testing.T) {
	value := launcherKey + "\r\n" + adminKey + "\r\n"
	got := ParseAuthorizedKeys(value)
	if len(got) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(got))
	}
}

func TestParseAuthorizedKeys_OptionsLine(t *testing.T) {
	got := ParseAuthorizedKeys(withOptionsKey)
	if len(got) != 1 || !got[0].Valid {
		t.Fatalf("expected 1 valid key from options line, got %+v", got)
	}
	if got[0].Type != "ssh-ed25519" {
		t.Errorf("Type: got %q", got[0].Type)
	}
	if got[0].Comment != "tagged@host" {
		t.Errorf("Comment: got %q", got[0].Comment)
	}
}

func TestParseAuthorizedKeys_InvalidLinePreserved(t *testing.T) {
	value := strings.Join([]string{invalidKey, launcherKey}, "\n")
	got := ParseAuthorizedKeys(value)
	if len(got) != 2 {
		t.Fatalf("expected 2 entries (1 invalid kept for audit), got %d", len(got))
	}
	if got[0].Valid {
		t.Errorf("first entry should be invalid")
	}
	if !got[1].Valid {
		t.Errorf("second entry should be valid")
	}
}

func TestIdentity_IgnoresComment(t *testing.T) {
	a := ParseAuthorizedKeys(launcherKey)[0]
	b := ParseAuthorizedKeys(launcherSameBlob)[0]
	if a.Identity() != b.Identity() {
		t.Fatalf("same type+blob but different identities:\n  a=%s\n  b=%s",
			a.Identity(), b.Identity())
	}
}

func TestAppendOrReplaceKey_AppendsWhenEmpty(t *testing.T) {
	out := AppendOrReplaceKey("", launcherKey)
	if out != launcherKey {
		t.Errorf("append-to-empty got %q want %q", out, launcherKey)
	}
}

func TestAppendOrReplaceKey_AppendsToExisting(t *testing.T) {
	out := AppendOrReplaceKey(adminKey, launcherKey)
	got := ParseAuthorizedKeys(out)
	if len(got) != 2 {
		t.Fatalf("expected 2 keys, got %d (out=%q)", len(got), out)
	}
	if got[0].Type != "ssh-rsa" || got[1].Type != "ssh-ed25519" {
		t.Errorf("order/types wrong: %+v", got)
	}
}

func TestAppendOrReplaceKey_ReplacesInPlace(t *testing.T) {
	value := strings.Join([]string{adminKey, launcherKey, otherEdKey}, "\n")
	// "Replace" with the same identity but a different comment — should
	// land on the same line and not change order.
	out := AppendOrReplaceKey(value, launcherSameBlob)
	got := ParseAuthorizedKeys(out)
	if len(got) != 3 {
		t.Fatalf("expected 3 keys after replace, got %d (out=%q)", len(got), out)
	}
	if got[1].Comment != "renamed@laptop" {
		t.Errorf("replaced line should carry the new comment; got %q", got[1].Comment)
	}
	// admin and other should still be exactly where they were.
	if got[0].Type != "ssh-rsa" || got[2].Comment != "other@user" {
		t.Errorf("ordering disturbed: %+v", got)
	}
}

func TestAppendOrReplaceKey_RejectsInvalid(t *testing.T) {
	out := AppendOrReplaceKey(launcherKey, "garbage")
	if out != launcherKey {
		t.Errorf("invalid key should be a no-op; got %q", out)
	}
}

func TestRemoveKey_RemovesOnlyMatchingIdentity(t *testing.T) {
	value := strings.Join([]string{adminKey, launcherKey, otherEdKey}, "\n")
	out := RemoveKey(value, launcherSameBlob) // identity match via type+blob only
	got := ParseAuthorizedKeys(out)
	if len(got) != 2 {
		t.Fatalf("expected 2 keys after remove, got %d (out=%q)", len(got), out)
	}
	for _, k := range got {
		if k.Identity() == ParseAuthorizedKeys(launcherKey)[0].Identity() {
			t.Errorf("launcher key still present after remove: %+v", k)
		}
	}
}

func TestRemoveKey_AllRemovedReturnsEmpty(t *testing.T) {
	out := RemoveKey(launcherKey, launcherKey)
	if out != "" {
		t.Errorf("expected empty when sole key removed; got %q", out)
	}
}

func TestContainsKey(t *testing.T) {
	value := strings.Join([]string{adminKey, launcherKey}, "\n")
	if !ContainsKey(value, launcherSameBlob) {
		t.Errorf("expected ContainsKey to match by type+blob")
	}
	if ContainsKey(value, otherEdKey) {
		t.Errorf("expected ContainsKey=false for unrelated key")
	}
}

// fingerprintOf returns the SHA256 fingerprint of a single key line,
// failing the test if the fixture doesn't produce one.
func fingerprintOf(t *testing.T, line string) string {
	t.Helper()
	got := ParseAuthorizedKeys(line)
	if len(got) != 1 || got[0].Fingerprint == "" {
		t.Fatalf("fixture %q has no fingerprint", line)
	}
	return got[0].Fingerprint
}

func TestRemoveKeyByFingerprint_KeepsOtherLinesVerbatim(t *testing.T) {
	// The options-prefixed line must survive untouched.
	value := strings.Join([]string{launcherKey, withOptionsKey, adminKey}, "\n")
	out, changed := RemoveKeyByFingerprint(value, fingerprintOf(t, launcherKey))
	if !changed {
		t.Fatalf("expected a removal")
	}
	if want := withOptionsKey + "\n" + adminKey; out != want {
		t.Fatalf("got %q want %q", out, want)
	}
}

func TestRemoveKeyByFingerprint_RemovesAllLinesWithSameKey(t *testing.T) {
	// Same blob, different comments: OpenSSH treats them as one key, so
	// removing it by fingerprint removes both lines.
	value := strings.Join([]string{launcherKey, otherEdKey, launcherSameBlob}, "\n")
	out, changed := RemoveKeyByFingerprint(value, fingerprintOf(t, launcherKey))
	if !changed || out != otherEdKey {
		t.Fatalf("got (%q, %v) want (%q, true)", out, changed, otherEdKey)
	}
}

func TestRemoveKeyByFingerprint_LastKeyReturnsEmpty(t *testing.T) {
	out, changed := RemoveKeyByFingerprint(launcherKey+"\n", fingerprintOf(t, launcherKey))
	if !changed || out != "" {
		t.Fatalf("got (%q, %v) want (\"\", true)", out, changed)
	}
}

func TestRemoveKeyByFingerprint_NotFoundIsUnchanged(t *testing.T) {
	// With nothing to remove the value must come back byte-for-byte (comment
	// line and CRLF included), not re-serialized.
	value := "# keep me\r\n" + launcherKey + "\r\n" + invalidKey
	for _, fp := range []string{"SHA256:notOnTheDevice", "", "   "} {
		out, changed := RemoveKeyByFingerprint(value, fp)
		if changed || out != value {
			t.Fatalf("fp %q: got (%q, %v) want unchanged", fp, out, changed)
		}
	}
	if out, changed := RemoveKeyByFingerprint("", fingerprintOf(t, launcherKey)); changed || out != "" {
		t.Fatalf("empty value: got (%q, %v)", out, changed)
	}
}

func TestRemoveRawLine_InvalidLine(t *testing.T) {
	value := strings.Join([]string{launcherKey, "  " + invalidKey + "  ", adminKey}, "\n")
	// The UI sends the trimmed text; surrounding whitespace in the stored
	// line must not prevent the match.
	out, changed := RemoveRawLine(value, invalidKey)
	if !changed {
		t.Fatalf("expected a removal")
	}
	if want := launcherKey + "\n" + adminKey; out != want {
		t.Fatalf("got %q want %q", out, want)
	}
	// The only line left was the invalid one: result is "".
	if out, changed := RemoveRawLine(invalidKey, " "+invalidKey); !changed || out != "" {
		t.Fatalf("last line: got (%q, %v)", out, changed)
	}
}

func TestRemoveRawLine_NotFoundOrEmpty(t *testing.T) {
	value := launcherKey + "\n" + invalidKey
	for _, raw := range []string{"something else", "", "  ", "this is not"} {
		if out, changed := RemoveRawLine(value, raw); changed || out != value {
			t.Fatalf("raw %q: got (%q, %v) want unchanged", raw, out, changed)
		}
	}
}

// Raw matching is purely textual. An exact copy of a valid key line removes
// that one line only; it does not widen to other lines carrying the same key
// under a different comment (removal by fingerprint does that).
func TestRemoveRawLine_ValidLineIsExactTextOnly(t *testing.T) {
	value := launcherKey + "\n" + launcherSameBlob
	out, changed := RemoveRawLine(value, launcherKey)
	if !changed || out != launcherSameBlob {
		t.Fatalf("got (%q, %v) want (%q, true)", out, changed, launcherSameBlob)
	}
}
