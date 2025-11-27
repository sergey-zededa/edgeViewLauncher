const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let goBackend;
const BACKEND_PORT = 8080;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false, // Hide until ready
        webPreferences: {
            preload: path.join(__dirname, 'electron-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        titleBarStyle: 'hiddenInset',
        frame: false
    });

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
    const goExecutable = isDev
        ? path.join(__dirname, 'edgeview-backend')
        : path.join(process.resourcesPath, 'edgeview-backend');

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

    const options = {
        method: method || 'GET',
        headers: {
            'Content-Type': 'application/json',
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'API call failed');
        }

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

