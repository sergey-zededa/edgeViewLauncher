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
- **Tauri shell** (`src-tauri/`) – window management, tray integration, secure storage, and process orchestration
- **Frontend** (`frontend/`) – React UI, device search, tunnel management, terminal and VNC views
- **Go backend** (root Go files and `internal/`) – HTTP API, EdgeView session management, SSH/VNC/TCP tunneling

For a more detailed architectural overview, see `CLAUDE.md` (and `AGENTS.md`) and the source code in `internal/`, `frontend/`, and `src-tauri/`.

## Development Prerequisites

- Rust toolchain (for the Tauri desktop shell)
- Go toolchain (for the backend sidecar)
- Node.js (v20+ recommended) + npm (for the frontend React UI)

## Development

The development workflow is driven by the Tauri + Go backend + React frontend stack. The typical setup is:

1. **Build and run the Go backend**
   - Build the backend binary at the repository root into `src-tauri/binaries/edgeview-backend-{target}`.
2. **Run Tauri in development mode**
   - Run `npm run dev` at the project root to start the Tauri app. Tauri will automatically spawn the Go backend and the Vite dev server.

Exact commands and variations can be found in `CLAUDE.md` and the package/config files (`package.json`, `tauri.conf.json`).

## Key Components

- `src-tauri/src/main.rs` – Tauri main process, tray icon, window lifecycle, backend sidecar orchestration
- `src-tauri/src/commands/` – Rust commands exposed to the React frontend
- `frontend/src/App.jsx` – main React UI for clusters, devices, tunnels, and settings
- `frontend/src/components/TerminalView.jsx` – xterm.js-based SSH terminal over WebSocket
- `frontend/src/components/VncViewer.jsx` – noVNC-based remote desktop client
- `http-server.go` – HTTP and WebSocket routes used by the frontend (via the Tauri `api_call` command)
- `app.go` and `internal/` packages – ZEDEDA API client, EdgeView sessions, tunnel manager, SSH handling

Refer to comments in these files and to `CLAUDE.md` for implementation details and development conventions.

## Building

Build and packaging are handled via Tauri CLI. To create distributable installers:

```bash
# macOS ARM64 (default)
npm run build

# Windows x64 (requires cross-compilation setup or running on Windows)
npm run build:windows

# Linux x64
npm run build:linux
```

Artifacts are written into `src-tauri/target/` (per-target `release/bundle/` subfolders).

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

For detailed information about the auto-update system, see `docs/AUTO_UPDATE.md`.

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

- `CLAUDE.md` / `AGENTS.md` – repository-specific development guidance, architecture notes, and testing instructions
- `frontend/WARP.md` – frontend-focused development guidance
- `docs/AUTO_UPDATE.md` – detailed auto-update implementation and release process
- Source code (especially `internal/` and `frontend/`) for the authoritative behaviour of sessions, tunnels, and UI flows

## License

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
