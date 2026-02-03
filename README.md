# EdgeView Launcher

EdgeView Launcher is a native desktop application for managing and connecting to ZEDEDA-managed edge devices via EdgeView. Unlike other solutions, this application runs directly on your operating system without requiring Docker containers or complex environment setup. It is available for macOS, Windows, and Linux.

## Features

*   **Native User Interface**: A standalone desktop application that integrates with your operating system.
*   **Integrated Remote Desktop**: Built-in noVNC viewer for graphical access to device displays.
*   **Integrated Terminal**: Full-featured xTerm-based SSH terminal for command-line access.
*   **TCP Tunneling**: Create secure tunnels to services running on EVE-OS devices.
*   **Session Management**: Handles authentication and session persistence automatically.

## Quick Start

### Installation

Download the latest release for your operating system from the GitHub Releases page.

**macOS Users**:
If the application is not code signed, you may need to clear the quarantine attribute after moving the application to your Applications folder:

```bash
xattr -cr "/Applications/EdgeView Launcher.app"
```

### Configuration

1.  Launch the application.
2.  Navigate to the Settings tab.
3.  Add a new cluster configuration with your ZEDEDA instance URL and API token.
4.  Save the configuration and connect to start managing your devices.

## Architecture

This repository contains three main parts:
- **Electron shell** (root JavaScript files) – window management, tray integration, and process orchestration
- **Frontend** (`frontend/`) – React UI, device search, tunnel management, terminal and VNC views
- **Go backend** (root Go files and `internal/`) – HTTP API, EdgeView session management, SSH/VNC/TCP tunneling

For a more detailed architectural overview, see `WARP.md` and the source code in `internal/`, `frontend/`, and the Electron entry files.

## Development Prerequisites

- Go toolchain (for the backend)
- Node.js (v20+ recommended) + npm (for the frontend and Electron shell)

## Development

The development workflow is driven by the Electron + Go backend + React frontend stack. The typical setup is:

1. **Start the frontend (Vite)**
   - Change into `frontend/` and run the Vite dev server (see `frontend/package.json` scripts).
2. **Build and run the Go backend**
   - Build the backend binary at the repository root.
3. **Run Electron in development mode**
   - Use the npm scripts in the root `package.json` to start the Electron shell, which will load the frontend and talk to the Go backend.

Exact commands and variations can be found in `WARP.md` and the package/config files (`package.json`, `frontend/package.json`).

## Key Components

- `electron-main.js` – Electron main process, tray icon, window lifecycle, backend process management
- `electron-preload.js` – IPC surface exposed to the React frontend
- `frontend/src/App.jsx` – main React UI for clusters, devices, tunnels, and settings
- `frontend/src/components/TerminalView.jsx` – xterm.js-based SSH terminal over WebSocket
- `frontend/src/components/VncViewer.jsx` – noVNC-based remote desktop client
- `http-server.go` – HTTP and WebSocket routes used by the frontend and Electron
- `app.go` and `internal/` packages – ZEDEDA API client, EdgeView sessions, tunnel manager, SSH handling

Refer to comments in these files and to `WARP.md` for implementation details and development conventions.

## Building

Build and packaging are handled via Electron Builder. To create distributable installers:

```bash
# macOS ARM64 (default)
npm run build

# Windows x64 (requires cross-compilation setup or running on Windows)
npm run build:windows

# Linux x64
npm run build:linux
```

Artifacts are written into `dist-electron/`.

### Code Signing

For distribution, the app should be code signed and notarized to avoid security warnings.
Refer to `package.json` build configuration for signing identities and notarization scripts.
Without signing, users may need to manually bypass Gatekeeper (e.g., `xattr -cr /Applications/EdgeView\ Launcher.app`).

## Auto-Update

The application supports automatic updates via GitHub Releases:

- Checks for updates automatically on startup (production builds only)
- Users are notified when new versions are available
- One-click download and installation
- Manual update check available in Settings

For detailed information about the auto-update system, see `AUTO_UPDATE.md`.

## Contributing

This repository is maintained by ZEDEDA. While the source code is public, we require:

- **All changes must be submitted via Pull Requests**
- **At least one maintainer approval required** before merging
- **Branch protection** prevents direct pushes to main
- **Issues and discussions** are welcome for bug reports and feature requests

Before contributing, please:
1. Open an issue to discuss your proposed changes
2. Fork the repository and create a feature branch
3. Ensure tests pass (`npm test` in frontend/)
4. Submit a pull request with a clear description

## Additional Documentation

- `WARP.md` – repository-specific development guidance, architecture notes, and testing instructions
- `AUTO_UPDATE.md` – detailed auto-update implementation and release process
- Source code (especially `internal/` and `frontend/`) for the authoritative behaviour of sessions, tunnels, and UI flows

## License

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
