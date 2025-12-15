# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Critical Rules

**IMPORTANT**: 
1. **NEVER create git tags** or trigger release builds (CI/CD) unless explicitly instructed by the user.
2. **NEVER push to remote** (`git push`) unless explicitly asked.
3. Do not modify `eve/` directory contents as they are reference implementations.

## Project Overview

EdgeView Launcher is an Electron desktop application with a Go backend for managing remote ZEDEDA edge devices. It provides SSH terminal access, VNC remote desktop, and TCP tunneling through EdgeView proxy connections.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                              │
│  electron-main.js                                                         │
│  - Spawns Go backend (edgeview-backend) on port 8080                     │
│  - Creates BrowserWindow, handles IPC (api-call, open-terminal-window)   │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │ IPC via electron-preload.js
┌─────────────────────────────▼────────────────────────────────────────────┐
│                        Frontend (React + Vite)                            │
│  frontend/src/                                                            │
│  ├── App.jsx           – Main UI (search, settings, device details)      │
│  ├── electronAPI.js    – Wraps window.electronAPI for API calls          │
│  └── components/                                                          │
│      ├── TerminalView.jsx  – xterm.js WebSocket terminal                 │
│      └── VncViewer.jsx     – NoVNC remote desktop viewer                 │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │ HTTP/WebSocket to localhost:8080
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
1. React calls `electronAPI.js` → Electron IPC → Go backend HTTP API
2. SSH Terminal: Frontend opens WebSocket to `/api/ssh/term?port=<port>`
3. VNC: Frontend uses noVNC to connect through EdgeView TCP tunnel
4. EdgeView sessions are cached with ~5 hour expiration

### Key Concepts
- **Clusters**: Multiple ZEDEDA cloud endpoints can be configured (baseUrl + apiToken)
- **EdgeView Sessions**: Authenticated WebSocket tunnels to edge devices via ZEDEDA's EdgeView service
- **Tunnels**: Persistent TCP tunnels (SSH, VNC, custom ports) tracked in `session.Manager`

## Development Commands

```bash
# Start development (runs both frontend and backend)
cd frontend && npm run dev          # Terminal 1: Vite dev server (localhost:5173)
go build -o edgeview-backend && NODE_ENV=development npm start  # Terminal 2: Electron app

# Rebuild Go backend only (after Go code changes)
# Important: Binary name MUST be edgeview-backend (macOS/Linux) or edgeview-backend.exe (Windows)
go build -o edgeview-backend http-server.go app.go

# Build for production
npm run build                       # Builds frontend + backend + Electron package
npm run build:windows               # Windows x64 build
npm run build:linux                 # Linux x64 build

# Run frontend tests
cd frontend && npm test             # Run all tests with Vitest
```

**Important**: The Go binary must be named `edgeview-backend` (not `edgeViewLauncher`) because `electron-main.js` looks for this specific name.

## Testing

Frontend tests use **Vitest** + **React Testing Library** with **jsdom** environment.

All Electron IPC calls must be mocked in tests:
```javascript
vi.mock('./electronAPI', () => ({
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

## File Locations

- Config file: `~/.edgeview-config.json` (clusters, recent devices)
- SSH keys: `~/.ssh/edgeview_rsa` and `~/.ssh/edgeview_rsa.pub`
- Production build output: `dist-electron/`
