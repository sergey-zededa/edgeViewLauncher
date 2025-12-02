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
    return api.connectToNode(nodeId, useInApp).then(res => res.data.message);
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
export const VerifyToken = (token, baseUrl) => {
    return window.electronAPI.verifyToken(token, baseUrl).then(res => res.data);
};
