# EdgeView Launcher

EdgeView Launcher is a desktop application for connecting to ZEDEDA-managed edge devices via EdgeView. It provides SSH terminal access, VNC remote desktop, and TCP tunnels to services running on EVE-OS devices.

This repository contains three main parts:
- **Electron shell** (root JavaScript files) – window management, tray integration, and process orchestration
- **Frontend** (`frontend/`) – React UI, device search, tunnel management, terminal and VNC views
- **Go backend** (root Go files and `internal/`) – HTTP API, EdgeView session management, SSH/VNC/TCP tunneling

For a more detailed architectural overview, see `WARP.md` and the source code in `internal/`, `frontend/`, and the Electron entry files.

## Prerequisites

- Go toolchain (for the backend)
- Node.js + npm (for the frontend and Electron shell)
- A ZEDEDA account with EdgeView access and a valid API token

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
