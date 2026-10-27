import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Tooltip from './Tooltip';

// Collapsible "Device" section of the device details: EVE version, uptime,
// last reboot and device resource use. Presentational: App loads the data
// once per device (useDeviceInfo) and also feeds its per-app numbers into the
// Running Applications rows, so this panel has no workload list of its own.
//
// Laid out exactly like the EdgeView Session section below it
// (.ssh-status-section → .section-title → .ssh-details → .status-grid) and
// collapsed by default so the session controls stay near the top; the
// collapsed title row carries a one-line summary instead.

const MB_PER_GB = 1024;

// Per-viewer expanded/collapsed choice. Storage can be missing or throw
// (private mode, blocked site data): the panel then just starts collapsed.
export const EXPANDED_STORAGE_KEY = 'deviceInfoExpanded';
const readExpanded = () => {
  try {
    return window.localStorage.getItem(EXPANDED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};
const writeExpanded = (v) => {
  try {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, v ? '1' : '0');
  } catch {
    // not persisted; the in-memory state still toggles
  }
};

// MB (as the controller reports memory/storage) -> "640 MB" / "7.6 GB" / "1.2 TB".
export const formatMB = (mb) => {
  if (typeof mb !== 'number' || !Number.isFinite(mb)) return '—';
  if (mb < MB_PER_GB) return `${Math.round(mb)} MB`;
  const gb = mb / MB_PER_GB;
  if (gb < MB_PER_GB) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  return `${(gb / MB_PER_GB).toFixed(1)} TB`;
};

// "used / total" with the unit written once when both share it:
// (1229, 2048) -> "1.2 / 2.0 GB", (300, 1024) -> "300 MB / 1.0 GB".
export const formatMBPair = (used, total, sep = ' / ') => {
  const a = formatMB(used);
  const b = formatMB(total);
  const ua = a.split(' ')[1];
  if (ua && ua === b.split(' ')[1]) return `${a.split(' ')[0]}${sep}${b}`;
  return `${a}${sep}${b}`;
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

// EVE reports its version with a "-<hypervisor>-<arch>" build suffix
// ("14.5.2-lts-kvm-amd64"). Split it so the value shows "14.5.2-lts" and the
// platform goes to the tooltip. Anything unrecognised is kept whole.
const EVE_PLATFORM_RE = /^(.+?)-((?:kvm|xen|kubevirt|k|acrn|mini)-(?:amd64|arm64|riscv64))$/i;
export const splitEveVersion = (v) => {
  const s = String(v || '');
  const m = s.match(EVE_PLATFORM_RE);
  return m ? { version: m[1], platform: m[2] } : { version: s, platform: '' };
};

// The inactive partition's state, when it says something about an update.
// "unused" / "active" are the normal resting states and say nothing.
const OTHER_STATE_NOTES = {
  updating: 'update downloading',
  inprogress: 'update pending',
  failed: 'update failed',
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const agoFrom = (iso) => {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return null;
  const sec = (Date.now() - t) / 1000;
  return sec < 60 ? 'just now' : `${formatDuration(sec)} ago`;
};

/**
 * One-line CPU / memory text for an app row in Running Applications,
 * e.g. "CPU 3.0% · 1.2 / 2.0 GB". CPU is left out while the device is
 * offline (the controller reports 0 without samples). Returns '' when there
 * is nothing to show.
 */
export const formatWorkloadUsage = (w, online) => {
  if (!w) return '';
  const parts = [];
  const cpu = num(w.cpuPercent);
  if (online && cpu !== null) parts.push(`CPU ${formatPercent(cpu)}`);
  const used = num(w.memUsedMB);
  const alloc = num(w.memAllocatedMB);
  if (used !== null && alloc !== null) parts.push(formatMBPair(used, alloc));
  else if (alloc !== null) parts.push(`${formatMB(alloc)} alloc.`);
  else if (used !== null) parts.push(formatMB(used));
  return parts.join(' · ');
};

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };
const subStyle = { ...ellipsis, maxWidth: '100%', fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 };

// Thin usage bar, the same width under every resource value. `pct` is
// clamped to 0-100 for display only.
const Bar = ({ pct }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 90 ? 'var(--color-danger)' : clamped >= 75 ? 'var(--color-warning)' : 'var(--color-success)';
  return (
    <div data-testid="usage-bar" style={{ width: '64px', height: '3px', borderRadius: '2px', background: 'var(--border-color)', overflow: 'hidden', marginTop: '2px' }}>
      <div style={{ width: `${clamped}%`, height: '100%', background: color, opacity: 0.85 }} />
    </div>
  );
};

// Multi-line tooltip body. Passed as a node (not a string) so the Tooltip
// keeps line breaks and does not add its "Copy" header.
const TipLines = ({ lines }) => (
  <div>{lines.filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}</div>
);

// A .status-item with the EdgeView items' rhythm: label, one value line,
// at most one muted sub-line. Nothing wraps; the whole item is the tooltip
// trigger, so the full text of anything ellipsized is one hover away.
const Item = ({ label, tip, value, valueClass, sub }) => {
  const body = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
      <div className="status-label" style={tip ? { cursor: 'help' } : undefined}>{label}</div>
      <div className={`status-value${valueClass ? ` ${valueClass}` : ''}`} style={{ maxWidth: '100%' }}>
        <span style={ellipsis}>{value}</span>
      </div>
      {sub}
    </div>
  );
  return (
    <div className="status-item" style={{ minWidth: 0, alignItems: 'stretch' }}>
      {tip ? <Tooltip text={<TipLines lines={tip} />}>{body}</Tooltip> : body}
    </div>
  );
};

/**
 * @param {object|null} info         GetDeviceInfo payload for the open device
 * @param {boolean} failed           the last load failed
 * @param {boolean} authFailed       ...because the token was rejected (the app banner explains it)
 * @param {boolean} isOnline         the page's online state (same as the rest of the details,
 *                                   includes maintenance mode); offline shows "last boot", hides CPU
 *                                   and marks the numbers as last reported
 * @param {object} timeFormatOptions Intl options for full timestamps in tooltips
 */
const DeviceInfoPanel = ({ info, failed, authFailed, isOnline, timeFormatOptions }) => {
  const [expanded, setExpanded] = useState(readExpanded);

  if (!info) {
    // Nothing yet. A plain failure gets a muted note; an auth failure is
    // already explained by the app-wide token banner.
    if (failed && !authFailed) {
      return (
        <div className="ssh-status-section" style={{ paddingBottom: 0 }}>
          <div className="section-title" style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: 0 }}>
            <span>Device</span>
            <span style={{ ...subStyle, fontSize: '12px' }}>Device details unavailable</span>
          </div>
        </div>
      );
    }
    return null;
  }

  const toggle = () => setExpanded((v) => {
    writeExpanded(!v);
    return !v;
  });

  const fullTime = (iso) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? '' : new Date(t).toLocaleString(undefined, timeFormatOptions);
  };

  // The page's own online state, not info.online, so this panel agrees with
  // the rest of the details (e.g. maintenance mode counts as online).
  const online = !!isOnline;

  // --- EVE version ---
  const eve = splitEveVersion(info.eveVersion);
  const other = splitEveVersion(info.otherVersion);
  const otherNote = info.otherVersion ? OTHER_STATE_NOTES[String(info.otherState || '').toLowerCase()] : undefined;
  const eveSub = [info.partition, otherNote].filter(Boolean).join(' · ');
  const eveTip = info.eveVersion ? [
    `Active: ${[info.partition, eve.version].filter(Boolean).join(' ')}${eve.platform ? ` (${eve.platform})` : ''}`,
    info.otherVersion && `Other: ${[info.otherPartition, other.version].filter(Boolean).join(' ')}${info.otherState ? ` (${info.otherState})` : ''}`,
  ] : null;

  // --- Uptime / last boot ---
  const bootAgo = agoFrom(info.bootTime);
  let uptimeLabel = 'UPTIME';
  let uptimeValue = '—';
  let uptimeTip = null;
  if (online) {
    const bootMs = Date.parse(info.bootTime);
    if (info.bootTime && !Number.isNaN(bootMs)) uptimeValue = formatDuration((Date.now() - bootMs) / 1000);
    else if (num(info.uptimeSec) !== null) uptimeValue = formatDuration(info.uptimeSec);
    if (info.bootTime) uptimeTip = [`Booted ${fullTime(info.bootTime)}`];
  } else {
    // An offline device's uptime is stale: say when it last booted instead.
    uptimeLabel = 'LAST BOOT';
    if (bootAgo) uptimeValue = bootAgo;
    if (info.bootTime) uptimeTip = [`Booted ${fullTime(info.bootTime)}`];
  }

  // --- Last reboot ---
  const lr = info.lastReboot;
  const lrAgo = lr ? agoFrom(lr.time) : null;
  const lrFirstLine = lr?.reason ? lr.reason.split('\n')[0] : '';
  const lrText = lr ? (lr.label || lrFirstLine || '—') : '—';
  const lrTip = lr && (lr.reason || lr.time)
    ? [lr.label, lr.reason, lr.time ? fullTime(lr.time) : '']
    : null;

  // --- Resources ---
  const cpu = info.cpu;
  // CPU is a 1-hour average the controller reports as 0 when it has no
  // samples (offline), so it is only meaningful while online.
  const cpuPct = online ? num(cpu?.percent) : null;
  const cores = num(cpu?.cores);
  const cpuTip = [
    online ? 'Average over the last hour, % of total device capacity' : 'Not reported while the device is offline',
    cores !== null && `${cores} ${cores === 1 ? 'core' : 'cores'}`,
  ];

  const mem = info.memory;
  const memTotal = num(mem?.totalMB);
  // All-zero used/allocated means the device never reported memory.
  const memReported = [mem?.usedEveMB, mem?.allocatedAppsMB, mem?.allocatedEveMB].some((v) => num(v) !== null && v !== 0);
  const memApps = memReported ? num(mem?.allocatedAppsMB) : null;
  const memEve = memReported ? num(mem?.usedEveMB) : null;
  // usedEveMB is EVE's own usage, not host-wide: show what is committed
  // (apps' allocation + EVE's use) against the device total.
  const memCommitted = (memApps !== null || memEve !== null) ? (memApps ?? 0) + (memEve ?? 0) : null;
  const memValue = memCommitted !== null
    ? `${formatMB(memCommitted)}${memTotal !== null ? ` / ${formatMB(memTotal)}` : ''}`
    : (memTotal !== null ? formatMB(memTotal) : '—');
  const memTip = [
    'Committed: allocated to app instances plus used by EVE itself, of the device total',
    memApps !== null && `Apps allocated ${formatMB(memApps)}`,
    memEve !== null && `EVE using ${formatMB(memEve)} (its own use, not host-wide)`,
  ];

  const stor = info.storage;
  const storTotal = num(stor?.totalMB);
  const storUsed = num(stor?.usedMB);
  const storValue = storUsed !== null && storTotal !== null ? `${formatMB(storUsed)} / ${formatMB(storTotal)}`
    : storTotal !== null ? formatMB(storTotal)
      : storUsed !== null ? formatMB(storUsed) : '—';

  // --- Collapsed one-line summary: only the parts we actually have. ---
  const summary = [
    info.eveVersion && `EVE ${eve.version}`,
    online ? (uptimeValue !== '—' && `up ${uptimeValue}`) : (bootAgo && `last boot ${bootAgo}`),
    cpuPct !== null && `CPU ${formatPercent(cpuPct)}`,
    memCommitted !== null && memTotal !== null && `Mem ${formatMBPair(memCommitted, memTotal, '/')}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="ssh-status-section" style={{ paddingBottom: 0 }}>
      <div
        className="section-title"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            toggle();
          }
        }}
        title={expanded ? 'Hide device details' : 'Show device details'}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          cursor: 'pointer', userSelect: 'none',
          marginBottom: expanded ? '12px' : 0,
        }}
      >
        {expanded
          ? <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
          : <ChevronRight size={14} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />}
        <span style={{ flexShrink: 0 }}>Device</span>
        {!expanded && summary && (
          <span data-testid="device-summary" style={{ ...subStyle, fontSize: '12px', flex: 1, marginLeft: '4px' }}>{summary}</span>
        )}
        {expanded && !online && (
          <span style={{ ...subStyle, fontSize: '12px', marginLeft: '4px' }}>offline · values are last reported</span>
        )}
      </div>

      {expanded && (
        <div className="ssh-details">
          <div className="status-grid" style={{ marginBottom: 0 }}>
            <Item
              label="EVE"
              tip={eveTip}
              value={info.eveVersion ? eve.version : '—'}
              valueClass={info.eveVersion ? '' : 'neutral'}
              sub={eveSub && (
                <div style={{ ...subStyle, ...(otherNote === 'update failed' ? { color: 'var(--color-warning)' } : {}) }}>{eveSub}</div>
              )}
            />
            <Item label={uptimeLabel} tip={uptimeTip} value={uptimeValue} />
            <Item
              label="LAST REBOOT"
              tip={lrTip}
              value={lrText}
              sub={lrAgo && <div style={subStyle}>{lrAgo}</div>}
            />
            <Item
              label="CPU"
              tip={cpuTip}
              value={cpuPct !== null ? formatPercent(cpuPct) : '—'}
              sub={cpuPct !== null && <Bar pct={cpuPct} />}
            />
            <Item
              label="MEMORY"
              tip={memTip}
              value={memValue}
              sub={memCommitted !== null && memTotal !== null && <Bar pct={(memCommitted / memTotal) * 100} />}
            />
            <Item
              label="STORAGE"
              tip={storUsed !== null && storTotal !== null ? [`${formatMB(storUsed)} used of ${formatMB(storTotal)}`] : null}
              value={storValue}
              sub={storUsed !== null && storTotal !== null && <Bar pct={(storUsed / storTotal) * 100} />}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DeviceInfoPanel;
