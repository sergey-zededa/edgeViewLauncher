// Normalize raw device/app status values coming from the ZEDEDA API.
// Device status strings arrive lowercased with underscores (e.g. "maintenance_mode",
// "provisioned"); app statuses arrive prefixed (e.g. "RUN_STATE_ONLINE").

function stripPrefix(raw) {
  return String(raw).replace(/^RUN_STATE_/i, '');
}

// Human-readable label, e.g. "maintenance_mode" -> "Maintenance Mode".
export function formatStatus(raw) {
  if (raw == null || raw === '') return '';
  const base = stripPrefix(raw).replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!base) return '';
  return base
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// CSS modifier class for the status dot. Returns one of:
// 'online' | 'offline' | 'suspect' | 'maintenance' | 'provisioned' | 'unknown'.
export function statusClass(raw) {
  if (raw == null || raw === '') return 'unknown';
  const v = stripPrefix(raw).toLowerCase();
  if (v === 'online') return 'online';
  if (v === 'offline') return 'offline';
  if (v === 'suspect') return 'suspect';
  if (v === 'maintenance_mode' || v === 'maintenance') return 'maintenance';
  if (v === 'provisioned') return 'provisioned';
  return 'unknown';
}

// True when the device state permits full interaction (tunnels, SSH, VNC, etc.).
// Maintenance mode is a transient admin state — the device is still reachable,
// so treat it the same as online for feature gating.
export function isInteractive(raw) {
  if (raw == null) return false;
  const v = stripPrefix(raw).toLowerCase();
  return v === 'online' || v === 'maintenance_mode' || v === 'maintenance';
}
