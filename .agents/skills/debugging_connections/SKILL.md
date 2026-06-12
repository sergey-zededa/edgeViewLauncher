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

## 5. Session Validity, Reset, and Expiry

- **Session shows expired/inactive but log says "Connected" (or reset doesn't recover):** session expiry is judged by **wall-clock** time. `internal/session/manager.go` `StoreCachedSession` stores `ExpiresAt` with the monotonic reading stripped (`expiresAt.Round(0)`) — this is deliberate, because the macOS monotonic clock pauses during sleep and would otherwise make an expired session look valid to the backend while the frontend (wall-clock) shows it expired. Do **not** reintroduce a `time.Now().Add(...)`-with-monotonic expiry comparison.
- **Reset must clear local state:** `App.ResetEdgeView` recycles the cloud EdgeView session (Stop+Start) **and** calls `sessionManager.InvalidateSession(nodeID)`. If a reset appears to "do nothing," verify the cache is being invalidated so the next connect re-mints a fresh session rather than resurrecting the stale one.
- **"device instance limit reached (can't have more than 2 peers)":** stale dispatcher peers on the device side. The cloud-side Stop/Start in `ResetEdgeView` is what releases them; local cache invalidation alone won't.

## 6. Authentication / Expired Token (HTTP 401)

- A ZEDEDA 401 is mapped to the `zededa.ErrUnauthorized` sentinel (`internal/zededa/client.go`); `sendError` (`http-server.go`) returns `code: "UNAUTHORIZED"`, which the frontend turns into an "Update Token" prompt. If you see raw ZEDEDA error envelopes in the UI again, check that the failing client method returns `ErrUnauthorized` on 401 and that callers wrap with `%w`.
- A **transient** 401 ("Session Cache miss") on the first authenticated call after a new token is expected — it's retried inside `GetEnterprise`. Only a persistent 401 (token genuinely expired/invalid) should surface the prompt.

## 7. Docker Compose App IPs

- If attempting to reach Docker Compose apps, confirm the connection targets the device's internal IP (e.g., `10.x.x.x`) rather than an external management IP.
- Ensure correlation logic accurately maps sibling applications to find the correct internal virtual IP.

Remember to document any new findings and apply fixes carefully, running both the backend and frontend components to test end-to-end integration.
