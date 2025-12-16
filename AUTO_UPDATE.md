# Auto-Update Implementation

This document describes the automatic update system implemented for EdgeView Launcher.

## Overview

The application now supports automatic updates through GitHub Releases using `electron-updater`. Users are notified when new versions are available, can download updates with progress tracking, and install them with a single click.

## Features

- **Automatic Update Checks**: Checks for updates 15 seconds after app launch (production only)
- **Update Notification Banner**: Non-intrusive banner appears at the top when updates are available
- **Download Progress**: Visual progress bar showing download percentage
- **One-Click Installation**: Users can restart and install with a single button click
- **Manual Update Check**: "Check for Updates" button in Settings
- **Version Display**: Current version and build number shown in Settings
- **Cross-Platform**: Works on macOS (ARM64, x64), Windows (x64), and Linux (AppImage)

## Architecture

### Backend (Electron Main Process)

**File**: `electron-main.js`

- Imports `autoUpdater` from `electron-updater`
- Configures update behavior:
  - `autoDownload = false` - User must manually trigger downloads
  - `autoInstallOnAppQuit = true` - Updates install on next app launch
- Event handlers for all update lifecycle events
- IPC handlers for:
  - `check-for-updates`: Manual update check
  - `download-update`: Start downloading
  - `install-update`: Quit and install

### Preload Bridge

**File**: `electron-preload.js`

Exposes update methods to renderer:
- `checkForUpdates()`
- `downloadUpdate()`
- `installUpdate()`
- Event listeners: `onUpdateAvailable`, `onUpdateDownloadProgress`, `onUpdateDownloaded`, `onUpdateError`

### Frontend API

**File**: `frontend/src/electronAPI.js`

Wrapper functions that call the preload bridge methods:
- `CheckForUpdates()`
- `DownloadUpdate()`
- `InstallUpdate()`
- `OnUpdateAvailable(callback)`
- `OnUpdateNotAvailable(callback)`
- `OnUpdateDownloadProgress(callback)`
- `OnUpdateDownloaded(callback)`
- `OnUpdateError(callback)`

### UI Components

**UpdateBanner Component** (`frontend/src/components/UpdateBanner.jsx`)

Displays different states:
- **Available**: Shows version, Download and Dismiss buttons
- **Downloading**: Shows progress bar with percentage
- **Downloaded**: Shows Restart & Install and Later buttons
- **Error**: Shows error message and Dismiss button

**App.jsx Integration**

- State management for update status
- Event listener setup in `useEffect`
- Banner displayed at top of app (before auth error banner)
- Settings page includes:
  - Current version display
  - "Check for Updates" button
  - Update status indicators

### Styling

**File**: `frontend/src/components/UpdateBanner.css`

- Blue gradient banner with white text
- Smooth slide-down animation
- Progress bar with white fill
- Error state uses red gradient
- Responsive button styling

## CI/CD Integration

**File**: `.github/workflows/release.yml`

Changed all build steps from `--publish never` to `--publish always`:
- macOS ARM64 build
- macOS x64 build  
- Windows x64 build
- Linux x64 build

This generates update manifests automatically:
- `latest-mac.yml` (macOS)
- `latest.yml` (Windows)
- `latest-linux.yml` (Linux AppImage)

## Configuration

**File**: `package.json`

**Important**: `electron-updater` must be installed as a regular dependency (not devDependency) since it's required at runtime in the packaged application.

Added repository and publish configuration:
```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/sergey-zededa/edgeViewLauncher.git"
  },
  "build": {
    "publish": {
      "provider": "github",
      "owner": "sergey-zededa",
      "repo": "edgeViewLauncher",
      "private": true
    }
  }
}
```

### Private Repository Setup

**This repository is private**, which requires additional configuration:

1. **Create a Personal Access Token (PAT)**:
   - Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Click "Generate new token (classic)"
   - Name it "EdgeView Launcher Releases"
   - Select scopes: `repo` (Full control of private repositories)
   - Generate and copy the token

2. **Add token to GitHub Secrets**:
   - Go to repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `GH_TOKEN`
   - Value: Paste your PAT
   - This will be used by CI/CD to publish releases

3. **Make releases public** (required for auto-update to work):
   - Go to repository Settings → General → Danger Zone
   - Find "Change repository visibility"
   - You can keep the source code private but make releases public
   - Alternatively, each release can be manually made public after creation

**Important**: Auto-updates from private repositories have limitations:
- `electron-updater` running in the app needs to download update manifest files
- For private repos, these files require authentication which cannot be securely embedded in the app
- **Recommended solution**: Keep source code private but make releases public
- If releases must stay private, users will need to manually download updates

## Testing

**Test File**: `frontend/src/components/UpdateBanner.test.jsx`

11 comprehensive tests covering:
- Rendering different states (available, downloading, downloaded, error)
- Button click handlers
- Progress bar updates
- Error handling
- Component visibility logic

All tests pass successfully.

## Usage for Releases

### Creating a New Release

1. Update version in `package.json` and `frontend/package.json`
2. Commit the version change
3. Create and push a git tag:
   ```bash
   git tag -a v0.1.2 -m "Release version 0.1.2"
   git push origin v0.1.2
   ```
4. GitHub Actions will automatically:
   - Build artifacts for all platforms
   - Generate update manifests
   - Create a GitHub Release
   - Upload all files to the release

### Update Flow for Users

1. User launches app
2. After 15 seconds, app checks for updates (production only)
3. If newer version found:
   - Blue banner appears at top: "New version X.Y.Z is available"
   - User clicks "Download"
   - Progress bar shows download percentage
   - When complete: "Update X.Y.Z is ready to install"
   - User clicks "Restart & Install"
   - App quits and restarts with new version

## Development Mode

Auto-update is disabled in development mode (when `NODE_ENV=development`). This prevents the app from attempting to update during development.

## Platform-Specific Notes

### macOS
- Works with both DMG and ZIP distributions
- Supports both ARM64 and x64 architectures
- Code signing recommended for production

### Windows
- Uses NSIS installer with differential updates
- Subsequent updates are seamless (no UAC prompts)
- Updates only the changed files

### Linux
- Auto-update only works with AppImage distribution
- Deb packages don't support auto-update (use system package manager)
- Users should download and use AppImage for auto-updates

## Security

- Update manifests and binaries are served over HTTPS via GitHub Releases
- Checksums verified automatically by electron-updater
- Signature verification enabled by default
- All downloads from trusted GitHub infrastructure

## Troubleshooting

### Updates Not Working

1. Check internet connectivity
2. Verify GitHub Releases are published correctly
3. Check browser console for error messages
4. Ensure app version in package.json is lower than release version

### Development Testing

To test updates in development:
1. Comment out the `NODE_ENV` check in `electron-main.js`
2. Build and publish a test release
3. Run the app and trigger manual update check
4. Restore the `NODE_ENV` check after testing
