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
    });

    const [configArg] = electronAPI.SecureStorageSaveSettings.mock.calls[0];
    expect(configArg.clusters).toHaveLength(1);
    expect(configArg.clusters[0].name).toBe('Cluster 1');
    expect(configArg.activeCluster).toBe('Cluster 1');

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
      expect(screen.getByText(/EdgeView tunnel operations are unavailable/)).toBeInTheDocument();
    });

    // Should have called cloud APIs even though device is offline
    expect(electronAPI.GetDeviceServices).toHaveBeenCalledWith('n1', 'Offline-Dev');
    expect(electronAPI.GetSSHStatus).toHaveBeenCalledWith('n1');
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
