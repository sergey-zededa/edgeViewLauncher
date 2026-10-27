import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import DeviceInfoPanel, {
  formatMB, formatMBPair, formatPercent, formatDuration, splitEveVersion, formatWorkloadUsage, EXPANDED_STORAGE_KEY,
} from './DeviceInfoPanel';

const NOW = new Date('2026-10-27T12:00:00Z');

const info = (extra = {}) => ({
  nodeId: 'node-1',
  name: 'TO952963',
  runState: 'RUN_STATE_ONLINE',
  online: true,
  eveVersion: '16.6.0-lts-kvm-amd64',
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
  ],
  workloadsAvailable: true,
  ...extra,
});

const valueOf = (label) => screen.getByText(label, { selector: '.status-label' }).closest('.status-item');
const summary = () => screen.getByTestId('device-summary');
const expand = () => fireEvent.click(screen.getByRole('button', { name: /Device/ }));

// Hover an item and return its (real) Tooltip's text.
const tooltipOf = async (label) => {
  fireEvent.mouseEnter(valueOf(label).querySelector('.tooltip-container'));
  return waitFor(() => {
    const tip = document.querySelector('.tooltip-content');
    expect(tip).toBeTruthy();
    return tip;
  });
};

const renderPanel = (props = {}) => render(
  <DeviceInfoPanel info={info()} failed={false} authFailed={false} isOnline timeFormatOptions={{ hour12: false }} {...props} />
);

describe('DeviceInfoPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('is collapsed by default, with a one-line summary in the title row', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /Device/ })).toHaveAttribute('aria-expanded', 'false');
    expect(summary()).toHaveTextContent('EVE 16.6.0-lts · up 2d 2h · CPU 13% · Mem 2.6/7.6 GB');
    // Platform suffix stays out of the summary too.
    expect(summary()).not.toHaveTextContent('kvm-amd64');
    expect(screen.queryByText('UPTIME', { selector: '.status-label' })).not.toBeInTheDocument();
  });

  it('expands into the status grid and collapses again on title click', () => {
    renderPanel();
    expand();
    expect(screen.getByRole('button', { name: /Device/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByTestId('device-summary')).not.toBeInTheDocument();
    const grid = valueOf('EVE').closest('.status-grid');
    expect(grid.closest('.ssh-details')).toBeInTheDocument();
    expect(grid.querySelectorAll('.status-item')).toHaveLength(6);

    expect(valueOf('UPTIME')).toHaveTextContent('2d 2h');
    const reboot = valueOf('LAST REBOOT');
    expect(reboot).toHaveTextContent('Update');
    expect(reboot).toHaveTextContent('2d 2h ago');
    expect(valueOf('CPU')).toHaveTextContent('13%');
    // committed = 2048 apps + 640 EVE = 2688 MB = 2.6 GB of 7.6 GB
    expect(valueOf('MEMORY')).toHaveTextContent('2.6 GB / 7.6 GB');
    expect(valueOf('STORAGE')).toHaveTextContent('33 GB / 120 GB');

    expand();
    expect(screen.queryByText('UPTIME', { selector: '.status-label' })).not.toBeInTheDocument();
    expect(summary()).toBeInTheDocument();
  });

  it('keeps each item to a value plus at most one sub-line; extra detail lives in tooltips', async () => {
    renderPanel();
    expand();
    for (const label of ['EVE', 'UPTIME', 'LAST REBOOT', 'CPU', 'MEMORY', 'STORAGE']) {
      const body = valueOf(label).querySelector('.status-label').parentElement;
      // label + value + optional sub-line
      expect(body.children.length).toBeLessThanOrEqual(3);
    }
    expect(valueOf('CPU')).not.toHaveTextContent('cores');
    expect(valueOf('MEMORY')).not.toHaveTextContent('apps');
    const cpuTip = await tooltipOf('CPU');
    expect(cpuTip).toHaveTextContent('Average over the last hour');
    expect(cpuTip).toHaveTextContent('4 cores');
  });

  it('puts the free-text reboot reason and the memory split in tooltips', async () => {
    renderPanel();
    expand();
    expect(valueOf('LAST REBOOT')).not.toHaveTextContent('NORMAL: baseos update');
    expect(await tooltipOf('LAST REBOOT')).toHaveTextContent('NORMAL: baseos update');
    fireEvent.mouseLeave(valueOf('LAST REBOOT').querySelector('.tooltip-container'));
    await waitFor(() => expect(document.querySelector('.tooltip-content')).toBeNull());
    const memTip = await tooltipOf('MEMORY');
    expect(memTip).toHaveTextContent('Apps allocated 2.0 GB');
    expect(memTip).toHaveTextContent('EVE using 640 MB');
  });

  it('shows the EVE version without its platform suffix; partitions go to the tooltip', async () => {
    renderPanel({ info: info({ eveVersion: '14.5.2-lts-kvm-amd64', otherVersion: '14.5.1-lts-kvm-amd64', otherPartition: 'IMGB', otherState: 'unused' }) });
    expect(summary()).toHaveTextContent('EVE 14.5.2-lts ·');
    expand();
    const eve = valueOf('EVE');
    expect(eve.querySelector('.status-value')).toHaveTextContent(/^14\.5\.2-lts$/);
    // One short sub-line: the partition label, no "partition" prefix, no other-partition text.
    expect(eve).toHaveTextContent(/IMGA$/);
    expect(eve).not.toHaveTextContent('partition');
    expect(eve).not.toHaveTextContent('IMGB');
    expect(eve).not.toHaveTextContent('kvm-amd64');

    const tip = await tooltipOf('EVE');
    expect(tip).toHaveTextContent('Active: IMGA 14.5.2-lts (kvm-amd64)');
    expect(tip).toHaveTextContent('Other: IMGB 14.5.1-lts (unused)');
  });

  it('flags a pending update on the other partition in the sub-line', () => {
    renderPanel({ info: info({ otherVersion: '16.7.0-lts-kvm-amd64', otherPartition: 'IMGB', otherState: 'inprogress' }) });
    expand();
    expect(valueOf('EVE')).toHaveTextContent('IMGA · update pending');
  });

  it('keeps an unrecognised EVE version string whole', () => {
    renderPanel({ info: info({ eveVersion: '0.0.0-master-20261001' }) });
    expand();
    expect(valueOf('EVE').querySelector('.status-value')).toHaveTextContent('0.0.0-master-20261001');
  });

  it('remembers the expanded choice per viewer', () => {
    const { unmount } = renderPanel();
    expand();
    expect(window.localStorage.getItem(EXPANDED_STORAGE_KEY)).toBe('1');
    unmount();
    renderPanel();
    expect(screen.getByRole('button', { name: /Device/ })).toHaveAttribute('aria-expanded', 'true');
    expect(valueOf('EVE')).toBeInTheDocument();
  });

  it('still renders and toggles when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    renderPanel();
    expect(summary()).toHaveTextContent('EVE 16.6.0-lts');
    expand();
    expect(valueOf('EVE')).toBeInTheDocument();
  });

  it('has no workload list (apps show their usage in Running Applications)', () => {
    renderPanel();
    expand();
    expect(screen.queryByText(/Workloads/)).not.toBeInTheDocument();
    expect(screen.queryByText('web-app')).not.toBeInTheDocument();
  });

  it('offline: "last boot" instead of uptime, no CPU, values flagged as last reported', () => {
    renderPanel({ isOnline: false, info: info({ online: false, runState: 'RUN_STATE_OFFLINE', uptimeSec: undefined, cpu: { percent: 0, cores: 4 } }) });
    expect(summary()).toHaveTextContent('EVE 16.6.0-lts · last boot 2d 2h ago · Mem 2.6/7.6 GB');
    expect(summary()).not.toHaveTextContent('CPU');
    expand();
    expect(screen.queryByText('UPTIME', { selector: '.status-label' })).not.toBeInTheDocument();
    expect(valueOf('LAST BOOT')).toHaveTextContent('2d 2h ago');
    expect(valueOf('CPU')).toHaveTextContent('—');
    expect(valueOf('CPU')).not.toHaveTextContent('%');
    expect(valueOf('MEMORY')).toHaveTextContent('2.6 GB / 7.6 GB');
    expect(screen.getByText(/values are last reported/)).toBeInTheDocument();
  });

  it('follows the isOnline prop, not info.online (maintenance mode shows uptime)', () => {
    renderPanel({ info: info({ online: false, runState: 'RUN_STATE_MAINTENANCE_MODE', uptimeSec: undefined }) });
    expand();
    expect(valueOf('UPTIME')).toHaveTextContent('2d 2h');
    expect(screen.queryByText(/values are last reported/)).not.toBeInTheDocument();
    expect(valueOf('CPU')).toHaveTextContent('13%');
  });

  it('falls back to uptimeSec when bootTime is absent', () => {
    renderPanel({ info: info({ bootTime: undefined, uptimeSec: 5 * 3600 + 12 * 60 }) });
    expand();
    expect(valueOf('UPTIME')).toHaveTextContent('5h 12m');
  });

  it('shows a dash for memory when the controller sent all zeros', () => {
    renderPanel({ info: info({ memory: { usedEveMB: 0, allocatedAppsMB: 0, allocatedEveMB: 0 } }) });
    expect(summary()).not.toHaveTextContent('Mem');
    expand();
    expect(valueOf('MEMORY')).toHaveTextContent('—');
    expect(valueOf('MEMORY')).not.toHaveTextContent('0 MB');
  });

  it('degrades to dashes (and an empty summary) when fields are missing', () => {
    renderPanel({ info: { nodeId: 'node-1', online: true, workloads: [], workloadsAvailable: true } });
    expect(screen.queryByTestId('device-summary')).not.toBeInTheDocument();
    expand();
    for (const label of ['EVE', 'UPTIME', 'LAST REBOOT', 'CPU', 'MEMORY', 'STORAGE']) {
      expect(valueOf(label)).toHaveTextContent('—');
    }
  });

  it('falls back to the free-text reason when there is no enum label', () => {
    renderPanel({ info: info({ lastReboot: { reason: 'power cycled\nsecond line', time: '2026-10-27T11:00:00Z' } }) });
    expand();
    expect(valueOf('LAST REBOOT')).toHaveTextContent('power cycled');
    expect(valueOf('LAST REBOOT')).not.toHaveTextContent('second line');
    expect(valueOf('LAST REBOOT')).toHaveTextContent('1h 0m ago');
  });

  it('shows a muted note when the load failed before any data', () => {
    const { container } = renderPanel({ info: null, failed: true });
    expect(screen.getByText('Device details unavailable')).toBeInTheDocument();
    expect(container.querySelector('.ssh-status-section')).toBeInTheDocument();
  });

  it('renders nothing while loading or after an auth failure', () => {
    const { container, rerender } = renderPanel({ info: null });
    expect(container.textContent).toBe('');
    rerender(<DeviceInfoPanel info={null} failed authFailed isOnline />);
    expect(container.textContent).toBe('');
  });
});

describe('formatters', () => {
  it('formats MB, percent and durations', () => {
    expect(formatMB(640)).toBe('640 MB');
    expect(formatMB(7800)).toBe('7.6 GB');
    expect(formatMB(122880)).toBe('120 GB');
    expect(formatMB(2 * 1024 * 1024)).toBe('2.0 TB');
    expect(formatMB(undefined)).toBe('—');
    expect(formatMBPair(1229, 2048)).toBe('1.2 / 2.0 GB');
    expect(formatMBPair(300, 1024)).toBe('300 MB / 1.0 GB');
    expect(formatMBPair(26 * 1024, 31 * 1024, '/')).toBe('26/31 GB');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(12.5)).toBe('13%');
    expect(formatPercent(null)).toBe('—');
    expect(formatDuration(30)).toBe('<1m');
    expect(formatDuration(5 * 60)).toBe('5m');
    expect(formatDuration(5 * 3600 + 12 * 60)).toBe('5h 12m');
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe('3d 4h');
    expect(formatDuration(-1)).toBe('—');
  });

  it('splits the EVE platform suffix defensively', () => {
    expect(splitEveVersion('14.5.2-lts-kvm-amd64')).toEqual({ version: '14.5.2-lts', platform: 'kvm-amd64' });
    expect(splitEveVersion('16.0.1-lts-kvm-arm64')).toEqual({ version: '16.0.1-lts', platform: 'kvm-arm64' });
    expect(splitEveVersion('13.4.0-xen-amd64')).toEqual({ version: '13.4.0', platform: 'xen-amd64' });
    expect(splitEveVersion('16.6.0-k-amd64')).toEqual({ version: '16.6.0', platform: 'k-amd64' });
    expect(splitEveVersion('12.0.0-kubevirt-amd64')).toEqual({ version: '12.0.0', platform: 'kubevirt-amd64' });
    expect(splitEveVersion('16.6.0-lts')).toEqual({ version: '16.6.0-lts', platform: '' });
    expect(splitEveVersion('kvm-amd64')).toEqual({ version: 'kvm-amd64', platform: '' });
    expect(splitEveVersion(undefined)).toEqual({ version: '', platform: '' });
  });

  it('formats a workload usage line, without CPU when offline', () => {
    const w = { cpuPercent: 3, memUsedMB: 1229, memAllocatedMB: 2048 };
    expect(formatWorkloadUsage(w, true)).toBe('CPU 3.0% · 1.2 / 2.0 GB');
    expect(formatWorkloadUsage(w, false)).toBe('1.2 / 2.0 GB');
    expect(formatWorkloadUsage({ memAllocatedMB: 512 }, true)).toBe('512 MB alloc.');
    expect(formatWorkloadUsage({}, true)).toBe('');
    expect(formatWorkloadUsage(null, true)).toBe('');
  });
});
