import { renderHook, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('./tauriAPI', () => ({
  GetDeviceInfo: vi.fn(),
}));

import { GetDeviceInfo } from './tauriAPI';
import useDeviceInfo from './useDeviceInfo';

const info = (extra = {}) => ({ nodeId: 'node-1', eveVersion: '16.6.0-lts', workloads: [], ...extra });

const useIt = (props) => useDeviceInfo(props.nodeId, props.nodeName, props.isOnline, props.onAuthError);
const renderIt = (props = {}) => renderHook(useIt, {
  initialProps: { nodeId: 'node-1', nodeName: 'Dev-1', isOnline: true, onAuthError: undefined, ...props },
});

describe('useDeviceInfo', () => {
  beforeEach(() => {
    GetDeviceInfo.mockReset();
    GetDeviceInfo.mockResolvedValue(info());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loads the device once and returns its info', async () => {
    const { result } = renderIt();
    await waitFor(() => expect(result.current.info?.eveVersion).toBe('16.6.0-lts'));
    expect(GetDeviceInfo).toHaveBeenCalledTimes(1);
    expect(GetDeviceInfo).toHaveBeenCalledWith('node-1', 'Dev-1');
  });

  it('does not fetch without a node', async () => {
    const { result } = renderIt({ nodeId: null });
    await act(async () => { });
    expect(GetDeviceInfo).not.toHaveBeenCalled();
    expect(result.current).toEqual({ info: null, failed: false, authFailed: false });
  });

  it('refreshes every 60s and stops when unmounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, unmount } = renderIt();
    await waitFor(() => expect(result.current.info).not.toBeNull());
    expect(GetDeviceInfo).toHaveBeenCalledTimes(1);

    GetDeviceInfo.mockResolvedValue(info({ eveVersion: '16.7.0-lts' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(GetDeviceInfo).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.info.eveVersion).toBe('16.7.0-lts'));

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(GetDeviceInfo).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good data when a refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, 'error').mockImplementation(() => { });
    const { result } = renderIt();
    await waitFor(() => expect(result.current.info).not.toBeNull());
    GetDeviceInfo.mockRejectedValue(new Error('blip'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(GetDeviceInfo).toHaveBeenCalledTimes(2);
    expect(result.current.info.eveVersion).toBe('16.6.0-lts');
    expect(result.current.failed).toBe(true);
  });

  it('reports an auth failure through onAuthError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => { });
    GetDeviceInfo.mockRejectedValue(Object.assign(new Error('expired'), { code: 'UNAUTHORIZED' }));
    const onAuthError = vi.fn();
    const { result } = renderIt({ onAuthError });
    await waitFor(() => expect(onAuthError).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual({ info: null, failed: true, authFailed: true });
  });

  it('ignores a response that lands after switching to another device', async () => {
    let resolveFirst;
    GetDeviceInfo.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    GetDeviceInfo.mockResolvedValueOnce(info({ nodeId: 'node-2', eveVersion: '15.0.0' }));
    const { result, rerender } = renderIt();
    rerender({ nodeId: 'node-2', nodeName: 'Other', isOnline: true });
    await waitFor(() => expect(result.current.info?.eveVersion).toBe('15.0.0'));
    await act(async () => { resolveFirst(info({ eveVersion: 'STALE-1.0' })); });
    expect(result.current.info.eveVersion).toBe('15.0.0');
  });

  it('never returns the previous device\'s data for a newly selected one', async () => {
    let resolveSecond;
    const { result, rerender } = renderIt();
    await waitFor(() => expect(result.current.info).not.toBeNull());
    GetDeviceInfo.mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));
    rerender({ nodeId: 'node-2', nodeName: 'Other', isOnline: true });
    expect(result.current.info).toBeNull();
    await act(async () => { resolveSecond(info({ nodeId: 'node-2', eveVersion: '15.0.0' })); });
    expect(result.current.info.eveVersion).toBe('15.0.0');
  });
});
