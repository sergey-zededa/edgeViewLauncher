#!/bin/bash

# Debug script for Electron app
echo "=== Electron App Debug Info ==="
echo ""

APP_PATH="/Users/sseper/Desktop/Projects/edgeViewLauncher/dist-electron/mac-arm64/EdgeView Launcher.app"

echo "1. Checking if app exists:"
ls -la "$APP_PATH"
echo ""

echo "2. Checking app contents:"
ls -la "$APP_PATH/Contents/Resources/"
echo ""

echo "3. Checking for backend binary:"
ls -la "$APP_PATH/Contents/Resources/edgeview-backend" 2>&1
echo ""

echo "4. Checking for frontend files:"
ls -la "$APP_PATH/Contents/Resources/app.asar" 2>&1
ls -la "$APP_PATH/Contents/Resources/frontend/dist/" 2>&1
echo ""

echo "5. Running app with console output:"
echo "   (Watch for errors below)"
echo ""

"$APP_PATH/Contents/MacOS/EdgeView Launcher"
