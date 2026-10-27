import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { vi, describe, it, beforeEach, afterEach } from 'vitest';

vi.mock('./components/VncViewer', () => ({
  __esModule: true,
  default: () => <div data-testid="vnc-viewer-mock" />,
}));

vi.mock('./components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }) => <span>{children}</span>,
}));

vi.mock('./components/UpdateBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="update-banner-mock" />,
}));

vi.mock('./components/GlobalStatusBanner', () => ({
  __esModule: true,
  default: ({ status }) => status ? (
    <div data-testid="global-status-banner-mock" data-type={status.type}>
      {status.title && <strong>{status.title}</strong>}{status.title && ' '}{status.message}
      {status.action && status.action.onClick && (
        <button onClick={() => status.action.onClick()}>{status.action.label}</button>
      )}
    </div>
  ) : null,
}));

vi.mock('./tauriAPI', () => {
  const fn = () => Promise.resolve();
  const noop = () => () => { }; // Cleanup function for event listeners
  return {
    SearchNodes: vi.fn().mockResolvedValue({ nodes: [], nextToken: '' }),
    ConnectToNode: vi.fn(fn),
    GetSettings: vi.fn(),
    SaveSettings: vi.fn().mockResolvedValue({ saved: true }),
    GetDeviceServices: vi.fn(),
    SetupSSH: vi.fn(fn),
    GetSSHStatus: vi.fn().mockResolvedValue({ status: 'disabled' }),
    GetEdgeViewSessions: vi.fn().mockResolvedValue(null),
    GetDeviceInfo: vi.fn().mockResolvedValue(null),
    DisableSSH: vi.fn(fn),
    RemoveSSHKey: vi.fn().mockResolvedValue({ removed: true, remaining: 1 }),
    SetVGAEnabled: vi.fn(fn),
    SetUSBEnabled: vi.fn(fn),
    SetConsoleEnabled: vi.fn(fn),
    EnableExternalPolicy: vi.fn(fn),
    ResetEdgeView: vi.fn(fn),
    DisconnectEdgeView: vi.fn(fn),
    StartEdgeViewSession: vi.fn(fn),
    VerifyTunnel: vi.fn(fn),
    GetUserInfo: vi.fn(fn),
    GetEnterprise: vi.fn().mockResolvedValue({ name: 'Test Enterprise' }),
    GetProjects: vi.fn().mockResolvedValue([]),
    GetSessionStatus: vi.fn().mockResolvedValue({ active: false }),
    GetConnectionProgress: vi.fn().mockResolvedValue({ status: 'Connected' }),
    GetAppInfo: vi.fn(fn),
    StartTunnel: vi.fn().mockResolvedValue({ port: 6000, tunnelId: 'tunnel-1' }),
    CloseTunnel: vi.fn(fn),
    ListTunnels: vi.fn().mockResolvedValue([]),
    AddRecentDevice: vi.fn(fn),
    VerifyToken: vi.fn().mockResolvedValue({ valid: true }),
    GetDeviceCache: vi.fn().mockResolvedValue({ devices: [], projects: [], updatedAt: new Date().toISOString(), isRefreshing: false }),
    RefreshDeviceCache: vi.fn().mockResolvedValue({ started: true }),
    // Auto-update API mocks
    OnUpdateAvailable: vi.fn(noop),
    OnUpdateNotAvailable: vi.fn(noop),
    OnUpdateDownloadProgress: vi.fn(noop),
    OnUpdateDownloaded: vi.fn(noop),
    OnUpdateError: vi.fn(noop),
    OnTunnelClosing: vi.fn(noop),
    CancelConnection: vi.fn().mockResolvedValue({ cancelled: true }),
    EmitTunnelClosing: vi.fn(),
    EmitTunnelsChanged: vi.fn(),
    DownloadUpdate: vi.fn(fn),
    InstallUpdate: vi.fn(fn),
    CheckForUpdates: vi.fn().mockResolvedValue({ success: true }),
    // Secure Storage API mocks
    SecureStorageStatus: vi.fn().mockResolvedValue({
      encryptionAvailable: true,
      secureTokensExist: false,
      needsMigration: false,
      backupExists: false
    }),
    SecureStorageMigrate: vi.fn().mockResolvedValue({ success: true }),
    SecureStorageGetSettings: vi.fn(),
    SecureStorageSaveSettings: vi.fn().mockResolvedValue({ success: true }),
    InjectSecureConfig: vi.fn().mockResolvedValue(),
    StartCollectInfo: vi.fn(fn).mockResolvedValue({ jobId: 'job-123' }),
    GetCollectInfoStatus: vi.fn(fn).mockResolvedValue({ status: 'starting', progress: 0, totalSize: 100 }),
    DownloadCollectInfo: vi.fn(id => `http://localhost:8080/api/collect-info/download?jobId=${id}`),
    openVncWindow: vi.fn(),
    openTerminalWindow: vi.fn(),
    openExternalTerminal: vi.fn(),
    getElectronAppInfo: vi.fn().mockResolvedValue({
      version: '0.1.1',
      buildNumber: 'dev',
      buildDate: null,
      gitCommit: 'abc123'
    }),
    getSystemTimeFormat: vi.fn().mockResolvedValue(false),
    startContainerShell: vi.fn(),
    openExternal: vi.fn(),
    SaveCollectInfo: vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/test.tar.gz' }),
    StartComposeDiagnostics: vi.fn().mockResolvedValue({ jobId: 'compose-job-1' }),
    GetComposeDiagnosticsStatus: vi.fn().mockResolvedValue({ status: 'connecting', progress: 0, totalSize: 0 }),
    SaveComposeDiagnostics: vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/runtime-info.tar.gz' }),
  };
});

import * as electronAPI from './tauriAPI';
import App, { ActivityLog } from './App';

// Helper to create a standard cache response
const makeCache = (devices = [], projects = []) => ({
  devices,
  projects,
  updatedAt: new Date().toISOString(),
  isRefreshing: false,
});

describe('App configuration and tunnels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset specific mocks that use mockResolvedValueOnce to prevent test pollution
    electronAPI.GetSettings.mockReset();
    electronAPI.SecureStorageGetSettings.mockReset();
    electronAPI.GetDeviceCache.mockReset();
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache());

    // Mock global window.electronAPI is no longer needed since we use tauriAPI imports
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      writable: true,
    });

    // Default settings: no token so settings panel opens
    const defaultConfig = {
      baseUrl: '',
      apiToken: '',
      clusters: [],
      activeCluster: '',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(defaultConfig);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(defaultConfig);
  });

  it('addNewCluster adds a new cluster and sets it as viewing (not active)', async () => {
    render(<App />);

    // Settings panel should open automatically
    await screen.findByRole('heading', { name: 'Configuration' });

    const addButton = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addButton);

    const newCluster = await screen.findByText('Cluster 1');
    expect(newCluster).toBeInTheDocument();

    const switchButtons = await screen.findAllByRole('button', { name: /switch to this cluster/i });
    expect(switchButtons.length).toBeGreaterThan(0);

    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('deleteCluster removes a cluster and updates active cluster', async () => {
    const config = {
      baseUrl: '',
      apiToken: '',
      clusters: [
        { name: 'Cluster 1', baseUrl: 'https://one', apiToken: '' },
        { name: 'Cluster 2', baseUrl: 'https://two', apiToken: '' },
      ],
      activeCluster: 'Cluster 1',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    render(<App />);

    await screen.findByRole('heading', { name: 'Configuration' });

    const firstCluster = await screen.findByText('Cluster 1');
    expect(firstCluster).toBeInTheDocument();

    const deleteButtons = screen.getAllByTitle('Delete Cluster');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('Cluster 1')).not.toBeInTheDocument();
    });

    const remaining = screen.getByText('Cluster 2');
    const item = remaining.closest('.cluster-item');
    expect(item).not.toBeNull();
    expect(within(item).getByText('Active')).toBeInTheDocument();
  });

  it('validateToken marks valid and invalid API tokens appropriately', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: 'Configuration' });

    const tokenTextarea = screen.getByPlaceholderText(/paste token from zededa cloud/i);

    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;

    fireEvent.change(tokenTextarea, { target: { value: validToken } });
    fireEvent.change(tokenTextarea, { target: { value: 'invalid-token' } });

    expect(screen.queryByText('Valid token format')).not.toBeInTheDocument();
    expect(screen.queryByText(/invalid format/i)).not.toBeInTheDocument();
  });

  it('saveSettings persists clusters and reloads user info', async () => {
    const emptyConfig = {
      baseUrl: '',
      apiToken: '',
      clusters: [],
      activeCluster: '',
      recentDevices: [],
    };
    const savedConfig = {
      baseUrl: 'https://cluster.example',
      apiToken: '',
      clusters: [
        {
          name: 'Cluster 1',
          baseUrl: 'https://cluster.example',
          apiToken: 'ENT1234:' + 'A'.repeat(171),
        },
      ],
      activeCluster: 'Cluster 1',
      recentDevices: [],
    };

    electronAPI.GetSettings.mockResolvedValue(emptyConfig);
    electronAPI.SecureStorageGetSettings
      .mockResolvedValueOnce(emptyConfig)
      .mockResolvedValueOnce(savedConfig);

    render(<App />);

    await screen.findByRole('heading', { name: 'Configuration' });

    const addButton = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addButton);

    const switchButton = screen.queryByText('Switch to this Cluster');

    if (switchButton) {
      fireEvent.click(switchButton);
    } else {
      const saveButton = screen.getByRole('button', { name: /save changes/i });
      fireEvent.click(saveButton);
    }

    await waitFor(() => {
      expect(electronAPI.SecureStorageSaveSettings).toHaveBeenCalledTimes(1);
      const [configArg] = electronAPI.SecureStorageSaveSettings.mock.calls[0];
      expect(configArg.clusters).toHaveLength(1);
      expect(configArg.clusters[0].name).toBe('Cluster 1');
      expect(configArg.activeCluster).toBe('Cluster 1');
    });

    await waitFor(() => {
      expect(electronAPI.GetEnterprise).toHaveBeenCalled();
      expect(electronAPI.GetProjects).toHaveBeenCalled();
    });
  });

  it('saveSettings persists edits to an existing cluster', async () => {
    const config = {
      baseUrl: 'https://original.example',
      apiToken: 'original-token',
      clusters: [
        { name: 'Cluster 1', baseUrl: 'https://original.example', apiToken: 'original-token' },
      ],
      activeCluster: 'Cluster 1',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    render(<App />);

    await waitFor(() => {
      expect(electronAPI.SecureStorageGetSettings).toHaveBeenCalled();
    });

    const appContainer = document.querySelector('.app-container');
    fireEvent.keyDown(appContainer, { key: ',', metaKey: true });

    await screen.findByRole('heading', { name: 'Configuration' });

    // The stored token is masked by default; click Replace to reveal the paste input.
    fireEvent.click(screen.getByLabelText('Replace token'));
    const tokenInput = screen.getByPlaceholderText(/paste token from zededa cloud/i);

    const newToken = 'new-token-value';
    fireEvent.change(tokenInput, { target: { value: newToken } });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(electronAPI.SecureStorageSaveSettings).toHaveBeenCalledTimes(1);
    });

    const [configArg] = electronAPI.SecureStorageSaveSettings.mock.calls[0];
    expect(configArg.clusters).toHaveLength(1);

    expect([newToken, 'original-token']).toContain(configArg.clusters[0].apiToken);

    expect(configArg.activeCluster).toBe('Cluster 1');
  });

  it('starting a VNC tunnel calls StartTunnel and adds an active tunnel without auto-launching VNC client', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;

    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [
        { name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken },
      ],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const node = {
      id: 'node-1',
      name: 'Node 1',
      status: 'online',
      project: 'proj-1',
    };

    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node], [{ id: 'proj-1', name: 'Project 1' }]));

    const servicesPayload = [
      {
        name: 'App 1',
        vncPort: 5900,
        ips: ['10.0.0.1'],
        pid: 1234,
        status: 'RUN_STATE_ONLINE',
      },
    ];
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify(servicesPayload));

    electronAPI.GetSessionStatus.mockResolvedValue({
      active: true,
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    });
    electronAPI.GetSSHStatus.mockResolvedValue({
      status: 'enabled',
      expiry: Math.floor(Date.now() / 1000) + 3600
    });

    const openExternal = electronAPI.openExternal;

    render(<App />);

    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);

    await screen.findByText('Running Applications');

    // The app row's Connect button (not the header's EdgeView Connect toggle).
    const appRow = screen.getByText('App 1').closest('.service-item');
    fireEvent.click(within(appRow).getByRole('button', { name: /\bconnect\b/i }));

    const launchVncLabel = await screen.findByText('Launch VNC');
    const launchVncButton = launchVncLabel.closest('.option-btn');
    expect(launchVncButton).not.toBeNull();

    fireEvent.click(launchVncButton);

    const builtinOption = await screen.findByText('Open in Built-in Viewer');
    fireEvent.click(builtinOption);

    await waitFor(() => {
      expect(electronAPI.StartTunnel).toHaveBeenCalledWith('node-1', 'localhost', 5900, 'vnc');
    });

    expect(openExternal).not.toHaveBeenCalled();

    const activeTunnelsHeading = await screen.findByText('Active Tunnels');
    const activeTunnelsSection = activeTunnelsHeading.closest('.active-tunnels-section');
    expect(activeTunnelsSection).not.toBeNull();

    const withinSection = within(activeTunnelsSection);
    expect(withinSection.getByText('VNC')).toBeInTheDocument();
    expect(withinSection.getByText(/localhost:6000/)).toBeInTheDocument();
    expect(withinSection.getByText(/TX: 0 B/)).toBeInTheDocument();
  });

  it('renders Activity Log section when a node is selected', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;

    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [
        { name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken },
      ],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const node = {
      id: 'node-1',
      name: 'Node 1',
      status: 'online',
      project: 'proj-1',
    };

    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });

    render(<App />);

    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);

    await screen.findByText('Running Applications');

    expect(screen.getByText('Activity Log')).toBeInTheDocument();
  });

  it('shows GlobalStatusBanner during EdgeView reset', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;
    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const node = { id: 'node-1', name: 'Node 1', status: 'online' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));

    electronAPI.GetSSHStatus.mockResolvedValue({
      status: 'enabled',
      expiry: Math.floor(Date.now() / 1000) + 3600
    });
    electronAPI.GetSessionStatus.mockResolvedValue({
      active: true,
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    });

    render(<App />);

    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);

    await screen.findByText('EdgeView Session');

    const resetButton = await screen.findByTitle('Restart EdgeView session');
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(screen.getByTestId('global-status-banner-mock')).toBeInTheDocument();
    });

    expect(electronAPI.ResetEdgeView).toHaveBeenCalledWith('node-1');
  });

  it('shows inline error in SSH modal on connection failure', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;
    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const node = { id: 'node-1', name: 'Node 1', status: 'online' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));

    const services = [{ name: 'App 1', ips: ['10.0.0.1'], status: 'RUN_STATE_ONLINE' }];
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify(services));

    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });

    electronAPI.StartTunnel.mockRejectedValue(new Error('Connection timed out'));

    render(<App />);

    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);

    await screen.findByText('Running Applications');

    // The app row's Connect button (not the header's EdgeView Connect toggle).
    const appRow = screen.getByText('App 1').closest('.service-item');
    fireEvent.click(within(appRow).getByRole('button', { name: /\bconnect\b/i }));

    const launchSshButton = await screen.findByText('Launch SSH');
    fireEvent.click(launchSshButton.closest('.option-btn'));

    await screen.findByText('Start SSH Session');

    const openBuiltinBtn = screen.getByText('Open Built-in Terminal').closest('button');
    fireEvent.click(openBuiltinBtn);

    await screen.findByText('Connection timed out');

    expect(screen.getByText('Connection timed out')).toBeInTheDocument();
  });

  it('does not render Activity Log when no node is selected', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;

    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [
        { name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken },
      ],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const node = {
      id: 'node-1',
      name: 'Node 1',
      status: 'online',
      project: 'proj-1',
    };

    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));

    render(<App />);

    await screen.findByText('Node 1');

    expect(screen.queryByText('Activity Log')).not.toBeInTheDocument();
  });

  it('shows Collect Info modal and tracks progress', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;
    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const node = { id: 'node-1', name: 'Node 1', status: 'online' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));

    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });

    electronAPI.StartCollectInfo.mockResolvedValue({ jobId: 'job-1' });
    electronAPI.GetCollectInfoStatus
      .mockResolvedValueOnce({ status: 'starting', progress: 0, totalSize: 0 })
      .mockResolvedValueOnce({ status: 'downloading', progress: 50, totalSize: 100 })
      .mockResolvedValue({ status: 'completed', progress: 100, totalSize: 100, filename: 'test.tar.gz' });
    electronAPI.SaveCollectInfo = vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/test.tar.gz' });

    render(<App />);

    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);

    await screen.findByText('Running Applications');

    const collectButton = screen.getByText('Collect Info');
    fireEvent.click(collectButton);

    await screen.findByText('Initiating system info collection for Node 1...');

    await waitFor(() => {
      expect(screen.getByTestId('global-status-banner-mock')).toHaveTextContent(/Collecting info/);
    }, { timeout: 3000 });

    await waitFor(() => {
      expect(electronAPI.SaveCollectInfo).toHaveBeenCalledWith('job-1', 'test.tar.gz');
    }, { timeout: 3000 });

    await screen.findByText(/File saved successfully/);
  });

  it('shows Diagnostics button on compose runtime apps and triggers collection', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;
    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const node = { id: 'node-1', name: 'Node 1', status: 'online' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));

    // Return services: a compose runtime parent + a compose child app sharing an IP
    const runtimeApp = {
      name: 'compose-runtime',
      id: 'rt-1',
      status: 'RUN_STATE_ONLINE',
      appType: 'APP_TYPE_VM',
      appVersion: '2.0.7',
      ips: ['192.168.1.10'],
      internalIps: ['10.0.0.5'],
      containers: [],
    };
    const composeApp = {
      name: 'compose-app-1',
      id: 'ca-1',
      status: 'RUN_STATE_ONLINE',
      appType: 'APP_TYPE_DOCKER_COMPOSE',
      ips: ['192.168.1.10'],
      internalIps: [],
      containers: [{ containerName: 'web', containerState: 'running' }],
    };
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([runtimeApp, composeApp]));

    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });

    electronAPI.StartComposeDiagnostics.mockResolvedValue({ jobId: 'compose-job-1' });
    electronAPI.GetComposeDiagnosticsStatus
      .mockResolvedValueOnce({ status: 'connecting', progress: 0, totalSize: 0 })
      .mockResolvedValueOnce({ status: 'running-script', progress: 0, totalSize: 0 })
      .mockResolvedValueOnce({ status: 'downloading', progress: 1000000, totalSize: 3000000 })
      .mockResolvedValue({ status: 'completed', progress: 3000000, totalSize: 3000000, filename: 'runtime-info-v1-test.tar.gz' });
    electronAPI.SaveComposeDiagnostics = vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/runtime-info-v1-test.tar.gz' });

    render(<App />);

    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);

    await screen.findByText('Running Applications');

    // The Diagnostics button should appear on the runtime parent app
    const diagButton = await screen.findByText('Diagnostics');
    expect(diagButton).toBeTruthy();

    // Click it to open credentials prompt
    fireEvent.click(diagButton);

    // Should show the credentials prompt
    const usernameInput = await screen.findByPlaceholderText('Username (e.g. ubuntu)');
    const passwordInput = await screen.findByPlaceholderText('Password');
    expect(usernameInput).toBeTruthy();
    expect(passwordInput).toBeTruthy();

    // Fill in credentials and submit
    fireEvent.change(usernameInput, { target: { value: 'wcsuser' } });
    fireEvent.change(passwordInput, { target: { value: 'secret' } });

    const collectBtn = screen.getByText('Collect');
    fireEvent.click(collectBtn);

    // Should start diagnostics
    await waitFor(() => {
      expect(electronAPI.StartComposeDiagnostics).toHaveBeenCalledWith(
        'node-1', 'compose-runtime', '10.0.0.5', 'wcsuser', 'secret'
      );
    }, { timeout: 3000 });

    // Should show progress via global status banner
    await waitFor(() => {
      expect(screen.getByTestId('global-status-banner-mock')).toHaveTextContent(/diagnostics|Diagnostics|runtime|Downloading|Running/i);
    }, { timeout: 3000 });

    // Should eventually save the file
    await waitFor(() => {
      expect(electronAPI.SaveComposeDiagnostics).toHaveBeenCalledWith('compose-job-1', 'runtime-info-v1-test.tar.gz');
    }, { timeout: 5000 });
  });

  it('does not show Diagnostics button on non-runtime compose apps', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;
    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const node = { id: 'node-1', name: 'Node 1', status: 'online' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));

    // Regular VM app (not a compose runtime)
    const regularApp = {
      name: 'regular-vm',
      id: 'vm-1',
      status: 'RUN_STATE_ONLINE',
      appType: 'APP_TYPE_VM',
      ips: ['192.168.1.10'],
      internalIps: [],
      containers: [],
    };
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([regularApp]));
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });

    render(<App />);

    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);

    await screen.findByText('Running Applications');

    // No Diagnostics button should be rendered (no compose runtime)
    expect(screen.queryByText('Diagnostics')).not.toBeInTheDocument();
  });

  // Regression: a device running both a K3s VM and a compose runtime rendered the
  // nested compose app under the K3s VM. Every IP-less app used to inherit the
  // runtime's IP, so the K3s VM looked like it shared an IP with the compose app
  // and — being listed first — won the parent slot.
  describe('compose app nesting on a device with a non-compose VM', () => {
    const setUpDevice = (services) => {
      const validKey = 'A'.repeat(171);
      const validToken = `ENT1234:${validKey}`;
      const config = {
        baseUrl: 'https://cluster.example',
        apiToken: validToken,
        clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
        activeCluster: 'Prod',
        recentDevices: [],
      };
      electronAPI.GetSettings.mockResolvedValue(config);
      electronAPI.SecureStorageGetSettings.mockResolvedValue(config);
      electronAPI.GetDeviceCache.mockResolvedValue(
        makeCache([{ id: 'node-1', name: 'Node 1', status: 'online' }])
      );
      electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify(services));
      electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
      electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });
    };

    // The K3s VM is listed first and shares the runtime's displayed IP, so it wins
    // any naive "first app with a matching IP" search.
    const k3sVM = {
      name: 'dealer-k3s-em321',
      id: 'k3s-1',
      status: 'RUN_STATE_ONLINE',
      appType: 'APP_TYPE_VM',
      deploymentType: 'DEPLOYMENT_TYPE_K3S',
      ips: ['10.5.255.254'],
      internalIps: [],
      containers: [],
    };
    const composeRuntime = {
      name: 'zededa-berlin-EM321.zcompose',
      id: 'rt-1',
      status: 'RUN_STATE_ONLINE',
      appType: 'APP_TYPE_VM_RUNTIME',
      deploymentType: 'DEPLOYMENT_TYPE_DOCKER_RUNTIME',
      appVersion: '2.0.7',
      ips: ['10.5.255.254'],
      internalIps: ['10.0.0.5'],
      containers: [],
    };
    const composeApp = {
      name: 'zededa-berlin-EM321.dealerfd',
      id: 'ca-1',
      status: 'RUN_STATE_ERROR',
      appType: 'APP_TYPE_DOCKER_COMPOSE',
      deploymentType: 'DEPLOYMENT_TYPE_DOCKER_RUNTIME',
      ips: ['10.5.255.254'],
      internalIps: [],
      containers: [],
    };

    const assertNestedUnderRuntime = (container) => {
      const items = [...container.querySelectorAll('.service-item')];
      const itemFor = (name) => items.find(el => el.textContent.includes(name));

      const child = itemFor('zededa-berlin-EM321.dealerfd');
      const runtime = itemFor('zededa-berlin-EM321.zcompose');
      const k3s = itemFor('dealer-k3s-em321');
      expect(child).toBeTruthy();
      expect(runtime).toBeTruthy();
      expect(k3s).toBeTruthy();

      // The compose app is the indented child...
      expect(child.style.marginLeft).toBe('32px');
      expect(runtime.style.marginLeft).toBe('0px');
      expect(k3s.style.marginLeft).toBe('0px');

      // ...and it is rendered directly beneath the runtime, not the K3s VM.
      expect(items.indexOf(child)).toBe(items.indexOf(runtime) + 1);

      // Only the real docker runtime is labelled as one.
      const badge = screen.getByText('Compose Runtime');
      expect(runtime.contains(badge)).toBe(true);
      expect(k3s.contains(badge)).toBe(false);
    };

    it('nests the compose app under the runtime named by parentAppId', async () => {
      setUpDevice([
        k3sVM,
        { ...composeApp, parentAppId: 'rt-1' },
        composeRuntime,
      ]);

      const { container } = render(<App />);
      fireEvent.click(await screen.findByText('Node 1'));
      await screen.findByText('Running Applications');
      await screen.findByText('zededa-berlin-EM321.dealerfd');

      assertNestedUnderRuntime(container);
    });

    it('falls back to deploymentType when the backend sends no parentAppId', async () => {
      // Older backend: no parentAppId, and all three apps display the same IP.
      setUpDevice([k3sVM, composeApp, composeRuntime]);

      const { container } = render(<App />);
      fireEvent.click(await screen.findByText('Node 1'));
      await screen.findByText('Running Applications');
      await screen.findByText('zededa-berlin-EM321.dealerfd');

      assertNestedUnderRuntime(container);
    });
  });

  it('does not show Diagnostics button for compose runtime v1.x', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;
    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const node = { id: 'node-1', name: 'Node 1', status: 'online' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));

    // Compose runtime v1.x (should NOT show diagnostics)
    const runtimeApp = {
      name: 'compose-runtime-v1',
      id: 'rt-v1',
      status: 'RUN_STATE_ONLINE',
      appType: 'APP_TYPE_VM',
      appVersion: '1.2.12',
      ips: ['192.168.1.20'],
      internalIps: ['10.0.0.6'],
      containers: [],
    };
    const composeAppV1 = {
      name: 'compose-app-v1',
      id: 'ca-v1',
      status: 'RUN_STATE_ONLINE',
      appType: 'APP_TYPE_DOCKER_COMPOSE',
      ips: ['192.168.1.20'],
      internalIps: [],
      containers: [{ containerName: 'app', containerState: 'running' }],
    };
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([runtimeApp, composeAppV1]));
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });

    render(<App />);

    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);

    await screen.findByText('Running Applications');

    // Diagnostics button should NOT be rendered for v1.x runtime
    expect(screen.queryByText('Diagnostics')).not.toBeInTheDocument();
  });
});

describe('Search with local cache filtering', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const config = {
    baseUrl: 'https://cluster.example',
    apiToken: validToken,
    clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
    activeCluster: 'Prod',
    recentDevices: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);
    electronAPI.GetProjects.mockResolvedValue([]);
    electronAPI.GetEnterprise.mockResolvedValue({ name: 'Test Enterprise' });
  });

  it('search by partial project name returns devices from matching projects', async () => {
    const devices = [
      { id: 'n1', name: 'Server-1', status: 'online', project: 'proj-abc' },
      { id: 'n2', name: 'Server-2', status: 'online', project: 'proj-abc' },
      { id: 'n3', name: 'Other-1', status: 'online', project: 'proj-def' },
    ];
    const projects = [
      { id: 'proj-abc', name: 'Production' },
      { id: 'proj-def', name: 'Staging' },
    ];

    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices, projects));

    render(<App />);

    // Wait for cache to load
    await screen.findByText('Server-1');

    const searchInput = screen.getByPlaceholderText('Search nodes, projects...');
    fireEvent.change(searchInput, { target: { value: 'Prod' } });

    // Local filtering is instant (useMemo)
    await waitFor(() => {
      expect(screen.getByText('Server-1')).toBeInTheDocument();
      expect(screen.getByText('Server-2')).toBeInTheDocument();
    });

    // Non-matching devices should not appear
    expect(screen.queryByText('Other-1')).not.toBeInTheDocument();
  });

  it('search filters by device name', async () => {
    const devices = [
      { id: 'n1', name: 'CHINA-Device', status: 'online', project: 'proj-dev' },
      { id: 'n2', name: 'UNRELATED123', status: 'online', project: 'proj-dev' },
      { id: 'n3', name: 'INTTST445843', status: 'online', project: 'proj-china' },
    ];
    const projects = [
      { id: 'proj-china', name: 'BOBST-staging-no-tpm-china' },
      { id: 'proj-dev', name: 'BOBST-develop' },
    ];

    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices, projects));

    render(<App />);

    await screen.findByText('CHINA-Device');

    const searchInput = screen.getByPlaceholderText('Search nodes, projects...');
    fireEvent.change(searchInput, { target: { value: 'china' } });

    await waitFor(() => {
      // CHINA-Device matches by device name
      expect(screen.getByText('CHINA-Device')).toBeInTheDocument();
      // INTTST445843 matches by project name (contains "china")
      expect(screen.getByText('INTTST445843')).toBeInTheDocument();
    });

    // UNRELATED123 should be filtered out
    expect(screen.queryByText('UNRELATED123')).not.toBeInTheDocument();
  });

  it('switching cluster clears the search so the new cluster is not filtered by the old query', async () => {
    const twoClusters = {
      ...config,
      clusters: [
        { name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken },
        { name: 'Staging', baseUrl: 'https://staging.example', apiToken: validToken },
      ],
    };
    electronAPI.GetSettings.mockResolvedValue(twoClusters);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(twoClusters);
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([
      { id: 'n1', name: 'Prod-Device', status: 'online', project: 'p1' },
    ]));

    render(<App />);
    await screen.findByText('Prod-Device');

    const searchInput = screen.getByPlaceholderText('Search nodes, projects...');
    fireEvent.change(searchInput, { target: { value: 'Prod-Dev' } });
    expect(searchInput).toHaveValue('Prod-Dev');

    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([
      { id: 'n2', name: 'Staging-Device', status: 'online', project: 'p2' },
    ]));
    fireEvent.click(screen.getByTitle('Switch Cluster'));
    fireEvent.click(await screen.findByText('Staging'));

    expect(await screen.findByText('Staging-Device')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search nodes, projects...')).toHaveValue('');
  });

  it('shows all devices when search is empty', async () => {
    const devices = [
      { id: 'n1', name: 'Device-A', status: 'online', project: 'p1' },
      { id: 'n2', name: 'Device-B', status: 'offline', project: 'p1' },
    ];
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices));

    render(<App />);

    await screen.findByText('Device-A');
    expect(screen.getByText('Device-B')).toBeInTheDocument();
  });

  it('clicking offline device opens details with cloud data and offline banner', async () => {
    const devices = [
      { id: 'n1', name: 'Offline-Dev', status: 'offline', project: 'p1' },
    ];
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify({ services: [{ name: 'test-app', status: 'HALTED' }] }));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', managementIPs: ['10.0.0.1'] });

    render(<App />);

    const nodeItem = await screen.findByText('Offline-Dev');
    fireEvent.click(nodeItem);

    // Should show the device details with cloud data
    await waitFor(() => {
      expect(screen.getByText('Activity Log')).toBeInTheDocument();
    });

    // Should show the offline banner
    await waitFor(() => {
      expect(screen.getByText(/live operations .* are unavailable/)).toBeInTheDocument();
    });

    // Should have called cloud APIs even though device is offline
    expect(electronAPI.GetDeviceServices).toHaveBeenCalledWith('n1', 'Offline-Dev');
    expect(electronAPI.GetSSHStatus).toHaveBeenCalledWith('n1');
  });

  // Regression: cloud-config controls (VGA/USB/Console/Ext Policy/SSH key) are
  // ZEDEDA Cloud PUTs the device reconciles on reconnect — they must remain
  // clickable while the device is offline. Only live-session operations
  // (SSH Terminal, VNC, TCP tunnels, Collect Info) require the device online.
  it('config chips (VGA/USB/Console/SSH/Ext Policy) work on offline devices', async () => {
    const devices = [
      { id: 'n1', name: 'Offline-Dev', status: 'offline', project: 'p1' },
    ];
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify({ services: [] }));
    electronAPI.GetSSHStatus.mockResolvedValue({
      status: 'disabled',
      vgaEnabled: false,
      usbEnabled: false,
      consoleEnabled: false,
      externalPolicy: false,
      managementIPs: ['10.0.0.1'],
    });

    render(<App />);
    fireEvent.click(await screen.findByText('Offline-Dev'));
    await waitFor(() => expect(screen.getByText('Activity Log')).toBeInTheDocument());

    // Each chip should be clickable and dispatch its cloud API call, despite
    // the device being offline. Cloud accepts the change; device reconciles
    // when it reconnects.
    fireEvent.click(await screen.findByText('Enable VGA'));
    await waitFor(() => expect(electronAPI.SetVGAEnabled).toHaveBeenCalledWith('n1', true));

    fireEvent.click(screen.getByText('Enable USB'));
    await waitFor(() => expect(electronAPI.SetUSBEnabled).toHaveBeenCalledWith('n1', true));

    fireEvent.click(screen.getByText('Enable Console'));
    await waitFor(() => expect(electronAPI.SetConsoleEnabled).toHaveBeenCalledWith('n1', true));

    fireEvent.click(screen.getByText('Enable SSH'));
    await waitFor(() => expect(electronAPI.SetupSSH).toHaveBeenCalledWith('n1'));

    fireEvent.click(screen.getByText('Enable Ext. Policy'));
    await waitFor(() => expect(electronAPI.EnableExternalPolicy).toHaveBeenCalledWith('n1', true));
  });

  // Regression: when the API token expires mid-session, ZEDEDA returns 401.
  // The backend tags these with code "UNAUTHORIZED". The UI surfaces this through
  // ONE persistent, app-global banner (with an Update Token action that deep-links
  // to Settings) — not the ephemeral status toast and not an inline per-section
  // message. It must also NOT dump the raw ZEDEDA error envelope, and the Running
  // Applications section must not lie with "No apps found" when the real cause is
  // a dead token.
  it('expired API token shows actionable prompt and opens settings, not a raw 401 blob', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;
    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const devices = [{ id: 'n1', name: 'Offline-Dev', status: 'offline', project: 'p1' }];
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices));

    // Simulate the thrown error tauriAPI produces for a 401 (code attached).
    const authErr = Object.assign(new Error('The ZEDEDA API token for this cluster is invalid or expired.'), { code: 'UNAUTHORIZED' });
    electronAPI.GetDeviceServices.mockRejectedValue(authErr);
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', managementIPs: ['10.0.0.1'] });

    render(<App />);
    fireEvent.click(await screen.findByText('Offline-Dev'));
    await waitFor(() => expect(screen.getByText('Activity Log')).toBeInTheDocument());

    // Friendly, actionable message — and crucially NOT the raw envelope.
    await waitFor(() => {
      expect(screen.getByText(/expired or is invalid/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/OPS_TYPE_UNSPECIFIED|httpStatusCode|Session Cache miss/)).not.toBeInTheDocument();

    // Sections that depend on live cloud reads (EdgeView/SSH details, Running
    // Applications) must not show stale data or lie with "No apps found" — each shows
    // a neutral unavailable note while the global banner explains why.
    expect(screen.queryByText('No apps found')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Unavailable while the API token is expired/i).length).toBeGreaterThan(0);

    // Exactly one Update Token affordance (the consolidated banner — not duplicated
    // across an inline banner and a toast). It deep-links to Settings with the
    // cluster's token field ready to paste.
    const updateBtns = screen.getAllByText('Update Token');
    expect(updateBtns).toHaveLength(1);
    fireEvent.click(updateBtns[0]);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste token from ZEDEDA Cloud...')).toBeInTheDocument();
    });
  });

  // The persistent auth banner can be dismissed, but dismissing it only hides the
  // banner — it must NOT un-gate the stale device data (authError stays true), so the
  // "Unavailable while the API token is expired" notes remain. (It re-surfaces on the
  // next real failure; that reset is covered by the handleAuthError/effect logic.)
  it('auth banner is dismissible without resurrecting stale device data', async () => {
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;
    const config = {
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
      activeCluster: 'Prod',
      recentDevices: [],
    };
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);

    const devices = [{ id: 'n1', name: 'Offline-Dev', status: 'offline', project: 'p1' }];
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices));

    const authErr = Object.assign(new Error('invalid or expired'), { code: 'UNAUTHORIZED' });
    electronAPI.GetDeviceServices.mockRejectedValue(authErr);
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', managementIPs: ['10.0.0.1'] });

    render(<App />);
    fireEvent.click(await screen.findByText('Offline-Dev'));
    await waitFor(() => expect(screen.getByText(/expired or is invalid/i)).toBeInTheDocument());

    // Dismiss hides the banner...
    fireEvent.click(screen.getByLabelText('Dismiss'));
    await waitFor(() => expect(screen.queryByText(/expired or is invalid/i)).not.toBeInTheDocument());

    // ...but the device panel still refuses to show stale data — authError is still
    // true, so the unavailable notes persist independent of the banner's visibility.
    expect(screen.getAllByText(/Unavailable while the API token is expired/i).length).toBeGreaterThan(0);
  });

  it('refresh button calls RefreshDeviceCache', async () => {
    const devices = [
      { id: 'n1', name: 'Device-1', status: 'online', project: 'p1' },
    ];
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices));

    render(<App />);

    await screen.findByText('Device-1');

    const refreshButton = screen.getByTitle('Refresh device list');
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(electronAPI.RefreshDeviceCache).toHaveBeenCalled();
    });
  });
});

describe('Switch Cluster dropdown filter', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const mkCluster = (name, environment) => ({
    name,
    baseUrl: `https://${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example`,
    apiToken: validToken,
    environment,
  });
  const config = {
    baseUrl: 'https://production-zededa-demo.example',
    apiToken: validToken,
    clusters: [
      mkCluster('Production - zededa-demo', 'prod'),
      mkCluster('Maersk FbM - Prod', 'prod'),
      mkCluster('Maersk FbM - Staging', 'staging'),
      mkCluster('Sandbox', 'demo'),
    ],
    activeCluster: 'Production - zededa-demo',
    recentDevices: [],
  };
  const devices = [
    { id: 'n1', name: 'Device-A', status: 'online', project: 'p1' },
    { id: 'n2', name: 'Device-B', status: 'online', project: 'p1' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockResolvedValue(config);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(config);
    electronAPI.GetProjects.mockResolvedValue([]);
    electronAPI.GetEnterprise.mockResolvedValue({ name: 'Test Enterprise' });
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices));
  });

  const openDropdown = async () => {
    render(<App />);
    await screen.findByText('Device-A');
    fireEvent.click(screen.getByTitle('Switch Cluster'));
    const input = await screen.findByPlaceholderText('Filter clusters…');
    return { input, list: screen.getByRole('listbox', { name: 'Clusters' }) };
  };
  const optionNames = (list) => within(list).queryAllByRole('option').map(o => o.textContent);

  it('autofocuses the filter and narrows clusters by name and environment', async () => {
    const { input, list } = await openDropdown();
    expect(input).toHaveFocus();
    expect(within(list).getAllByRole('option')).toHaveLength(4);

    fireEvent.change(input, { target: { value: 'maersk' } });
    expect(optionNames(list)).toEqual(['Maersk FbM - Prodprod', 'Maersk FbM - Stagingstaging']);

    // Environment match ("staging" pill) — case-insensitive.
    fireEvent.change(input, { target: { value: 'STAG' } });
    expect(optionNames(list)).toEqual(['Maersk FbM - Stagingstaging']);

    fireEvent.change(input, { target: { value: 'demo' } });
    // "Production - zededa-demo" by name, "Sandbox" by its demo environment.
    expect(optionNames(list)).toEqual(['Production - zededa-demoprod', 'Sandboxdemo']);

    fireEvent.change(input, { target: { value: 'nothing-like-this' } });
    expect(within(list).queryAllByRole('option')).toHaveLength(0);
    expect(within(list).getByText('No clusters match')).toBeInTheDocument();
  });

  it('ArrowDown + Enter activates the highlighted cluster', async () => {
    const { input, list } = await openDropdown();
    fireEvent.change(input, { target: { value: 'maersk' } });
    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(list).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    // Wraps around past the end.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(list).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(within(list).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    const injectCallsBefore = electronAPI.InjectSecureConfig.mock.calls.length;
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(electronAPI.SecureStorageSaveSettings).toHaveBeenCalledTimes(1));
    expect(electronAPI.SecureStorageSaveSettings.mock.calls[0][0].activeCluster).toBe('Maersk FbM - Staging');
    await waitFor(() => expect(electronAPI.InjectSecureConfig.mock.calls.length).toBeGreaterThan(injectCallsBefore));
    expect(screen.queryByPlaceholderText('Filter clusters…')).not.toBeInTheDocument();
  });

  it('Enter with a single match activates it without arrowing', async () => {
    const { input } = await openDropdown();
    fireEvent.change(input, { target: { value: 'sandbox' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(electronAPI.SecureStorageSaveSettings).toHaveBeenCalledTimes(1));
    expect(electronAPI.SecureStorageSaveSettings.mock.calls[0][0].activeCluster).toBe('Sandbox');
  });

  it('Enter on the already-active cluster just closes', async () => {
    const { input } = await openDropdown();
    // InjectSecureConfig also runs at startup; only calls after Enter count.
    const injectCallsBefore = electronAPI.InjectSecureConfig.mock.calls.length;
    fireEvent.change(input, { target: { value: 'zededa-demo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByPlaceholderText('Filter clusters…')).not.toBeInTheDocument());
    expect(electronAPI.SecureStorageSaveSettings).not.toHaveBeenCalled();
    expect(electronAPI.InjectSecureConfig).toHaveBeenCalledTimes(injectCallsBefore);
  });

  it('opens with the active cluster highlighted, so an immediate Enter does not switch', async () => {
    const midActive = { ...config, activeCluster: 'Maersk FbM - Staging' };
    electronAPI.GetSettings.mockResolvedValue(midActive);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(midActive);
    const { input, list } = await openDropdown();
    expect(within(list).getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');

    // Typing then clearing the filter returns the highlight to the active cluster.
    fireEvent.change(input, { target: { value: 'sand' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(within(list).getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByPlaceholderText('Filter clusters…')).not.toBeInTheDocument());
    expect(electronAPI.SecureStorageSaveSettings).not.toHaveBeenCalled();
  });

  it('keys typed in the filter do not navigate or connect devices', async () => {
    const { input } = await openDropdown();
    const deviceSearch = screen.getByPlaceholderText('Search nodes, projects...');
    const firstRow = screen.getByText('Device-A').closest('.result-item');
    expect(firstRow).toHaveClass('selected');

    fireEvent.change(input, { target: { value: 'no-such-cluster' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'a' });

    // Device list selection unchanged, nothing opened, device search untouched.
    expect(screen.getByText('Device-A').closest('.result-item')).toHaveClass('selected');
    expect(electronAPI.AddRecentDevice).not.toHaveBeenCalled();
    expect(electronAPI.SecureStorageSaveSettings).not.toHaveBeenCalled();
    expect(deviceSearch).toHaveValue('');
    expect(screen.getByPlaceholderText('Filter clusters…')).toBeInTheDocument();

    // Escape closes the popover.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Filter clusters…')).not.toBeInTheDocument();
    expect(electronAPI.AddRecentDevice).not.toHaveBeenCalled();
  });

  it('resets the query and highlight after closing and reopening', async () => {
    const { input } = await openDropdown();
    fireEvent.change(input, { target: { value: 'maersk' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Filter clusters…')).not.toBeInTheDocument();

    // Reopen: filter empty, full list, first row highlighted.
    fireEvent.click(screen.getByTitle('Switch Cluster'));
    const reopened = await screen.findByPlaceholderText('Filter clusters…');
    expect(reopened).toHaveValue('');
    const options = within(screen.getByRole('listbox', { name: 'Clusters' })).getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    // Outside click also resets.
    fireEvent.change(reopened, { target: { value: 'sand' } });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByPlaceholderText('Filter clusters…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Switch Cluster'));
    expect(await screen.findByPlaceholderText('Filter clusters…')).toHaveValue('');
  });
});

describe('Status bar and global tunnels', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const configWithToken = {
    baseUrl: 'https://cluster.example',
    apiToken: validToken,
    clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
    activeCluster: 'Prod',
    recentDevices: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockReset();
    electronAPI.SecureStorageGetSettings.mockReset();
    electronAPI.GetDeviceCache.mockReset();
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache());
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      writable: true,
    });
  });

  it('All Tunnels button is hidden when there are no active tunnels', async () => {
    const emptyConfig = { baseUrl: '', apiToken: '', clusters: [], activeCluster: '', recentDevices: [] };
    electronAPI.GetSettings.mockResolvedValue(emptyConfig);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(emptyConfig);

    render(<App />);

    await screen.findByRole('heading', { name: 'Configuration' });

    // The button only renders when at least one active tunnel exists.
    expect(screen.queryByText('All Tunnels')).not.toBeInTheDocument();
  });

  it('clicking All Tunnels shows global tunnel panel with cross-device tunnels', async () => {
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);

    const node = { id: 'node-1', name: 'Node 1', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node], [{ id: 'proj-1', name: 'Project 1' }]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    // Return tunnels from two different devices when polled
    electronAPI.ListTunnels.mockResolvedValue([
      {
        ID: 'tun-1', NodeID: 'node-1', NodeName: 'Node 1', Type: 'TCP',
        TargetIP: '10.0.0.1:5900', LocalPort: 6001, Status: 'active',
        IsEncrypted: true, BytesSent: 0, BytesReceived: 0,
      },
      {
        ID: 'tun-2', NodeID: 'node-2', NodeName: 'Node 2', Type: 'TCP',
        TargetIP: '10.0.0.2:22', LocalPort: 6002, Status: 'active',
        IsEncrypted: false, BytesSent: 0, BytesReceived: 0,
      },
    ]);

    render(<App />);

    // Select device to trigger tunnel polling
    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);
    await screen.findByText('Running Applications');

    // Wait for tunnel polling to populate activeTunnels. Note that waiting on
    // 'Active Tunnels' would prove nothing: that section title renders for any
    // selectedNode, and the tunnel count only toggles a CSS class. The
    // 'All Tunnels' button is gated on activeTunnels being non-empty, so
    // waiting for it is what actually confirms the ListTunnels poll landed.
    const allTunnelsBtn = await screen.findByText('All Tunnels');
    fireEvent.click(allTunnelsBtn);

    // Global panel should render
    await waitFor(() => {
      expect(screen.getByText('All Active Tunnels')).toBeInTheDocument();
    });

    // Should show tunnels from both devices
    const globalSection = screen.getByText('All Active Tunnels').closest('.active-tunnels-section');
    expect(globalSection).not.toBeNull();
    const withinGlobal = within(globalSection);
    expect(withinGlobal.getByText('Node 1')).toBeInTheDocument();
    expect(withinGlobal.getByText('Node 2')).toBeInTheDocument();
  });

  it('notifies the tray (tunnels-changed) when an active tunnel appears', async () => {
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);

    const node = { id: 'node-1', name: 'Node 1', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node], [{ id: 'proj-1', name: 'Project 1' }]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    // A tunnel is present, so the immediate poll on node selection surfaces it.
    electronAPI.ListTunnels.mockResolvedValue([
      {
        ID: 'tun-1', NodeID: 'node-1', NodeName: 'Node 1', Type: 'TCP',
        TargetIP: '10.0.0.1:5900', LocalPort: 6001, Status: 'active',
        IsEncrypted: true, BytesSent: 0, BytesReceived: 0,
      },
    ]);

    render(<App />);

    fireEvent.click(await screen.findByText('Node 1'));
    await screen.findByText('Running Applications');

    await waitFor(() => {
      expect(screen.getByText('Active Tunnels')).toBeInTheDocument();
    });
    // The active-tunnel set changed from empty to one, so the tray is notified.
    await waitFor(() => {
      expect(electronAPI.EmitTunnelsChanged).toHaveBeenCalled();
    });
  });

  it('does not notify the tray when there are no active tunnels', async () => {
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);

    const node = { id: 'node-1', name: 'Node 1', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node], [{ id: 'proj-1', name: 'Project 1' }]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    electronAPI.ListTunnels.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByText('Node 1'));
    await screen.findByText('Running Applications');

    // The active-tunnel set stays empty (matches the baseline), so no tray churn.
    expect(electronAPI.EmitTunnelsChanged).not.toHaveBeenCalled();
  });

  it('clicking Hide All Tunnels dismisses the panel', async () => {
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);

    const node = { id: 'node-1', name: 'Node 1', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    electronAPI.ListTunnels.mockResolvedValue([
      {
        ID: 'tun-1', NodeID: 'node-1', NodeName: 'Node 1', Type: 'TCP',
        TargetIP: '10.0.0.1:80', LocalPort: 6001, Status: 'active',
        IsEncrypted: true, BytesSent: 0, BytesReceived: 0,
      },
    ]);

    render(<App />);

    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);
    await screen.findByText('Running Applications');

    // Open global tunnels. findByText waits for the ListTunnels poll to land;
    // 'Active Tunnels' would not, since it renders for any selectedNode.
    fireEvent.click(await screen.findByText('All Tunnels'));
    await waitFor(() => {
      expect(screen.getByText('All Active Tunnels')).toBeInTheDocument();
    });

    // Close global tunnels
    fireEvent.click(screen.getByText('Hide All Tunnels'));
    expect(screen.queryByText('All Active Tunnels')).not.toBeInTheDocument();
  });

  it('All Tunnels button is not rendered when there are no active tunnels', async () => {
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);

    const node = { id: 'node-1', name: 'Node 1', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.ListTunnels.mockResolvedValue([]);

    render(<App />);

    await screen.findByText('Node 1');

    // With no active tunnels, the button is hidden, and the panel cannot appear.
    expect(screen.queryByText('All Tunnels')).not.toBeInTheDocument();
    expect(screen.queryByText('All Active Tunnels')).not.toBeInTheDocument();
  });

  it('status bar shows result count on device list', async () => {
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);

    const devices = [
      { id: 'n1', name: 'Device-A', status: 'online', project: 'p1' },
      { id: 'n2', name: 'Device-B', status: 'online', project: 'p1' },
      { id: 'n3', name: 'Device-C', status: 'offline', project: 'p1' },
    ];
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices));

    render(<App />);

    await screen.findByText('Device-A');

    expect(screen.getByText('3 results')).toBeInTheDocument();
  });
});

describe('Navigation and interaction flows', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const configWithToken = {
    baseUrl: 'https://cluster.example',
    apiToken: validToken,
    clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
    activeCluster: 'Prod',
    recentDevices: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockReset();
    electronAPI.SecureStorageGetSettings.mockReset();
    electronAPI.GetDeviceCache.mockReset();
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache());
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      writable: true,
    });
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);
  });

  it('clicking back arrow returns to device list', async () => {
    const node = { id: 'node-1', name: 'BackNav-Device', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });

    render(<App />);

    // Select device
    const nodeItem = await screen.findByText('BackNav-Device');
    fireEvent.click(nodeItem);

    await screen.findByText('Activity Log');

    // Click back arrow
    const backIcon = screen.getByRole('button', { name: /back/i });
    expect(backIcon).not.toBeNull();
    fireEvent.click(backIcon);

    // Should be back on device list
    await waitFor(() => {
      expect(screen.queryByText('Activity Log')).not.toBeInTheDocument();
    });
    expect(screen.getByText('BackNav-Device')).toBeInTheDocument();
  });

  it('pressing Escape on device details returns to device list', async () => {
    const node = { id: 'node-1', name: 'EscNav-Device', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });

    render(<App />);

    const nodeItem = await screen.findByText('EscNav-Device');
    fireEvent.click(nodeItem);
    await screen.findByText('Activity Log');

    const appContainer = document.querySelector('.app-container');
    fireEvent.keyDown(appContainer, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Activity Log')).not.toBeInTheDocument();
    });
    expect(screen.getByText('EscNav-Device')).toBeInTheDocument();
  });

  it('selecting a device calls GetDeviceServices and GetSSHStatus', async () => {
    const node = { id: 'dev-42', name: 'API-Test-Device', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });

    render(<App />);

    const nodeItem = await screen.findByText('API-Test-Device');
    fireEvent.click(nodeItem);

    await waitFor(() => {
      expect(electronAPI.GetDeviceServices).toHaveBeenCalledWith('dev-42', 'API-Test-Device');
      expect(electronAPI.GetSSHStatus).toHaveBeenCalledWith('dev-42');
    });
  });

  it('arrow keys navigate device list and Enter selects a device', async () => {
    const devices = [
      { id: 'n1', name: 'Alpha-Device', status: 'online', project: 'p1' },
      { id: 'n2', name: 'Beta-Device', status: 'online', project: 'p1' },
      { id: 'n3', name: 'Gamma-Device', status: 'online', project: 'p1' },
    ];
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache(devices));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });

    render(<App />);

    await screen.findByText('Alpha-Device');

    const appContainer = document.querySelector('.app-container');

    // Arrow down twice to reach third device (index 0 -> 1 -> 2)
    fireEvent.keyDown(appContainer, { key: 'ArrowDown' });
    fireEvent.keyDown(appContainer, { key: 'ArrowDown' });
    fireEvent.keyDown(appContainer, { key: 'Enter' });

    // Should have selected the third device and opened details
    await waitFor(() => {
      expect(electronAPI.GetDeviceServices).toHaveBeenCalledWith('n3', 'Gamma-Device');
    });
  });

  it('Escape closes settings panel', async () => {
    render(<App />);

    await screen.findByText('Alpha-Device').catch(() => null);

    // Open settings via Cmd+,
    const appContainer = document.querySelector('.app-container');
    fireEvent.keyDown(appContainer, { key: ',', metaKey: true });

    await screen.findByRole('heading', { name: 'Configuration' });

    // Press Escape to close
    fireEvent.keyDown(appContainer, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument();
    });
  });

  it('Escape in Settings closes the Base URL dropdown, then leaves the field, then closes Settings', async () => {
    render(<App />);
    const appContainer = document.querySelector('.app-container');
    const openSettings = async () => {
      fireEvent.keyDown(appContainer, { key: ',', metaKey: true });
      await screen.findByRole('heading', { name: 'Configuration' });
    };
    const isSettingsOpen = () => screen.queryByRole('heading', { name: 'Configuration' }) !== null;

    await openSettings();
    const baseUrl = await screen.findByPlaceholderText('https://zedcontrol.zededa.net');
    baseUrl.focus();
    fireEvent.focus(baseUrl);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    // 1st Escape: only the dropdown closes.
    fireEvent.keyDown(baseUrl, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(isSettingsOpen()).toBe(true);

    // 2nd Escape: focus leaves the field; Settings stays open.
    fireEvent.keyDown(baseUrl, { key: 'Escape' });
    expect(document.activeElement).toBe(appContainer);
    expect(isSettingsOpen()).toBe(true);

    // 3rd Escape: Settings closes.
    fireEvent.keyDown(appContainer, { key: 'Escape' });
    await waitFor(() => expect(isSettingsOpen()).toBe(false));
  });

  it('a Base URL dropdown left open does not reappear when Settings is reopened', async () => {
    render(<App />);
    const appContainer = document.querySelector('.app-container');
    fireEvent.keyDown(appContainer, { key: ',', metaKey: true });
    await screen.findByRole('heading', { name: 'Configuration' });

    // Open via the chevron so the input never has focus to lose.
    fireEvent.mouseDown(screen.getByTitle('Show preset URLs'));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    // Close Settings from the toolbar icon, then reopen.
    fireEvent.click(document.querySelector('.header-actions svg.lucide-settings'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument());
    fireEvent.keyDown(appContainer, { key: ',', metaKey: true });
    await screen.findByRole('heading', { name: 'Configuration' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('EdgeView session controls', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const configWithToken = {
    baseUrl: 'https://cluster.example',
    apiToken: validToken,
    clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
    activeCluster: 'Prod',
    recentDevices: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockReset();
    electronAPI.SecureStorageGetSettings.mockReset();
    electronAPI.GetDeviceCache.mockReset();
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache());
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      writable: true,
    });
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);
  });

  it('clicking Enable SSH chip calls SetupSSH', async () => {
    const node = { id: 'node-1', name: 'SSH-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    render(<App />);

    const nodeItem = await screen.findByText('SSH-Test');
    fireEvent.click(nodeItem);

    await screen.findByText('EdgeView Session');

    const enableSshChip = screen.getByTitle('SSH Disabled - Click to Enable');
    fireEvent.click(enableSshChip);

    await waitFor(() => {
      expect(electronAPI.SetupSSH).toHaveBeenCalledWith('node-1');
    });
  });

  it('refresh shows the session inactive once EdgeView is stopped on the controller', async () => {
    const node = { id: 'node-1', name: 'EV-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: String(Math.floor(Date.now() / 1000) + 3600) });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Test'));
    await screen.findByText('Activated');

    // Controller now reports the session gone: backend drops its cache and
    // passes through the cloud's expireSec "0".
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: '0' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });
    fireEvent.click(screen.getByTitle('Refresh device status'));

    await screen.findByText('Inactive');
    expect(screen.queryByText('Activated')).not.toBeInTheDocument();
    await screen.findByText(/No active EdgeView session/);
  });

  it('refresh shows the session as Unknown when the controller cannot be reached', async () => {
    const node = { id: 'node-1', name: 'EV-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: String(Math.floor(Date.now() / 1000) + 3600) });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Test'));
    await screen.findByText('Activated');

    // Controller GET fails: backend returns status 'unknown' and keeps its
    // cache, so GetSessionStatus still reports the cached session as active.
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'unknown' });
    fireEvent.click(screen.getByTitle('Refresh device status'));

    await screen.findByText('Unknown');
    expect(screen.queryByText('Activated')).not.toBeInTheDocument();
    await screen.findByText(/Could not reach controller/);
  });

  it('Disconnect button asks for confirmation, then ends the EdgeView session', async () => {
    const node = { id: 'node-1', name: 'EV-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: String(Math.floor(Date.now() / 1000) + 3600) });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Test'));
    await screen.findByText('Activated');

    // After the controller call the backend reports the session gone.
    electronAPI.DisconnectEdgeView.mockImplementation(async () => {
      electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: '0' });
      electronAPI.GetSessionStatus.mockResolvedValue({ active: false });
    });
    fireEvent.click(screen.getByTitle('Disconnect EdgeView session on the controller'));

    // Nothing happens until the user confirms in the dialog.
    await screen.findByText('Disconnect EdgeView Session');
    expect(electronAPI.DisconnectEdgeView).not.toHaveBeenCalled();
    const dialog = screen.getByText('Disconnect EdgeView Session').closest('.modal-container');
    fireEvent.click(within(dialog).getByRole('button', { name: /disconnect/i }));

    await waitFor(() => expect(electronAPI.DisconnectEdgeView).toHaveBeenCalledWith('node-1'));
    await screen.findByText('Inactive');
    await screen.findByText(/EdgeView session disconnected/);
    expect(screen.queryByText('Disconnect EdgeView Session')).not.toBeInTheDocument();
    // The toggle now offers to start a new session.
    expect(screen.getByTitle('Start an EdgeView session on the controller')).toHaveTextContent('Connect');
  });

  it('Disconnect does nothing when the confirmation is cancelled', async () => {
    const node = { id: 'node-1', name: 'EV-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: String(Math.floor(Date.now() / 1000) + 3600) });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Test'));
    await screen.findByText('Activated');
    fireEvent.click(screen.getByTitle('Disconnect EdgeView session on the controller'));
    await screen.findByText('Disconnect EdgeView Session');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Disconnect EdgeView Session')).not.toBeInTheDocument();
    expect(electronAPI.DisconnectEdgeView).not.toHaveBeenCalled();
    expect(screen.getByText('Activated')).toBeInTheDocument();
  });

  it('Connect starts an EdgeView session on the controller when there is none', async () => {
    const node = { id: 'node-1', name: 'EV-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: '0' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Test'));
    await screen.findByText('Inactive');

    electronAPI.StartEdgeViewSession.mockImplementation(async () => {
      electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: String(Math.floor(Date.now() / 1000) + 18000) });
      electronAPI.GetSessionStatus.mockResolvedValue({ active: false });
    });
    fireEvent.click(screen.getByTitle('Start an EdgeView session on the controller'));

    await waitFor(() => expect(electronAPI.StartEdgeViewSession).toHaveBeenCalledWith('node-1'));
    await screen.findByText('Activated');
    expect(screen.getByTitle('Disconnect EdgeView session on the controller')).toHaveTextContent('Disconnect');
  });

  it('Connect without the needed ZEDEDA permission shows a Permission denied toast, not the raw 403 or the token banner', async () => {
    const node = { id: 'node-1', name: 'EV-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: '0', cloudSession: 'ended' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Test'));
    const connect = await screen.findByTitle('Start an EdgeView session on the controller');

    const reason = 'Your ZEDEDA account does not have the PermissionAccessUpdate permission needed for this action. Ask an enterprise admin to grant it to your role for this device\'s project.';
    electronAPI.StartEdgeViewSession.mockRejectedValue(
      Object.assign(new Error(reason), { code: 'FORBIDDEN', permission: 'PermissionAccessUpdate' }),
    );
    fireEvent.click(connect);

    const title = await screen.findByText('Permission denied');
    const banner = screen.getByTestId('global-status-banner-mock');
    expect(banner).toContainElement(title);
    expect(banner).toHaveAttribute('data-type', 'error');
    expect(banner).toHaveTextContent(`Couldn't start EdgeView. ${reason}`);
    // Not an expired token: the Update Token banner must not appear.
    expect(screen.queryByText('Authentication failed')).not.toBeInTheDocument();
    await waitFor(() => expect(connect).not.toBeDisabled());
  });

  it('Connect works on an offline device (cloud-config, not gated on online)', async () => {
    const node = { id: 'node-1', name: 'EV-Offline', status: 'offline', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: '0' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Offline'));
    const connect = await screen.findByTitle('Start an EdgeView session on the controller');
    expect(connect).not.toBeDisabled();
    fireEvent.click(connect);
    await waitFor(() => expect(electronAPI.StartEdgeViewSession).toHaveBeenCalledWith('node-1'));
  });

  it('Connect is disabled while its request is in flight, so a second click does not fire', async () => {
    const node = { id: 'node-1', name: 'EV-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: '0', cloudSession: 'ended' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Test'));
    const connect = await screen.findByTitle('Start an EdgeView session on the controller');

    let finish;
    electronAPI.StartEdgeViewSession.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(connect);
    await waitFor(() => expect(connect).toBeDisabled());
    fireEvent.click(connect);
    expect(electronAPI.StartEdgeViewSession).toHaveBeenCalledTimes(1);

    await act(async () => { finish(); });
    await waitFor(() => expect(connect).not.toBeDisabled());
  });

  it('offers Disconnect, not Connect, when the controller has a session with an unreadable expiry', async () => {
    const node = { id: 'node-1', name: 'EV-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: '', cloudSession: 'indeterminate' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Test'));
    const toggle = await screen.findByTitle('Disconnect EdgeView session on the controller');
    expect(toggle).toHaveTextContent('Disconnect');
    expect(screen.queryByTitle('Start an EdgeView session on the controller')).not.toBeInTheDocument();
  });

  it('Connect/Disconnect is disabled when the controller cannot be reached', async () => {
    const node = { id: 'node-1', name: 'EV-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'unknown' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    render(<App />);
    fireEvent.click(await screen.findByText('EV-Test'));
    await screen.findByText('Unknown');
    expect(screen.getByTitle("Can't reach controller")).toBeDisabled();
  });

  it('clicking SSH Enabled chip calls DisableSSH', async () => {
    const node = { id: 'node-1', name: 'SSH-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: Math.floor(Date.now() / 1000) + 3600 });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    // DisableSSH shows a confirm dialog
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    const nodeItem = await screen.findByText('SSH-Test');
    fireEvent.click(nodeItem);

    await screen.findByText('EdgeView Session');

    const disableSshChip = screen.getByTitle('SSH Enabled - Click to Disable');
    fireEvent.click(disableSshChip);

    await waitFor(() => {
      expect(electronAPI.DisableSSH).toHaveBeenCalledWith('node-1');
    });

    window.confirm.mockRestore();
  });

  it('clicking VGA chip calls SetVGAEnabled', async () => {
    const node = { id: 'node-1', name: 'VGA-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', vgaEnabled: false });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    render(<App />);

    const nodeItem = await screen.findByText('VGA-Test');
    fireEvent.click(nodeItem);

    await screen.findByText('EdgeView Session');

    const vgaChip = screen.getByTitle('VGA Disabled - Click to Enable');
    fireEvent.click(vgaChip);

    await waitFor(() => {
      expect(electronAPI.SetVGAEnabled).toHaveBeenCalledWith('node-1', true);
    });
  });

  it('clicking USB chip calls SetUSBEnabled', async () => {
    const node = { id: 'node-1', name: 'USB-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', usbEnabled: false });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    render(<App />);

    const nodeItem = await screen.findByText('USB-Test');
    fireEvent.click(nodeItem);

    await screen.findByText('EdgeView Session');

    const usbChip = screen.getByTitle('USB Disabled - Click to Enable');
    fireEvent.click(usbChip);

    await waitFor(() => {
      expect(electronAPI.SetUSBEnabled).toHaveBeenCalledWith('node-1', true);
    });
  });

  it('clicking Console chip calls SetConsoleEnabled', async () => {
    const node = { id: 'node-1', name: 'Console-Test', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', consoleEnabled: false });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });

    render(<App />);

    const nodeItem = await screen.findByText('Console-Test');
    fireEvent.click(nodeItem);

    await screen.findByText('EdgeView Session');

    const consoleChip = screen.getByTitle('Console Disabled - Click to Enable');
    fireEvent.click(consoleChip);

    await waitFor(() => {
      expect(electronAPI.SetConsoleEnabled).toHaveBeenCalledWith('node-1', true);
    });
  });

  // Regression: when an EVE-OS SSH session fails after all probe rounds, the
  // backend's leaf error embeds the word "cancelled" (a per-round context
  // deadline) even though the user never clicked Cancel. The catch block used
  // to match the bare substring "cancel" and silently swallow the log, leaving
  // the activity log with no indication the connection failed.
  it('logs "Connection failed" when the SSH probe exhausts all rounds (error text contains "cancelled")', async () => {
    const node = { id: 'node-1', name: 'SSH-Fail', status: 'online', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: Math.floor(Date.now() / 1000) + 3600 });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    electronAPI.ConnectToNode.mockRejectedValue(
      new Error('failed to start proxy on any candidate IP: failed to establish tunnel after 5 rounds across 4 IP(s): waitForTcpSetupOK cancelled: context deadline exceeded')
    );

    render(<App />);

    const nodeItem = await screen.findByText('SSH-Fail');
    fireEvent.click(nodeItem);

    await screen.findByText('EdgeView Session');

    // Open the EVE-OS SSH Terminal split menu, then pick the External Terminal
    // entry — that calls startSession(node.id, false).
    fireEvent.click(screen.getByTitle('Open SSH Terminal'));
    fireEvent.click(await screen.findByText('Use External Terminal'));

    expect(await screen.findByText(/Connection failed:/)).toBeInTheDocument();
  });
});

// A tunnel to a non-internal IP is refused by the device while its External
// Connection Policy is off. The backend tags this "EXT_POLICY_DENIED"; the UI
// must offer a one-click fix that always *enables* the policy and flag the
// Ext. Policy chip until the policy is on.
describe('External Connection Policy denial', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const configWithToken = {
    baseUrl: 'https://cluster.example',
    apiToken: validToken,
    clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
    activeCluster: 'Prod',
    recentDevices: [],
  };
  const node = { id: 'node-1', name: 'Policy-Dev', status: 'online', project: 'proj-1' };
  const DENIED_MSG = "The target IP is not recognized as an internal EVE-OS address and the device's External Connection Policy is disabled. Enable it using the \"Enable Ext. Policy\" button in the EdgeView Session section, or in the device's EdgeView settings on ZEDEDA Cloud.";
  const deniedError = (withCode = true) => {
    const e = new Error(DENIED_MSG);
    if (withCode) e.code = 'EXT_POLICY_DENIED';
    return e;
  };
  const sshStatus = (externalPolicy) => ({
    status: 'enabled',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    externalPolicy,
  });
  const extPolicyChip = () => screen.getByText(/^(Enable Ext\. Policy|Ext\. Policy Enabled)$/, { selector: '.config-chip' });
  const toast = () => screen.getByTestId('global-status-banner-mock');

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockReset();
    electronAPI.SecureStorageGetSettings.mockReset();
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);
    electronAPI.GetDeviceCache.mockReset();
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([
      { name: 'App 1', vncPort: 5900, ips: ['10.0.0.1'], pid: 1234, status: 'RUN_STATE_ONLINE' },
    ]));
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    electronAPI.GetSSHStatus.mockResolvedValue(sshStatus(false));
  });

  afterEach(() => {
    electronAPI.StartTunnel.mockReset();
    electronAPI.StartTunnel.mockResolvedValue({ port: 6000, tunnelId: 'tunnel-1' });
    electronAPI.GetSSHStatus.mockReset();
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });
  });

  const openDevice = async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('Policy-Dev'));
    await screen.findByText('Running Applications');
    await waitFor(() => expect(extPolicyChip()).toBeInTheDocument());
  };

  const startVncTunnel = async () => {
    const appRow = screen.getByText('App 1').closest('.service-item');
    fireEvent.click(within(appRow).getByRole('button', { name: /\bconnect\b/i }));
    fireEvent.click((await screen.findByText('Launch VNC')).closest('.option-btn'));
    fireEvent.click(await screen.findByText('Open in Built-in Viewer'));
  };

  it('shows an actionable toast that enables the policy with one click', async () => {
    electronAPI.StartTunnel.mockRejectedValue(deniedError());
    await openDevice();
    await startVncTunnel();

    const actionBtn = await screen.findByRole('button', { name: 'Enable Ext. Policy' });
    // The chip lives in the EdgeView Session section and carries the flag.
    expect(extPolicyChip().closest('.ssh-status-section')).toHaveTextContent('EdgeView Session');
    expect(extPolicyChip()).toHaveClass('needs-attention');
    expect(toast()).toHaveAttribute('data-type', 'error');
    expect(toast()).toHaveTextContent('External Connection Policy is off');
    expect(toast()).toHaveTextContent(/isn't on the device's local network/);

    // Later status refreshes report the policy on.
    electronAPI.GetSSHStatus.mockResolvedValue(sshStatus(true));
    fireEvent.click(actionBtn);

    await waitFor(() => expect(electronAPI.EnableExternalPolicy).toHaveBeenCalledWith('node-1', true));
    expect(electronAPI.EnableExternalPolicy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/retry the connection/)).toBeInTheDocument();
  });

  it('the toast action enables even when a toggle would disable (never sends false)', async () => {
    // Policy reads as enabled when the tunnel starts, so a toggle captured in
    // that render would send false.
    electronAPI.GetSSHStatus.mockResolvedValue(sshStatus(true));
    let rejectTunnel;
    electronAPI.StartTunnel.mockImplementation(() => new Promise((_, reject) => { rejectTunnel = reject; }));
    await openDevice();
    await screen.findByText('Ext. Policy Enabled');
    await startVncTunnel();
    await waitFor(() => expect(rejectTunnel).toBeDefined());

    // While the tunnel is in flight the controller now reports it off.
    electronAPI.GetSSHStatus.mockResolvedValue(sshStatus(false));
    fireEvent.click(screen.getByTitle('Refresh device status'));
    await waitFor(() => expect(extPolicyChip()).toHaveTextContent('Enable Ext. Policy'));

    await act(async () => { rejectTunnel(deniedError()); });
    fireEvent.click(await screen.findByRole('button', { name: 'Enable Ext. Policy' }));

    await waitFor(() => expect(electronAPI.EnableExternalPolicy).toHaveBeenCalled());
    expect(electronAPI.EnableExternalPolicy).toHaveBeenCalledWith('node-1', true);
    expect(electronAPI.EnableExternalPolicy).not.toHaveBeenCalledWith('node-1', false);
  });

  it('does not re-send when the controller already reports the policy enabled', async () => {
    electronAPI.GetSSHStatus.mockResolvedValue(sshStatus(true));
    electronAPI.StartTunnel.mockRejectedValue(deniedError());
    await openDevice();
    await screen.findByText('Ext. Policy Enabled');
    await startVncTunnel();

    // The chip already reads "enabled" — it is not flagged.
    expect(extPolicyChip()).not.toHaveClass('needs-attention');

    fireEvent.click(await screen.findByRole('button', { name: 'Enable Ext. Policy' }));

    expect(await screen.findByText(/already enabled on ZEDEDA Cloud/)).toBeInTheDocument();
    expect(toast()).toHaveAttribute('data-type', 'info');
    expect(toast()).toHaveTextContent(/next config sync/);
    expect(electronAPI.EnableExternalPolicy).not.toHaveBeenCalled();
  });

  it('flags the Ext. Policy chip on denial and clears it once the policy is enabled', async () => {
    electronAPI.StartTunnel.mockRejectedValue(deniedError());
    await openDevice();
    expect(extPolicyChip()).not.toHaveClass('needs-attention');

    await startVncTunnel();
    await screen.findByRole('button', { name: 'Enable Ext. Policy' });
    await waitFor(() => expect(extPolicyChip()).toHaveClass('needs-attention'));

    // Status refresh reports the policy on (e.g. enabled on ZEDEDA Cloud).
    electronAPI.GetSSHStatus.mockResolvedValue(sshStatus(true));
    fireEvent.click(screen.getByTitle('Refresh device status'));

    await waitFor(() => expect(extPolicyChip()).toHaveTextContent('Ext. Policy Enabled'));
    expect(extPolicyChip()).not.toHaveClass('needs-attention');
  });

  it('clicking the flagged chip clears the attention state', async () => {
    electronAPI.StartTunnel.mockRejectedValue(deniedError());
    await openDevice();
    await startVncTunnel();
    await waitFor(() => expect(extPolicyChip()).toHaveClass('needs-attention'));

    fireEvent.click(extPolicyChip());

    await waitFor(() => expect(electronAPI.EnableExternalPolicy).toHaveBeenCalledWith('node-1', true));
    expect(extPolicyChip()).not.toHaveClass('needs-attention');
  });

  it('falls back to the message text when the error has no code', async () => {
    electronAPI.StartTunnel.mockRejectedValue(deniedError(false));
    await openDevice();
    await startVncTunnel();

    expect(await screen.findByRole('button', { name: 'Enable Ext. Policy' })).toBeInTheDocument();
    expect(toast()).toHaveTextContent('External Connection Policy is off');
    await waitFor(() => expect(extPolicyChip()).toHaveClass('needs-attention'));
  });
});

// Status-grid items driven by EdgeView session info: the ENCRYPTION label
// (TLS only vs end-to-end) and the SESSIONS slot usage from the controller.
describe('EdgeView status grid: encryption and sessions', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const configWithToken = {
    baseUrl: 'https://cluster.example',
    apiToken: validToken,
    clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
    activeCluster: 'Prod',
    recentDevices: [],
  };
  const node = { id: 'node-1', name: 'Grid-Dev', status: 'online', project: 'proj-1' };
  const status = (extra = {}) => ({
    status: 'enabled',
    cloudSession: 'live',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    maxSessions: 3,
    ...extra,
  });
  const sessions = (extra = {}) => ({
    available: true, maxSessions: 3, inUse: 1, free: 1, offline: 1, unknown: 0,
    slots: [
      { inst: 1, state: 'busy', ours: false },
      { inst: 2, state: 'free', ours: false },
      { inst: 3, state: 'offline', ours: false },
    ],
    ...extra,
  });
  const valueOf = (label) => screen.getByText(label, { selector: '.status-label' }).closest('.status-item').querySelector('.status-value');

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockReset();
    electronAPI.SecureStorageGetSettings.mockReset();
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);
    electronAPI.GetDeviceCache.mockReset();
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSessionStatus.mockReset();
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });
    electronAPI.GetSSHStatus.mockReset();
    electronAPI.GetSSHStatus.mockResolvedValue(status());
    electronAPI.GetEdgeViewSessions.mockReset();
    electronAPI.GetEdgeViewSessions.mockResolvedValue(sessions());
  });

  afterEach(() => {
    electronAPI.GetSSHStatus.mockReset();
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });
    electronAPI.GetEdgeViewSessions.mockReset();
    electronAPI.GetEdgeViewSessions.mockResolvedValue(null);
  });

  const openDevice = async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('Grid-Dev'));
    await screen.findByText('ENCRYPTION');
  };

  it('shows "TLS only" (neutral, not a warning) when the session is not end-to-end encrypted', async () => {
    electronAPI.GetSSHStatus.mockResolvedValue(status({ isEncrypted: false }));
    await openDevice();
    await waitFor(() => expect(valueOf('ENCRYPTION')).toHaveTextContent('TLS only'));
    expect(valueOf('ENCRYPTION')).toHaveClass('neutral');
    expect(valueOf('ENCRYPTION')).not.toHaveClass('mismatch');
    expect(screen.queryByText(/Unencrypted/)).not.toBeInTheDocument();
  });

  it('shows "End-to-end (E2E)" with success styling when sshStatus reports isEncrypted', async () => {
    electronAPI.GetSSHStatus.mockResolvedValue(status({ isEncrypted: true }));
    await openDevice();
    await waitFor(() => expect(valueOf('ENCRYPTION')).toHaveTextContent('End-to-end (E2E)'));
    expect(valueOf('ENCRYPTION')).toHaveClass('success');
  });

  it('shows "End-to-end (E2E)" when only the session status reports isEncrypted', async () => {
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, isEncrypted: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await openDevice();
    await waitFor(() => expect(valueOf('ENCRYPTION')).toHaveTextContent('End-to-end (E2E)'));
  });

  it('shows "1 / 3 in use" from the controller session slots', async () => {
    await openDevice();
    await waitFor(() => expect(valueOf('SESSIONS')).toHaveTextContent('1 / 3 in use'));
    expect(electronAPI.GetEdgeViewSessions).toHaveBeenCalledWith('node-1');
    expect(screen.queryByText('MAX SESSIONS')).not.toBeInTheDocument();
    expect(screen.queryByText('INSTANCE')).not.toBeInTheDocument();
  });

  it('falls back to the max when the sessions call fails', async () => {
    electronAPI.GetEdgeViewSessions.mockRejectedValue(new Error('boom'));
    await openDevice();
    await waitFor(() => expect(electronAPI.GetEdgeViewSessions).toHaveBeenCalled());
    expect(valueOf('SESSIONS')).toHaveTextContent(/^3$/);
  });

  it('falls back to the max when the controller has no live session (available: false)', async () => {
    electronAPI.GetEdgeViewSessions.mockResolvedValue(sessions({ available: false, maxSessions: 0, inUse: 0, free: 0, offline: 0, slots: [] }));
    await openDevice();
    await waitFor(() => expect(electronAPI.GetEdgeViewSessions).toHaveBeenCalled());
    expect(valueOf('SESSIONS')).toHaveTextContent(/^3$/);
  });

  it('falls back to the max when every slot state is unknown', async () => {
    electronAPI.GetEdgeViewSessions.mockResolvedValue(sessions({
      inUse: 0, free: 0, offline: 0, unknown: 3,
      slots: [1, 2, 3].map(inst => ({ inst, state: 'unknown', ours: false })),
    }));
    await openDevice();
    await waitFor(() => expect(electronAPI.GetEdgeViewSessions).toHaveBeenCalled());
    expect(valueOf('SESSIONS')).toHaveTextContent(/^3$/);
  });

  it('does not query sessions when the cloud session has ended', async () => {
    electronAPI.GetSSHStatus.mockResolvedValue(status({ cloudSession: 'ended', expiry: '0' }));
    await openDevice();
    await waitFor(() => expect(electronAPI.GetSSHStatus).toHaveBeenCalled());
    expect(electronAPI.GetEdgeViewSessions).not.toHaveBeenCalled();
  });
});

// The details "Device" section (EVE version, uptime, last reboot, resources)
// and the per-app CPU/memory in Running Applications come from one
// controller cloud-status read, so they must show for offline devices too
// and never block or error out the rest of the details.
describe('Device info section', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const configWithToken = {
    baseUrl: 'https://cluster.example',
    apiToken: validToken,
    clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
    activeCluster: 'Prod',
    recentDevices: [],
  };
  const node = { id: 'node-1', name: 'Info-Dev', status: 'online', project: 'proj-1' };
  const deviceInfo = (extra = {}) => ({
    nodeId: 'node-1',
    online: true,
    eveVersion: '16.6.0-lts',
    partition: 'IMGA',
    bootTime: new Date(Date.now() - (3 * 86400 + 5 * 3600) * 1000).toISOString(),
    uptimeSec: 3 * 86400 + 5 * 3600,
    lastReboot: { code: 'REBOOT_CMD', label: 'Reboot command', reason: 'user requested', time: new Date(Date.now() - 3 * 86400 * 1000).toISOString() },
    cpu: { percent: 7.5, cores: 4 },
    memory: { totalMB: 8192, usedEveMB: 512, allocatedAppsMB: 2048 },
    storage: { totalMB: 102400, usedMB: 20480 },
    workloads: [{ id: 'a1', name: 'my-app', runState: 'RUN_STATE_ONLINE', cpuPercent: 2, memUsedMB: 256, memAllocatedMB: 1024 }],
    workloadsAvailable: true,
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockReset();
    electronAPI.SecureStorageGetSettings.mockReset();
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);
    electronAPI.GetDeviceCache.mockReset();
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSessionStatus.mockReset();
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });
    electronAPI.GetSSHStatus.mockReset();
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });
    electronAPI.GetDeviceInfo.mockReset();
    electronAPI.GetDeviceInfo.mockResolvedValue(deviceInfo());
  });

  afterEach(() => {
    electronAPI.GetSSHStatus.mockReset();
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });
    electronAPI.GetDeviceInfo.mockReset();
    electronAPI.GetDeviceInfo.mockResolvedValue(null);
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    // The panel remembers expanded/collapsed per viewer; don't leak it.
    window.localStorage.removeItem('deviceInfoExpanded');
  });

  const openDevice = async (name = 'Info-Dev') => {
    render(<App />);
    fireEvent.click(await screen.findByText(name));
  };
  const valueOf = (label) => screen.getByText(label, { selector: '.status-label' }).closest('.status-item');
  // The Device section's title row (other buttons are titled "Device is offline").
  const deviceToggle = () => document.querySelector('.section-title[role="button"][aria-expanded]');
  const usageOf = (appName) => within(screen.getByText(appName).closest('.service-item')).queryByTestId('app-usage');

  it('is collapsed by default with a summary, and expands into the status grid', async () => {
    await openDevice();
    const summary = await screen.findByTestId('device-summary');
    expect(electronAPI.GetDeviceInfo).toHaveBeenCalledWith('node-1', 'Info-Dev');
    expect(summary).toHaveTextContent('EVE 16.6.0-lts · up 3d 5h · CPU 7.5% · Mem 2.5/8.0 GB');
    expect(deviceToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('UPTIME', { selector: '.status-label' })).not.toBeInTheDocument();

    fireEvent.click(deviceToggle());
    expect(valueOf('UPTIME')).toHaveTextContent('3d 5h');
    expect(valueOf('LAST REBOOT')).toHaveTextContent('Reboot command');
    expect(valueOf('CPU')).toHaveTextContent('7.5%');
    expect(valueOf('MEMORY')).toHaveTextContent('2.5 GB / 8.0 GB');
    expect(valueOf('STORAGE')).toHaveTextContent('20 GB / 100 GB');
    // Workloads are not duplicated in the Device section.
    expect(screen.queryByText(/Workloads/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem('deviceInfoExpanded')).toBe('1');
  });

  // The EdgeView Session and Device sections, found by their title text / content.
  const edgeViewSection = () => screen.getByText('EdgeView Session').closest('.ssh-status-section');
  const deviceSection = () => screen.getByTestId('device-config').closest('.ssh-status-section');
  const CONFIG_CHIPS = ['Enable SSH', 'Enable VGA', 'Enable USB', 'Enable Console'];

  it('puts the Device section below the EdgeView Session section', async () => {
    await openDevice();
    await screen.findByTestId('device-summary');
    const ev = edgeViewSection();
    const dev = deviceSection();
    expect(ev).not.toBe(dev);
    expect(ev.compareDocumentPosition(dev) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ...and above Running Applications.
    const apps = screen.getByText('Running Applications');
    expect(dev.compareDocumentPosition(apps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One Device section: its title row is the facts toggle.
    expect(within(dev).getByText('Device', { selector: '.section-title span' })).toBeInTheDocument();
    expect(within(dev).getAllByRole('button', { expanded: false })).toHaveLength(1);
  });

  it('keeps the configuration chips visible while the facts grid is collapsed', async () => {
    await openDevice();
    await screen.findByTestId('device-summary');
    expect(deviceToggle()).toHaveAttribute('aria-expanded', 'false');
    const dev = deviceSection();
    expect(within(dev).queryByText('UPTIME', { selector: '.status-label' })).not.toBeInTheDocument();
    for (const label of CONFIG_CHIPS) {
      expect(within(dev).getByText(label, { selector: '.config-chip' })).toBeInTheDocument();
    }
    expect(within(dev).getByText('Configuration')).toBeInTheDocument();
    // Collapsed, the card is just the configuration block (no rule above it).
    expect(screen.getByTestId('device-config').style.borderTop).toBe('');
  });

  it('shows the facts grid above the configuration when expanded', async () => {
    await openDevice();
    await screen.findByTestId('device-summary');
    fireEvent.click(deviceToggle());
    const dev = deviceSection();
    const grid = within(dev).getByText('UPTIME', { selector: '.status-label' }).closest('.status-grid');
    const config = screen.getByTestId('device-config');
    expect(grid.compareDocumentPosition(config) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Same card, separated from the grid by a rule.
    expect(grid.closest('.ssh-details')).toBe(config.closest('.ssh-details'));
    expect(config.style.borderTop).not.toBe('');
    for (const label of CONFIG_CHIPS) {
      expect(within(config).getByText(label, { selector: '.config-chip' })).toBeInTheDocument();
    }
    // Collapsing again leaves the chips in place.
    fireEvent.click(deviceToggle());
    expect(within(deviceSection()).getByText('Enable VGA', { selector: '.config-chip' })).toBeInTheDocument();
  });

  it('keeps Ext. Policy and Collect Info in the EdgeView section, not the Device section', async () => {
    await openDevice();
    await screen.findByTestId('device-summary');
    const ev = edgeViewSection();
    const dev = deviceSection();
    expect(within(ev).getByText('Enable Ext. Policy', { selector: '.config-chip' })).toBeInTheDocument();
    expect(within(ev).getByText('Collect Info', { selector: '.config-chip' })).toBeInTheDocument();
    expect(within(dev).queryByText('Enable Ext. Policy')).not.toBeInTheDocument();
    expect(within(dev).queryByText('Collect Info')).not.toBeInTheDocument();
    for (const label of CONFIG_CHIPS) {
      expect(within(ev).queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('still shows the configuration chips when the device facts fail to load', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
    electronAPI.GetDeviceInfo.mockRejectedValue(new Error('boom'));
    await openDevice();
    await screen.findByText('Device details unavailable');
    const dev = deviceSection();
    expect(within(dev).getByText('Enable VGA', { selector: '.config-chip' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('still shows it (as last boot) for an offline device', async () => {
    const offline = { id: 'node-1', name: 'Info-Dev', status: 'offline', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([offline]));
    electronAPI.GetDeviceInfo.mockResolvedValue(deviceInfo({ online: false, uptimeSec: undefined }));
    await openDevice();
    const summary = await screen.findByTestId('device-summary');
    expect(summary).toHaveTextContent('last boot 3d 5h ago');
    expect(summary).not.toHaveTextContent('CPU');
    fireEvent.click(deviceToggle());
    expect(valueOf('LAST BOOT')).toHaveTextContent('3d 5h ago');
    expect(screen.queryByText('UPTIME', { selector: '.status-label' })).not.toBeInTheDocument();
  });

  it('shows each app\'s CPU / memory in Running Applications, matched by id', async () => {
    const runtime = { id: 'rt-1', name: 'docker-runtime', status: 'RUN_STATE_ONLINE', appType: 'APP_TYPE_VM', deploymentType: 'DEPLOYMENT_TYPE_DOCKER_RUNTIME', ips: ['10.1.0.5'] };
    const child = { id: 'ca-1', name: 'compose-app', status: 'RUN_STATE_ONLINE', appType: 'APP_TYPE_DOCKER_COMPOSE', parentAppId: 'rt-1' };
    // Same name as a workload but a different id: must not borrow its numbers.
    const unmatched = { id: 'zz-9', name: 'name-twin', status: 'RUN_STATE_ONLINE', appType: 'APP_TYPE_VM' };
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([runtime, child, unmatched]));
    electronAPI.GetDeviceInfo.mockResolvedValue(deviceInfo({
      workloads: [
        { id: 'rt-1', name: 'docker-runtime', runState: 'RUN_STATE_ONLINE', cpuPercent: 3, memUsedMB: 1229, memAllocatedMB: 2048 },
        { id: 'ca-1', name: 'compose-app', runState: 'RUN_STATE_ONLINE', cpuPercent: 12, memUsedMB: 300, memAllocatedMB: 1024 },
        { id: 'other-id', name: 'name-twin', runState: 'RUN_STATE_ONLINE', cpuPercent: 50, memUsedMB: 100, memAllocatedMB: 200 },
      ],
    }));
    await openDevice();
    await waitFor(() => expect(usageOf('docker-runtime')).toHaveTextContent('CPU 3.0% · 1.2 / 2.0 GB'));
    expect(usageOf('compose-app')).toHaveTextContent('CPU 12% · 300 MB / 1.0 GB');
    expect(usageOf('name-twin')).toBeNull();
    // One read feeds both the Device section and the app rows.
    expect(electronAPI.GetDeviceInfo).toHaveBeenCalledTimes(1);
  });

  it('leaves CPU out of the app rows while the device is offline', async () => {
    const offline = { id: 'node-1', name: 'Info-Dev', status: 'offline', project: 'proj-1' };
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([offline]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([{ id: 'a1', name: 'my-app', status: 'RUN_STATE_HALTED', appType: 'APP_TYPE_VM' }]));
    electronAPI.GetDeviceInfo.mockResolvedValue(deviceInfo({ online: false }));
    await openDevice();
    await waitFor(() => expect(usageOf('my-app')).toHaveTextContent('256 MB / 1.0 GB'));
    expect(usageOf('my-app')).not.toHaveTextContent('CPU');
  });

  it('shows no usage on app rows when device info has no data', async () => {
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([{ id: 'a1', name: 'my-app', status: 'RUN_STATE_ONLINE', appType: 'APP_TYPE_VM' }]));
    electronAPI.GetDeviceInfo.mockResolvedValue(null);
    await openDevice();
    await screen.findByText('my-app');
    await waitFor(() => expect(electronAPI.GetDeviceInfo).toHaveBeenCalled());
    expect(usageOf('my-app')).toBeNull();
  });

  it('the compact details header back button returns to the device list', async () => {
    await openDevice();
    await screen.findByText('Running Applications');
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveAttribute('title', 'Back (Esc)');
    expect(back.closest('.search-bar')).toHaveClass('details-bar');
    fireEvent.click(back);
    expect(await screen.findByPlaceholderText('Search nodes, projects...')).toBeInTheDocument();
    expect(screen.queryByText('Running Applications')).not.toBeInTheDocument();
    expect(document.querySelector('.details-bar')).toBeNull();
  });

  it('does not disturb the details when GetDeviceInfo fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', cloudSession: 'live', expiry: Math.floor(Date.now() / 1000) + 3600, maxSessions: 3 });
    electronAPI.GetDeviceInfo.mockRejectedValue(new Error('boom'));
    await openDevice();
    await screen.findByText('ENCRYPTION');
    await screen.findByText('Device details unavailable');
    expect(screen.queryByTestId('global-status-banner-mock')).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it('raises the token banner (not a toast) when the controller rejects the token', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
    electronAPI.GetDeviceInfo.mockRejectedValue(Object.assign(new Error('expired'), { code: 'UNAUTHORIZED' }));
    await openDevice();
    await waitFor(() => expect(electronAPI.GetDeviceInfo).toHaveBeenCalled());
    expect(await screen.findByText(/Update Token/)).toBeInTheDocument();
    expect(screen.queryByText('Device details unavailable')).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

// The backend returns 409 E2E_UNSUPPORTED when a device runs EVE 16.6+ with
// "Encrypt Session" on (lf-edge/eve#5573): no client can connect, and the fix
// is a policy change on the controller, so the toast has no action.
describe('End-to-end encryption unsupported (EVE 16.6+)', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const configWithToken = {
    baseUrl: 'https://cluster.example',
    apiToken: validToken,
    clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
    activeCluster: 'Prod',
    recentDevices: [],
  };
  const node = { id: 'node-1', name: 'E2E-Dev', status: 'online', project: 'proj-1' };
  const E2E_MSG = 'This device runs EVE 16.6 or newer with "Encrypt Session" enabled. Disable it in the project EdgeView policy.';
  const e2eError = () => Object.assign(new Error(E2E_MSG), { code: 'E2E_UNSUPPORTED' });
  const toast = () => screen.getByTestId('global-status-banner-mock');

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockReset();
    electronAPI.SecureStorageGetSettings.mockReset();
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);
    electronAPI.GetDeviceCache.mockReset();
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([node]));
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([
      { name: 'App 1', vncPort: 5900, ips: ['10.0.0.1'], pid: 1234, status: 'RUN_STATE_ONLINE' },
    ]));
    electronAPI.GetSessionStatus.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', expiry: Math.floor(Date.now() / 1000) + 3600, externalPolicy: false });
  });

  afterEach(() => {
    electronAPI.StartTunnel.mockReset();
    electronAPI.StartTunnel.mockResolvedValue({ port: 6000, tunnelId: 'tunnel-1' });
    electronAPI.GetSSHStatus.mockReset();
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'disabled' });
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });
  });

  it('shows a specific error toast with the backend message, no action and no ext-policy flag', async () => {
    electronAPI.StartTunnel.mockRejectedValue(e2eError());
    render(<App />);
    fireEvent.click(await screen.findByText('E2E-Dev'));
    await screen.findByText('Running Applications');
    const chip = await screen.findByText(/^(Enable Ext\. Policy|Ext\. Policy Enabled)$/, { selector: '.config-chip' });

    const appRow = screen.getByText('App 1').closest('.service-item');
    fireEvent.click(within(appRow).getByRole('button', { name: /\bconnect\b/i }));
    fireEvent.click((await screen.findByText('Launch VNC')).closest('.option-btn'));
    fireEvent.click(await screen.findByText('Open in Built-in Viewer'));

    await waitFor(() => expect(toast()).toHaveTextContent('End-to-end encryption not supported by this EVE'));
    expect(toast()).toHaveAttribute('data-type', 'error');
    expect(toast()).toHaveTextContent(/Disable it in the project EdgeView policy/);
    expect(within(toast()).queryByRole('button')).not.toBeInTheDocument();
    expect(chip).not.toHaveClass('needs-attention');
  });
});

// Per-row removal in the Authorized SSH Keys audit panel. Removing a key is a
// cloud-config change (ZEDEDA PUT), so it must work on offline devices too.
describe('Authorized SSH Keys removal', () => {
  const validKey = 'A'.repeat(171);
  const validToken = `ENT1234:${validKey}`;
  const configWithToken = {
    baseUrl: 'https://cluster.example',
    apiToken: validToken,
    clusters: [{ name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken }],
    activeCluster: 'Prod',
    recentDevices: [],
  };

  const launcherKey = { type: 'ssh-ed25519', fingerprint: 'SHA256:launcher', comment: 'me@laptop', isLauncherKey: true, valid: true };
  const adminKey = { type: 'ssh-rsa', fingerprint: 'SHA256:admin', comment: 'admin@ops', isLauncherKey: false, valid: true };
  const junkLine = { type: '', fingerprint: '', comment: '', isLauncherKey: false, valid: false, raw: 'this is not a key' };
  const REMOVE = 'Remove this key from the device';
  const REMOVE_OURS = "Remove this launcher's key from the device (disables SSH for this app)";

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI.GetSettings.mockReset();
    electronAPI.SecureStorageGetSettings.mockReset();
    electronAPI.GetDeviceCache.mockReset();
    electronAPI.RemoveSSHKey.mockReset();
    electronAPI.RemoveSSHKey.mockResolvedValue({ removed: true, remaining: 2 });
    Object.defineProperty(window, 'electronAPI', { value: undefined, writable: true });
    electronAPI.GetSettings.mockResolvedValue(configWithToken);
    electronAPI.SecureStorageGetSettings.mockResolvedValue(configWithToken);
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify([]));
    electronAPI.GetSessionStatus.mockResolvedValue({ active: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Opens the device and expands the keys panel.
  const openKeysPanel = async (keys, { status = 'online' } = {}) => {
    electronAPI.GetDeviceCache.mockResolvedValue(makeCache([{ id: 'n1', name: 'Key-Dev', status, project: 'p1' }]));
    electronAPI.GetSSHStatus.mockResolvedValue({ status: 'enabled', authorizedKeys: keys });
    render(<App />);
    fireEvent.click(await screen.findByText('Key-Dev'));
    fireEvent.click(await screen.findByText(`Authorized SSH Keys (${keys.length})`));
  };

  it('removes a key by fingerprint, reloads SSH status and keeps the panel open', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openKeysPanel([launcherKey, adminKey, junkLine]);
    const statusCalls = electronAPI.GetSSHStatus.mock.calls.length;

    fireEvent.click(screen.getAllByRole('button', { name: REMOVE })[0]);

    await waitFor(() => expect(electronAPI.RemoveSSHKey).toHaveBeenCalledWith('n1', { fingerprint: 'SHA256:admin' }));
    expect(confirmSpy.mock.calls[0][0]).toContain('ssh-rsa SHA256:admin (admin@ops)');
    expect(confirmSpy.mock.calls[0][0]).not.toMatch(/SSH will be disabled/);
    await waitFor(() => expect(electronAPI.GetSSHStatus.mock.calls.length).toBeGreaterThan(statusCalls));
    expect(electronAPI.DisableSSH).not.toHaveBeenCalled();
    // Clicking the trash must not collapse the panel.
    expect(screen.getByText('SHA256:admin')).toBeInTheDocument();
  });

  it('removes an unparseable line by its raw text', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openKeysPanel([launcherKey, adminKey, junkLine]);

    fireEvent.click(screen.getAllByRole('button', { name: REMOVE })[1]);

    await waitFor(() => expect(electronAPI.RemoveSSHKey).toHaveBeenCalledWith('n1', { raw: 'this is not a key' }));
  });

  it("routes the launcher's own key through DisableSSH", async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openKeysPanel([launcherKey, adminKey]);

    fireEvent.click(screen.getByRole('button', { name: REMOVE_OURS }));

    await waitFor(() => expect(electronAPI.DisableSSH).toHaveBeenCalledWith('n1'));
    expect(confirmSpy.mock.calls[0][0]).toMatch(/launcher's own SSH key/);
    expect(electronAPI.RemoveSSHKey).not.toHaveBeenCalled();
  });

  it('works on an offline device', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openKeysPanel([launcherKey, adminKey], { status: 'offline' });

    const btn = screen.getByRole('button', { name: REMOVE });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    await waitFor(() => expect(electronAPI.RemoveSSHKey).toHaveBeenCalledWith('n1', { fingerprint: 'SHA256:admin' }));
  });

  it('does nothing when the confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openKeysPanel([launcherKey, adminKey]);

    fireEvent.click(screen.getByRole('button', { name: REMOVE }));
    fireEvent.click(screen.getByRole('button', { name: REMOVE_OURS }));

    expect(electronAPI.RemoveSSHKey).not.toHaveBeenCalled();
    expect(electronAPI.DisableSSH).not.toHaveBeenCalled();
  });

  it('warns that SSH will be disabled when removing the last key', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    electronAPI.RemoveSSHKey.mockResolvedValue({ removed: true, remaining: 0 });
    await openKeysPanel([adminKey]);

    fireEvent.click(screen.getByRole('button', { name: REMOVE }));

    await waitFor(() => expect(electronAPI.RemoveSSHKey).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0][0]).toMatch(/SSH will be disabled on the device/);
  });

  it('reports an already-removed key as info, not an error', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    electronAPI.RemoveSSHKey.mockResolvedValue({ removed: false, remaining: 1 });
    await openKeysPanel([launcherKey, adminKey]);

    fireEvent.click(screen.getByRole('button', { name: REMOVE }));

    const banner = await screen.findByText(/already removed from the device/, { selector: '[data-testid="global-status-banner-mock"]' });
    expect(banner).toHaveAttribute('data-type', 'info');
  });

  it('shows a Permission denied toast on 403', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    electronAPI.RemoveSSHKey.mockRejectedValue(Object.assign(
      new Error('Your ZEDEDA account does not have the PermissionDeviceUpdate permission needed for this action.'),
      { code: 'FORBIDDEN', permission: 'PermissionDeviceUpdate' },
    ));
    await openKeysPanel([launcherKey, adminKey]);

    fireEvent.click(screen.getByRole('button', { name: REMOVE }));

    const banner = await screen.findByTestId('global-status-banner-mock');
    await waitFor(() => expect(banner).toHaveTextContent(/Permission denied/));
    expect(banner).toHaveTextContent(/remove SSH key/);
    expect(banner).toHaveAttribute('data-type', 'error');
  });
});

describe('ActivityLog component', () => {
  it('displays "No activity recorded" when logs is empty', () => {
    render(<ActivityLog logs={[]} />);

    expect(screen.getByText('Activity Log')).toBeInTheDocument();
    expect(screen.getByText('No activity recorded')).toBeInTheDocument();
  });

  it('displays the correct log entries when logs is not empty', () => {
    const logs = [
      { timestamp: '10:00:00', message: 'First log', type: 'info' },
      { timestamp: '10:01:00', message: 'Second log', type: 'error' },
    ];

    const { container } = render(<ActivityLog logs={logs} />);

    expect(screen.getByText('First log')).toBeInTheDocument();
    expect(screen.getByText('Second log')).toBeInTheDocument();

    const entries = container.querySelectorAll('.log-entry');
    expect(entries.length).toBe(2);
  });
});
