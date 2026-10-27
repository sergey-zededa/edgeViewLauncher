import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Box } from 'lucide-react';
import { GetDeviceInfo } from '../tauriAPI';

// Compact "Device" section of the device details: EVE version, uptime, last
// reboot and resource use for the device and its app instances.
//
// This is a cloud read (controller device/app status), so it is cloud-config
// class: it works while the device is offline and is never gated on the
// EdgeView session. Fetched when the details open, refreshed every 60s.
const REFRESH_MS = 60000;

const MB_PER_GB = 1024;

// MB (as the controller reports memory/storage) -> "640 MB" / "7.6 GB" / "1.2 TB".
export const formatMB = (mb) => {
  if (typeof mb !== 'number' || !Number.isFinite(mb)) return '—';
  if (mb < MB_PER_GB) return `${Math.round(mb)} MB`;
  const gb = mb / MB_PER_GB;
  if (gb < MB_PER_GB) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  return `${(gb / MB_PER_GB).toFixed(1)} TB`;
};

// The controller's CPU Utilization is percent of total device capacity
// (0-100), a 1-hour average (EVE scales by CPU count); shown as-is.
export const formatPercent = (p) => {
  if (typeof p !== 'number' || !Number.isFinite(p)) return '—';
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
};

// Seconds -> "2d 3h" / "5h 12m" / "4m" / "<1m". Two most significant units.
export const formatDuration = (sec) => {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
};

const agoFrom = (iso) => {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return null;
  const sec = (Date.now() - t) / 1000;
  return sec < 60 ? 'just now' : `${formatDuration(sec)} ago`;
};

// RUN_STATE_ONLINE -> "Online"
const formatRunState = (s) => {
  const t = String(s || '').replace(/^RUN_STATE_/, '').replace(/_/g, ' ').toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '—';
};

const runStateClass = (s) => {
  const t = String(s || '').replace(/^RUN_STATE_/, '');
  if (t === 'ONLINE') return 'success';
  if (/ERROR|FAIL|BROKEN/.test(t)) return 'error';
  if (/HALT|OFFLINE|UNKNOWN|INIT/.test(t) || !t) return 'neutral';
  return 'mismatch';
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Thin usage bar. `pct` is clamped to 0-100 for display only.
const Bar = ({ pct }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 90 ? 'var(--color-danger)' : clamped >= 75 ? 'var(--color-warning)' : 'var(--color-success)';
  return (
    <div style={{ height: '4px', borderRadius: '2px', background: 'var(--border-color)', overflow: 'hidden', marginTop: '2px' }}>
      <div style={{ width: `${clamped}%`, height: '100%', background: color }} />
    </div>
  );
};

const subStyle = { fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 };

const Item = ({ label, title, children }) => (
  <div className="status-item" style={{ minWidth: 0 }}>
    <div className="status-label" style={title ? { cursor: 'help' } : undefined} title={title}>{label}</div>
    {children}
  </div>
);

/**
 * @param {string} nodeId
 * @param {string} nodeName          device name (lets the backend fetch app statuses concurrently)
 * @param {boolean} isOnline         the page's online state (same as the rest of the details,
 *                                   includes maintenance mode); offline shows "last boot", hides CPU
 *                                   and marks the numbers as last reported
 * @param {object} timeFormatOptions Intl options for full timestamps in tooltips
 * @param {() => void} onAuthError   called when the controller rejects the API token
 */
const DeviceInfoPanel = ({ nodeId, nodeName, isOnline, timeFormatOptions, onAuthError }) => {
  // Keyed by node so a slow response for a previously selected device is
  // never shown for the current one.
  const [state, setState] = useState({ nodeId: null, info: null, failed: false });
  const [showWorkloads, setShowWorkloads] = useState(false);

  useEffect(() => {
    if (!nodeId) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const info = await GetDeviceInfo(nodeId, nodeName);
        if (cancelled) return;
        setState({ nodeId, info: info || null, failed: false });
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load device info:', err);
        // Background read: an expired token only raises the persistent banner.
        if (err?.code === 'UNAUTHORIZED' && onAuthError) onAuthError();
        // Keep what we already showed for this device; a blip should not blank it.
        setState(prev => ({ nodeId, info: prev.nodeId === nodeId ? prev.info : null, failed: true, authFailed: err?.code === 'UNAUTHORIZED' }));
      }
    };
    load();
    const intervalId = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // onAuthError is a fresh closure each render; the fetch must not restart for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeName, isOnline]);

  const current = state.nodeId === nodeId ? state : null;
  const info = current?.info;

  if (!info) {
    // Nothing yet. A plain failure gets a muted note; an auth failure is
    // already explained by the app-wide token banner.
    if (current?.failed && !current.authFailed) {
      return (
        <div className="ssh-status-section" style={{ paddingBottom: 0 }}>
          <div className="section-title" style={{ marginBottom: '6px' }}><span>Device</span></div>
          <div style={{ ...subStyle, fontSize: '12px' }}>Device details unavailable</div>
        </div>
      );
    }
    return null;
  }

  const fullTime = (iso) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? '' : new Date(t).toLocaleString(undefined, timeFormatOptions);
  };

  // --- EVE version ---
  const eveValue = info.eveVersion ? (
    <>
      <div className="status-value" style={{ overflowWrap: 'anywhere' }}>{info.eveVersion}</div>
      {info.partition && <div style={subStyle}>partition {info.partition}</div>}
    </>
  ) : <div className="status-value neutral">—</div>;
  const otherTitle = info.otherVersion
    ? `The other EVE partition${info.otherPartition ? ` (${info.otherPartition})` : ''} holds ${info.otherVersion}${info.otherState ? ` (${info.otherState})` : ''} — a pending update or a fallback image.`
    : undefined;

  // --- Uptime / last boot ---
  // The page's own online state, not info.online, so this panel agrees with
  // the rest of the details (e.g. maintenance mode counts as online).
  const online = !!isOnline;
  const bootAgo = agoFrom(info.bootTime);
  let uptimeLabel = 'UPTIME';
  let uptimeValue = '—';
  let uptimeTitle;
  if (online) {
    const bootMs = Date.parse(info.bootTime);
    if (info.bootTime && !Number.isNaN(bootMs)) uptimeValue = formatDuration((Date.now() - bootMs) / 1000);
    else if (num(info.uptimeSec) !== null) uptimeValue = formatDuration(info.uptimeSec);
    if (info.bootTime) uptimeTitle = `Booted ${fullTime(info.bootTime)}`;
  } else {
    // An offline device's uptime is stale: say when it last booted instead.
    uptimeLabel = 'LAST BOOT';
    if (bootAgo) uptimeValue = bootAgo;
    if (info.bootTime) uptimeTitle = fullTime(info.bootTime);
  }

  // --- Last reboot ---
  const lr = info.lastReboot;
  const lrAgo = lr ? agoFrom(lr.time) : null;
  const lrFirstLine = lr?.reason ? lr.reason.split('\n')[0] : '';
  const lrText = lr ? (lr.label || lrFirstLine || '—') : '—';
  const lrTitle = lr
    ? [lr.reason, lr.time ? fullTime(lr.time) : ''].filter(Boolean).join('\n') || undefined
    : undefined;

  // --- Resources ---
  const cpu = info.cpu;
  // CPU is a 1-hour average the controller reports as 0 when it has no
  // samples (offline), so it is only meaningful while online.
  const cpuPct = online ? num(cpu?.percent) : null;
  const mem = info.memory;
  const memTotal = num(mem?.totalMB);
  // All-zero used/allocated means the device never reported memory.
  const memReported = [mem?.usedEveMB, mem?.allocatedAppsMB, mem?.allocatedEveMB].some((v) => num(v) !== null && v !== 0);
  const memApps = memReported ? num(mem?.allocatedAppsMB) : null;
  const memEve = memReported ? num(mem?.usedEveMB) : null;
  // usedEveMB is EVE's own usage, not host-wide: show what is committed
  // (apps' allocation + EVE's use) against the device total.
  const memCommitted = (memApps !== null || memEve !== null) ? (memApps ?? 0) + (memEve ?? 0) : null;
  const stor = info.storage;
  const storTotal = num(stor?.totalMB);
  const storUsed = num(stor?.usedMB);

  const workloads = Array.isArray(info.workloads) ? info.workloads : [];

  return (
    <div className="ssh-status-section" style={{ paddingBottom: 0 }}>
      <div className="section-title" style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
        <span>Device</span>
        {!online && <span style={subStyle}>offline — values are last reported</span>}
      </div>

      <div className="status-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: '8px' }}>
        <Item label="EVE" title={otherTitle}>
          {eveValue}
          {info.otherVersion && (
            <div style={subStyle} title={otherTitle}>
              other{info.otherPartition ? ` (${info.otherPartition})` : ''}: {info.otherVersion}
            </div>
          )}
        </Item>

        <Item label={uptimeLabel} title={uptimeTitle}>
          <div className="status-value">{uptimeValue}</div>
        </Item>

        <Item label="LAST REBOOT" title={lrTitle}>
          <div className="status-value" style={{ minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lrText}</span>
          </div>
          {lrAgo && <div style={subStyle}>{lrAgo}</div>}
        </Item>

        <Item label="CPU" title="Average over the last hour">
          <div className="status-value">{cpuPct !== null ? formatPercent(cpuPct) : '—'}</div>
          {cpuPct !== null && <Bar pct={cpuPct} />}
          {num(cpu?.cores) !== null && <div style={subStyle}>{cpu.cores} {cpu.cores === 1 ? 'core' : 'cores'}</div>}
        </Item>

        <Item label="MEMORY" title="Memory committed on the device: allocated to app instances plus used by EVE itself, of the device total. EVE usage is EVE's own, not host-wide.">
          <div className="status-value">
            {memCommitted !== null ? `${formatMB(memCommitted)}${memTotal !== null ? ` / ${formatMB(memTotal)}` : ''}` : (memTotal !== null ? formatMB(memTotal) : '—')}
          </div>
          {memCommitted !== null && memTotal !== null && <Bar pct={(memCommitted / memTotal) * 100} />}
          {(memApps !== null || memEve !== null) && (
            <div style={subStyle}>
              {memApps !== null ? `apps ${formatMB(memApps)}` : ''}{memApps !== null && memEve !== null ? ' · ' : ''}{memEve !== null ? `EVE ${formatMB(memEve)}` : ''}
            </div>
          )}
        </Item>

        <Item label="STORAGE">
          <div className="status-value">
            {storUsed !== null && storTotal !== null ? `${formatMB(storUsed)} / ${formatMB(storTotal)}`
              : storTotal !== null ? formatMB(storTotal)
                : storUsed !== null ? formatMB(storUsed) : '—'}
          </div>
          {storUsed !== null && storTotal !== null && <Bar pct={(storUsed / storTotal) * 100} />}
        </Item>
      </div>

      {info.workloadsAvailable === false ? (
        <div style={{ ...subStyle, fontSize: '12px' }} title={info.workloadsError || undefined}>Workloads unavailable</div>
      ) : workloads.length === 0 ? (
        <div style={{ ...subStyle, fontSize: '12px' }}>No app instances</div>
      ) : (
        <div>
          <div
            onClick={() => setShowWorkloads((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              cursor: 'pointer', userSelect: 'none',
              fontSize: '12px', color: 'var(--text-secondary)',
            }}
            title="Show / hide the app instances on this device with their CPU and memory use"
          >
            {showWorkloads ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Box size={13} />
            <span>Workloads ({workloads.length})</span>
          </div>
          {showWorkloads && (
            <div style={{
              marginTop: '8px', padding: '8px 10px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              display: 'flex', flexDirection: 'column', gap: '4px',
              fontSize: '12px',
            }}>
              {workloads.map((w) => {
                const used = num(w.memUsedMB);
                const alloc = num(w.memAllocatedMB);
                return (
                  <div key={w.id || w.name} data-testid="workload-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 56px 130px', gap: '8px', alignItems: 'center' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.name}>{w.name}</span>
                    <span className={`status-value ${runStateClass(w.runState)}`} style={{ fontSize: '12px' }}>{formatRunState(w.runState)}</span>
                    <span title="CPU (average over the last hour)">{online && num(w.cpuPercent) !== null ? formatPercent(w.cpuPercent) : '—'}</span>
                    <span title="Memory used / allocated">
                      {used !== null && alloc !== null ? `${formatMB(used)} / ${formatMB(alloc)}`
                        : alloc !== null ? `${formatMB(alloc)} alloc.`
                          : used !== null ? formatMB(used) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DeviceInfoPanel;
