#!/bin/bash
# rebuild_windows_from_mac.sh
# Rebuild Windows distribution from macOS using cross-compilation

set -e

echo "🔨 Building EdgeView Launcher for Windows from macOS..."

# 1. Build Windows backend binary
echo "1. Cross-compiling Go backend for Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -o edgeview-backend.exe http-server.go app.go
if [ ! -f "edgeview-backend.exe" ]; then
    echo "❌ ERROR: edgeview-backend.exe was not created!"
    exit 1
fi
echo "✓ Backend built: edgeview-backend.exe ($(ls -lh edgeview-backend.exe | awk '{print $5}'))"

# 2. Build Frontend
echo "2. Building frontend..."
npm run build:frontend
if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed!"
    exit 1
fi
echo "✓ Frontend built"

# 3. Build Windows installer
echo "3. Building Windows installer with electron-builder..."
npx electron-builder --win
if [ $? -ne 0 ]; then
    echo "❌ Installer build failed!"
    exit 1
fi

echo ""
echo "✅ SUCCESS! Windows distribution built:"
echo "   Setup: dist-electron/EdgeView Launcher Setup *.exe"
echo "   Unpacked: dist-electron/win-unpacked/EdgeView Launcher.exe"
echo ""
