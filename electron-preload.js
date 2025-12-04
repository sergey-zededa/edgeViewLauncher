const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
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
    openTerminalWindow: (port) => ipcRenderer.invoke('open-terminal-window', port),
    openVncWindow: (options) => ipcRenderer.invoke('open-vnc-window', options),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    getSystemTimeFormat: () => ipcRenderer.invoke('get-system-time-format'),
    verifyToken: (token, baseUrl) => ipcRenderer.invoke('api-call', '/api/verify-token', 'POST', { token, baseUrl })
});
