---
description: How to build and run the EdgeView Launcher application for development
---

# Build and Run EdgeView Launcher

This workflow describes the process for starting the local development environment for both the frontend (React/Vite) and backend (Go + Electron).

1. Start the frontend development server
```bash
// turbo
cd frontend && npm run dev
```

2. Build the Go backend binary
```bash
// turbo
go build -o edgeview-backend ./cmd/edgeview-backend
```
*(Note: Important: Binary name MUST be edgeview-backend or edgeview-backend.exe because electron-main.js looks for this specific name.)*

3. Launch the Electron Application in Development Mode
```bash
NODE_ENV=development npm start
```
