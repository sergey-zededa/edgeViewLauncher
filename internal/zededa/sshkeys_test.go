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
