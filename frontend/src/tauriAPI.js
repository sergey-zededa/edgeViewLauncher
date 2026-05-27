/**
 * tauriAPI.js – drop-in replacement for electronAPI.js
 *
 * Exports the EXACT same function names as electronAPI.js so that App.jsx
 * requires zero changes other than swapping the import path.
 *
 * All backend calls route through the generic `api_call` Tauri command.
 * Window / system / update functions invoke their dedicated Rust commands.
 * Event subscriptions use @tauri-apps/api/event listen() instead of
 * ipcRenderer.on() — the returned cleanup function contract is preserved.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';

// ── Generic backend proxy ─────────────────────────────────────────────────────

const apiCall = (endpoint, method = 'GET', body = undefined) =>
    invoke('api_call', { endpoint, method, body: body ?? null }).then(r => {
        if (r && r.success === false && r.error) {
            throw new Error(r.error);
        }
        return r;
    });

// ── Node / Device API ─────────────────────────────────────────────────────────

export const SearchNodes = (query, limit = 200, pageToken = '', projectId = '', nodeId = '') =>
    apiCall('/api/search-nodes', 'POST', { query, limit, pageToken, projectId, nodeId }).then(r => r?.data);

export const ConnectToNode = (nodeId, useInApp, targetIP) =>
    apiCall('/api/connect', 'POST', { nodeId, useInApp, targetIP: targetIP || '' }).then(r => r?.data);

export const CancelConnection = (nodeId) =>
    apiCall('/api/cancel-connection', 'POST', { nodeId }).then(r => r?.data);

export const GetDeviceServices = (nodeId, nodeName) =>
    apiCall('/api/device-services', 'POST', { nodeId, nodeName }).then(r =>
        typeof r?.data === 'string' ? r.data : JSON.stringify(r?.data)
    );

export const GetSessionStatus = (nodeId) =>
    apiCall('/api/session-status', 'POST', { nodeId }).then(r => r?.data);

export const GetConnectionProgress = (nodeId) =>
    apiCall(`/api/connection-progress?nodeId=${nodeId}`, 'GET').then(r => r?.data);

export const GetAppInfo = (nodeId) =>
    apiCall('/api/app-info', 'POST', { nodeId }).then(r => r?.data);

export const AddRecentDevice = (nodeId) =>
    apiCall('/api/recent-device', 'POST', { nodeId }).then(r => r?.data);

// ── Device Cache ─────────────────────────────────────────────────────────────

export const GetDeviceCache = () =>
    apiCall('/api/device-cache', 'GET').then(r => r?.data);

export const RefreshDeviceCache = () =>
    apiCall('/api/device-cache/refresh', 'POST').then(r => r?.data);

// ── SSH / EdgeView ────────────────────────────────────────────────────────────

export const SetupSSH = (nodeId) =>
    apiCall('/api/setup-ssh', 'POST', { nodeId }).then(r => r?.data);

export const GetSSHStatus = (nodeId) =>
    apiCall('/api/ssh-status', 'POST', { nodeId }).then(r => r?.data);

export const DisableSSH = (nodeId) =>
    apiCall('/api/disable-ssh', 'POST', { nodeId }).then(r => r?.data);

export const ResetEdgeView = (nodeId) =>
    apiCall('/api/reset-edgeview', 'POST', { nodeId }).then(r => r?.data);

export const VerifyTunnel = (nodeId) =>
    apiCall('/api/verify-tunnel', 'POST', { nodeId }).then(r => r?.data);

// ── Device controls ───────────────────────────────────────────────────────────

export const SetVGAEnabled = (nodeId, enabled) =>
    apiCall('/api/set-vga', 'POST', { nodeId, enabled }).then(r => r?.data);

export const SetUSBEnabled = (nodeId, enabled) =>
    apiCall('/api/set-usb', 'POST', { nodeId, enabled }).then(r => r?.data);

export const SetConsoleEnabled = (nodeId, enabled) =>
    apiCall('/api/set-console', 'POST', { nodeId, enabled }).then(r => r?.data);

export const EnableExternalPolicy = (nodeId, enable) =>
    apiCall('/api/enable-external-policy', 'POST', { nodeId, enable }).then(r => r?.data);

// ── Tunnels ───────────────────────────────────────────────────────────────────

export const StartTunnel = (nodeId, targetIP, targetPort, protocol) =>
    apiCall('/api/start-tunnel', 'POST', { nodeId, targetIP, targetPort, protocol }).then(r => r?.data);

export const CloseTunnel = (tunnelId) =>
    apiCall(`/api/tunnel/${tunnelId}`, 'DELETE').then(r => r?.data);

/**
 * Notify other windows (specifically the main App) that a tunnel teardown
 * has been initiated, so its active-tunnel list can show "Terminating..."
 * immediately rather than waiting for the next 5s poll to reconcile.
 * Fire-and-forget: best-effort, never throws.
 */
export const EmitTunnelClosing = (tunnelId) => {
    if (!tunnelId) return Promise.resolve();
    return emit('tunnel-closing', { tunnelId }).catch(() => { });
};

/** Subscribe to tunnel-closing events. Returns an unlisten function. */
export const OnTunnelClosing = (callback) => {
    let unlisten = () => { };
    listen('tunnel-closing', (event) => callback(event.payload))
        .then(fn => { unlisten = fn; });
    return () => unlisten();
};

export const ListTunnels = (nodeId) =>
    apiCall(`/api/tunnels?nodeId=${nodeId}`, 'GET').then(res => {
        const hasDataField = res && Object.prototype.hasOwnProperty.call(res, 'data');
        if (!hasDataField) return null;
        const data = res.data;
        if (Array.isArray(data)) return data;
        if (data == null) return [];
        return [];
    });

// ── Settings / Auth ───────────────────────────────────────────────────────────

export const GetSettings = () =>
    apiCall('/api/settings', 'GET').then(r => r?.data);

export const SaveSettings = (clusters, activeCluster) =>
    apiCall('/api/settings', 'POST', { clusters, activeCluster }).then(r => r?.data);

export const GetUserInfo = () =>
    apiCall('/api/user-info', 'GET').then(r => r?.data);

export const GetEnterprise = () =>
    apiCall('/api/enterprise', 'GET').then(r => r?.data);

export const GetProjects = () =>
    apiCall('/api/projects', 'GET').then(r => r?.data);

export const VerifyToken = (token, baseUrl) =>
    apiCall('/api/verify-token', 'POST', { token, baseUrl }).then(r => r?.data);

export const ProbeBaseUrl = (baseUrl) =>
    apiCall('/api/probe-base-url', 'POST', { baseUrl }).then(r => r?.data);

// ── Collect Info ──────────────────────────────────────────────────────────────

export const StartCollectInfo = (nodeId) =>
    apiCall('/api/collect-info/start', 'POST', { nodeId }).then(r => r?.data);

export const GetCollectInfoStatus = (jobId) =>
    apiCall(`/api/collect-info/status?jobId=${jobId}`, 'GET').then(r => r?.data);

export const DownloadCollectInfo = (jobId) =>
    // Returns a direct URL string – the frontend constructs this for display purposes
    invoke('get_backend_port').then(port =>
        `http://localhost:${port}/api/collect-info/download?jobId=${jobId}`
    );

export const SaveCollectInfo = (jobId, filename) =>
    invoke('save_collected_file', { jobId, filename });

// ── Compose Diagnostics ──────────────────────────────────────────────────────

export const StartComposeDiagnostics = (nodeId, appName, appIP, username, password) =>
    apiCall('/api/compose-diagnostics/start', 'POST', { nodeId, appName, appIP, username, password }).then(r => r?.data);

export const GetComposeDiagnosticsStatus = (jobId) =>
    apiCall(`/api/compose-diagnostics/status?jobId=${jobId}`, 'GET').then(r => r?.data);

export const SaveComposeDiagnostics = (jobId, filename) =>
    invoke('save_collected_file', { jobId, filename, endpoint: '/api/compose-diagnostics/download' });

// ── Secure Storage ────────────────────────────────────────────────────────────

export const SecureStorageStatus = () =>
    invoke('secure_storage_status');

export const SecureStorageMigrate = () =>
    invoke('secure_storage_migrate');

export const SecureStorageGetSettings = () =>
    invoke('secure_storage_get_settings').then(res => {
        if (res?.success) return res.data;
        throw new Error(res?.error || 'Failed to load settings');
    });

export const SecureStorageSaveSettings = (config) =>
    invoke('secure_storage_save_settings', { config }).then(res => {
        if (!res?.success) throw new Error(res?.error || 'Failed to save settings');
        return res;
    });

export const InjectSecureConfig = () =>
    invoke('inject_secure_config');

// ── Windows ───────────────────────────────────────────────────────────────────

export const openVncWindow = (options) =>
    invoke('open_vnc_window', { options });

export const openTerminalWindow = (options) =>
    invoke('open_terminal_window', { options });

export const resizeWindow = (width, height) =>
    invoke('resize_window', { width, height });

export const closeCurrentWindow = () =>
    invoke('close_current_window');

export const quitApp = () =>
    invoke('quit_app');

export const getBackendPort = () =>
    invoke('get_backend_port');

// ── System ────────────────────────────────────────────────────────────────────

export const openExternal = (url) =>
    invoke('open_external', { url });

export const openExternalTerminal = (command) =>
    invoke('open_external_terminal', { command });

export const getSystemTimeFormat = () =>
    invoke('get_system_time_format');

export const getElectronAppInfo = () =>
    invoke('get_app_version');

// ── Container Shell ───────────────────────────────────────────────────────────

export const startContainerShell = (nodeId, appName, containerName, shell, appType, appIP, username, password, appId) =>
    apiCall('/api/container-shell', 'POST', {
        nodeId, appName, containerName,
        shell: shell || '/bin/sh',
        appType, appIP,
        username: username || 'root',
        password: password || '',
        appId: appId || ''
    }).then(async res => {
        if (!res?.success) throw new Error(res?.error || 'Failed to start container shell');
        const { port, tunnelId, execCommand } = res.data;
        // Open the terminal window with SSH credentials
        await openTerminalWindow({
            port,
            nodeName: appName || 'Container',
            targetInfo: containerName,
            tunnelId: tunnelId || '',
            initialCommand: execCommand,
            mode: 'terminal',
            username: username || 'root',
            password: password || ''
        });
        return res.data;
    });

// ── Auto-updater ──────────────────────────────────────────────────────────────

export const CheckForUpdates = () =>
    invoke('check_for_updates');

export const DownloadUpdate = () =>
    invoke('download_update');

export const InstallUpdate = () =>
    invoke('install_update');

/** Returns an unlisten function (same contract as the Electron version). */
export const OnUpdateAvailable = (callback) => {
    let unlisten = () => { };
    listen('update-available', (event) => callback(event.payload))
        .then(fn => { unlisten = fn; });
    return () => unlisten();
};

export const OnUpdateNotAvailable = (callback) => {
    let unlisten = () => { };
    listen('update-not-available', (event) => callback(event.payload))
        .then(fn => { unlisten = fn; });
    return () => unlisten();
};

export const OnUpdateDownloadProgress = (callback) => {
    let unlisten = () => { };
    listen('update-download-progress', (event) => callback(event.payload))
        .then(fn => { unlisten = fn; });
    return () => unlisten();
};

export const OnUpdateDownloaded = (callback) => {
    let unlisten = () => { };
    listen('update-downloaded', (event) => callback(event.payload))
        .then(fn => { unlisten = fn; });
    return () => unlisten();
};

export const OnUpdateError = (callback) => {
    let unlisten = () => { };
    listen('update-error', (event) => callback(event.payload))
        .then(fn => { unlisten = fn; });
    return () => unlisten();
};
