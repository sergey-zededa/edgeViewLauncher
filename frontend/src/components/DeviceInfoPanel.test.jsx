import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../tauriAPI', () => ({
  GetDeviceInfo: vi.fn(),
}));

import { GetDeviceInfo } from '../tauriAPI';
import DeviceInfoPanel, { formatMB, formatPercent, formatDuration } from './DeviceInfoPanel';

const NOW = new Date('2026-10-27T12:00:00Z');

const info = (extra = {}) => ({
  nodeId: 'node-1',
  name: 'TO952963',
  runState: 'RUN_STATE_ONLINE',
  online: true,
  eveVersion: '16.6.0-lts',
  partition: 'IMGA',
  bootTime: '2026-10-25T09:30:00Z',
  uptimeSec: 2 * 86400 + 2 * 3600 + 30 * 60,
  lastReboot: {
    code: 'UPDATE', label: 'Update', reason: 'NORMAL: baseos update\nrebooting', time: '2026-10-25T09:29:00Z',
  },
  cpu: { percent: 12.5, cores: 4 },
  memory: { totalMB: 7800, usedEveMB: 640, allocatedAppsMB: 2048, allocatedEveMB: 800 },
  storage: { totalMB: 122880, usedMB: 33792 },
  workloads: [
    { id: 'a1', name: 'web-app', runState: 'RUN_STATE_ONLINE', cpuPercent: 4.25, memUsedMB: 300, memAllocatedMB: 1024 },
    { id: 'a2', name: 'db', runState: 'RUN_STATE_HALTED', memAllocatedMB: 512 },
  ],
  workloadsAvailable: true,
  ...extra,
});

const valueOf = (label) => screen.getByText(label, { selector: '.status-label' }).closest('.status-item');

const renderPanel = (props = {}) => render(
  <DeviceInfoPanel nodeId="node-1" nodeName="TO952963" isOnline timeFormatOptions={{ hour12: false }} {...props} />
);

describe('DeviceInfoPanel', () => {
  beforeEach(() => {
    GetDeviceInfo.mockReset();
    GetDeviceInfo.mockResolvedValue(info());
    vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows EVE version, uptime, reboot label, and resource numbers', async () => {
    renderPanel();
    await screen.findByText('16.6.0-lts');
    expect(GetDeviceInfo).toHaveBeenCalledWith('node-1', 'TO952963');
    expect(screen.getByText('partition IMGA')).toBeInTheDocument();

    expect(valueOf('UPTIME')).toHaveTextContent('2d 2h');
    const reboot = valueOf('LAST REBOOT');
    expect(reboot).toHaveTextContent('Update');
    expect(reboot).toHaveTextContent('2d 2h ago');
    // Free-text reason is the hover text, not on-screen clutter.
    expect(reboot.querySelector('.status-label')).toHaveAttribute('title', expect.stringContaining('NORMAL: baseos update'));

    expect(valueOf('CPU')).toHaveTextContent('13%');
    expect(valueOf('CPU')).toHaveTextContent('4 cores');
    // committed = 2048 apps + 640 EVE = 2688 MB = 2.6 GB of 7.6 GB
    expect(valueOf('MEMORY')).toHaveTextContent('2.6 GB / 7.6 GB');
    expect(valueOf('MEMORY')).toHaveTextContent('apps 2.0 GB · EVE 640 MB');
    expect(valueOf('STORAGE')).toHaveTextContent('33 GB / 120 GB');
  });

  it('lists workloads in a collapsible section', async () => {
    renderPanel();
    await screen.findByText('Workloads (2)');
    expect(screen.queryByText('web-app')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Workloads (2)'));
    const rows = screen.getAllByTestId('workload-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('web-app');
    expect(rows[0]).toHaveTextContent('Online');
    expect(rows[0]).toHaveTextContent('4.3%');
    expect(rows[0]).toHaveTextContent('300 MB / 1.0 GB');
    expect(rows[1]).toHaveTextContent('db');
    expect(rows[1]).toHaveTextContent('Halted');
    expect(rows[1]).toHaveTextContent('512 MB alloc.');
    // no CPU figure for the halted app
    expect(rows[1]).toHaveTextContent('—');

    fireEvent.click(screen.getByText('Workloads (2)'));
    expect(screen.queryByTestId('workload-row')).not.toBeInTheDocument();
  });

  it('shows "last boot" instead of uptime and flags values as last reported when offline', async () => {
    GetDeviceInfo.mockResolvedValue(info({ online: false, runState: 'RUN_STATE_OFFLINE', uptimeSec: undefined }));
    renderPanel({ isOnline: false });
    await screen.findByText('16.6.0-lts');
    expect(screen.queryByText('UPTIME', { selector: '.status-label' })).not.toBeInTheDocument();
    expect(valueOf('LAST BOOT')).toHaveTextContent('2d 2h ago');
    expect(screen.getByText(/values are last reported/)).toBeInTheDocument();
  });

  it('degrades to dashes when fields are missing', async () => {
    GetDeviceInfo.mockResolvedValue({ nodeId: 'node-1', online: true, workloads: [], workloadsAvailable: true });
    renderPanel();
    await screen.findByText('Device');
    for (const label of ['EVE', 'UPTIME', 'LAST REBOOT', 'CPU', 'STORAGE']) {
      expect(valueOf(label)).toHaveTextContent('—');
    }
    expect(valueOf('MEMORY')).toHaveTextContent('—');
    expect(screen.getByText('No app instances')).toBeInTheDocument();
  });

  it('keeps the device half when the workloads lookup failed', async () => {
    GetDeviceInfo.mockResolvedValue(info({ workloads: [], workloadsAvailable: false, workloadsError: 'boom' }));
    renderPanel();
    await screen.findByText('16.6.0-lts');
    expect(screen.getByText('Workloads unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/^Workloads \(/)).not.toBeInTheDocument();
  });

  it('mentions the other partition when it holds a different version', async () => {
    GetDeviceInfo.mockResolvedValue(info({ otherVersion: '14.5.1-lts', otherPartition: 'IMGB', otherState: 'unused' }));
    renderPanel();
    expect(await screen.findByText('other (IMGB): 14.5.1-lts')).toBeInTheDocument();
  });

  it('falls back to the free-text reason when there is no enum label', async () => {
    GetDeviceInfo.mockResolvedValue(info({ lastReboot: { reason: 'power cycled\nsecond line', time: '2026-10-27T11:00:00Z' } }));
    renderPanel();
    await screen.findByText('16.6.0-lts');
    expect(valueOf('LAST REBOOT')).toHaveTextContent('power cycled');
    expect(valueOf('LAST REBOOT')).toHaveTextContent('1h 0m ago');
  });

  it('renders nothing (no error) when the call rejects before any data', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
    GetDeviceInfo.mockRejectedValue(new Error('boom'));
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByText('Device details unavailable')).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/boom/);
    spy.mockRestore();
  });

  it('shows nothing and reports an auth error through onAuthError', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
    const err = Object.assign(new Error('expired'), { code: 'UNAUTHORIZED' });
    GetDeviceInfo.mockRejectedValue(err);
    const onAuthError = vi.fn();
    const { container } = renderPanel({ onAuthError });
    await waitFor(() => expect(onAuthError).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');
    spy.mockRestore();
  });

  it('keeps showing the last good data when a refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
    renderPanel();
    await screen.findByText('16.6.0-lts');
    GetDeviceInfo.mockRejectedValue(new Error('blip'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(GetDeviceInfo).toHaveBeenCalledTimes(2);
    expect(screen.getByText('16.6.0-lts')).toBeInTheDocument();
    expect(screen.queryByText('Device details unavailable')).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it('refreshes every 60s and stops when unmounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = renderPanel();
    await screen.findByText('16.6.0-lts');
    expect(GetDeviceInfo).toHaveBeenCalledTimes(1);

    GetDeviceInfo.mockResolvedValue(info({ eveVersion: '16.7.0-lts' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(GetDeviceInfo).toHaveBeenCalledTimes(2);
    await screen.findByText('16.7.0-lts');

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(GetDeviceInfo).toHaveBeenCalledTimes(2);
  });

  it('ignores a response that lands after switching to another device', async () => {
    let resolveFirst;
    GetDeviceInfo.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    GetDeviceInfo.mockResolvedValueOnce(info({ nodeId: 'node-2', eveVersion: '15.0.0' }));
    const { rerender } = renderPanel();
    rerender(<DeviceInfoPanel nodeId="node-2" nodeName="Other" isOnline timeFormatOptions={{ hour12: false }} />);
    await screen.findByText('15.0.0');
    await act(async () => { resolveFirst(info({ eveVersion: 'STALE-1.0' })); });
    expect(screen.queryByText('STALE-1.0')).not.toBeInTheDocument();
    expect(screen.getByText('15.0.0')).toBeInTheDocument();
  });
});

describe('formatters', () => {
  it('formats MB, percent and durations', () => {
    expect(formatMB(640)).toBe('640 MB');
    expect(formatMB(7800)).toBe('7.6 GB');
    expect(formatMB(122880)).toBe('120 GB');
    expect(formatMB(2 * 1024 * 1024)).toBe('2.0 TB');
    expect(formatMB(undefined)).toBe('—');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(12.5)).toBe('13%');
    expect(formatPercent(null)).toBe('—');
    expect(formatDuration(30)).toBe('<1m');
    expect(formatDuration(5 * 60)).toBe('5m');
    expect(formatDuration(5 * 3600 + 12 * 60)).toBe('5h 12m');
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe('3d 4h');
    expect(formatDuration(-1)).toBe('—');
  });
});
