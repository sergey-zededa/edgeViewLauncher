// Package installerlint contains static checks against the bundle scripts
// that ship with the installers. These checks run in the regular Go test
// suite so that mistakes in installer-only code (which is not exercised
// on CI runners that lack a real Windows installer) still surface as a
// red CI build.
package installerlint

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

// hooksPath resolves src-tauri/nsis/hooks.nsh relative to this test file
// so it works from any CWD (go test ./..., IDE runner, etc.).
func hooksPath(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", ".."))
	return filepath.Join(repoRoot, "src-tauri", "nsis", "hooks.nsh")
}

type nsisMacro struct {
	name  string
	lines []string // lines between !macro and !macroend, in order
}

var (
	macroStartRe = regexp.MustCompile(`^\s*!macro\s+(\S+)`)
	macroEndRe   = regexp.MustCompile(`^\s*!macroend\b`)
	// "StrCpy $INSTDIR <anything>" — leading whitespace allowed,
	// case-insensitive on the directive (NSIS is case-insensitive).
	strCpyInstdirRe = regexp.MustCompile(`(?i)^\s*StrCpy\s+\$INSTDIR\b`)
	// "SetOutPath $INSTDIR" — same conventions.
	setOutPathInstdirRe = regexp.MustCompile(`(?i)^\s*SetOutPath\s+\$INSTDIR\b`)
)

// parseMacros extracts each top-level !macro ... !macroend block. Comment
// lines (starting with ';') are dropped so they don't satisfy the
// invariant checks below.
func parseMacros(src string) []nsisMacro {
	var out []nsisMacro
	var cur *nsisMacro
	for _, rawLine := range strings.Split(src, "\n") {
		line := rawLine
		if idx := strings.Index(line, ";"); idx >= 0 {
			line = line[:idx]
		}
		if m := macroStartRe.FindStringSubmatch(line); m != nil && cur == nil {
			cur = &nsisMacro{name: m[1]}
			continue
		}
		if macroEndRe.MatchString(line) && cur != nil {
			out = append(out, *cur)
			cur = nil
			continue
		}
		if cur != nil {
			cur.lines = append(cur.lines, line)
		}
	}
	return out
}

// TestNSISHookSetOutPathFollowsInstdirOverride guards the bug fixed in
// PR #116. Tauri's NSIS template calls `SetOutPath $INSTDIR` immediately
// before invoking NSIS_HOOK_PREINSTALL, so a `StrCpy $INSTDIR` inside the
// hook redirects shortcuts/registry/uninstaller but NOT file extraction
// — unless we re-issue `SetOutPath $INSTDIR` after the override.
//
// Symptom of regression: fresh Windows installs land files at Tauri's
// default path while the Start Menu shortcut points at the override
// path, so the shortcut launches nothing and the app appears broken.
func TestNSISHookSetOutPathFollowsInstdirOverride(t *testing.T) {
	path := hooksPath(t)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}

	macros := parseMacros(string(raw))
	if len(macros) == 0 {
		t.Fatalf("no !macro blocks found in %s — file structure changed?", path)
	}

	for _, m := range macros {
		lastStrCpy := -1
		lastSetOutPath := -1
		for i, line := range m.lines {
			if strCpyInstdirRe.MatchString(line) {
				lastStrCpy = i
			}
			if setOutPathInstdirRe.MatchString(line) {
				lastSetOutPath = i
			}
		}
		if lastStrCpy >= 0 && lastSetOutPath <= lastStrCpy {
			t.Errorf("macro %s: `StrCpy $INSTDIR` at line offset %d is not followed by `SetOutPath $INSTDIR` in the same macro.\n"+
				"Tauri's NSIS template captures the file-extraction directory via `SetOutPath $INSTDIR` BEFORE this hook runs;\n"+
				"overriding $INSTDIR without re-issuing SetOutPath leaves files at the original path while shortcuts and\n"+
				"the uninstaller point at the new one — broken Start Menu shortcut on fresh installs.\n"+
				"Add `SetOutPath $INSTDIR` immediately after the StrCpy override.", m.name, lastStrCpy)
		}
	}
}

// TestNSISHookHasPreinstallMacro is a structural sanity check: if the
// hook file is ever truncated or accidentally emptied, we want CI to
// catch it rather than silently shipping an installer that no longer
// kills lingering processes or sets the right install path.
func TestNSISHookHasPreinstallMacro(t *testing.T) {
	path := hooksPath(t)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	macros := parseMacros(string(raw))
	var found *nsisMacro
	for i := range macros {
		if macros[i].name == "NSIS_HOOK_PREINSTALL" {
			found = &macros[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("expected an NSIS_HOOK_PREINSTALL macro in %s", path)
	}
	hasTaskkill := false
	for _, l := range found.lines {
		if strings.Contains(l, "taskkill") {
			hasTaskkill = true
			break
		}
	}
	if !hasTaskkill {
		t.Errorf("NSIS_HOOK_PREINSTALL must still run taskkill against the backend / launcher to avoid 'file in use' errors during install — none found in %s", path)
	}
}
