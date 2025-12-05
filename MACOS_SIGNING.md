# macOS Code Signing & Notarization Guide

## The Problem

macOS shows "EdgeView Launcher is damaged" error when users download and try to open the DMG on different Macs. This is because the app is **not properly code signed** (using adhoc signature).

## Current State

- ✅ App works on the build machine
- ❌ App blocked on other Macs ("damaged" error)
- ❌ Not notarized by Apple
- ❌ Not signed with Developer ID

## Solutions

### Option 1: For Testing/Internal Distribution (Current Setup)

**Users must bypass Gatekeeper manually:**

1. Download the DMG
2. Right-click the app → Select "Open" (don't double-click!)
3. Click "Open" in the security dialog
4. App will run (only need to do this once)

**Alternative terminal command:**
```bash
xattr -cr "/Applications/EdgeView Launcher.app"
```

This is acceptable for internal testing but **not suitable for public distribution**.

---

### Option 2: Proper Code Signing (Recommended for Distribution)

To distribute to other Macs without warnings, you need:

#### Prerequisites

1. **Apple Developer Account** ($99/year)
   - Sign up at https://developer.apple.com

2. **Developer ID Certificate**
   - Go to https://developer.apple.com/account/resources/certificates
   - Create "Developer ID Application" certificate
   - Download and install in Keychain Access

#### Configuration Steps

1. **Find your certificate identity:**
```bash
security find-identity -v -p codesigning
```

Look for: `Developer ID Application: Your Name (TEAM_ID)`

2. **Update package.json with your identity:**
```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "entitlements.mac.plist",
      "entitlementsInherit": "entitlements.mac.plist"
    }
  }
}
```

3. **Build with signing:**
```bash
npm run build
```

The app will now be signed with your Developer ID.

---

### Option 3: Full Notarization (Best - No Warnings)

After code signing, you should **notarize** the app with Apple for zero warnings.

#### Additional Prerequisites

1. **App-Specific Password** for notarization:
   - Go to https://appleid.apple.com/account/manage
   - Generate app-specific password
   - Save it securely

2. **Store credentials:**
```bash
xcrun notarytool store-credentials "AC_PASSWORD" \
  --apple-id "your-apple-id@example.com" \
  --team-id "YOUR_TEAM_ID" \
  --password "xxxx-xxxx-xxxx-xxxx"
```

3. **Update package.json:**
```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "entitlements.mac.plist",
      "entitlementsInherit": "entitlements.mac.plist"
    },
    "afterSign": "scripts/notarize.js"
  }
}
```

4. **Create notarization script:**

See `scripts/notarize.js` (create if needed):
```javascript
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;  
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: 'com.edgeview.launcher',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  });
};
```

5. **Install notarization package:**
```bash
npm install --save-dev @electron/notarize
```

6. **Build with notarization:**
```bash
APPLE_ID="your@email.com" \
APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
APPLE_TEAM_ID="YOUR_TEAM_ID" \
npm run build
```

---

## Verification

### Check code signature:
```bash
codesign -dv --verbose=4 "dist-electron/mac-arm64/EdgeView Launcher.app"
```

**Good signature shows:**
- `Authority=Developer ID Application: Your Name`
- `Signature=Developer ID`

**Bad signature shows:**
- `Signature=adhoc` ← Current state (not signed)

### Check notarization:
```bash
spctl -a -vv "dist-electron/mac-arm64/EdgeView Launcher.app"
```

**Good result:**
```
accepted
source=Notarized Developer ID
```

**Bad result:**
```
rejected
source=no usable signature
```

---

## Current Workaround for Users

Until proper signing is implemented, instruct users to:

1. Download and mount the DMG
2. **Right-click** the app (don't double-click!)
3. Select "Open"
4. Click "Open" in the dialog

Or use this command:
```bash
xattr -cr "/Applications/EdgeView Launcher.app"
open "/Applications/EdgeView Launcher.app"
```

---

## Estimated Effort

- **Option 1** (Current): ✅ Already done - users bypass manually
- **Option 2** (Code signing): ~30 minutes setup + $99/year
- **Option 3** (Full notarization): ~1 hour setup + $99/year

## Resources

- [Electron Code Signing](https://www.electron.build/code-signing)
- [Apple Notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [electron-builder Notarization](https://www.electron.build/configuration/mac#notarization)
