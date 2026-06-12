---
description: How to build and run the EdgeView Launcher application for development
---

# Build and Run EdgeView Launcher

This workflow describes the process for starting the local development environment. EdgeView Launcher is a **Tauri v2** app: the React/Vite frontend runs inside the Tauri shell, which spawns the Go backend as a **sidecar**.

1. Build the Go backend sidecar (required before the Tauri app runs, and after any Go change).
```bash
// turbo
go build -o src-tauri/binaries/edgeview-backend-aarch64-apple-darwin ./cmd/edgeview-backend
```
*(Important: the binary MUST carry the platform-triple suffix — e.g. `edgeview-backend-aarch64-apple-darwin` — so the Tauri shell can find and spawn the sidecar. Use the matching triple on Windows/Linux.)*

2. Start the full dev environment from the project root. This runs `tauri dev`, which launches Vite and the Tauri window together and spawns the backend sidecar.
```bash
// turbo
npm run dev
```

3. (Optional) Run only the Vite dev server for pure frontend work:
```bash
// turbo
cd frontend && npm run dev
```

Tauri discovers the backend's dynamic HTTP port by parsing the sidecar's stdout line `"HTTP Server starting on :<PORT>"`. All frontend API calls are proxied through the Tauri `api_call` command to that port.
