#!/bin/bash
# verify_windows_build.sh
# Verifies that the Windows build is complete and ready for distribution

set -e

echo "🔍 Verifying Windows Build..."
echo ""

ERRORS=0

# Check 1: Setup installer exists
if [ -f "dist-electron/EdgeView Launcher Setup 0.0.1.exe" ]; then
    SIZE=$(ls -lh "dist-electron/EdgeView Launcher Setup 0.0.1.exe" | awk '{print $5}')
    echo "✓ Setup installer exists: $SIZE"
else
    echo "❌ Setup installer NOT FOUND: dist-electron/EdgeView Launcher Setup 0.0.1.exe"
    ERRORS=$((ERRORS+1))
fi

# Check 2: Unpacked folder exists
if [ -d "dist-electron/win-unpacked" ]; then
    echo "✓ Unpacked folder exists"
else
    echo "❌ Unpacked folder NOT FOUND: dist-electron/win-unpacked"
    ERRORS=$((ERRORS+1))
fi

# Check 3: Main exe exists in unpacked
if [ -f "dist-electron/win-unpacked/EdgeView Launcher.exe" ]; then
    SIZE=$(ls -lh "dist-electron/win-unpacked/EdgeView Launcher.exe" | awk '{print $5}')
    echo "✓ Main executable exists: $SIZE"
else
    echo "❌ Main executable NOT FOUND: dist-electron/win-unpacked/EdgeView Launcher.exe"
    ERRORS=$((ERRORS+1))
fi

# Check 4: Backend exe exists in resources
if [ -f "dist-electron/win-unpacked/resources/edgeview-backend.exe" ]; then
    SIZE=$(ls -lh "dist-electron/win-unpacked/resources/edgeview-backend.exe" | awk '{print $5}')
    echo "✓ Backend executable exists: $SIZE"
    
    # Check it's x64 (amd64) not arm64
    BACKEND_DATE=$(ls -l "dist-electron/win-unpacked/resources/edgeview-backend.exe" | awk '{print $6, $7, $8}')
    ROOT_DATE=$(ls -l "edgeview-backend.exe" | awk '{print $6, $7, $8}')
    echo "  Backend build date: $BACKEND_DATE"
    echo "  Root exe date: $ROOT_DATE"
else
    echo "❌ Backend executable NOT FOUND: dist-electron/win-unpacked/resources/edgeview-backend.exe"
    ERRORS=$((ERRORS+1))
fi

# Check 5: App asar exists
if [ -f "dist-electron/win-unpacked/resources/app.asar" ]; then
    SIZE=$(ls -lh "dist-electron/win-unpacked/resources/app.asar" | awk '{print $5}')
    echo "✓ App package exists: $SIZE"
else
    echo "❌ App package NOT FOUND: dist-electron/win-unpacked/resources/app.asar"
    ERRORS=$((ERRORS+1))
fi

# Check 6: Verify architecture is x64 not arm64
if [ -d "dist-electron/win-unpacked" ] && [ ! -d "dist-electron/win-arm64-unpacked" ]; then
    echo "✓ Architecture is x64 (not arm64)"
else
    if [ -d "dist-electron/win-arm64-unpacked" ]; then
        echo "⚠️  WARNING: ARM64 build detected! Should be x64 for Windows PCs"
    fi
fi

echo ""
if [ $ERRORS -eq 0 ]; then
    echo "✅ Build verification PASSED! Windows package is complete."
    echo ""
    echo "📦 Distributable files:"
    echo "   Setup installer: dist-electron/EdgeView Launcher Setup 0.0.1.exe"
    echo "   Portable exe:    dist-electron/win-unpacked/EdgeView Launcher.exe"
    exit 0
else
    echo "❌ Build verification FAILED with $ERRORS error(s)!"
    exit 1
fi
