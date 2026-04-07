# EdgeView Launcher v0.2.2 — Release Notes

## New Foundation

EdgeView Launcher has been rebuilt on [Tauri v2](https://v2.tauri.app/), replacing the previous Electron framework. The app is now **significantly smaller** (~22 MB vs ~150 MB), **starts faster**, and uses **less memory** while running. Your cluster configurations and SSH keys are preserved automatically during the upgrade. **API tokens will need to be re-entered** on first launch — the app will prompt you with a re-authentication banner.

## What's New

**One-Click Compose Diagnostics**
Collect runtime diagnostics for Docker Compose app instances directly from the device detail view — logs, network state, and container status in a single download.

**Improved Terminal & VNC Sessions**
- Stop an active SSH or VNC tunnel directly from within the terminal/viewer — no need to navigate back to the device panel.
- Fixed a data corruption issue in SSH tunnels that could cause garbled output during high-throughput sessions.
- Interactive SSH password authentication now works correctly.

**Smarter Device Search**
- Search results now load progressively as you scroll (lazy loading) instead of fetching everything upfront.
- Project-filtered searches are faster and no longer show stale results from other projects.
- Fixed pagination issues with large device fleets.

**Better Cluster Management**
- New quick cluster switcher lets you jump between cloud endpoints without opening Settings.
- Switching clusters now shows smooth loading transitions instead of briefly flashing old data.
- Base URL field shows an example format, and the API Token field includes a step-by-step setup guide.

**Refreshed Interface**
- Loading spinners replaced with skeleton placeholders that match the layout — no more content jumping.
- Status messages now appear as floating toasts that don't push content around.
- Port input combines a text field with a dropdown of common ports (SSH 22, VNC 5900, HTTP 80, etc.).
- Tooltips throughout the app now include links to relevant ZEDEDA documentation.
- Offline/suspect devices show read-only details with clearly disabled controls.

**Auto-Updates (Windows & Linux)**
The app checks for updates automatically on launch. On Windows and Linux, updates download and install in the background. On macOS, you'll see a notification with a download link (full auto-update requires Apple code signing, planned for a future release).

**Seamless Upgrade from v0.1.x**
The Windows installer now installs to the same directory as the old Electron app, automatically kills lingering backend processes, and removes the old installation — no manual cleanup needed.

## Bug Fixes

- **VNC viewer** — fixed "Object is not a constructor" error caused by Vite 8 CJS interop change with noVNC
- **Auto-updater** — error toast now shows the actual failure reason instead of a generic message
- **Collect Info** no longer produces 0-byte downloads
- **External Connection Policy** blocking a connection now shows a clear error message instead of a generic failure
- **macOS tray icon** is now visible in both light and dark menu bars, and responds to left-click
- **Docker Compose shell** correctly detects management IPs on airgapped devices and passes credentials properly
- **Settings panel** no longer crashes when quickly switching between clusters
- **About dialog** respects your light/dark theme preference

## Maintenance

- Updated dependencies: vite 8.0, jsdom 29, lucide-react 0.577, golang.org/x/crypto 0.49
- Fixed rollup high-severity vulnerability (GHSA-mw96-cpmx-2vgc)
- Enabled CodeQL security analysis in CI
- Bumped Go to 1.25, GitHub Actions to v5/v6
- Resolved all Rust clippy warnings
- Added VNC component tests (80 total tests, up from 70)
