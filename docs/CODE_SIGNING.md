# Code Signing for EdgeView Launcher

## Overview

macOS auto-update functionality requires **properly code-signed applications**. Without code signing:
- Auto-update will fail with signature validation errors
- Users will see security warnings when opening the app
- The app cannot be distributed via Mac App Store

## Current Status

⚠️ **The GitHub Actions builds are NOT code-signed**

This means:
- ✅ Apps built locally or via CI can be installed
- ✅ Apps run normally after bypassing Gatekeeper  
- ❌ Auto-update does NOT work
- ❌ Users see "unidentified developer" warnings

## Setting Up Code Signing

### Prerequisites

1. **Apple Developer Account** ($99/year for organizations)
   - Enroll at https://developer.apple.com/programs/

2. **Developer ID Application Certificate**
   - Log in to Apple Developer portal
   - Go to Certificates, Identifiers & Profiles
   - Create new certificate → Developer ID Application
   - Download and install in macOS Keychain

3. **App-Specific Password** (for notarization)
   - Go to https://appleid.apple.com/
   - Sign In → Security → App-Specific Passwords
   - Generate password for "EdgeView Launcher Notarization"

### Configuration

#### Step 1: Add Certificates to Build Machine

**For local builds:**
```bash
# Export certificate from Keychain
# Certificates & Keys → Right-click Developer ID Application → Export

# Import on build machine
security import certificate.p12 -k ~/Library/Keychains/login.keychain-db
```

**For GitHub Actions:**
```bash
# Base64 encode certificate
base64 -i certificate.p12 -o certificate-base64.txt

# Add to GitHub Secrets:
# - MACOS_CERTIFICATE: (content of certificate-base64.txt)
# - MACOS_CERTIFICATE_PWD: (p12 password)
# - APPLE_ID: (your Apple ID email)
# - APPLE_APP_PASSWORD: (app-specific password)
# - APPLE_TEAM_ID: (10-character team ID from Apple Developer)
```

#### Step 2: Update package.json

Add to `build.mac` section:
```json
{
  "mac": {
    "identity": "Developer ID Application: ZEDEDA Inc (TEAM_ID)",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "assets/entitlements.mac.plist",
    "entitlementsInherit": "assets/entitlements.mac.plist",
    "notarize": {
      "teamId": "TEAM_ID"
    }
  }
}
```

#### Step 3: Update GitHub Actions Workflow

Add certificate import and notarization to `.github/workflows/release.yml`:

```yaml
- name: Import Code Signing Certificate
  env:
    MACOS_CERTIFICATE: ${{ secrets.MACOS_CERTIFICATE }}
    MACOS_CERTIFICATE_PWD: ${{ secrets.MACOS_CERTIFICATE_PWD }}
  run: |
    echo $MACOS_CERTIFICATE | base64 --decode > certificate.p12
    security create-keychain -p actions build.keychain
    security default-keychain -s build.keychain
    security unlock-keychain -p actions build.keychain
    security import certificate.p12 -k build.keychain -P $MACOS_CERTIFICATE_PWD -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k actions build.keychain

- name: Build Electron app (macOS universal)
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_PASSWORD: ${{ secrets.APPLE_APP_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  run: npx electron-builder --mac --publish always
```

## Testing Code Signing

### Verify Signed Build

```bash
# Check if app is signed
codesign -dv --verbose=4 "dist-electron/mac-arm64/EdgeView Launcher.app"

# Verify signature
codesign --verify --verbose=4 "dist-electron/mac-arm64/EdgeView Launcher.app"

# Check notarization
spctl -a -vvv -t install "dist-electron/mac-arm64/EdgeView Launcher.app"
```

Expected output:
```
source=Notarized Developer ID
origin=Developer ID Application: ZEDEDA Inc (TEAM_ID)
```

## Workaround: Manual Updates

Until code signing is set up, users can:

1. **Download from GitHub Releases**
   - Go to https://github.com/sergey-zededa/edgeViewLauncher/releases
   - Download latest `.dmg` or `.zip` file
   - Install manually

2. **Bypass Gatekeeper** (first launch only)
   ```bash
   xattr -cr "/Applications/EdgeView Launcher.app"
   ```

3. **Or**: Right-click app → Open → "Open Anyway"

## Cost Considerations

- **Apple Developer Program**: $99/year
- **No additional costs** for code signing or notarization
- One certificate works for all apps from the organization

## Timeline

Typical setup time: **2-3 hours**
- 1 hour: Apple Developer enrollment (if needed)
- 30 min: Certificate generation and export
- 30 min: GitHub Secrets configuration
- 30 min: Workflow updates and testing

## References

- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
- [Notarizing macOS Software](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
