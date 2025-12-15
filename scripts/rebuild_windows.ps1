# rebuild_windows.ps1
Write-Host "Starting EdgeView Launcher Rebuild..." -ForegroundColor Cyan

# 1. Kill any running instances
Write-Host "1. Stopping any running instances..."
taskkill /F /IM "edgeview-backend.exe" 2>$null
taskkill /F /IM "EdgeView Launcher.exe" 2>$null
taskkill /F /IM "electron.exe" 2>$null

# 2. Force Cleanup old binary
Write-Host "2. Cleaning up old binary..."
if (Test-Path "edgeview-backend.exe") {
    Remove-Item "edgeview-backend.exe" -Force
}

# 3. Build Backend
Write-Host "3. Building Go Backend..."
go build -o edgeview-backend.exe http-server.go app.go
if ($LASTEXITCODE -ne 0) {
    Write-Host "CRITICAL ERROR: Go build failed!" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "edgeview-backend.exe")) {
    Write-Host "CRITICAL ERROR: edgeview-backend.exe was not created!" -ForegroundColor Red
    exit 1
}
Write-Host "Backend built successfully." -ForegroundColor Green

# 4. Build Frontend & Installer
Write-Host "4. Building Frontend and Installer..."
npm run build:frontend
if ($LASTEXITCODE -ne 0) { Write-Host "Frontend build failed!"; exit 1 }

npx electron-builder --win
if ($LASTEXITCODE -ne 0) { Write-Host "Installer build failed!"; exit 1 }

Write-Host "---------------------------------------------------"
Write-Host "SUCCESS! New installer is in 'dist-electron'" -ForegroundColor Green
Write-Host "You can also run the unpacked version key directly:"
Write-Host "dist-electron/win-unpacked/EdgeView Launcher.exe" -ForegroundColor Yellow
Write-Host "---------------------------------------------------"
