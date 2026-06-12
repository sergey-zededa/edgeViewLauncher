# WARP.md

This file provides guidance to WARP (warp.dev) when working with the **frontend** of this repository. For full repo guidance see `../CLAUDE.md` and `../AGENTS.md`.

## Project Overview

EdgeView Launcher is a **Tauri v2** desktop application with a Go backend that provides remote device management for ZEDEDA edge nodes. The frontend is a React + Vite app. It does **not** talk to the Go backend directly — every API call is proxied through a single generic Tauri command (`api_call`) implemented in Rust, which forwards HTTP requests to the Go backend running as a sidecar on a dynamic localhost port.

> Note: the app runs under Tauri (`tauri dev` / `tauri build`); the frontend imports `./tauriAPI`, not `./electronAPI`. The legacy Electron files (`electron-main.js`, `electron-preload.js`, `src/electronAPI.js`) were removed in the Tauri-migration cleanup; see `docs/MIGRATING_FROM_ELECTRON.md` for the history.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Tauri Core (Rust) — src-tauri/               │
│  src/lib.rs            – registers IPC commands, windows, tray   │
│  src/commands/api.rs   – api_call: proxies HTTP to Go backend    │
│  - Spawns Go backend sidecar (edgeview-backend-<triple>)         │
│  - Discovers backend port from stdout: "HTTP Server starting     │
│    on :<PORT>"                                                   │
└────────────────────────┬────────────────────────────────────────┘
                         │ invoke('api_call', { endpoint, method, body })
┌────────────────────────▼────────────────────────────────────────┐
│  frontend/ (React + Vite)                                        │
│  ├── src/tauriAPI.js       – wraps all invoke() calls            │
│  ├── src/App.jsx           – main UI (search, settings, device)  │
│  ├── vnc.html              – standalone VNC window (separate     │
│  │                           Vite entry point, NOT in src/)      │
│  └── src/components/                                             │
│      ├── TerminalView.jsx  – xterm.js WebSocket terminal        │
│      └── VncViewer.jsx     – noVNC embedded viewer              │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP / WebSocket to localhost:<dynamic-port>
┌────────────────────────▼────────────────────────────────────────┐
│  Go backend sidecar — cmd/edgeview-backend/                      │
│  http-server.go – HTTP routes + WebSocket SSH terminal handler   │
│  app.go         – business logic, ZEDEDA API, session mgmt       │
│  internal/session/ internal/zededa/ internal/config/ …           │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow
1. React components call functions from `src/tauriAPI.js`.
2. `tauriAPI.js` calls `invoke('api_call', { endpoint, method, body })` (Tauri IPC).
3. The Rust `api_call` command (`src-tauri/src/commands/api.rs`) makes an HTTP request to the Go backend at `localhost:<dynamic-port>` and returns the JSON body **regardless of HTTP status**.
4. `tauriAPI.js`'s `apiCall` helper throws when `response.success === false`, copying `response.code` (e.g. `"UNAUTHORIZED"`) onto the thrown `Error`.
5. The Go backend handles ZEDEDA API calls, SSH tunnels, and VNC proxying.

> ⚠️ `vnc.html` imports noVNC independently from `VncViewer.jsx`; keep both in sync for any dependency or import changes.

### Key Files
- `src/tauriAPI.js` – wraps every `invoke()` call; single error chokepoint
- `src/App.jsx` – main UI (clusters, devices, tunnels, settings)
- `../src-tauri/src/commands/api.rs` – the `api_call` proxy command
- `../cmd/edgeview-backend/app.go` – Go backend logic (ZEDEDA integration)
- `../cmd/edgeview-backend/http-server.go` – Go HTTP routes and handlers

## Development Commands

**IMPORTANT**: Check your current directory (`pwd`) before running commands.
- If you are in `edgeViewLauncher/frontend/`, run `npm run build` / `npm test` directly.
- **DO NOT** run `cd frontend && ...` if you are already in the frontend directory.

```bash
# From frontend/ directory:
npm run dev              # Start Vite dev server only (localhost:5173)
npm run build            # Build frontend for production (outputs to dist/)
npm test                 # Run tests with Vitest
npm test -- --run        # Non-watch mode (used in CI)

# From the project root (parent directory):
npm run dev              # Full dev environment: tauri dev (spawns Vite + Tauri)
                         # Requires the Go backend to be pre-built (see below).

# Rebuild the Go backend sidecar after Go changes (mac). The binary MUST carry
# the platform-triple suffix so Tauri can find the sidecar:
go build -o src-tauri/binaries/edgeview-backend-aarch64-apple-darwin ./cmd/edgeview-backend
```

## Testing

Tests use **Vitest** + **React Testing Library** with **jsdom** environment.

- Test file: `src/App.test.jsx`
- Config: `vitest.config.mts`

### Mocking Pattern
All Tauri IPC calls go through `src/tauriAPI.js`, so mock that module:

```javascript
vi.mock('./tauriAPI', () => ({
  SearchNodes: vi.fn().mockResolvedValue([]),
  GetSettings: vi.fn().mockResolvedValue({ clusters: [], activeCluster: '' }),
  // ... other methods used by the component under test
}));
```

### Run a single test
```bash
npm test -- -t "test name pattern"
```

## Key Concepts

### Clusters
Multiple ZEDEDA cloud clusters can be configured. Each cluster has:
- `name` – Display name
- `baseUrl` – ZEDEDA API endpoint
- `apiToken` – Authentication token (format: `<7-char-name>:<base64-key>`)

### Tunnels
The app manages SSH/VNC tunnels to edge devices:
- Tunnels are tracked in `activeTunnels` state (backend: `session.Manager`)
- Backend provides `/api/start-tunnel`, `/api/tunnel/:id`, `/api/tunnels`
- `TerminalView` connects via WebSocket to `/api/ssh/term?port=<port>`

### Session Status
EdgeView sessions have expiration times. The `sessionStatus` state tracks:
- `active` – Whether the session is live
- `expiresAt` – Session expiration timestamp

Expiry is judged by **wall-clock** time on the backend (the cache strips the monotonic clock reading), so the frontend's `isSessionConnected` (which compares `expiresAt` against `Date.now()`) stays consistent with the backend across machine sleep/wake.

### Cloud-config vs live-session gating
- *Cloud-config* controls (Enable SSH/VGA/USB/Console/Ext Policy) are async ZEDEDA PUTs and **must NOT** be disabled when a device is offline.
- *Live-session* controls (SSH Terminal, VNC, tunnels, Collect Info) require an active EdgeView tunnel and **must** be gated on `isSessionConnected`.

### Auth errors (expired/invalid token)
A ZEDEDA 401 arrives as a thrown error with `err.code === 'UNAUTHORIZED'`. `App.jsx` (`isAuthError` / `handleAuthError`) shows an actionable "Update Token" prompt that deep-links to the active cluster's token field, instead of rendering the raw ZEDEDA error envelope.
