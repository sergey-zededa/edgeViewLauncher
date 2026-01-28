# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

EdgeView Launcher is an Electron desktop application with a Go backend that provides remote device management capabilities for ZEDEDA edge nodes. The frontend is a React + Vite application that communicates with the Go backend via Electron IPC.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                     │
│  electron-main.js                                                │
│  - Spawns Go backend (edgeview-backend) on port 8080            │
│  - Creates BrowserWindow for React app                           │
│  - Handles IPC: api-call, open-terminal-window, open-external   │
└────────────────────────┬────────────────────────────────────────┘
                         │ IPC (contextBridge)
┌────────────────────────▼────────────────────────────────────────┐
│  electron-preload.js                                             │
│  - Exposes window.electronAPI with typed methods                │
│  - All API calls routed through ipcRenderer.invoke              │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  frontend/ (React + Vite)                                        │
│  ├── src/electronAPI.js    – Wraps window.electronAPI           │
│  ├── src/App.jsx           – Main UI (search, settings, device) │
│  └── src/components/                                             │
│      ├── TerminalView.jsx  – xterm.js WebSocket terminal        │
│      └── VncViewer.jsx     – NoVNC remote desktop viewer        │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow
1. React components call functions from `electronAPI.js`
2. `electronAPI.js` calls `window.electronAPI.*` (exposed by preload)
3. Preload script invokes IPC to main process
4. Main process makes HTTP requests to Go backend at `localhost:8080`
5. Go backend handles ZEDEDA API calls, SSH tunnels, VNC proxying

### Key Files (Parent Directory)
- `electron-main.js` – Main process entry, backend lifecycle, IPC handlers
- `electron-preload.js` – Secure bridge between main/renderer
- `app.go` – Go backend application logic (ZEDEDA API integration)
- `http-server.go` – Go HTTP server routes and handlers

## Development Commands

**IMPORTANT**: Check your current directory (`pwd`) before running commands.
- If you are in `edgeViewLauncher/frontend/`, run `npm run build`.
- **DO NOT** run `cd frontend && ...` if you are already in the frontend directory.

```bash
# From frontend/ directory:
npm run dev          # Start Vite dev server (localhost:5173)
npm run build        # Build for production (outputs to dist/)
npm test             # Run tests with Vitest
npm run test -- --watch  # Run tests in watch mode

# From parent directory:
npm start            # Start Electron app (NODE_ENV=development)
npm run build        # Build frontend + backend + package Electron
go build -o edgeview-backend http-server.go app.go  # Rebuild Go backend only
```

**Important**: The Go binary must be named `edgeview-backend` (not `edgeViewLauncher`) because `electron-main.js` looks for this specific name.

## Testing

Tests use **Vitest** + **React Testing Library** with **jsdom** environment.

- Test file: `src/App.test.jsx`
- Setup file: `src/test/setupTests.js`
- Config: `vitest.config.mts`

### Mocking Pattern
All Electron IPC calls must be mocked. The standard pattern:

```javascript
vi.mock('./electronAPI', () => ({
  SearchNodes: vi.fn().mockResolvedValue([]),
  GetSettings: vi.fn().mockResolvedValue({ clusters: [], activeCluster: '' }),
  // ... other methods
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
- Tunnels are tracked in `activeTunnels` state
- Backend provides `/api/start-tunnel`, `/api/tunnel/:id`, `/api/tunnels`
- `TerminalView` connects via WebSocket to `/api/ssh/term?port=<port>`

### Session Status
EdgeView sessions have expiration times. The `sessionStatus` state tracks:
- `active` – Whether session is live
- `expiresAt` – Session expiration timestamp
