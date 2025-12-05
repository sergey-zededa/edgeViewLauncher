# Build Commands Reference

## Quick Reference

```bash
npm run build              # Build complete macOS ARM64 package (default)
npm run build:windows      # Build complete Windows x64 package
npm run build:frontend     # Build React frontend only
npm run build:backend:mac  # Build Go backend for macOS ARM64 only
npm run build:backend:windows  # Build Go backend for Windows x64 only
```

---

## Detailed Build Commands

### macOS ARM64 (Default)

**Full build:**
```bash
npm run build
```

This will:
1. Generate build-info.json (via prebuild hook)
2. Build React frontend (Vite) → `frontend/dist/`
3. Build Go backend for macOS ARM64 → `edgeview-backend`
4. Package with electron-builder → `dist-electron/EdgeView Launcher-*.dmg`

**Output files:**
- `dist-electron/EdgeView Launcher-0.0.1-arm64.dmg` - Installer
- `dist-electron/mac-arm64/EdgeView Launcher.app` - Application bundle

---

### Windows x64

**Full build:**
```bash
npm run build:windows
```

This will:
1. Build React frontend → `frontend/dist/`
2. Cross-compile Go backend for Windows x64 → `edgeview-backend.exe`
3. Package with electron-builder → `dist-electron/EdgeView Launcher Setup *.exe`

**Output files:**
- `dist-electron/EdgeView Launcher Setup 0.0.1.exe` - Installer (102M)
- `dist-electron/win-unpacked/EdgeView Launcher.exe` - Portable exe (201M)
- `dist-electron/win-unpacked/resources/edgeview-backend.exe` - Go backend (11M)

**Verify Windows build:**
```bash
./verify_windows_build.sh
```

---

### Component-Level Builds

#### Frontend Only
```bash
npm run build:frontend
```
Builds: `frontend/dist/` (React + Vite)

#### Backend Only

**macOS ARM64:**
```bash
npm run build:backend:mac
```
Builds: `edgeview-backend` (ARM64)

**Windows x64:**
```bash
npm run build:backend:windows
```
Builds: `edgeview-backend.exe` (x64)

---

## Build Scripts (Alternative)

### macOS - Shell Script
```bash
./rebuild_windows_from_mac.sh
```
Builds Windows package from macOS using cross-compilation.

### Windows - PowerShell Script
```powershell
.\rebuild_windows.ps1
```
Builds Windows package on Windows native.

---

## Architecture Matrix

| Platform | Architecture | Go Backend Binary | Electron App | Command |
|----------|--------------|-------------------|--------------|---------|
| macOS    | ARM64 (M1/M2)| `edgeview-backend` | arm64 | `npm run build` |
| Windows  | x64 (amd64)  | `edgeview-backend.exe` | x64 | `npm run build:windows` |

---

## Verification Commands

### Check Go Binary Architecture

**macOS:**
```bash
file edgeview-backend
# Expected: Mach-O 64-bit executable arm64
```

**Windows:**
```bash
file edgeview-backend.exe
# Expected: PE32+ executable (console) x86-64
```

### Check Electron App Code Signature

**macOS:**
```bash
codesign -dv --verbose=4 "dist-electron/mac-arm64/EdgeView Launcher.app"
```

Look for:
- `Signature=adhoc` (current - unsigned)
- `Signature=Developer ID` (properly signed)

### Check Complete Windows Build
```bash
./verify_windows_build.sh
```

Checks:
- Setup installer exists
- Main exe exists
- Backend exe exists in resources
- Correct architecture (x64 not arm64)

---

## Build Targets Configuration

Defined in `package.json`:

```json
{
  "build": {
    "mac": {
      "target": [{"target": "dmg", "arch": ["arm64"]}]
    },
    "win": {
      "target": [{"target": "nsis", "arch": ["x64"]}]
    }
  }
}
```

---

## Development Workflow

### Local Development
```bash
cd frontend && npm run dev          # Terminal 1: Vite dev server
go build -o edgeview-backend && npm start  # Terminal 2: Electron + backend
```

### Production Build for Current Platform
```bash
npm run build                       # Builds for macOS ARM64 by default
```

### Cross-Platform Build
```bash
npm run build:windows               # Build Windows from macOS
```

---

## Troubleshooting

### "edgeview-backend not found" error
The backend binary name must match what electron-main.js expects.
- macOS: `edgeview-backend`
- Windows: `edgeview-backend.exe`

Rebuild with:
```bash
npm run build:backend:mac           # macOS
npm run build:backend:windows       # Windows
```

### Windows exe missing from dist
Make sure you're building x64, not ARM64:
```bash
npm run build:windows               # Forces --x64 flag
```

### macOS "damaged" error
See `MACOS_SIGNING.md` for code signing solutions.

Users can bypass with:
```bash
xattr -cr "/Applications/EdgeView Launcher.app"
```
