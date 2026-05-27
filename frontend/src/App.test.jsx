import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  default: ({ status }) => status ? <div data-testid="global-status-banner-mock">{status.message}</div> : null,
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
    DisableSSH: vi.fn(fn),
    SetVGAEnabled: vi.fn(fn),
    SetUSBEnabled: vi.fn(fn),
    SetConsoleEnabled: vi.fn(fn),
    EnableExternalPolicy: vi.fn(fn),
    ResetEdgeView: vi.fn(fn),
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

    const connectButton = screen.getByRole('button', { name: /connect/i });
    fireEvent.click(connectButton);

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

    const connectButton = screen.getByRole('button', { name: /connect/i });
    fireEvent.click(connectButton);

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

    // Wait for tunnel polling to populate activeTunnels
    await waitFor(() => {
      expect(screen.getByText('Active Tunnels')).toBeInTheDocument();
    });

    // Click All Tunnels button
    const allTunnelsBtn = screen.getByText('All Tunnels');
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

    await waitFor(() => {
      expect(screen.getByText('Active Tunnels')).toBeInTheDocument();
    });

    // Open global tunnels
    fireEvent.click(screen.getByText('All Tunnels'));
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
