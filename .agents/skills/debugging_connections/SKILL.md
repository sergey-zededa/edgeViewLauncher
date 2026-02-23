---
name: Debugging Connections
description: Troubleshooting steps and guidance for debugging SSH, VNC, and TCP tunnel stability issues in EdgeView Launcher.
---

# Debugging EdgeView Launcher Connections (SSH, VNC, TCP Tunnels)

This skill provides context and steps for troubleshooting communication issues between the EdgeView Launcher application, the local proxy (`internal/session/manager.go`), and ZEDEDA EdgeView service.

## 1. Comparing with Reference Implementations

If connection stability (e.g., stalling, dropping, "TCP EOF") is observed, the primary source of truth is the reference implementation: `eve/edgeview-client`.
- Check `eve/edgeview-client` source code for SSH connection management, keep-alive mechanisms, and WebSocket protocol implementation.
- Compare these mechanisms with our application's `internal/session/manager.go` and `internal/zededa/client.go`.
- Identify discrepancies or missing keep-alive/handshake logic.

## 2. Inspecting TCP Tunnel Data Flow

- Issues with data flow ("TCP EOF", client disconnected) often stem from early termination of the tunnel handshake.
- Look at the `MappingID` allocation and verification.
- Add minimal, precise debug logging near the EOF conditions to trace the problem without spamming the console with verbose API logs.

## 3. SSH Terminal-Specific Issues

- **Stalling/Dropping:** Verify WebSocket pings are sent consistently, similar to the reference implementation. Verify "No password provided" or "invalid packet length" errors to ensure the SSH payload is correctly wrapped.
- **Rendering & Resizing:** 
  - Ensure ANSI color codes are intact when passing through the WebSocket to `xterm.js`.
  - Check dynamic resizing: Confirm the terminal window dimensions (e.g., 120x80) synchronize with the remote PTY size via resizing events from the frontend to the backend.

## 4. VNC-Specific Issues

- **External Clients (e.g., RealVNC):** External VNC viewers might enforce stricter protocol handshake timings. Check for "no device online" errors resulting from early closure by the edge.
- **noVNC Built-in Viewer:** The built-in viewer might have helpers (like the on-screen keyboard) to send special key combinations. Test this client first as a baseline before debugging external clients.
- Review keep-alive logic inside `manager.go` specific to VNC proxying.

## 5. Docker Compose App IPs

- If attempting to reach Docker Compose apps, confirm the connection targets the device's internal IP (e.g., `10.x.x.x`) rather than an external management IP.
- Ensure correlation logic accurately maps sibling applications to find the correct internal virtual IP.

Remember to document any new findings and apply fixes carefully, running both the backend and frontend components to test end-to-end integration.
