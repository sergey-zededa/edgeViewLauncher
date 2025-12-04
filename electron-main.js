const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { callJSON } = require('./backendClient');

let mainWindow;
let tray;
let isQuitting = false;
let goBackend;
let BACKEND_PORT = null; // Will be set dynamically when Go backend starts

function createTray() {
    // Try using the PNG first, it's often better for tray icons
    const iconPath = path.join(__dirname, 'icon.png');
    console.log('Creating tray with icon:', iconPath);

    let trayIcon = nativeImage.createFromPath(iconPath);

    if (trayIcon.isEmpty()) {
        console.error('Tray icon is empty! Trying .icns fallback');
        trayIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.icns'));
    }

    // Resize to appropriate size for tray (16x16 is standard for macOS menu bar)
    trayIcon = trayIcon.resize({ width: 16, height: 16 });

    tray = new Tray(trayIcon);
    tray.setToolTip('EdgeView Launcher');
    console.log('Tray created successfully');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open EdgeView Launcher',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                } else {
                    createWindow();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function createWindow() {
    // Platform-specific window options
    const windowOptions = {
        width: 800,
        height: 600,
        show: false, // Hide until ready
        frame: false, // Remove native frame on all platforms for custom look
        webPreferences: {
            preload: path.join(__dirname, 'electron-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    };

    // Set platform-specific icon
    if (process.platform === 'win32') {
        windowOptions.icon = path.join(__dirname, 'icon.ico');
    } else if (process.platform === 'darwin') {
        windowOptions.icon = path.join(__dirname, 'icon.icns');
        windowOptions.titleBarStyle = 'hiddenInset';
    } else {
        windowOptions.icon = path.join(__dirname, 'icon.png');
    }

    mainWindow = new BrowserWindow(windowOptions);

    // Remove/minimize the default menu
    if (process.platform === 'darwin') {
        // macOS requires at least an app menu, create menu with Edit commands for paste support
        const template = [
            {
                label: app.name,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            },
            {
                label: 'Edit',
                submenu: [
                    { role: 'undo' },
                    { role: 'redo' },
                    { type: 'separator' },
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' }
                ]
            }
        ];
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } else {
        // Windows/Linux: Remove menu completely
        Menu.setApplicationMenu(null);
    }

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Handle window close - hide instead of quit unless quitting
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
    });

    // Handle errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });

    // Load the React app
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
        // DevTools can still be opened with Ctrl+Shift+I or Cmd+Option+I
    } else {
        // In production, frontend files are in frontend/dist (per package.json files config)
        const indexPath = path.join(__dirname, 'frontend', 'dist', 'index.html');
        mainWindow.loadFile(indexPath).catch(err => {
            console.error('Failed to load file:', err);
        });
    }

    // Debug
    mainWindow.webContents.on('console-message', (event, level, message) => {
        console.log('Renderer:', message);
    });
}

// ... (createVncWindow and startGoBackend functions remain unchanged) ...

// We need to keep the original functions but I'm replacing the top block, so I'll skip re-pasting them here 
// and just continue with the app lifecycle events which are at the bottom of the replaced block in the original file.
// Wait, I need to be careful not to delete createVncWindow and startGoBackend.
// The StartLine is 1 and EndLine is 181. This covers everything up to app.on('before-quit').
// So I need to include createVncWindow and startGoBackend in the replacement or adjust the range.
// Adjusting range to only cover the top part and the app lifecycle events separately is safer, 
// but the instruction says "Implement system tray and modify window close behavior".
// Let's replace the top part (imports, vars, createWindow) and then the bottom part (app events).

// ACTUALLY, I will replace the whole file content for the top part and the bottom part in one go if possible, 
// but the tool limits me to a contiguous block.
// Lines 1-60 cover imports, vars, and createWindow.
// Lines 157-181 cover app lifecycle.
// I'll do this in two steps or use multi_replace.

// Let's use multi_replace_file_content to be safe and precise.


function createVncWindow(options) {
    const { port, nodeName, appName, tunnelId } = options;

    const vncWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        title: `VNC - ${nodeName}`,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        },
        ...(process.platform === 'darwin' ? {
            titleBarStyle: 'hiddenInset',
            frame: false
        } : {})
    });

    // Build URL with connection parameters
    const params = new URLSearchParams({
        port,
        nodeName: nodeName || 'Unknown Device',
        appName: appName || 'VNC',
        tunnelId: tunnelId || ''
    });

    if (process.env.NODE_ENV === 'development') {
        // In development, serve from Vite dev server
        vncWindow.loadURL(`http://localhost:5173/vnc.html?${params}`);
    } else {
        // In production, load from packaged files
        const vncPath = path.join(__dirname, 'frontend', 'dist', 'vnc.html');
        vncWindow.loadFile(vncPath, { search: params.toString() }).catch(err => {
            console.error('Failed to load VNC window:', err);
        });
    }

    vncWindow.once('ready-to-show', () => {
        vncWindow.show();
    });

    vncWindow.on('closed', () => {
        // Window closed, cleanup tunnel
        console.log(`VNC window closed for ${nodeName}`);
        if (tunnelId) {
            // Close the tunnel via API
            fetch(`http://localhost:8080/api/tunnel/${tunnelId}`, {
                method: 'DELETE'
            }).then(() => {
                console.log(`Tunnel ${tunnelId} closed`);
            }).catch(err => {
                console.error(`Failed to close tunnel ${tunnelId}:`, err);
            });
        }
    });

    return vncWindow;
}

function startGoBackend() {
    // Start the Go HTTP server
    // In packaged app, resources are in app.asar or Contents/Resources
    const isDev = process.env.NODE_ENV === 'development';

    // Platform-specific executable name
    const exeName = process.platform === 'win32' ? 'edgeview-backend.exe' : 'edgeview-backend';
    const goExecutable = process.env.NODE_ENV === 'development'
        ? path.join(__dirname, exeName)
        : path.join(process.resourcesPath, exeName);

    console.log('[Go Backend] Starting Go backend:', goExecutable);

    // Start with port 0 to let OS assign an available port
    goBackend = spawn(goExecutable, ['-port', '0']);

    goBackend.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[Go Backend]', output);

        // Parse the port from the Go backend's startup message
        const portMatch = output.match(/HTTP Server starting on :(\d+)/);
        if (portMatch && !BACKEND_PORT) {
            BACKEND_PORT = parseInt(portMatch[1], 10);
            console.log(`[Go Backend] Detected backend port: ${BACKEND_PORT}`);
        }
    });

    goBackend.stderr.on('data', (data) => {
        console.error('[Go Backend Error]', data.toString());
    });

    goBackend.on('error', (error) => {
        console.error('[Go Backend] Failed to start:', error);
    });

    goBackend.on('close', (code) => {
        console.log(`[Go Backend] Exited with code ${code}`);
    });
}

app.whenReady().then(() => {
    // Configure About Panel
    app.setAboutPanelOptions({
        applicationName: 'EdgeView Launcher',
        applicationVersion: '1.0.0',
        copyright: 'Copyright © 2025 ZEDEDA',
        version: '1.0.0',
        credits: 'Powered by ZEDEDA',
        website: 'https://zededa.com'
    });

    startGoBackend();
    createTray();

    // Give backend a moment to start
    setTimeout(createWindow, 1000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else if (mainWindow) {
            mainWindow.show();
        }
    });
});

app.on('window-all-closed', () => {
    // Do nothing - keep app running in tray
});

app.on('before-quit', () => {
    isQuitting = true;
    // Kill Go backend
    if (goBackend) {
        goBackend.kill();
    }
});

// IPC Handlers - Forward to Go backend
ipcMain.handle('api-call', async (event, endpoint, method, body) => {
    // Wait for backend port to be ready
    if (!BACKEND_PORT) {
        // Poll for up to 5 seconds for the port to be set
        const maxWait = 5000;
        const interval = 100;
        let waited = 0;
        while (!BACKEND_PORT && waited < maxWait) {
            await new Promise(resolve => setTimeout(resolve, interval));
            waited += interval;
        }
        if (!BACKEND_PORT) {
            throw new Error('Backend port not ready');
        }
    }

    const url = `http://localhost:${BACKEND_PORT}${endpoint}`;

    try {
        // Use shared helper with tolerant JSON parsing so that
        // empty/whitespace-only bodies do not cause SyntaxError.
        const data = await callJSON(url, method || 'GET', body);
        return data;
    } catch (error) {
        console.error('API call error:', error);
        throw error;
    }
});

// Open VNC Window
ipcMain.handle('open-vnc-window', async (event, options) => {
    try {
        createVncWindow(options);
        return { success: true };
    } catch (error) {
        console.error('Failed to create VNC window:', error);
        return { success: false, error: error.message };
    }
});

// Open Terminal Window
ipcMain.handle('open-terminal-window', async (event, options) => {
    // Support both old format (just port) and new format (options object)
    const port = typeof options === 'number' ? options : options.port;
    const nodeName = typeof options === 'object' ? options.nodeName : 'Unknown Device';
    const targetInfo = typeof options === 'object' ? options.targetInfo : 'SSH';
    const tunnelId = typeof options === 'object' ? options.tunnelId : '';

    const termWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'electron-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        title: `SSH - ${nodeName}`,
        backgroundColor: '#1e1e1e',
        ...(process.platform === 'darwin' ? {
            titleBarStyle: 'hiddenInset',
            frame: false
        } : {})
    });

    // Build URL with connection parameters
    const params = new URLSearchParams({
        mode: 'terminal',
        port,
        nodeName,
        targetInfo,
        tunnelId: tunnelId || ''
    });

    if (process.env.NODE_ENV === 'development') {
        termWindow.loadURL(`http://localhost:5173?${params}`);
    } else {
        const indexPath = path.join(__dirname, 'frontend', 'dist', 'index.html');
        termWindow.loadFile(indexPath, { search: params.toString() }).catch(err => {
            console.error('Failed to load terminal window:', err);
        });
    }

    termWindow.once('ready-to-show', () => {
        termWindow.show();
    });

    termWindow.on('closed', () => {
        // Window closed, cleanup tunnel
        console.log(`Terminal window closed for ${nodeName}`);
        if (tunnelId) {
            // Close the tunnel via API
            fetch(`http://localhost:8080/api/tunnel/${tunnelId}`, {
                method: 'DELETE'
            }).then(() => {
                console.log(`Tunnel ${tunnelId} closed`);
            }).catch(err => {
                console.error(`Failed to close tunnel ${tunnelId}:`, err);
            });
        }
    });

    return true;
});

// Open External URL (VNC, etc.)
ipcMain.handle('open-external', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return true;
});

// Get System Time Format (12h vs 24h)
ipcMain.handle('get-system-time-format', async () => {
    const { app } = require('electron');
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    try {
        if (process.platform === 'darwin') {
            // macOS: Try reading system preferences
            try {
                const { stdout } = await execPromise('defaults read -g AppleICUForce24HourTime');
                const output = stdout.trim();
                if (output === '1' || output.toLowerCase() === 'true') return true;
                if (output === '0' || output.toLowerCase() === 'false') return false;
            } catch (e) {
                // AppleICUForce24HourTime not set
            }

            // Try AppleLocale
            let rawLocale = null;
            try {
                const { stdout } = await execPromise('defaults read -g AppleLocale');
                rawLocale = stdout.trim();
            } catch (e) {
                // AppleLocale not set
            }

            // Try AppleTimeFormat
            try {
                const { stdout } = await execPromise('defaults read -g AppleTimeFormat');
                const timeFormat = stdout.trim();
                if (timeFormat.includes('H') || timeFormat.includes('k')) return true;
                if (timeFormat.includes('h') || timeFormat.includes('K')) return false;
            } catch (e) {
                // AppleTimeFormat not set
            }

            // Fallback to Intl
            let localeToCheck = app.getLocale();
            if (rawLocale) {
                const rgMatch = rawLocale.match(/@rg=([a-z]{2})/i);
                if (rgMatch && rgMatch[1]) {
                    const lang = rawLocale.split('_')[0];
                    const region = rgMatch[1].toUpperCase();
                    localeToCheck = `${lang}-${region}`;
                } else {
                    localeToCheck = rawLocale.replace('_', '-').split('@')[0];
                }
            }

            const opts = new Intl.DateTimeFormat(localeToCheck, { hour: 'numeric' }).resolvedOptions();
            if (opts.hourCycle) return opts.hourCycle.startsWith('h2');
            if (opts.hour12 !== undefined) return !opts.hour12;
        } else if (process.platform === 'win32') {
            // Windows: Query registry for time format
            try {
                const { stdout } = await execPromise('reg query "HKCU\\Control Panel\\International" /v sShortTime');
                // If format contains 'H' (24h) vs 'h' (12h)
                if (stdout.includes('H')) return true;
                if (stdout.includes('h')) return false;
            } catch (e) {
                // Registry query failed
            }
        }
        // Linux and fallback: Use Intl API
        const opts = new Intl.DateTimeFormat(app.getLocale(), { hour: 'numeric' }).resolvedOptions();
        if (opts.hourCycle) return opts.hourCycle.startsWith('h2');
        if (opts.hour12 !== undefined) return !opts.hour12;
    } catch (e) {
        // Time format detection failed
    }

    return null;
});
