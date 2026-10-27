import { useState, useEffect } from 'react';
import { GetDeviceInfo } from './tauriAPI';

// Device info for the open device details: EVE version, uptime, last reboot,
// resource use, and per-app CPU/memory (workloads). One fetch + 60s poll per
// selected device, shared by the "Device" section and the Running
// Applications rows.
//
// This is a cloud read (controller device/app status), so it is cloud-config
// class: it works while the device is offline and is never gated on the
// EdgeView session.
export const DEVICE_INFO_REFRESH_MS = 60000;

/**
 * @param {string|null} nodeId     device to load; null/empty stops fetching
 *                                 (no device open, or the token is known dead)
 * @param {string} nodeName        device name (lets the backend fetch app statuses concurrently)
 * @param {boolean} isOnline       the page's online state; a change refetches
 * @param {() => void} onAuthError called when the controller rejects the API token
 * @returns {{ info: object|null, failed: boolean, authFailed: boolean }}
 *          for `nodeId` only — never data from a previously selected device
 */
const useDeviceInfo = (nodeId, nodeName, isOnline, onAuthError) => {
  // Keyed by node so a slow response for a previously selected device is
  // never shown for the current one.
  const [state, setState] = useState({ nodeId: null, info: null, failed: false, authFailed: false });

  useEffect(() => {
    if (!nodeId) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const info = await GetDeviceInfo(nodeId, nodeName);
        if (cancelled) return;
        setState({ nodeId, info: info || null, failed: false, authFailed: false });
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load device info:', err);
        const authFailed = err?.code === 'UNAUTHORIZED';
        // Background read: an expired token only raises the persistent banner.
        if (authFailed && onAuthError) onAuthError();
        // Keep what we already showed for this device; a blip should not blank it.
        setState(prev => ({ nodeId, info: prev.nodeId === nodeId ? prev.info : null, failed: true, authFailed }));
      }
    };
    load();
    const intervalId = setInterval(load, DEVICE_INFO_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // onAuthError is a fresh closure each render; the fetch must not restart for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeName, isOnline]);

  if (!nodeId || state.nodeId !== nodeId) return { info: null, failed: false, authFailed: false };
  return { info: state.info, failed: state.failed, authFailed: state.authFailed };
};

export default useDeviceInfo;
