# AGENTS.md

This file provides guidance to AI Agents (including WARP) when working with code in this repository.

## Critical Rules

1. **NEVER DELETE KEYCHAIN ITEMS**: You are strictly forbidden from deleting items from the user's keychain (e.g., via `security delete-generic-password`) unless explicitly and unambiguously instructed to do so by the user for a specific item.
2. **NEVER create git tags** or trigger release builds (CI/CD) unless explicitly instructed by the user.
3. **ALWAYS work using PR process**:
   - Create a new branch for every task or set of changes.
   - **NEVER commit directly to the `main` or `master` branch.**
   - Push your branch to the remote to facilitate PR creation.
3. **Write meaningful commit messages**:
   - Include decent human-readable comments describing the changes.
   - This ensures GitHub produces meaningful "What's changed" messages for every new release.
4. Do not modify `eve/` directory contents as they are reference implementations.
5. **Always run tests and build** after modifying code to verify changes. From the project root:
   - Frontend: `npm run build:frontend` and `npm --prefix frontend test -- --run`
   - Backend: `go test ./...` and `go build -o src-tauri/binaries/edgeview-backend-aarch64-apple-darwin ./cmd/edgeview-backend`
6. **Commit Message Attribution**:
   - **DO NOT** include the `Co-Authored-By` attribution line in commit messages.

## Project Overview

EdgeView Launcher is a Tauri desktop application with a Go backend sidecar for managing remote ZEDEDA edge devices. It provides SSH terminal access, VNC remote desktop, and TCP tunneling through EdgeView proxy connections.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             Tauri Core (Rust)                             │
│  src-tauri/src/main.rs                                                    │
│  - Spawns Go backend as sidecar (edgeview-backend)                        │
│  - Creates WebviewWindow, tray menu, native dialogs                       │
│  - Handles IPC commands (api_call, open_terminal_window)                  │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │ IPC via invoke() / listen()
┌─────────────────────────────▼────────────────────────────────────────────┐
│                        Frontend (React + Vite)                            │
│  frontend/src/                                                            │
│  ├── App.jsx           – Main UI (search, settings, device details)      │
│  ├── tauriAPI.js       – Wraps Tauri commands for API calls              │
│  └── components/                                                          │
│      ├── TerminalView.jsx  – xterm.js WebSocket terminal                 │
│      └── VncViewer.jsx     – NoVNC remote desktop viewer                 │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │ HTTP/WebSocket to localhost:<dynamic-port>
┌─────────────────────────────▼────────────────────────────────────────────┐
│                        Go Backend                                         │
│  http-server.go  – HTTP API routes, WebSocket SSH terminal handler       │
│  app.go          – Business logic, session management, ZEDEDA integration│
│                                                                           │
│  internal/                                                                │
│  ├── config/     – Cluster configuration persistence (~/.edgeview-config)│
│  ├── session/    – EdgeView session cache, TCP tunnel management         │
│  ├── ssh/        – SSH key generation and management                     │
│  └── zededa/     – ZEDEDA Cloud API client (devices, apps, EdgeView)     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Data Flow
1. React calls `tauriAPI.js` → Tauri IPC `api_call` → Tauri Rust proxies HTTP to Go backend
2. SSH Terminal: Frontend opens WebSocket to `/api/ssh/term?port=<port>`
3. VNC: Frontend uses noVNC to connect through EdgeView TCP tunnel
4. EdgeView sessions are cached with ~5 hour expiration

### Key Concepts
- **Clusters**: Multiple ZEDEDA cloud endpoints can be configured (baseUrl + apiToken)
- **EdgeView Sessions**: Authenticated WebSocket tunnels to edge devices via ZEDEDA's EdgeView service, cached ~5 hours. Expiry is stored wall-clock (monotonic stripped via `expiresAt.Round(0)`) so a session that expires while the machine sleeps isn't mistaken for valid. `ResetEdgeView` invalidates the local cache so a reset re-mints cleanly.
- **Tunnels**: Persistent TCP tunnels (SSH, VNC, custom ports) tracked in `session.Manager`
- **Cloud-config vs live-session gating**: Cloud-config ops (Enable SSH/VGA/USB/Console/Ext Policy) are async ZEDEDA PUTs and **must NOT** be gated on device-online; live-session ops (SSH/VNC/tunnels/Collect Info) require an active EdgeView tunnel and **must** be gated on `isSessionConnected`.
- **Auth errors**: ZEDEDA 401s map to `zededa.ErrUnauthorized` → response `code: "UNAUTHORIZED"` → frontend "Update Token" prompt (no raw error blob).

## Development Commands

```bash
# Start development (runs both frontend and backend automatically via tauri.conf.json)
npm run dev

# Rebuild Go backend only (after Go code changes) -> needed before Tauri runs.
# The binary MUST carry the platform-triple suffix so Tauri finds the sidecar.
go build -o src-tauri/binaries/edgeview-backend-aarch64-apple-darwin ./cmd/edgeview-backend

# Build for production
npm run build                       # Builds Tauri package
npm run build:windows               # Windows x64 build
npm run build:linux                 # Linux x64 build

# Run frontend tests
cd frontend && npm test             # Run all tests with Vitest
```

**Important**: The Go binary is the Tauri **sidecar** — it must be placed in `src-tauri/binaries/` and named `edgeview-backend-<target-triple>` (e.g. `edgeview-backend-aarch64-apple-darwin`) so the Tauri shell can spawn it. Tauri discovers its dynamic HTTP port at startup by parsing the backend's stdout line `"HTTP Server starting on :<PORT>"`.

## Testing

Frontend tests use **Vitest** + **React Testing Library** with **jsdom** environment.

All Tauri IPC calls must be mocked in tests:
```javascript
vi.mock('./tauriAPI', () => ({
  SearchNodes: vi.fn().mockResolvedValue([]),
  GetSettings: vi.fn().mockResolvedValue({ clusters: [], activeCluster: '' }),
  // ... other methods
}));
```

## API Endpoints

Key Go backend routes (`http-server.go`):
- `POST /api/search-nodes` – Search devices by name/project
- `POST /api/connect` – Initialize EdgeView session and start SSH proxy
- `POST /api/start-tunnel` – Create TCP tunnel to device IP:port
- `DELETE /api/tunnel/{id}` – Close a tunnel
- `GET /api/ssh/term?port=<port>` – WebSocket endpoint for SSH terminal
- `GET/POST /api/settings` – Cluster configuration CRUD

## API Documentation

For full API documentation of the ZEDEDA Cloud API, refer to the Swagger definition:
[ZEDEDA Edge Node Service Swagger](https://zedcontrol.zededa.net/api/v1/docs/zapiservices/zedge_node_service.swagger.json)

## File Locations

- Config file: `~/.edgeview-config.json` (clusters, recent devices)
- SSH keys: `~/.ssh/edgeview_rsa` and `~/.ssh/edgeview_rsa.pub`
- Go backend binary (dev, mac): `src-tauri/binaries/edgeview-backend-aarch64-apple-darwin`
- Production build output: `src-tauri/target/`

## Release Process

Auto-update depends on the release tag matching the version the running app reports. Run these steps from the project root.

1.  **Bump versions** in all four places: `package.json` (root), `frontend/package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` (then `cargo check` in `src-tauri/` to refresh `Cargo.lock`). CI's `scripts/check-versions.js` fails unless they all agree.

2.  **Land the bump through a PR**, like any other change (see rule 3).

3.  **Create the release** after the PR merges. The tag must match `v*` and point at the latest commit on `main`; a release pointing at an older commit breaks auto-update, because the app's internal version won't match the tag.

    ```bash
    gh release create v0.x.y --target main --generate-notes --title "v0.x.y"
    ```

4.  **Verify** that the GitHub Action "Release" workflow succeeds and that the release has the installers (`EdgeView.Launcher_x.y.z_universal.dmg`, `EdgeView.Launcher_x.y.z_x64-setup.exe`, `EdgeView.Launcher_x.y.z_amd64.AppImage`) and `latest.json`, which the updater reads.
