import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, beforeEach } from 'vitest';

vi.mock('./electronAPI', () => {
  const fn = () => Promise.resolve();
  return {
    SearchNodes: vi.fn().mockResolvedValue([]),
    ConnectToNode: vi.fn(fn),
    GetSettings: vi.fn(),
    SaveSettings: vi.fn().mockResolvedValue({ saved: true }),
    GetDeviceServices: vi.fn(),
    SetupSSH: vi.fn(fn),
    GetSSHStatus: vi.fn().mockResolvedValue(null),
    DisableSSH: vi.fn(fn),
    ResetEdgeView: vi.fn(fn),
    VerifyTunnel: vi.fn(fn),
    GetUserInfo: vi.fn(fn),
    GetEnterprise: vi.fn().mockResolvedValue({ name: 'Test Enterprise' }),
    GetProjects: vi.fn().mockResolvedValue([]),
    GetSessionStatus: vi.fn().mockResolvedValue({ active: false }),
    GetAppInfo: vi.fn(fn),
    StartTunnel: vi.fn().mockResolvedValue({ port: 6000, tunnelId: 'tunnel-1' }),
    CloseTunnel: vi.fn(fn),
    ListTunnels: vi.fn().mockResolvedValue([]),
    AddRecentDevice: vi.fn(fn),
  };
});

import * as electronAPI from './electronAPI';
import App from './App';

describe('App configuration and tunnels', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default settings: no token so settings panel opens
    electronAPI.GetSettings.mockResolvedValue({
      baseUrl: '',
      apiToken: '',
      clusters: [],
      activeCluster: '',
      recentDevices: [],
    });

    electronAPI.SearchNodes.mockResolvedValue([]);
  });

  it('addNewCluster adds a new cluster and sets it active', async () => {
    render(<App />);

    // Settings panel should open automatically
    await screen.findByText('Configuration');

    const addButton = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addButton);

    const newCluster = await screen.findByText('Cluster 1');
    expect(newCluster).toBeInTheDocument();

    // The new cluster should be marked active
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
  });

  it('deleteCluster removes a cluster and updates active cluster', async () => {
    // Initial settings with two clusters, first active
    electronAPI.GetSettings.mockResolvedValue({
      baseUrl: '',
      apiToken: '',
      clusters: [
        { name: 'Cluster 1', baseUrl: 'https://one', apiToken: '' },
        { name: 'Cluster 2', baseUrl: 'https://two', apiToken: '' },
      ],
      activeCluster: 'Cluster 1',
      recentDevices: [],
    });

    render(<App />);

    await screen.findByText('Configuration');

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
    expect(within(item!).getByText('Active')).toBeInTheDocument();
  });

  it('validateToken marks valid and invalid API tokens appropriately', async () => {
    render(<App />);

    await screen.findByText('Configuration');

    const tokenTextarea = screen.getByPlaceholderText(/paste token from zededa cloud/i);

    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`; // 7-char name + base64-ish key

    // Valid token
    fireEvent.change(tokenTextarea, { target: { value: validToken } });
    await screen.findByText('Valid token format');

    // Invalid token (wrong format)
    fireEvent.change(tokenTextarea, { target: { value: 'invalid-token' } });
    await screen.findByText(/invalid format/i);
  });

  it('saveSettings persists clusters and reloads user and nodes', async () => {
    // First GetSettings call - empty config so settings open
    electronAPI.GetSettings
      .mockResolvedValueOnce({
        baseUrl: '',
        apiToken: '',
        clusters: [],
        activeCluster: '',
        recentDevices: [],
      })
      // Second GetSettings after save - active cluster with token
      .mockResolvedValueOnce({
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
      });

    electronAPI.SearchNodes.mockResolvedValue([]);

    render(<App />);

    await screen.findByText('Configuration');

    // Add a new cluster so we have something to save
    const addButton = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addButton);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(electronAPI.SaveSettings).toHaveBeenCalledTimes(1);
    });

    const [clustersArg, activeClusterArg] = electronAPI.SaveSettings.mock.calls[0];
    expect(clustersArg).toHaveLength(1);
    expect(clustersArg[0].name).toBe('Cluster 1');
    expect(activeClusterArg).toBe('Cluster 1');

    // After reloading settings with a token, loadUserInfo should run
    await waitFor(() => {
      expect(electronAPI.GetEnterprise).toHaveBeenCalled();
      expect(electronAPI.GetProjects).toHaveBeenCalled();
    });

    // Node data reload via SearchNodes
    await waitFor(() => {
      expect(electronAPI.SearchNodes).toHaveBeenCalled();
    });
  });

  it('starting a VNC tunnel calls StartTunnel and adds an active tunnel', async () => {
    // Settings with token so main view shows directly
    const validKey = 'A'.repeat(171);
    const validToken = `ENT1234:${validKey}`;

    electronAPI.GetSettings.mockResolvedValue({
      baseUrl: 'https://cluster.example',
      apiToken: validToken,
      clusters: [
        { name: 'Prod', baseUrl: 'https://cluster.example', apiToken: validToken },
      ],
      activeCluster: 'Prod',
      recentDevices: [],
    });

    const node = {
      id: 'node-1',
      name: 'Node 1',
      status: 'online',
      project: 'proj-1',
      edgeView: true,
    };

    electronAPI.SearchNodes.mockResolvedValue([node]);

    // Device services with one app exposing VNC
    const servicesPayload = [
      {
        name: 'App 1',
        vncPort: 5900,
        ips: ['10.0.0.1'],
        pid: 1234,
      },
    ];
    electronAPI.GetDeviceServices.mockResolvedValue(JSON.stringify(servicesPayload));

    // Stub window.electronAPI for openExternal used when launching VNC
    const openExternal = vi.fn();
    Object.defineProperty(window, 'electronAPI', {
      value: { openExternal },
      writable: true,
    });

    render(<App />);

    // Wait for node to appear from initial search
    const nodeItem = await screen.findByText('Node 1');
    fireEvent.click(nodeItem);

    // Wait until Running Applications header appears (services loaded)
    await screen.findByText('Running Applications');

    // Expand service options
    const connectButton = screen.getByRole('button', { name: /connect/i });
    fireEvent.click(connectButton);

    const launchVncLabel = await screen.findByText('Launch VNC');
    const launchVncButton = launchVncLabel.closest('.option-btn');
    expect(launchVncButton).not.toBeNull();

    fireEvent.click(launchVncButton!);

    await waitFor(() => {
      expect(electronAPI.StartTunnel).toHaveBeenCalledWith('node-1', 'localhost', 5900);
    });

    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith('vnc://localhost:6000');
    });

    // Active tunnel should be rendered in the UI
    await screen.findByText('Active Tunnels');
    expect(screen.getByText('VNC')).toBeInTheDocument();
    expect(screen.getByText(/localhost:6000/)).toBeInTheDocument();
  });
});