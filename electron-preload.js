const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Platform info
    platform: process.platform,

    // Generic API call handler
    apiCall: (endpoint, method, body) => ipcRenderer.invoke('api-call', endpoint, method, body),

    // Convenience methods for common operations
    searchNodes: (query) => ipcRenderer.invoke('api-call', '/api/search-nodes', 'POST', { query }),
    connectToNode: (nodeId, useInApp) => ipcRenderer.invoke('api-call', '/api/connect', 'POST', { nodeId, useInApp }),
    getSettings: () => ipcRenderer.invoke('api-call', '/api/settings', 'GET'),
    saveSettings: (clusters, activeCluster) => ipcRenderer.invoke('api-call', '/api/settings', 'POST', { clusters, activeCluster }),
    getDeviceServices: (nodeId, nodeName) => ipcRenderer.invoke('api-call', '/api/device-services', 'POST', { nodeId, nodeName }),
    setupSSH: (nodeId) => ipcRenderer.invoke('api-call', '/api/setup-ssh', 'POST', { nodeId }),
    getSSHStatus: (nodeId) => ipcRenderer.invoke('api-call', '/api/ssh-status', 'POST', { nodeId }),
    disableSSH: (nodeId) => ipcRenderer.invoke('api-call', '/api/disable-ssh', 'POST', { nodeId }),
    resetEdgeView: (nodeId) => ipcRenderer.invoke('api-call', '/api/reset-edgeview', 'POST', { nodeId }),
    verifyTunnel: (nodeId) => ipcRenderer.invoke('api-call', '/api/verify-tunnel', 'POST', { nodeId }),
    addRecentDevice: (nodeId) => ipcRenderer.invoke('api-call', '/api/recent-device', 'POST', { nodeId }),
    getUserInfo: () => ipcRenderer.invoke('api-call', '/api/user-info', 'GET'),
    getEnterprise: () => ipcRenderer.invoke('api-call', '/api/enterprise', 'GET'),
    getProjects: () => ipcRenderer.invoke('api-call', '/api/projects', 'GET'),
    getSessionStatus: (nodeId) => ipcRenderer.invoke('api-call', '/api/session-status', 'POST', { nodeId }),
    getAppInfo: (nodeId) => ipcRenderer.invoke('api-call', '/api/app-info', 'POST', { nodeId }),
    startTunnel: (nodeId, targetIP, targetPort, protocol) => ipcRenderer.invoke('api-call', '/api/start-tunnel', 'POST', { nodeId, targetIP, targetPort, protocol }),
    closeTunnel: (tunnelId) => ipcRenderer.invoke('api-call', `/api/tunnel/${tunnelId}`, 'DELETE'),
    listTunnels: (nodeId) => ipcRenderer.invoke('api-call', `/api/tunnels?nodeId=${nodeId}`, 'GET'),
    getConnectionProgress: (nodeId) => ipcRenderer.invoke('api-call', `/api/connection-progress?nodeId=${nodeId}`, 'GET'),
    setVGAEnabled: (nodeId, enabled) => ipcRenderer.invoke('api-call', '/api/set-vga', 'POST', { nodeId, enabled }),
    setUSBEnabled: (nodeId, enabled) => ipcRenderer.invoke('api-call', '/api/set-usb', 'POST', { nodeId, enabled }),
    setConsoleEnabled: (nodeId, enabled) => ipcRenderer.invoke('api-call', '/api/set-console', 'POST', { nodeId, enabled }),
    openTerminalWindow: (port) => ipcRenderer.invoke('open-terminal-window', port),
    openVncWindow: (options) => ipcRenderer.invoke('open-vnc-window', options),
    resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
    getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    openExternalTerminal: (command) => ipcRenderer.invoke('open-external-terminal', command),
    getSystemTimeFormat: () => ipcRenderer.invoke('get-system-time-format'),
    verifyToken: (token, baseUrl) => ipcRenderer.invoke('api-call', '/api/verify-token', 'POST', { token, baseUrl }),

    // Collect Info
    startCollectInfo: (nodeId) => ipcRenderer.invoke('api-call', '/api/collect-info/start', 'POST', { nodeId }),
    getCollectInfoStatus: (jobId) => ipcRenderer.invoke('api-call', `/api/collect-info/status?jobId=${jobId}`, 'GET'),
    saveCollectInfo: (jobId, filename) => ipcRenderer.invoke('save-collected-file', { jobId, filename }),

    // Container Shell Access
    startContainerShell: (nodeId, appName, containerName, shell, appType, appIP, username, password, appId) => ipcRenderer.invoke('start-container-shell', { nodeId, appName, containerName, shell, appType, appIP, username, password, appId }),

    // Secure Storage methods
    secureStorageStatus: () => ipcRenderer.invoke('secure-storage-status'),
    secureStorageMigrate: () => ipcRenderer.invoke('secure-storage-migrate'),
    secureStorageGetSettings: () => ipcRenderer.invoke('secure-storage-get-settings'),
    secureStorageSaveSettings: (config) => ipcRenderer.invoke('secure-storage-save-settings', config),

    // Electron App Info (version, build number)
    getElectronAppInfo: () => ipcRenderer.invoke('get-electron-app-info'),

    // Auto-updater methods
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateAvailable: (callback) => {
        const listener = (event, info) => callback(info);
        ipcRenderer.on('update-available', listener);
        // Return cleanup function
        return () => ipcRenderer.removeListener('update-available', listener);
    },
    onUpdateNotAvailable: (callback) => {
        const listener = (event, info) => callback(info);
        ipcRenderer.on('update-not-available', listener);
        return () => ipcRenderer.removeListener('update-not-available', listener);
    },
    onUpdateDownloadProgress: (callback) => {
        const listener = (event, progress) => callback(progress);
        ipcRenderer.on('update-download-progress', listener);
        return () => ipcRenderer.removeListener('update-download-progress', listener);
    },
    onUpdateDownloaded: (callback) => {
        const listener = (event, info) => callback(info);
        ipcRenderer.on('update-downloaded', listener);
        return () => ipcRenderer.removeListener('update-downloaded', listener);
    },
    onUpdateError: (callback) => {
        const listener = (event, error) => callback(error);
        ipcRenderer.on('update-error', listener);
        return () => ipcRenderer.removeListener('update-error', listener);
    },

    // Window Controls
    closeWindow: () => {
        try {
            const { getCurrentWindow } = require('@electron/remote');
            if (getCurrentWindow) {
                getCurrentWindow().close();
                return;
            }
        } catch (e) {
            // Ignore error and use fallback
        }
        // Fallback: send IPC to close window
        ipcRenderer.invoke('close-current-window');
    }
});
