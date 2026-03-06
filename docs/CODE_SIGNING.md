# Code Signing for EdgeView Launcher (Tauri)

## Overview

macOS requires applications to be code-signed to access certain system features (like the Keychain) and to run on Apple Silicon devices without ad-hoc signing hacks.

## Local Development Signing ("EdgeView Dev")

For local development, we use a self-signed certificate named **"EdgeView Dev"**. This allows the app to:
1. Build and run locally on macOS (including Apple Silicon).
2. Access the macOS Keychain for secure token storage.
3. Mimic the production signing environment.

### Setup

To set up the local signing identity:

1. **Create the Certificate**:
   Use the `scripts/setup-dev-cert.sh` script (if available) or create a self-signed code signing certificate in Keychain Access named "EdgeView Dev".

2. **Configure Keychain Access**:
   The `codesign` tool needs permission to access the private key of the certificate.
   - When you build the app for the first time, macOS will prompt you to allow `codesign` to access the keychain.
   - **Always select "Always Allow"** to prevent future prompts and build failures.
   - If you accidentally denied access or the prompt doesn't appear, you can manually grant access:
     ```bash
     security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "YOUR_LOGIN_PASSWORD" login.keychain-db
     ```

### Troubleshooting Keychain Issues

#### "errSecInternalComponent" or Auto-Dismissing Prompts

If the build fails with `errSecInternalComponent` or if the app launches but the keychain access prompt appears and immediately disappears (making the app unusable), it is likely due to a **keychain item conflict**.

This happens when a keychain item (e.g., stored tokens) was created by a binary signed with a *different* identity (e.g., ad-hoc signed or signed by a different certificate) than the current build.

**Fix:**
Delete the conflicting generic password item from the keychain:

```bash
security delete-generic-password -l "edgeview-launcher-v2"
```

After deleting the item, restart the app. You will need to re-authenticate (enter your API tokens) as the secure storage has been reset.

## Production Signing

For production builds (e.g., CI/CD), we use a valid **Developer ID Application** certificate from Apple.

### Environment Variables

The Tauri build process (`tauri build`) looks for the following environment variables:
- `APPLE_SIGNING_IDENTITY`: The name or SHA-1 hash of the signing identity (e.g., "Developer ID Application: ZEDEDA Inc (TEAM_ID)").
- `APPLE_CERTIFICATE`: Base64-encoded `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: Password for the `.p12` file.
- `APPLE_KEYCHAIN_PASSWORD`: (Optional) Password for the temporary keychain created during CI.

### Notarization

After signing, the app must be notarized by Apple to run on user machines without "unidentified developer" warnings. This requires:
- `APPLE_ID`: Apple ID email.
- `APPLE_PASSWORD`: App-specific password.
- `APPLE_TEAM_ID`: Apple Team ID.

## Verification

To verify the signature of a built app:

```bash
codesign -dv --verbose=4 "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/EdgeView Launcher.app"
```

To verify entitlements (required for Keychain access):

```bash
codesign -d --entitlements :- "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/EdgeView Launcher.app"
```
