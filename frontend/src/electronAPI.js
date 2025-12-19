// Electron API wrapper - replaces Wails bindings
const api = window.electronAPI;

// Safety check
if (!api) {
    console.error('CRITICAL: window.electronAPI is not defined!');
    throw new Error('Electron API not available - preload script failed to load');
}

export const SearchNodes = (query) => {
    return api.searchNodes(query).then(res => {
        return res.data;
    }).catch(err => {
        console.error('SearchNodes error:', err);
        throw err;
    });
};

export const ConnectToNode = (nodeId, useInApp) => {
    return api.connectToNode(nodeId, useInApp).then(res => res.data);
};

export const GetSettings = () => {
    return api.getSettings().then(res => res.data);
};

export const SaveSettings = (clusters, activeCluster) => {
    return api.saveSettings(clusters, activeCluster).then(res => res.data);
};

export const GetDeviceServices = (nodeId, nodeName) => {
    return api.getDeviceServices(nodeId, nodeName).then(res => {
        return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    });
};

export const SetupSSH = (nodeId) => {
    return api.setupSSH(nodeId).then(res => res.data);
};

export const GetSSHStatus = (nodeId) => {
    return api.getSSHStatus(nodeId).then(res => res.data);
};

export const SetVGAEnabled = (nodeId, enabled) => {
    return api.setVGAEnabled(nodeId, enabled).then(res => res.data);
};

export const SetUSBEnabled = (nodeId, enabled) => {
    return api.setUSBEnabled(nodeId, enabled).then(res => res.data);
};

export const SetConsoleEnabled = (nodeId, enabled) => {
    return api.setConsoleEnabled(nodeId, enabled).then(res => res.data);
};

export const DisableSSH = (nodeId) => {
    return api.disableSSH(nodeId).then(res => res.data);
};

export const ResetEdgeView = (nodeId) => {
    return api.resetEdgeView(nodeId).then(res => res.data);
};

export const VerifyTunnel = (nodeId) => {
    return api.verifyTunnel(nodeId).then(res => res.data);
};

export const AddRecentDevice = (nodeId) => {
    return api.addRecentDevice(nodeId).then(res => res.data);
};

export const GetUserInfo = () => {
    return api.getUserInfo().then(res => res.data);
};

export const GetEnterprise = () => {
    return api.getEnterprise().then(res => res.data);
};

export const GetProjects = () => {
    return api.getProjects().then(res => res.data);
};

export const GetSessionStatus = (nodeId) => {
    return api.getSessionStatus(nodeId).then(res => res.data);
};

export const GetConnectionProgress = (nodeId) => {
    return api.getConnectionProgress(nodeId).then(res => res.data);
};

export const GetAppInfo = (nodeId) => {
    return window.electronAPI.getAppInfo(nodeId);
};

export const StartTunnel = (nodeId, targetIP, targetPort, protocol) => {
    return api.startTunnel(nodeId, targetIP, targetPort, protocol).then(res => res.data);
};

export const CloseTunnel = (tunnelId) => {
    return window.electronAPI.closeTunnel(tunnelId).then(res => res.data);
};

export const ListTunnels = (nodeId) => {
    return window.electronAPI.listTunnels(nodeId).then(res => {
        // Distinguish between "no data field at all" (empty body / transport
        // issue) and an explicit null/[] coming from the backend.
        const hasDataField = res && Object.prototype.hasOwnProperty.call(res, 'data');
        const data = hasDataField ? res.data : undefined;

        if (!hasDataField) {
            // Signal to the caller that we should keep the previous
            // state instead of treating this as "no tunnels".
            return null;
        }

        if (Array.isArray(data)) return data;
        if (data == null) return [];
        // In case backend ever returns a single tunnel object, normalize to array
        return Array.isArray(data) ? data : [];
    });
};
export const StartCollectInfo = (nodeId) => {
    return api.startCollectInfo(nodeId).then(res => res.data);
};

export const GetCollectInfoStatus = (jobId) => {
    return api.getCollectInfoStatus(jobId).then(res => res.data);
};

export const DownloadCollectInfo = (jobId) => {
    // This is a direct URL, not an API call
    return `http://localhost:8080/api/collect-info/download?jobId=${jobId}`;
};

export const SaveCollectInfo = (jobId, filename) => {
    return window.electronAPI.saveCollectInfo(jobId, filename);
};

export const VerifyToken = (token, baseUrl) => {
    return window.electronAPI.verifyToken(token, baseUrl).then(res => res.data);
};

// Secure Storage API
export const SecureStorageStatus = () => {
    return window.electronAPI.secureStorageStatus();
};

export const SecureStorageMigrate = () => {
    return window.electronAPI.secureStorageMigrate();
};

export const SecureStorageGetSettings = () => {
    return window.electronAPI.secureStorageGetSettings().then(res => {
        if (res.success) {
            return res.data;
        }
        throw new Error(res.error || 'Failed to load settings');
    });
};

export const SecureStorageSaveSettings = (config) => {
    return window.electronAPI.secureStorageSaveSettings(config).then(res => {
        if (!res.success) {
            throw new Error(res.error || 'Failed to save settings');
        }
        return res;
    });
};

// Auto-updater API
export const CheckForUpdates = () => {
    return window.electronAPI.checkForUpdates();
};

export const DownloadUpdate = () => {
    return window.electronAPI.downloadUpdate();
};

export const InstallUpdate = () => {
    return window.electronAPI.installUpdate();
};

export const OnUpdateAvailable = (callback) => {
    return window.electronAPI.onUpdateAvailable(callback);
};

export const OnUpdateNotAvailable = (callback) => {
    return window.electronAPI.onUpdateNotAvailable(callback);
};

export const OnUpdateDownloadProgress = (callback) => {
    return window.electronAPI.onUpdateDownloadProgress(callback);
};

export const OnUpdateDownloaded = (callback) => {
    return window.electronAPI.onUpdateDownloaded(callback);
};

export const OnUpdateError = (callback) => {
    return window.electronAPI.onUpdateError(callback);
};
