# Release Guide: EdgeView Launcher v0.2.0 (Electron-to-Tauri Migration)

## Context

EdgeView Launcher is migrating from Electron (v0.1.21 on `main`) to Tauri v2 (v0.2.0 on `feature/tauri-migration`). The core challenge is that existing users have the Electron app with `electron-updater` checking YAML manifests (`latest-mac.yml`, `latest.yml`, `latest-linux.yml`), while the new Tauri app uses a completely different updater checking `latest.json`. The v0.2.0 release must serve **both** update systems simultaneously so existing users discover the upgrade and future updates use Tauri's native updater.

The repo is **public**. The latest Electron release is **v0.1.21** (2026-02-06). The bundle identifier `com.edgeview.launcher` matches between both versions.

---

## Phase 0: Prerequisites (Must Complete Before Anything Else)

### 0.1 Generate Tauri Updater Signing Keypair

The public key in `src-tauri/tauri.conf.json` is currently `PLACEHOLDER_UPDATE_AFTER_tauri_signer_generate`. This blocks all CI release builds.

```bash
npx tauri signer generate -w ~/.tauri/edgeview-launcher.key
```

This outputs:
- A password-protected private key file at `~/.tauri/edgeview-launcher.key`
- The public key string printed to stdout (base64, starts with `dW50cnVzdGVk...`)

**Actions:**
1. Replace the placeholder in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) with the generated public key
2. **Back up the private key** in a password manager or secure vault — if lost, all existing Tauri installations will be unable to auto-update ever again
3. Commit the pubkey change to the `feature/tauri-migration` branch

### 0.2 Add GitHub Secrets

Go to the repository Settings > Secrets and variables > Actions and add:

| Secret | Required For | Blocking? |
|--------|-------------|-----------|
| `TAURI_SIGNING_PRIVATE_KEY` | All platforms — updater signature | **Yes** |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | All platforms — key decryption | **Yes** |
| `APPLE_CERTIFICATE` (base64 .p12) | macOS code signing | No — can defer |
| `APPLE_CERTIFICATE_PASSWORD` | macOS code signing | No — can defer |
| `APPLE_SIGNING_IDENTITY` | macOS code signing | No — can defer |
| `APPLE_ID` | macOS notarization | No — can defer |
| `APPLE_PASSWORD` (app-specific) | macOS notarization | No — can defer |
| `APPLE_TEAM_ID` | macOS notarization | No — can defer |

**If Apple signing is deferred:** macOS auto-update stays disabled (the code already handles this in `UpdateBanner.jsx`). macOS users will see a "Download from GitHub" link instead. The `.dmg` will trigger Gatekeeper warnings on first launch (user right-clicks > Open to bypass). This is acceptable for an initial release.

### 0.3 Entitlements for Production

`assets/entitlements.mac.plist` has `com.apple.security.get-task-allow` set to `false` for production. This entitlement must be `false` or Apple will reject notarization. (It was previously `true` for development only.)

---

## Phase 1: Release Workflow — Dual Artifact Generation

The release workflow (`.github/workflows/release.yml`) produces both Tauri-native artifacts AND Electron-compatible YAML manifests so that v0.1.21 users discover the upgrade.

### 1.1 What electron-updater Expects Per Platform

**macOS** — fetches `latest-mac.yml`, expects a `.zip` containing the `.app` bundle:
```yaml
version: 0.2.0
files:
  - url: EdgeViewLauncher-0.2.0-mac.zip
    sha512: <BASE64_SHA512_OF_ZIP>
    size: <SIZE_BYTES>
path: EdgeViewLauncher-0.2.0-mac.zip
sha512: <BASE64_SHA512_OF_ZIP>
releaseDate: '2026-03-26T12:00:00.000Z'
```

**Windows** — fetches `latest.yml`, expects an `.exe` NSIS installer:
```yaml
version: 0.2.0
files:
  - url: <TAURI_EXE_FILENAME>
    sha512: <BASE64_SHA512_OF_EXE>
    size: <SIZE_BYTES>
path: <TAURI_EXE_FILENAME>
sha512: <BASE64_SHA512_OF_EXE>
releaseDate: '2026-03-26T12:00:00.000Z'
```

**Linux** — fetches `latest-linux.yml`, expects an `.AppImage`:
```yaml
version: 0.2.0
files:
  - url: <TAURI_APPIMAGE_FILENAME>
    sha512: <BASE64_SHA512_OF_APPIMAGE>
    size: <SIZE_BYTES>
path: <TAURI_APPIMAGE_FILENAME>
sha512: <BASE64_SHA512_OF_APPIMAGE>
releaseDate: '2026-03-26T12:00:00.000Z'
```

### 1.2 How It Works

Each platform build job in `release.yml` has a step after the Tauri build that:
1. Finds the built artifact (`.app`, `.exe`, or `.AppImage`)
2. For macOS: Creates an Electron-compatible `.zip` of the `.app` bundle using `ditto`
3. Computes the SHA512 hash (base64-encoded, as `electron-updater` expects)
4. Generates the appropriate YAML manifest (`latest-mac.yml`, `latest.yml`, or `latest-linux.yml`)
5. Includes these bridge artifacts in the upload step

The final `release` job uses `ncipollo/release-action` with `allowUpdates: true` to add these bridge artifacts alongside the Tauri-native artifacts (`latest.json`, `.app.tar.gz`, `.dmg`, etc.).

### 1.3 Key Nuance: `tauri-action` Also Creates a Draft Release

`tauri-apps/tauri-action@v0` (used in all three build jobs) creates/updates a draft GitHub release itself via `releaseDraft: true`. It uploads `.app.tar.gz`, `.dmg`, `.exe`, `.AppImage`, `.deb`, and `latest.json` files directly to that release. The final `release` job then uses `ncipollo/release-action` with `allowUpdates: true` to add the remaining artifacts (bridge YAMLs, bridge zip) and publish it (set `draft: false`).

---

## Phase 2: Pre-Merge Testing Strategy

### 2.1 Local Build Smoke Test

```bash
# On feature/tauri-migration branch, from project root:
npm run build

# Verify the app launches and core functionality works:
# - Go sidecar starts (check Activity Monitor for edgeview-backend)
# - Can add a cluster
# - Can search devices
# - Settings panel shows version 0.2.0
```

### 2.2 Local Electron-to-Tauri Upgrade Test (macOS)

This follows `docs/MIGRATING_FROM_ELECTRON.md` exactly:

```bash
# 1. Build the Tauri app
npm run build

# 2. Create Electron-compatible zip
cd "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/"
ditto -c -k --sequesterRsrc --keepParent "EdgeView Launcher.app" EdgeViewLauncher-0.2.0-mac.zip

# 3. Calculate SHA512
shasum -a 512 EdgeViewLauncher-0.2.0-mac.zip | cut -f1 -d' ' | xxd -r -p | base64

# 4. Create latest-mac.yml (use the hash and stat -f%z for size)
# 5. Serve: cd ~/Desktop/update-server && python3 -m http.server 8080

# 6. In a SEPARATE copy of the v0.1.21 Electron source, patch electron-main.js:
#    autoUpdater.setFeedURL({ provider: 'generic', url: 'http://localhost:8080' });
#    Then run the old Electron app in dev mode.

# 7. Verify: Electron detects v0.2.0, downloads zip, extracts .app, relaunches as Tauri
```

**What to validate:**
- `~/.edgeview-config.json` survives (cluster configs preserved)
- `~/.ssh/edgeview_rsa` survives (SSH keys preserved)
- The re-authentication banner appears (commit `347898b` added this)
- The Tauri app doesn't crash on launch after the swap

### 2.3 Release Candidate via CI

Push an RC tag **from the feature branch** (no merge to main needed):

```bash
# Ensure tauri.conf.json has real pubkey, not placeholder
# Ensure GitHub secrets TAURI_SIGNING_PRIVATE_KEY + PASSWORD are set

git tag v0.2.0-rc.1
git push origin v0.2.0-rc.1
```

The workflow triggers on `v*` tags. It will:
1. Build all three platforms in parallel
2. Create a draft release (via `tauri-action`)
3. Finalize as a **prerelease** (the `-rc` suffix triggers the prerelease detection in `release.yml`)

**RC Verification checklist:**
- [ ] CI completes without errors on all 3 platforms
- [ ] Release has `latest.json` files (Tauri updater manifests)
- [ ] Release has bridge YAML files (`latest-mac.yml`, `latest.yml`, `latest-linux.yml`)
- [ ] Release has the macOS bridge `.zip`
- [ ] Download macOS `.dmg` > install > launches > can connect to a cluster
- [ ] Download Windows `.exe` > install > launches > can connect to a cluster
- [ ] Download Linux `.AppImage` > run > launches > can connect to a cluster
- [ ] The RC is marked as "Pre-release" (not "Latest") — v0.1.21 stays "Latest"

**Important:** Because the RC is a prerelease, `electron-updater` on v0.1.21 will **NOT** see it (by default, `electron-updater` only checks the "Latest" release for the YAML manifests). This is exactly what we want — existing users are not disrupted during testing.

**If CI fails:** Most likely cause is missing `TAURI_SIGNING_PRIVATE_KEY`. Fix, re-tag as `v0.2.0-rc.2`, retry.

### 2.4 Testing the RC Upgrade Path

Even though the RC is a prerelease, you can still test the upgrade path by pointing the old Electron app at the RC's assets directly:

```bash
# Download the RC's latest-mac.yml manually from the GitHub release page
# Host it locally and test as in step 2.2
```

Or, create a second RC that you temporarily mark as "Latest" in the GitHub UI, test the auto-update, then revert it back to prerelease.

---

## Phase 3: Platform-Specific Migration Behavior

### 3.1 macOS — Manual Download (Safest)

**How it works for v0.1.21 users:**
1. Electron app auto-checks for updates (15s after launch)
2. `electron-updater` fetches `latest-mac.yml` from "Latest" release
3. Sees `version: 0.2.0 > 0.1.21` → notifies user
4. **If Apple-signed:** User clicks Download > .zip downloads > .app extracted > swap > Tauri launches
5. **If NOT Apple-signed (current state):** The swap may trigger Gatekeeper. The safest approach is to keep macOS auto-update disabled. The old Electron app shows "Update available" but the NEW Tauri app's `UpdateBanner.jsx` shows "Download from GitHub" for macOS.

**Recommendation:** For v0.2.0, rely on the `latest-mac.yml` bridge so Electron users *see* the update is available, but in the release notes clearly instruct macOS users to download the `.dmg` manually and drag to Applications (replacing the old app). Once Apple signing is configured, you can enable seamless auto-update.

### 3.2 Windows — Auto-Update Should Work

**How it works for v0.1.21 users:**
1. `electron-updater` fetches `latest.yml`
2. Downloads the Tauri NSIS `.exe`
3. Runs it — NSIS installer installs the Tauri app

**Install path difference:**
- Electron installed to: `C:\Users\<user>\AppData\Local\Programs\EdgeView Launcher\`
- Tauri will install to: `C:\Users\<user>\AppData\Local\EdgeView Launcher\`

The old Electron files stay behind but are harmless. Start Menu shortcuts update to the new location. Users can manually delete the old folder later.

**Note:** `electron-updater` uses `.blockmap` files for differential downloads. The Tauri exe won't have one, so `electron-updater` falls back to a full download. This is fine.

### 3.3 Linux — Auto-Update Should Work

**AppImage users:** `electron-updater` downloads the new `.AppImage` and replaces the old file. Self-contained, no install paths to worry about. Should work seamlessly.

**Deb users:** No auto-update path (documented limitation). Must download new `.deb` manually.

---

## Phase 4: Merge and Release

### 4.1 Pre-Merge Checklist

- [ ] `src-tauri/tauri.conf.json` has real updater pubkey (not placeholder)
- [ ] GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` + `PASSWORD` are configured
- [ ] At least one RC (`v0.2.0-rc.1`) built successfully in CI
- [ ] RC tested on all platforms (launch, connect, settings)
- [ ] Local Electron-to-Tauri upgrade test passed
- [ ] `release.yml` updated with Electron bridge artifact generation
- [ ] Apple signing secrets added (optional — macOS auto-update stays disabled if not)

### 4.2 Create PR and Merge

```bash
# From feature/tauri-migration branch:
gh pr create --base main --head feature/tauri-migration \
  --title "feat: migrate from Electron to Tauri v2" \
  --body "## Summary
- Complete framework migration from Electron to Tauri v2
- Smaller binary, lower memory, native webview

## Test plan
- [x] RC build passed CI on all 3 platforms
- [x] Local Electron-to-Tauri upgrade tested on macOS
- [x] Frontend tests pass
- [x] Go tests pass
- [x] Rust tests pass"

# After PR review and merge:
git checkout main && git pull
```

### 4.3 Tag the Release

```bash
git tag v0.2.0
git push origin v0.2.0
```

This triggers `.github/workflows/release.yml`. The tag `v0.2.0` does NOT contain `-rc`/`-beta`/`-alpha`, so the release will be published as "Latest" — immediately replacing v0.1.21 as the latest release.

**This is the point of no return for existing users.** Once v0.2.0 is "Latest", all Electron v0.1.x users will see the update notification on their next launch.

### 4.4 Post-Release Verification

1. **Check release page** at the GitHub releases URL
2. **Verify Electron bridge manifests are accessible:**
   ```bash
   curl -sL https://github.com/sergey-zededa/edgeViewLauncher/releases/latest/download/latest-mac.yml
   curl -sL https://github.com/sergey-zededa/edgeViewLauncher/releases/latest/download/latest.yml
   curl -sL https://github.com/sergey-zededa/edgeViewLauncher/releases/latest/download/latest-linux.yml
   ```
3. **Verify Tauri updater manifest:**
   ```bash
   curl -sL https://github.com/sergey-zededa/edgeViewLauncher/releases/latest/download/latest.json
   ```
4. **Test from v0.1.21 Electron app** (if you have it installed): Launch > wait 15s > should see "Update available v0.2.0"
5. **Edit release notes** — replace the auto-generated notes with the suggested content below

### 4.5 Suggested Release Notes

```markdown
## EdgeView Launcher v0.2.0 — Tauri Migration

EdgeView Launcher has been rebuilt on [Tauri v2](https://tauri.app/), replacing Electron.

### What's Improved
- **~70% smaller download** — no bundled Chromium; uses your OS native webview
- **Lower memory usage** — Rust core instead of Node.js
- **Faster startup**
- Secure token storage via OS keychain
- System tray with quick device access
- One-click compose runtime diagnostics
- Cursor-based pagination for large device lists
- Skeleton loading states for smoother transitions

### Upgrading from v0.1.x

**Windows:** You should receive an auto-update prompt. Allow the installer to run.

**Linux (AppImage):** Auto-update should work. If not, download the new AppImage below.

**Linux (.deb):** Download the new `.deb` from assets below and install manually.

**macOS:** Auto-update is temporarily unavailable on macOS. Download the `.dmg` from assets below, open it, and drag EdgeView Launcher to Applications (replacing the old version).

### After Upgrading
You will need to **re-enter your API token** on first launch. Your cluster configuration (`~/.edgeview-config.json`) and SSH keys (`~/.ssh/edgeview_rsa`) are preserved.

### Known Limitations
- macOS auto-update is disabled pending Apple Developer ID code signing setup
```

---

## Phase 5: Rollback Plan

### If v0.2.0 Has a Critical Bug

**Option A (preferred): Patch release**
1. Fix the bug on a branch off `main`
2. Tag `v0.2.1` — both bridge YAMLs and Tauri `latest.json` will point to v0.2.1
3. Users on Tauri v0.2.0 auto-update via `latest.json`; stragglers on Electron auto-update via YAML

**Option B (emergency): Delete the release, patch, re-release**
1. `gh release delete v0.2.0 --yes` (removes the release, v0.1.21 becomes "Latest" again)
2. `git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0` (delete the tag)
3. Electron users revert to seeing v0.1.21 as latest
4. Fix the bug, re-tag as v0.2.0 or v0.2.1

**Option B risk:** Users who already upgraded to Tauri v0.2.0 check `latest.json`, which no longer exists after the release is deleted. They'll silently fail to find updates (the code in `updater.rs` handles 404 gracefully). They can manually download the fixed version.

**Do NOT attempt to revert to Electron.** The engineering cost is enormous and users who already upgraded to Tauri would be stranded.

---

## Phase 6: Post-Release Cleanup (v0.2.1 or v0.3.0)

These are non-urgent improvements for subsequent releases:

1. **Remove Electron bridge YAML generation from `release.yml`** after 1-2 more releases (once all v0.1.x users have upgraded). The YAML files are only needed for the one-time Electron-to-Tauri bridge.

2. **Remove the macOS manual download workaround** in `UpdateBanner.jsx` once Apple code signing is configured.

3. **Remove the re-authentication banner** (one-time migration UX).

4. **Update `docs/AUTO_UPDATE.md`** — it still describes the Electron architecture. Rewrite for Tauri.

5. **Clean up stale files on main** after merge: verify old Electron files are gone.

6. **Fix `repository.url` mismatch** in `package.json` — currently `sergio-zededa` but releases are at `sergey-zededa`.

---

## Quick Reference: Complete Artifact Matrix for v0.2.0 Release

| Artifact | Purpose | Consumer |
|----------|---------|----------|
| `latest.json` (per-platform) | Tauri updater manifest | Tauri v0.2.0+ apps |
| `*.app.tar.gz` + `*.app.tar.gz.sig` | macOS Tauri update payload | Tauri updater |
| `*.dmg` | macOS fresh install | New users |
| `EdgeViewLauncher-0.2.0-mac.zip` | macOS Electron bridge payload | electron-updater on v0.1.x |
| `latest-mac.yml` | macOS Electron bridge manifest | electron-updater on v0.1.x |
| `*_x64-setup.exe` + `*.nsis.zip.sig` | Windows installer + Tauri update | Both |
| `latest.yml` | Windows Electron bridge manifest | electron-updater on v0.1.x |
| `*.AppImage` + `*.AppImage.sig` | Linux portable + Tauri update | Both |
| `latest-linux.yml` | Linux Electron bridge manifest | electron-updater on v0.1.x |
| `*.deb` | Linux package install | New users / deb users |
