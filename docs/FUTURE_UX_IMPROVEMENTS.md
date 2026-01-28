# Future UX Improvements

A prioritized list of convenience improvements for EdgeView Launcher.

---

## 🔥 High-Impact / Quick Wins

### 1. Copy-to-Clipboard Buttons
Add a 📋 icon next to `localhost:PORT` values for one-click copying.

### 2. Favorite/Pin Devices
Star frequently-used devices to pin them at the top of the list.

### 3. Keyboard Shortcuts
- `Cmd+K` / `Ctrl+K` — Focus search bar
- `Enter` — Open selected device
- `Escape` — Close modals / go back

### 4. Tunnel Auto-Reconnect
Offer automatic reconnection when a tunnel drops (with toast notification).

---

## 🎨 UX Polish

### 5. Active Tunnel Indicator
Show a badge/glow on device cards that have active tunnels.

### 6. "Open in Browser" Button
For HTTP ports (80, 443, 8080, 3000), add a button to open `http://localhost:PORT`.

### 7. Tunnel Duration Timer
Display how long each tunnel has been active (e.g., "Connected 5m ago").

### 8. Dark/Light Theme Toggle
Add a settings option to switch themes (CSS variables already in place).

---

## 🛠 Power User Features

### 9. SSH with Custom Port/User
`Shift+Click` on IP opens a mini-prompt for custom username/port instead of `root:22`.

### 10. Bulk Tunnel Management
- "Close All Tunnels" button
- Multi-select and close tunnels at once

### 11. Command Palette
Spotlight-style palette (`Cmd+Shift+P`) for quick actions: "SSH to X", "Close tunnel Y", etc.

---

## Implementation Status

| Feature | Status |
|---------|--------|
| Copy-to-Clipboard | ⬜ Not started |
| Favorite Devices | ⬜ Not started |
| Keyboard Shortcuts | ⬜ Not started |
| Auto-Reconnect | ⬜ Not started |
| Active Tunnel Indicator | ⬜ Not started |
| Open in Browser | ⬜ Not started |
| Tunnel Duration | ⬜ Not started |
| Theme Toggle | ⬜ Not started |
| Custom SSH Prompt | ⚠️ Partial (User/Persistence implemented) |
| Bulk Tunnel Mgmt | ⬜ Not started |
| Command Palette | ⬜ Not started |
