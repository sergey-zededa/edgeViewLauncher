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

export const GetAppInfo = (nodeId) => {
    return window.electronAPI.getAppInfo(nodeId);
};

export const StartTunnel = (nodeId, targetIP, targetPort) => {
    return window.electronAPI.startTunnel(nodeId, targetIP, targetPort).then(res => res.data);
};

export const CloseTunnel = (tunnelId) => {
    return window.electronAPI.closeTunnel(tunnelId).then(res => res.data);
};

export const ListTunnels = (nodeId) => {
    return window.electronAPI.listTunnels(nodeId).then(res => res.data);
};
