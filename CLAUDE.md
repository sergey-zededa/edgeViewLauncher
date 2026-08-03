# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Rules

- **NEVER DELETE KEYCHAIN ITEMS** unless explicitly and unambiguously instructed for a specific item.
- **NEVER create git tags** or trigger release builds unless explicitly instructed.
- **NEVER commit directly to `main`**. Always work on a feature branch and use PRs.
- **Do not modify `eve/`** — it contains reference implementations.
- **Do NOT include `Co-Authored-By`** attribution in commit messages.
- **Always run tests and build** after modifying code to verify changes.

## Architecture

EdgeView Launcher is a **Tauri v2 desktop app** with three layers:

```
Tauri Core (Rust) — src-tauri/
  Spawns Go backend as sidecar, creates windows, tray, and IPC commands.
  All frontend API calls go through the generic api_call IPC command,
  which proxies HTTP requests to the Go backend on a dynamic port.

Frontend (React + Vite) — frontend/
  src/App.jsx: main UI — clusters, devices, tunnels, settings
  src/tauriAPI.js: wraps all Tauri invoke() calls
  src/components/TerminalView.jsx: xterm.js terminal over WebSocket
  src/components/VncViewer.jsx: noVNC embedded viewer (overlay in main window)
  vnc.html: standalone VNC window (separate Vite entry point, NOT in src/)
  ⚠️  vnc.html imports noVNC independently from VncViewer.jsx — both
     must be kept in sync for any dependency or import changes.

Go Backend (sidecar) — cmd/edgeview-backend/
  http-server.go: HTTP routes and WebSocket SSH terminal handler
  app.go: business logic, ZEDEDA API integration, session management
  internal/config/: cluster config persistence (~/.edgeview-config.json)
  internal/session/: EdgeView session cache, TCP tunnel management
  internal/ssh/: SSH key generation (~/.ssh/edgeview_rsa)
  internal/zededa/: ZEDEDA Cloud API client
```

**Data flow**: React → `tauriAPI.js` (invoke) → Rust `api_call` command → HTTP to Go backend on `localhost:<dynamic-port>`. The port is discovered at startup by parsing the Go backend's stdout log line `"HTTP Server starting on :<PORT>"`.

**Key concepts**:
- **Clusters**: Multiple ZEDEDA cloud endpoints (baseUrl + apiToken), stored in `~/.edgeview-config.json`
- **EdgeView Sessions**: Authenticated WebSocket tunnels to edge devices, cached ~5 hours. Cache entries store `ExpiresAt` with the monotonic clock reading stripped (`expiresAt.Round(0)` in `internal/session/manager.go` `StoreCachedSession`) so expiry is judged by **wall-clock** time — the macOS monotonic clock pauses during sleep, which would otherwise let the backend treat a session that expired overnight as still valid while the frontend (wall-clock) shows it expired. `ResetEdgeView` (`app.go`) recycles the cloud session **and** calls `InvalidateSession(nodeID)` so a reset forces a fresh mint instead of resurrecting the stale cache entry.
- **Tunnels**: Persistent TCP tunnels (SSH port 2222, VNC port 5900, custom) tracked in `session.Manager`
- **Compose app nesting**: `APP_TYPE_DOCKER_COMPOSE` instances render indented under the docker runtime hosting them. The ZEDEDA app-instance API has no child→runtime reference, so the backend derives it in `resolveComposeParents` (`app.go`) and ships it as `parentAppId`; the frontend groups on that field. **Never correlate nesting by IP alone** — that is the bug fixed in `compose_parent_test.go`. Only instances declaring `DEPLOYMENT_TYPE_DOCKER_RUNTIME` are candidate parents (a K3s/standalone VM cannot host a compose app), and a compose app inherits its runtime's IP for display *only after* its parent is resolved — giving every IP-less app a runtime's IPs fabricates the very overlap the grouping reads as evidence. Ambiguous cases stay unparented on purpose; top-level is better than wrong-parent.
- **Cloud-config vs live-session operations**: Device operations split into two classes with very different UI gating requirements.
  - *Cloud-config* (Enable SSH/VGA/USB/Console/External Policy, etc.) are ZEDEDA Cloud PUTs via `internal/zededa/client.go` `UpdateDevice()`. The device reconciles asynchronously on reconnect, so these **must NOT be gated on device-online status** — users should be able to queue them while the device is down.
  - *Live-session* (SSH Terminal, VNC, TCP tunnels, Collect Info) require an active EdgeView WebSocket tunnel from `internal/session/` and **must be gated on `isSessionConnected`** (which implies online).
  - When adding a new device-detail control, classify it before wiring gating. Regression test pattern: `frontend/src/App.test.jsx` → "config chips (VGA/USB/Console/SSH/Ext Policy) work on offline devices".
- **Auth errors (expired/invalid token)**: ZEDEDA 401s are mapped to the `zededa.ErrUnauthorized` sentinel in `internal/zededa/client.go`; `sendError` (`http-server.go`) detects it via `errors.Is` and returns a `code: "UNAUTHORIZED"` response. `tauriAPI.js` copies that code onto the thrown error, and `App.jsx` (`isAuthError`/`handleAuthError`) shows an actionable "Update Token" prompt that deep-links to the active cluster's token field — instead of dumping the raw ZEDEDA error envelope. The transient cold-start 401 ("Session Cache miss") is still absorbed by `GetEnterprise`'s retry loop before the sentinel surfaces.
- The Go binary is named `edgeview-backend` and placed in `src-tauri/binaries/` with a platform triple suffix (e.g., `edgeview-backend-aarch64-apple-darwin`)

## Development Commands

All commands run from the **project root** unless noted.

```bash
# Start full dev environment (spawns Vite + Tauri; Go backend must be pre-built)
npm run dev

# Build Go backend (required before `npm run dev` if Go code changed)
go build -o src-tauri/binaries/edgeview-backend-aarch64-apple-darwin ./cmd/edgeview-backend

# Build frontend only
npm run build:frontend          # or: cd frontend && npm run build

# Run frontend tests (Vitest + React Testing Library)
cd frontend && npm test
cd frontend && npm test -- --run   # non-watch mode (used in CI)

# Run Go tests
go test ./...

# Run Rust tests
cd src-tauri && cargo test

# Go vet
go vet ./...

# Production builds
npm run build           # macOS ARM64
npm run build:windows   # Windows x64
npm run build:linux     # Linux x64
```

## Testing Notes

Frontend tests use **Vitest** + **React Testing Library** with **jsdom**. All Tauri IPC calls must be mocked:

```javascript
vi.mock('./tauriAPI', () => ({
  SearchNodes: vi.fn().mockResolvedValue([]),
  GetSettings: vi.fn().mockResolvedValue({ clusters: [], activeCluster: '' }),
}));
```

## Go Backend API Endpoints

Defined in `cmd/edgeview-backend/http-server.go`:
- `POST /api/search-nodes` — search devices by name/project
- `POST /api/connect` — initialize EdgeView session, start SSH proxy
- `POST /api/start-tunnel` — create TCP tunnel to device IP:port
- `DELETE /api/tunnel/{id}` — close a tunnel
- `GET /api/ssh/term?port=<port>` — WebSocket endpoint for SSH terminal
- `GET/POST /api/settings` — cluster configuration CRUD

## File Locations

- Config: `~/.edgeview-config.json`
- SSH keys: `~/.ssh/edgeview_rsa` and `~/.ssh/edgeview_rsa.pub`
- Go backend binary (dev, mac): `src-tauri/binaries/edgeview-backend-aarch64-apple-darwin`
- Production build output: `src-tauri/target/`

## Release Process

1. Bump version in both `package.json` (root) and `frontend/package.json`
2. Update version in `src-tauri/tauri.conf.json`
3. Commit from project root (`git add .`) and push to `main`
4. Create a GitHub release with a `v*` tag pointing to the latest commit on `main`:
   ```bash
   gh release create v0.x.y --generate-notes --title "v0.x.y"
   ```
   The CI "Release" workflow builds and uploads artifacts automatically.
