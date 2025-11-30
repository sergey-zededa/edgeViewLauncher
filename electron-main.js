const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { callJSON } = require('./backendClient');

let mainWindow;
let goBackend;
const BACKEND_PORT = 8080;

function createWindow() {
    // Platform-specific window options
    const windowOptions = {
        width: 800,
        height: 600,
        show: false, // Hide until ready
        webPreferences: {
            preload: path.join(__dirname, 'electron-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    };

    // macOS-specific: Use hidden title bar with inset traffic lights
    if (process.platform === 'darwin') {
        windowOptions.titleBarStyle = 'hiddenInset';
        windowOptions.frame = false;
    }
    // Windows/Linux: Use standard frame with menu bar hidden
    // (frame: true is default, so we don't need to set it)

    mainWindow = new BrowserWindow(windowOptions);

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Handle errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });

    // Load the React app
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
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

function startGoBackend() {
    // Start the Go HTTP server
    // In packaged app, resources are in app.asar or Contents/Resources
    const isDev = process.env.NODE_ENV === 'development';
    
    // Platform-specific executable name
    const exeName = process.platform === 'win32' ? 'edgeview-backend.exe' : 'edgeview-backend';
    
    const goExecutable = isDev
        ? path.join(__dirname, exeName)
        : path.join(process.resourcesPath, exeName);

    console.log('Starting Go backend from:', goExecutable);
    console.log('isDev:', isDev);
    console.log('__dirname:', __dirname);
    console.log('process.resourcesPath:', process.resourcesPath);

    goBackend = spawn(goExecutable, ['-port', BACKEND_PORT.toString()]);

    goBackend.stdout.on('data', (data) => {
        console.log(`[Go Backend] ${data}`);
    });

    goBackend.stderr.on('data', (data) => {
        console.error(`[Go Backend Error] ${data}`);
    });

    goBackend.on('error', (error) => {
        console.error('[Go Backend] Failed to start:', error);
    });

    goBackend.on('close', (code) => {
        console.log(`[Go Backend] Exited with code ${code}`);
    });
}

app.whenReady().then(() => {
    startGoBackend();

    // Give backend a moment to start
    setTimeout(createWindow, 1000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    // Kill Go backend
    if (goBackend) {
        goBackend.kill();
    }
});

// IPC Handlers - Forward to Go backend
ipcMain.handle('api-call', async (event, endpoint, method, body) => {
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

// Open Terminal Window
ipcMain.handle('open-terminal-window', async (event, port) => {
    const termWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'electron-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        title: 'SSH Terminal',
        backgroundColor: '#1e1e1e'
    });

    if (process.env.NODE_ENV === 'development') {
        termWindow.loadURL(`http://localhost:5173?mode=terminal&port=${port}`);
    } else {
        const indexPath = path.join(__dirname, 'frontend', 'dist', 'index.html');
        termWindow.loadURL(`file://${indexPath}?mode=terminal&port=${port}`);
    }

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
