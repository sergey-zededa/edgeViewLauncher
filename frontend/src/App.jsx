import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SearchNodes, ConnectToNode, GetSettings, SaveSettings, GetDeviceServices, SetupSSH, GetSSHStatus, DisableSSH, SetVGAEnabled, SetUSBEnabled, SetConsoleEnabled, ResetEdgeView, VerifyTunnel, GetUserInfo, GetEnterprise, GetProjects, GetSessionStatus, GetConnectionProgress, GetAppInfo, StartTunnel, CloseTunnel, ListTunnels, AddRecentDevice, VerifyToken, OnUpdateAvailable, OnUpdateNotAvailable, OnUpdateDownloadProgress, OnUpdateDownloaded, OnUpdateError, DownloadUpdate, InstallUpdate, SecureStorageStatus, SecureStorageMigrate, SecureStorageGetSettings, SecureStorageSaveSettings, StartCollectInfo, GetCollectInfoStatus, SaveCollectInfo } from './electronAPI';
import { Search, Settings, Server, Activity, Save, Monitor, ArrowLeft, Terminal, Globe, Lock, Unlock, AlertTriangle, ChevronDown, X, Plus, Check, AlertCircle, Cpu, Wifi, HardDrive, Clock, Hash, ExternalLink, Copy, Play, RefreshCw, Trash2, ArrowRight, Info, Download, Box, Layers } from 'lucide-react';
import eveOsIcon from './assets/eve-os.png';
import Tooltip from './components/Tooltip';
import About from './components/About';
import UpdateBanner from './components/UpdateBanner';
import GlobalStatusBanner from './components/GlobalStatusBanner';
import Modal from './components/Modal';
import Button from './components/Button';
import Badge from './components/Badge';
import './components/Tooltip.css';
import './App.css';

// Simple component to display version info
function VersionDisplay() {
  const [versionInfo, setVersionInfo] = React.useState(null);

  React.useEffect(() => {
    window.electronAPI.getElectronAppInfo().then(info => {
      setVersionInfo(info);
    }).catch(err => {
      console.error('Failed to get version info:', err);
    });
  }, []);

  if (!versionInfo) return 'Loading...';

  return (
    <span>
      {versionInfo.version}
      {versionInfo.buildNumber !== 'dev' && ` (Build ${versionInfo.buildNumber})`}
    </span>
  );
}

// Custom Select Component for Port Selection
// Custom Select Component for Port Selection
const PortSelect = ({ ports, selectedValue, onChange, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      // Logic handled via backdrop in portal, but kept for trigger safety
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        // Only close if not clicking inside the portal (handled separately)
      }
    };
    /* Window resize handler to close dropdown if open */
    const handleResize = () => setIsOpen(false);

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleDropdown = () => {
    if (!isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
    setIsOpen(!isOpen);
  };

  const selectedPort = ports.find(p => p.publicPort.toString() === selectedValue.toString());

  return (
    <div className="custom-select-container" ref={dropdownRef} style={{ position: 'relative', flex: 1 }}>
      <div
        className="custom-select-trigger"
        onClick={toggleDropdown}
        style={{
          padding: '8px 12px',
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '4px',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '13px',
          userSelect: 'none'
        }}
      >
        <span style={{ color: selectedValue ? '#fff' : '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selectedPort
            ? `${selectedPort.publicPort} (Ext) → ${selectedPort.privatePort} (${selectedPort.containerName})`
            : placeholder}
        </span>
        <ChevronDown size={14} style={{ color: '#888', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>

      {isOpen && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998, cursor: 'default' }}
            onClick={() => setIsOpen(false)}
          />
          <div className="custom-select-options" style={{
            position: 'fixed',
            top: coords.top + 4,
            left: coords.left,
            width: coords.width,
            backgroundColor: '#1e1e1e',
            border: '1px solid #333',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 9999,
            maxHeight: '300px', // Increased height since it breaks out of modal
            overflowY: 'auto'
          }}>
            {ports.length === 0 ? (
              <div style={{ padding: '8px 12px', color: '#666', fontSize: '12px' }}>No exposed ports</div>
            ) : (
              ports.map((pm, idx) => (
                <div
                  key={idx}
                  className="custom-option"
                  onClick={() => {
                    onChange(pm.publicPort);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: '#ccc',
                    borderBottom: idx < ports.length - 1 ? '1px solid #2a2a2a' : 'none',
                    transition: 'background 0.1s'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#2a2a2a'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ color: '#fff', fontWeight: '500' }}>{pm.publicPort}</span>
                      <span style={{ color: '#666' }}>→</span>
                      <span style={{ color: '#999' }}>{pm.privatePort}</span>
                    </div>
                    {/* Consistent coloring: Container name in Blue to match main list logic */}
                    <div style={{ fontSize: '11px', color: 'var(--color-accent)', marginLeft: '12px' }}>{pm.containerName}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

// Copyable Text Component
const Copyable = ({ text, children, style = {} }) => {
  const [showCopy, setShowCopy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span 
      onMouseEnter={() => setShowCopy(true)}
      onMouseLeave={() => setShowCopy(false)}
      style={{ 
        position: 'relative', 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: '4px',
        userSelect: 'text',
        cursor: 'text',
        ...style
      }}
      onClick={(e) => e.stopPropagation()} // Prevent row click
    >
      {children || text}
      <span 
        onClick={handleCopy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: showCopy || copied ? 1 : 0,
          transition: 'opacity 0.2s',
          color: copied ? '#238636' : 'var(--text-secondary)',
          padding: '2px',
          borderRadius: '4px',
          backgroundColor: showCopy ? 'rgba(255,255,255,0.1)' : 'transparent'
        }}
        title="Copy to clipboard"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </span>
    </span>
  );
};

function App() {
  const [config, setConfig] = useState({ baseUrl: '', apiToken: '', clusters: [], activeCluster: '' });
  const [query, setQuery] = useState('');
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [authError, setAuthError] = useState(false); // Track authentication failures
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [enterprise, setEnterprise] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [projects, setProjects] = useState([]);

  // Device Details State
  const [services, setServices] = useState(null);
  const [loadingServices, setLoadingServices] = useState(false);
  const [sshStatus, setSshStatus] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [loadingSSH, setLoadingSSH] = useState(false);
  const [expandedServiceId, setExpandedServiceId] = useState(null);
  const [expandedServiceContainers, setExpandedServiceContainers] = useState({});
  const [highlightTunnels, setHighlightTunnels] = useState(false);
  const [activeTunnels, setActiveTunnels] = useState([]); // Track active tunnels across all devices
  const [showGlobalTunnels, setShowGlobalTunnels] = useState(false);
  const [tunnelConnected, setTunnelConnected] = useState(false);
  const [tunnelLoading, setTunnelLoading] = useState(null);
  // Removed loadingMessage and tunnelLoadingMessage in favor of globalStatus
  const [sshUser, setSshUser] = useState('root');
  const [sshPassword, setSshPassword] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshTunnelConfig, setSshTunnelConfig] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [localPort, setLocalPort] = useState(null);
  const [tcpTunnelConfig, setTcpTunnelConfig] = useState(null); // { ip, appName }
  const [tcpPortInput, setTcpPortInput] = useState('');
  const [tcpIpInput, setTcpIpInput] = useState('');
  const [tcpError, setTcpError] = useState('');

  // Update state
  const [updateState, setUpdateState] = useState({
    status: 'not-available', // 'not-available', 'available', 'downloading', 'downloaded', 'error', 'dismissed'
    version: null,
    downloadProgress: 0,
    error: null
  });

  // Secure storage migration state
  const [migrationState, setMigrationState] = useState({
    needed: false,
    inProgress: false,
    completed: false,
    error: null,
    encryptionAvailable: true
  });

  // Dropdown state
  const [showTerminalMenu, setShowTerminalMenu] = useState(false);
  const [showVncMenu, setShowVncMenu] = useState(false);
  const [vncMenuAppId, setVncMenuAppId] = useState(null);
  const dropdownRef = useRef(null);

  // SSH quick-connect popover state
  const [sshPopover, setSshPopover] = useState(null);
  const [shellPrompt, setShellPrompt] = useState(null); // { containerName: string, username: string }

  // Helper for starting container shell
  const handleContainerShell = async (app, c, username = 'root', password = '') => {
    // Determine App IP:
    // For Docker Compose, we need the runtime IP (VM IP).
    // 1. Try to find it in the port mappings first.

    console.log('[DEBUG-SHELL] Analyzing App:', {
      id: app.id,
      name: app.name,
      type: app.appType,
      ips: app.ips,
      internalIps: app.internalIps
    });

    // Derive servicesList from state
    const servicesList = Array.isArray(services) ? services : (services?.services || []);

    let targetAppIp = null;

    // STRATEGY CHANGE: For Docker Compose, PREFER correlation over PortMaps to find the Internal (Airgapped) IP.
    // PortMaps often contain the External IP (e.g. 192.168.x.x) which is not reachable via SSH tunnel.
    if (app.appType === 'APP_TYPE_DOCKER_COMPOSE') {
      console.log('[DEBUG-SHELL] Accessing correlation logic for Docker Compose app (PRIORITY)');
      const appExternalIps = app.ips || [];
      console.log('[DEBUG-SHELL] App External IPs:', appExternalIps);

      // Find sibling app that:
      // - Shares at least one External IP with this app
      // - Has an Internal IP (identified by backend via airgapped network)
      const runtimeApp = servicesList.find(otherApp => {
        if (otherApp.id === app.id) return false;

        const otherIps = otherApp.ips || [];
        const hasSharedIp = otherIps.some(ip => appExternalIps.includes(ip));
        const hasInternalIps = otherApp.internalIps && otherApp.internalIps.length > 0;

        // Log candidates for debugging
        if (hasSharedIp) {
          console.log('[DEBUG-SHELL] Candidate Sibling:', {
            name: otherApp.name,
            sharedIp: true,
            hasInternalIps: hasInternalIps,
            internalIps: otherApp.internalIps
          });
        }

        return hasSharedIp && hasInternalIps;
      });

      if (runtimeApp) {
        targetAppIp = runtimeApp.internalIps[0];
        console.log('[DEBUG-SHELL] Found deterministic Runtime IP via correlation:', targetAppIp, 'from app:', runtimeApp.name);
        addLog(`Found deterministic Runtime IP via correlation: ${targetAppIp}`, 'info');
      } else {
        console.log('[DEBUG-SHELL] Correlation failed: No matching sibling app found with Internal IPs. Trying heuristic fallback...');

        // Fallback: Find sibling that shares IP, and pick its OTHER ip (heuristic)
        const fallbackApp = servicesList.find(otherApp => {
          if (otherApp.id === app.id) return false;
          const otherIps = otherApp.ips || [];
          return otherIps.some(ip => appExternalIps.includes(ip));
        });

        if (fallbackApp) {
          const otherIps = fallbackApp.ips || [];
          // Find IP that is NOT in appExternalIps
          const uniqueIps = otherIps.filter(ip => !appExternalIps.includes(ip));
          if (uniqueIps.length > 0) {
            targetAppIp = uniqueIps[0];
            console.log('[DEBUG-SHELL] Found Runtime IP via Heuristic (Non-Shared IP):', targetAppIp, 'from app:', fallbackApp.name);
            addLog(`Found Runtime IP via Heuristic: ${targetAppIp}`, 'info');
          }
        }

        if (!targetAppIp) {
          console.log('[DEBUG-SHELL] Heuristic fallback failed.');
          // Log all services for deep debugging
          console.log('[DEBUG-SHELL] All Available Services:', servicesList.map(s => ({
            name: s.name,
            ips: s.ips,
            internalIps: s.internalIps
          })));
        }
      }

    }

    // Fallback: Check PortMaps (for non-Compose or if correlation failed)
    if (!targetAppIp && c.portMaps && c.portMaps.length > 0) {
      const pmWithRuntime = c.portMaps.find(pm => pm.runtimeIp);
      if (pmWithRuntime) {
        targetAppIp = pmWithRuntime.runtimeIp;
        console.log('[DEBUG-SHELL] Found Runtime IP in PortMap:', targetAppIp);
      }
    }

    // Final Fallback: Use first available app IP
    if (!targetAppIp && app.ips && app.ips.length > 0) {
      targetAppIp = app.ips[0];
      console.log('[DEBUG-SHELL] Fallback to App IP:', targetAppIp);
    }

    console.log('[DEBUG-SHELL] Final StartContainerShell Params:', {
      nodeId: selectedNode.id,
      appName: app.name,
      containerName: c.containerName,
      appType: app.appType,
      targetAppIp,
      username
    });

    setTunnelLoading(`shell-${c.containerName}`);
    setGlobalStatus({ type: 'loading', message: `Opening shell in ${c.containerName}...` });
    addLog(`Opening shell in container: ${c.containerName}`, 'info');

    let pollInterval = null;
    try {
      // Poll progress for shell connection
      pollInterval = setInterval(async () => {
        try {
          const progress = await GetConnectionProgress(selectedNode.id);
          if (progress && progress.status) {
            setGlobalStatus({ type: 'loading', message: progress.status });
          }
        } catch (e) { /* ignore */ }
      }, 500);

      const result = await window.electronAPI.startContainerShell(
        selectedNode.id,
        app.name,
        c.containerName,
        '/bin/sh', // default shell
        app.appType,
        targetAppIp,
        username,
        password,
        app.id // Pass App ID (UUID) for container name resolution
      );
      clearInterval(pollInterval);
      pollInterval = null;

      if (result.success) {
        addLog(`Container shell opened for ${c.containerName}`, 'success');
      } else {
        addLog(`Failed to open shell: ${result.error}`, 'error');
      }
    } catch (err) {
      if (pollInterval) clearInterval(pollInterval);
      addLog(`Failed to open shell: ${err.message}`, 'error');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setTunnelLoading(null);
      setGlobalStatus(null);
    }
  }; // { ip, appName, username }
  const sshPopoverRef = useRef(null);

  // Settings editing state
  const [editingCluster, setEditingCluster] = useState({ name: '', baseUrl: '', apiToken: '' });
  const [viewingClusterName, setViewingClusterName] = useState('');
  const [viewingUserInfo, setViewingUserInfo] = useState(null);
  const [loadingTokenInfo, setLoadingTokenInfo] = useState(false);
  const [showTokenStatus, setShowTokenStatus] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [tokenStatus, setTokenStatus] = useState(null);
  const [settingsError, setSettingsError] = useState(null); // Track settings save errors
  const [globalStatus, setGlobalStatus] = useState(null);
  const [sshError, setSshError] = useState(null);
  // Last SSH update timestamp
  const [lastSSHUpdate, setLastSSHUpdate] = useState(0);

  // Collect Info State (removed modal state, kept only for tracking job if needed, but logic is moved to global status)
  // Actually we need to track jobId to poll status.
  const collectInfoJobRef = useRef(null);

  const handleTokenPaste = (token) => {
    setEditingCluster({ ...editingCluster, apiToken: token });
    // Token verification disabled - will be re-enabled in future
    setTokenStatus(null);
  };

  // Sync tunnels on node selection (polling + diff-based logging)
  useEffect(() => {
    if (!selectedNode) {
      // Keep activeTunnels as a global list across navigation.
      return;
    }

    let cancelled = false;

    const fetchTunnels = async () => {
      if (!selectedNode || cancelled) return;
      try {
        const tunnels = await ListTunnels(selectedNode.id);

        if (tunnels === null) {
          // Special case: transport-level oddity (empty body). We keep the
          // current activeTunnels state and avoid treating this as a closure.
          return;
        }

        if (!Array.isArray(tunnels)) {
          return;
        }

        const mapped = tunnels.map(t => {
          const rawTarget = t.TargetIP || '';
          const [ipPart, portPart] = rawTarget.split(':');
          const targetPort = parseInt(portPart || '0', 10);

          // Derive a more user-friendly tunnel type for well-known ports.
          let type = t.Type || 'TCP';
          if (type === 'TCP') {
            if (targetPort === 22) {
              type = 'SSH';
            } else if (targetPort === 5900) {
              type = 'VNC';
            }
          }

          return {
            id: t.ID,
            nodeId: t.NodeID,
            nodeName: t.NodeName || selectedNode.name,
            projectId: t.ProjectID || selectedNode.project,
            type,
            targetIP: ipPart || '',
            targetPort,
            localPort: t.LocalPort,
            createdAt: t.CreatedAt,
            status: t.Status || 'active',
            error: t.Error || '',
            isEncrypted: t.IsEncrypted,
            bytesSent: t.BytesSent || 0,
            bytesReceived: t.BytesReceived || 0,
            lastActivity: t.LastActivity ? new Date(t.LastActivity).getTime() : 0,
          };
        });

        setActiveTunnels(prev => {
          // Compute diffs for activity logging (per-node)
          const prevForNode = prev.filter(t => t.nodeId === selectedNode.id);
          const prevIds = new Set(prevForNode.map(t => t.id));
          const newIds = new Set(mapped.map(t => t.id));

          // New tunnels detected by polling
          mapped.forEach(t => {
            if (!prevIds.has(t.id)) {
              addLog(`Tunnel active: ${t.type} localhost:${t.localPort} -> ${t.targetIP}:${t.targetPort}`, 'info');
            }
          });

          // Tunnels that transitioned to failed state
          const prevById = new Map(prevForNode.map(t => [t.id, t]));
          mapped
            .filter(t => t.status === 'failed')
            .forEach(t => {
              const prevT = prevById.get(t.id);
              if (!prevT || prevT.status !== 'failed') {
                const reason = t.error || 'device is not connected to EdgeView (no device online)';
                addLog(
                  `Tunnel failed: ${t.type} localhost:${t.localPort} -> ${t.targetIP}:${t.targetPort} — ${reason}`,
                  'error'
                );
              }
            });

          // Closed tunnels detected by polling (IDs no longer present)
          prevForNode.forEach(t => {
            if (!newIds.has(t.id)) {
              addLog(`Tunnel closed: ${t.type} localhost:${t.localPort} -> ${t.targetIP}:${t.targetPort}`, 'closed');
            }
          });

          // Merge: keep tunnels for other nodes + updated list for this node
          const others = prev.filter(t => t.nodeId !== selectedNode.id);
          return [...others, ...mapped];
        });
      } catch (err) {
        console.error('Failed to list tunnels:', err);
      }
    };

    // Initial fetch
    fetchTunnels();
    // Poll every 5 seconds while this node is selected
    const intervalId = setInterval(fetchTunnels, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [selectedNode]);

  // Polling for device services (every 15-60 seconds while a node is selected)
  // This ensures VNC details and real-time status are updated as background enrichment finishes.
  useEffect(() => {
    if (!selectedNode || showSettings) {
      return;
    }

    let intervalId = null;
    let currentInterval = 15000;

    const pollServices = async () => {
      try {
        const result = await GetDeviceServices(selectedNode.id, selectedNode.name);
        if (!result) return;

        try {
          const parsed = JSON.parse(result);
          const servicesList = parsed.services || [];

          setServices(prev => {
            if (!prev) return parsed;
            const currentStr = JSON.stringify(prev);
            const newStr = JSON.stringify(parsed);
            if (currentStr !== newStr) return parsed;
            return prev;
          });

          // SMART POLLING: Check if we have "complete" data for all running services
          const isComplete = servicesList.length > 0 && servicesList.every(s => {
            if (s.status?.toUpperCase() !== 'RUNNING') return true;
            const hasIPs = s.ips && s.ips.length > 0;
            const isVM = s.appType === 'APP_TYPE_VM';
            const hasVNC = s.vncPort > 0;
            return hasIPs && (!isVM || hasVNC);
          });

          if (isComplete && currentInterval !== 60000) {
            console.log('Enrichment complete, slowing down poll to 60s');
            currentInterval = 60000;
            if (intervalId) clearInterval(intervalId);
            intervalId = setInterval(pollServices, currentInterval);
          }
        } catch (e) {
          console.error('Failed to parse polled services:', e);
        }
      } catch (err) {
        console.error('Service polling failed:', err);
      }
    };

    // Start polling immediately
    pollServices();
    intervalId = setInterval(pollServices, currentInterval);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [selectedNode, showSettings]);

  // Background device list refresh (every 30 seconds)
  useEffect(() => {
    // Only refresh when viewing the device list (not in settings, not viewing a device)
    if (showSettings || selectedNode) {
      return;
    }

    // Set up interval to refresh device list every 30 seconds
    const refreshInterval = setInterval(async () => {
      try {
        // Silent refresh - don't set loading state to avoid UI flicker
        const results = await SearchNodes(query);
        setNodes(results || []);
        // Preserve selectedIndex to maintain user's position in the list
      } catch (err) {
        console.error('Background device list refresh failed:', err);
        // Silently fail - don't disrupt user experience
      }
    }, 30000); // 30 seconds

    return () => {
      clearInterval(refreshInterval);
    };
  }, [query, showSettings, selectedNode]);


  const fetchViewingUserInfo = async (cluster) => {
    if (!cluster || !cluster.apiToken || !cluster.baseUrl) {
      setViewingUserInfo(null);
      setTokenStatus(null);
      return;
    }

    setLoadingTokenInfo(true);

    // Use VerifyToken directly to check the specific cluster credentials
    try {
      // Don't set loading state here to avoid flickering, just update when done
      const info = await VerifyToken(cluster.apiToken, cluster.baseUrl);

      if (info.valid) {
        setViewingUserInfo({
          tokenOwner: info.subject,
          tokenExpiry: info.expiresAt,
          tokenRole: info.role,
          lastLogin: info.lastLogin
        });
        setTokenStatus({ valid: true, message: 'Token valid' });
      } else {
        setViewingUserInfo(null);
        setTokenStatus({ valid: false, message: info.error || 'Invalid token' });
      }
    } catch (err) {
      console.error('Failed to verify token:', err);
      setViewingUserInfo(null);
      setTokenStatus({ valid: false, message: 'Verification failed' });
    } finally {
      setLoadingTokenInfo(false);
    }
  };

  // Sync editingCluster with activeCluster when settings open and load user info
  useEffect(() => {
    if (showSettings) {
      // If we are opening settings, default to viewing the active cluster
      // Note: We avoid including config in dependencies to prevent overriding user selection
      // when adding/removing clusters.
      setViewingClusterName(config.activeCluster);
      const active = config.clusters.find(c => c.name === config.activeCluster);
      if (active) {
        setEditingCluster({ ...active });
        fetchViewingUserInfo(active);
      }
    }
  }, [showSettings]);

  // Helper to format relative time
  const getRelativeTime = (timestamp) => {
    const now = Date.now();
    const diff = timestamp - now;
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // SSH username persistence helpers (per-app)
  const getSavedSshUsername = (appName) => {
    try {
      const saved = localStorage.getItem(`ssh-username-${appName}`);
      return saved || 'root';
    } catch {
      return 'root';
    }
  };

  const saveSshUsername = (appName, username) => {
    try {
      localStorage.setItem(`ssh-username-${appName}`, username);
    } catch (err) {
      console.warn('Failed to save SSH username:', err);
    }
  };

  // Helper to format bytes
  const formatBytes = (bytes, decimals = 1) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Derive a unified EdgeView expiry timestamp (ms since epoch) from
  // either sessionStatus or sshStatus, and whether it is already expired.
  const getExpiryInfo = () => {
    let ts = null;
    if (sessionStatus && sessionStatus.expiresAt) {
      ts = new Date(sessionStatus.expiresAt).getTime();
    } else if (sshStatus && sshStatus.expiry) {
      const parsed = parseInt(sshStatus.expiry, 10);
      if (!Number.isNaN(parsed)) {
        ts = parsed * 1000;
      }
    }
    if (!ts) {
      return { timestamp: null, expired: false, label: '-', colorClass: '' };
    }
    const now = Date.now();
    const diff = ts - now;
    const expired = diff <= 0;

    // Color coding: Green (>30min), Yellow (0-30min), Red (expired)
    let colorClass = '';
    if (expired) {
      colorClass = 'error'; // Red
    } else if (diff < 30 * 60 * 1000) {
      colorClass = 'mismatch'; // Yellow
    } else {
      colorClass = 'success'; // Green
    }

    return {
      timestamp: ts,
      expired,
      label: expired ? 'Expired' : getRelativeTime(ts),
      colorClass,
    };
  };

  const expiryInfo = getExpiryInfo();
  const sessionExpired = expiryInfo.expired;
  // Session is connected if we have a valid active session (non-expired with timestamp)
  // tunnelConnected is just a bonus verification, not required
  const isSessionConnected = !sessionExpired && expiryInfo.timestamp !== null;

  // State for time format preference
  const [use24HourTime, setUse24HourTime] = useState(false);

  useEffect(() => {
    // Fetch system time format preference on mount
    const checkTimeFormat = async () => {
      try {
        const is24h = await window.electronAPI.getSystemTimeFormat();

        if (is24h !== null) {
          setUse24HourTime(is24h);
        } else {
          // Fallback to browser detection if native check returns null (e.g. non-macOS)
          const opts = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();

          if (opts.hourCycle) {
            setUse24HourTime(opts.hourCycle.startsWith('h2')); // h23 or h24 means 24-hour
          } else if (opts.hour12 !== undefined) {
            setUse24HourTime(!opts.hour12);
          }
        }
      } catch (err) {
        console.error('Failed to check time format:', err);
      }
    };
    checkTimeFormat();
  }, []);

  // Auto-update event listeners
  useEffect(() => {
    const cleanupUpdateAvailable = OnUpdateAvailable((info) => {
      console.log('Update available:', info.version);
      setUpdateState({
        status: 'available',
        version: info.version,
        downloadProgress: 0,
        error: null
      });
    });

    const cleanupUpdateNotAvailable = OnUpdateNotAvailable((info) => {
      console.log('Update not available');
      setUpdateState(prev => ({ ...prev, status: 'not-available' }));
    });

    const cleanupDownloadProgress = OnUpdateDownloadProgress((progress) => {
      setUpdateState(prev => ({
        ...prev,
        status: 'downloading',
        downloadProgress: Math.round(progress.percent)
      }));
    });

    const cleanupUpdateDownloaded = OnUpdateDownloaded((info) => {
      console.log('Update downloaded:', info.version);
      setUpdateState(prev => ({
        ...prev,
        status: 'downloaded',
        downloadProgress: 100
      }));
    });

    const cleanupUpdateError = OnUpdateError((error) => {
      console.error('Update error:', error);
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: error || 'Unknown error occurred'
      }));
    });

    return () => {
      cleanupUpdateAvailable();
      cleanupUpdateNotAvailable();
      cleanupDownloadProgress();
      cleanupUpdateDownloaded();
      cleanupUpdateError();
    };
  }, []);

  // Helper to detect user's time format preference (12h vs 24h)
  const getTimeFormatOptions = () => {
    return { hour12: !use24HourTime };
  };

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString(undefined, getTimeFormatOptions());
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  // Extract user-friendly error message from API errors
  const extractErrorMessage = (err) => {
    const fullMessage = err.message || String(err);
    // Remove "Error invoking remote method 'api-call': Error: " prefix
    let cleaned = fullMessage
      .replace(/^Error invoking remote method '[^']+': Error: /, '')
      .replace(/^Error: /, '');

    // Map common low-level errors to user-friendly messages
    if (cleaned.includes('websocket: close 1006')) {
      cleaned = 'Connection closed unexpectedly (device might be offline or busy)';
    } else if (cleaned.includes('i/o timeout')) {
      cleaned = 'Connection timed out (network might be slow or unstable)';
    } else if (cleaned.includes('404 Not Found')) {
      cleaned = 'Resource not found on server';
    } else if (cleaned.includes('500 Internal Server Error')) {
      cleaned = 'Server encountered an internal error';
    }

    return cleaned;
  };

  // Tunnel management functions
  const addTunnel = (type, targetIP, targetPort, localPort, tunnelId, username = '') => {
    const tunnel = {
      id: tunnelId,
      nodeId: selectedNode?.id,
      nodeName: selectedNode?.name,
      projectId: selectedNode?.project,
      type,
      targetIP,
      targetPort,
      localPort,
      username,
      createdAt: new Date().toISOString(),
      bytesSent: 0,
      bytesReceived: 0,
      lastActivity: 0
    };
    setActiveTunnels(prev => [...prev, tunnel]);
    return tunnel;
  };

  const startCustomTunnel = async () => {
    if (!tcpTunnelConfig || !selectedNode) return;

    const port = parseInt(tcpPortInput, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      setTcpError('Enter a valid port between 1 and 65535');
      return;
    }

    const ip = tcpIpInput.trim();
    if (!ip) {
      setTcpError('Enter a valid IP address');
      return;
    }

    let pollInterval = null;
    try {
      setTcpError('');
      setTunnelLoading('tcp');
      setGlobalStatus({ type: 'loading', message: `Starting TCP tunnel to ${ip}:${port}...` });
      addLog(`Starting TCP tunnel to ${ip}:${port}...`, 'info');

      // Poll progress
      pollInterval = setInterval(async () => {
        try {
          const progress = await GetConnectionProgress(selectedNode.id);
          if (progress && progress.status) {
            setGlobalStatus({ type: 'loading', message: progress.status });
          }
        } catch (e) { /* ignore */ }
      }, 500);

      const result = await StartTunnel(selectedNode.id, ip, port);
      clearInterval(pollInterval);
      pollInterval = null;

      const localPort = result.port || result;
      const tunnelId = result.tunnelId;

      addLog(`TCP tunnel active: localhost:${localPort} -> ${ip}:${port}`, 'success');
      addTunnel('TCP', ip, port, localPort, tunnelId);
      setHighlightTunnels(true);
      setTimeout(() => setHighlightTunnels(false), 2000);

      setTcpTunnelConfig(null);
      setTcpPortInput('');
      setTcpIpInput('');

      // Refresh session status to reflect potential encryption updates
      await loadSSHStatus(selectedNode.id, false);

      const newConfig = await GetSettings();
      // handleTunnelError(err); // Removed invalid call
    } catch (err) {
      if (pollInterval) clearInterval(pollInterval);
      console.error(err);
      handleTunnelError(err);
      const msg = err.message || String(err);
      setTcpError(msg);
      addLog(`Failed to start TCP tunnel: ${msg}`, 'error');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setTunnelLoading(null);
      setGlobalStatus(null);
    }
  };

  // Quick tunnel start - bypasses modal, used for clickable port shortcuts
  const startQuickTunnel = async (ip, port) => {
    if (!selectedNode) return;

    const tunnelKey = `tcp-${ip}-${port}`;
    let pollInterval = null;
    try {
      setTunnelLoading(tunnelKey);
      setGlobalStatus({ type: 'loading', message: `Starting TCP tunnel to ${ip}:${port}...` });
      addLog(`Starting TCP tunnel to ${ip}:${port}...`, 'info');

      // Poll progress
      pollInterval = setInterval(async () => {
        try {
          const progress = await GetConnectionProgress(selectedNode.id);
          if (progress && progress.status) {
            setGlobalStatus({ type: 'loading', message: progress.status });
          }
        } catch (e) { /* ignore */ }
      }, 500);

      const result = await StartTunnel(selectedNode.id, ip, port);
      clearInterval(pollInterval);
      pollInterval = null;

      const localPort = result.port || result;
      const tunnelId = result.tunnelId;

      addLog(`TCP tunnel active: localhost:${localPort} -> ${ip}:${port}`, 'success');
      addTunnel('TCP', ip, port, localPort, tunnelId);
      setHighlightTunnels(true);
      setTimeout(() => setHighlightTunnels(false), 2000);

      setGlobalStatus({ type: 'success', message: `Tunnel ready: localhost:${localPort}`, duration: 3000 });
    } catch (err) {
      if (pollInterval) clearInterval(pollInterval);
      console.error(err);
      handleTunnelError(err);
      addLog(`Failed to start TCP tunnel: ${err.message || err}`, 'error');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setTunnelLoading(null);
      setGlobalStatus(null);
    }
  };

  // Quick VNC start - bypasses menu, used for clickable VNC port shortcuts
  const startQuickVnc = async (ip, port, appName) => {
    if (!selectedNode) return;

    let pollInterval = null;
    try {
      setTunnelLoading('vnc');
      setGlobalStatus({ type: 'loading', message: `Starting VNC connection to ${ip}:${port}...` });
      addLog(`Starting VNC tunnel to ${ip}:${port}...`, 'info');

      // Poll progress
      pollInterval = setInterval(async () => {
        try {
          const progress = await GetConnectionProgress(selectedNode.id);
          if (progress && progress.status) {
            setGlobalStatus({ type: 'loading', message: progress.status });
          }
        } catch (e) { /* ignore */ }
      }, 500);

      const result = await StartTunnel(selectedNode.id, ip, port, 'vnc');
      clearInterval(pollInterval);
      pollInterval = null;

      const localPort = result.port || result;
      const tunnelId = result.tunnelId;

      addLog(`VNC tunnel active: localhost:${localPort} -> ${ip}:${port}`, 'success');
      addTunnel('VNC', ip, port, localPort, tunnelId);

      // Open VNC viewer window
      await window.electronAPI.openVncWindow({
        port: localPort,
        nodeName: selectedNode.name,
        appName: appName || 'VNC',
        tunnelId
      });

      setGlobalStatus({ type: 'success', message: `VNC connected on localhost:${localPort}`, duration: 3000 });
    } catch (err) {
      if (pollInterval) clearInterval(pollInterval);
      console.error(err);
      handleTunnelError(err);
      addLog(`Failed to start VNC: ${err.message || err}`, 'error');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setTunnelLoading(null);
      setGlobalStatus(null);
    }
  };

  // Quick SSH start - bypasses modal, opens built-in terminal with specified/saved username
  const startQuickSsh = async (ip, appName, username = 'root') => {
    if (!selectedNode) return;

    // Save username for this app
    if (appName) {
      saveSshUsername(appName, username);
    }

    let pollInterval = null;
    try {
      setTunnelLoading('ssh');
      setGlobalStatus({ type: 'loading', message: `Starting SSH connection to ${username}@${ip}...` });
      addLog(`Starting SSH tunnel to ${username}@${ip}:22...`, 'info');

      // Poll progress
      pollInterval = setInterval(async () => {
        try {
          const progress = await GetConnectionProgress(selectedNode.id);
          if (progress && progress.status) {
            setGlobalStatus({ type: 'loading', message: progress.status });
          }
        } catch (e) { /* ignore */ }
      }, 500);

      const result = await StartTunnel(selectedNode.id, ip, 22);
      clearInterval(pollInterval);
      pollInterval = null;

      const localPort = result.port || result;
      const tunnelId = result.tunnelId;

      addLog(`SSH tunnel active: localhost:${localPort} -> ${ip}:22`, 'success');
      addTunnel('SSH', ip, 22, localPort, tunnelId, username);

      // Open built-in terminal
      await window.electronAPI.openTerminalWindow({
        port: localPort,
        nodeName: selectedNode.name,
        targetInfo: `${username}@${ip}:22`,
        tunnelId,
        username
      });

      setGlobalStatus({ type: 'success', message: `SSH connected on localhost:${localPort}`, duration: 3000 });
    } catch (err) {
      if (pollInterval) clearInterval(pollInterval);
      console.error(err);
      handleTunnelError(err);
      addLog(`Failed to start SSH: ${err.message || err}`, 'error');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setTunnelLoading(null);
      setGlobalStatus(null);
    }
  };

  const startSshModalTunnel = async (mode = 'builtin') => {
    if (!sshTunnelConfig || !selectedNode) return;
    setSshError(null);
    const { ip } = sshTunnelConfig;
    if (!ip) {
      addLog('No SSH target IP configured', 'error');
      return;
    }

    const targetPort = parseInt(sshPort, 10);
    if (Number.isNaN(targetPort) || targetPort <= 0 || targetPort > 65535) {
      setSshError('Enter a valid port between 1 and 65535');
      return;
    }

    let pollInterval = null;
    try {
      if (sshTunnelConfig.appName) {
        saveSshUsername(sshTunnelConfig.appName, sshUser);
      }
      setTunnelLoading('ssh');
      const sshTarget = ip;
      setGlobalStatus({ type: 'loading', message: `Starting SSH tunnel to ${sshTarget}:${targetPort}...` });
      addLog(`Starting SSH tunnel to ${sshTarget}:${targetPort}...`, 'info');

      // Poll progress
      pollInterval = setInterval(async () => {
        try {
          const progress = await GetConnectionProgress(selectedNode.id);
          if (progress && progress.status) {
            setGlobalStatus({ type: 'loading', message: progress.status });
          }
        } catch (e) { /* ignore */ }
      }, 500);

      const result = await StartTunnel(selectedNode.id, sshTarget, targetPort);
      clearInterval(pollInterval);
      pollInterval = null;

      const localPort = result.port || result;
      const tunnelId = result.tunnelId;

      addLog(`SSH tunnel active on localhost:${localPort}`, 'success');
      addTunnel('SSH', sshTarget, targetPort, localPort, tunnelId, sshUser);
      setHighlightTunnels(true);
      setTimeout(() => setHighlightTunnels(false), 2000);

      const sshCommand = `ssh -p ${localPort} ${sshUser}@localhost`;
      addLog(`Command: ${sshCommand}`, 'info');

      setExpandedServiceId(null);

      if (mode === 'native') {
        await window.electronAPI.openExternalTerminal(sshCommand);
        addLog('Launched native terminal', 'success');
      } else if (mode === 'builtin') {
        await window.electronAPI.openTerminalWindow({
          port: localPort,
          nodeName: selectedNode.name,
          targetInfo: `${sshUser}@${selectedNode.name}`,
          tunnelId: tunnelId,
          username: sshUser,
          password: sshPassword
        });
      } else {
        // Tunnel only
        addLog(`SSH Tunnel ready. Connect with: ${sshCommand}`, 'success');
      }

      setSshTunnelConfig(null);
      setSshPassword(''); // Clear password
      setSshPort('22'); // Reset port

      // Refresh session status to reflect potential encryption updates
      await loadSSHStatus(selectedNode.id, false);
    } catch (err) {
      if (pollInterval) clearInterval(pollInterval);
      console.error(err);
      handleTunnelError(err);
      setSshError(err.message);
      addLog(`Failed to start SSH tunnel: ${err.message}`, 'error');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setTunnelLoading(null);
      setGlobalStatus(null);
    }
  };

  const removeTunnel = async (tunnelId) => {
    try {
      const tunnel = activeTunnels.find(t => t.id === tunnelId);
      await CloseTunnel(tunnelId);
      setActiveTunnels(prev => prev.filter(t => t.id !== tunnelId));

      if (tunnel) {
        addLog(`Tunnel closed: ${tunnel.type} localhost:${tunnel.localPort} -> ${tunnel.targetIP}:${tunnel.targetPort}`, 'closed');
      } else {
        addLog(`Tunnel closed`, 'closed');
      }
    } catch (err) {
      console.error(err);
      addLog(`Failed to close tunnel: ${err.message}`, 'error');
      setActiveTunnels(prev => prev.filter(t => t.id !== tunnelId));
    }
  };

  const StopTunnel = removeTunnel; // Alias

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowTerminalMenu(false);
        setShowVncMenu(false);
        setVncMenuAppId(null);
      }
      // Close SSH popover when clicking outside
      if (sshPopoverRef.current && !sshPopoverRef.current.contains(event.target)) {
        setSshPopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Helper to detect if error is session-related and update status
  const handleTunnelError = (err) => {
    const errorMsg = err.message || String(err);
    // Detect session-related errors
    if (errorMsg.includes('no active session') ||
      errorMsg.includes('failed to create one') ||
      errorMsg.includes('failed to enable EdgeView') ||
      errorMsg.includes('session expired')) {
      setTunnelConnected(false);
      addLog('EdgeView session is not active. Click the reset button to restart the session.', 'error');
    }
  };

  const loadUserInfo = async () => {
    try {
      const ent = await GetEnterprise();
      setEnterprise(ent);
      const projList = await GetProjects();
      const map = {};
      if (projList) {
        projList.forEach(p => { map[p.id] = p.name; });
        setProjects(map);
      }
      // Fetch user info (token owner)
      const info = await GetUserInfo();
      setUserInfo(info);
    } catch (err) {
      console.log('Error loading user info:', err);
      throw err; // Re-throw to propagate error to saveSettings
    }
  };

  useEffect(() => {
    // Check secure storage status and perform migration if needed
    const initializeSettings = async () => {
      try {
        const status = await SecureStorageStatus();

        setMigrationState(prev => ({
          ...prev,
          needed: status.needsMigration,
          encryptionAvailable: status.encryptionAvailable
        }));

        // Auto-migrate if needed
        if (status.needsMigration && status.encryptionAvailable) {
          console.log('[SecureStorage] Migration needed, starting auto-migration...');
          setMigrationState(prev => ({ ...prev, inProgress: true }));

          const result = await SecureStorageMigrate();

          if (result.success) {
            console.log('[SecureStorage] Migration successful:', result.message);
            setMigrationState({
              needed: false,
              inProgress: false,
              completed: true,
              error: null,
              encryptionAvailable: true
            });
          } else {
            console.error('[SecureStorage] Migration failed:', result.error);
            setMigrationState(prev => ({
              ...prev,
              inProgress: false,
              error: result.error
            }));
          }
        }

        // Load settings using secure storage
        const cfg = await SecureStorageGetSettings();

        if (cfg) {
          setConfig({
            baseUrl: cfg.baseUrl || '',
            apiToken: cfg.apiToken || '',
            clusters: cfg.clusters || [],
            activeCluster: cfg.activeCluster || '',
            recentDevices: cfg.recentDevices || []
          });
          const hasToken = cfg.apiToken || (cfg.clusters && cfg.clusters.some(c => c.name === cfg.activeCluster && c.apiToken));
          if (hasToken) {
            loadUserInfo();
          } else {
            setShowSettings(true);
          }
        } else {
          setShowSettings(true);
        }
      } catch (err) {
        console.error('Failed to initialize settings:', err);
        // Fallback to legacy GetSettings if secure storage fails
        try {
          const cfg = await GetSettings();
          if (cfg) {
            setConfig({
              baseUrl: cfg.baseUrl || '',
              apiToken: cfg.apiToken || '',
              clusters: cfg.clusters || [],
              activeCluster: cfg.activeCluster || '',
              recentDevices: cfg.recentDevices || []
            });
          }
        } catch (fallbackErr) {
          console.error('Fallback GetSettings also failed:', fallbackErr);
          setShowSettings(true);
        }
      }
    };

    initializeSettings();
  }, []);

  useEffect(() => {
    const search = async () => {
      setLoading(true);
      setAuthError(false); // Clear auth error before attempting
      try {
        const results = await SearchNodes(query);
        setNodes(results || []);
        setSelectedIndex(0);
        setAuthError(false); // Clear any previous auth errors on success
      } catch (err) {
        console.error(err);
        setNodes([]);
        // Check if this is an authentication error (401)
        if (err.message && (err.message.includes('401') || err.message.includes('unauthorized'))) {
          setAuthError(true);
        }
      } finally {
        setLoading(false);
      }
    };
    const timeoutId = setTimeout(search, 300);
    return () => clearTimeout(timeoutId);
  }, [query]);

  const handleConnect = async (node) => {
    if (node.status !== 'online') return;
    try {
      await AddRecentDevice(node.id);
      const newConfig = await SecureStorageGetSettings();
      setConfig(newConfig);
    } catch (err) {
      console.error("Failed to update recents:", err);
    }
    setSelectedNode(node);
    setServices(null);
    setSshStatus(null);
    setLogs([]);
    setLoadingServices(true);
    setLoadingSSH(true);
    // Use global status for SSH connection progress
    setGlobalStatus({ type: 'loading', message: "Fetching device services..." });
    addLog(`Connecting to ${node.name}...`);
    setShowTerminal(false);

    GetDeviceServices(node.id, node.name).then(result => {
      try {
        const parsed = JSON.parse(result);
        setServices(parsed);
        addLog("Services list updated", 'success');
      } catch (e) {
        console.error("Failed to parse services JSON:", e);
        addLog(`Failed to parse services: ${e.message} `, 'error');
        setServices({ error: "Failed to parse response" });
      }
    }).catch(err => {
      console.error("Failed to get services:", err);
      addLog(`Failed to get services: ${err} `, 'error');
      setServices({ error: err.toString() });
    }).finally(() => {
      setLoadingServices(false);
      // Clear global status if it was "Fetching device services..."
      // But loadSSHStatus might have set it to something else, so be careful.
      // However, loadSSHStatus is called in parallel, so this might be tricky.
      // Let's rely on loadSSHStatus to update it or clear it.
      // If loadSSHStatus finishes first, we don't want it to clear status if loadSSHStatus set it to something else.
      // But loadSSHStatus sets globalStatus on start.
      // Given the overlap, maybe we just don't clear it here? 
      // Or we check if message is "Fetching device services..."?
      // Since we can't check current state easily in closure, let's assume loadSSHStatus will handle it.
      // Actually, handleConnect logic is a bit messy with parallel calls.
      // Let's just not clear it here, as loadSSHStatus is likely still running or will run.
      GetSessionStatus(node.id).then(status => {
        if (status.active) {
          setSessionStatus(status);
          addLog(`EdgeView session active (refreshed)`, 'success');
        }
      }).catch(console.error);
    });

    loadSSHStatus(node.id, true);
  };

  const loadSSHStatus = async (nodeId, checkTunnel = true) => {
    setLoadingSSH(true);
    setGlobalStatus({ type: 'loading', message: "Checking SSH configuration..." });
    // REMOVED: addLog("Checking SSH status..."); (too verbose)
    let sessStatus = null;
    try {
      const status = await GetSSHStatus(nodeId);
      setSshStatus(status);
      addLog(`SSH Status: ${status.status} `);
      try {
        sessStatus = await GetSessionStatus(nodeId);
        console.log("GetSessionStatus result:", sessStatus);
        setSessionStatus(sessStatus);
        if (sessStatus.active) {
          addLog(`EdgeView session active (expires: ${new Date(sessStatus.expiresAt).toLocaleString(undefined, getTimeFormatOptions())})`, 'success');
        }
      } catch (err) {
        console.error('Failed to get session status:', err);
      }
      if (checkTunnel) {
        setGlobalStatus({ type: 'loading', message: "Verifying EdgeView tunnel..." });
        // REMOVED: addLog("Verifying EdgeView tunnel connectivity..."); (too verbose)
        try {
          await VerifyTunnel(nodeId);
          // Only set as connected if we also have a valid active session with expiry
          // Check both local session (sessStatus) and cloud status (status)
          const isLocalActive = sessStatus && sessStatus.active && sessStatus.expiresAt;
          const isCloudActive = status && status.expiry && !Number.isNaN(parseInt(status.expiry, 10)) && (parseInt(status.expiry, 10) * 1000 > Date.now());

          if (isLocalActive || isCloudActive) {
            setTunnelConnected(true);
            addLog("EdgeView session verified: Connected", 'success');
          } else {
            setTunnelConnected(false);
            addLog("No active EdgeView session", 'warning');
          }
        } catch (err) {
          setTunnelConnected(false);
          addLog(`Tunnel check failed: ${err} `, 'warning');
        }
      }
    } catch (err) {
      console.error('Failed to load SSH status:', err);
      addLog(`Failed to load SSH status: ${err} `, 'error');
      setSshStatus(null);
      setTunnelConnected(false);
    } finally {
      setLoadingSSH(false);
      setGlobalStatus(null);
    }
  };

  const startSession = async (nodeId, useInApp) => {
    // Check if SSH was recently updated (within last 60 seconds)
    if (Date.now() - lastSSHUpdate < 60000) {
      if (!window.confirm(`The SSH key was updated less than a minute ago. The device might not be ready yet.

Do you want to try connecting anyway?`)) {
        return;
      }
    }

    let cancelled = false;
    let intervalId = null;

    const pollProgress = async () => {
      if (cancelled) return;
      try {
        const progress = await GetConnectionProgress(nodeId);
        if (progress && typeof progress.status === 'string' && progress.status.trim().length > 0) {
          setGlobalStatus({ type: 'loading', message: progress.status });
        }
      } catch (e) {
        // Ignore polling errors – connection attempts may still be in progress.
      }
    };

    try {
      setShowTerminalMenu(false);
      setLoadingSSH(true);
      setGlobalStatus({ type: 'loading', message: 'Starting EdgeView session...' });
      addLog(`Starting EdgeView SSH session (${useInApp ? 'In-App Terminal' : 'Native Terminal'})...`, 'info');

      // Start polling connection progress while backend works.
      pollProgress();
      intervalId = setInterval(pollProgress, 1000);

      const result = await ConnectToNode(nodeId, useInApp);

      const { port, tunnelId } = result;

      if (!port) {
        console.error("Could not determine port from result:", result);
        setError({ type: 'error', message: "Failed to start session: Could not determine port." });
        return;
      }

      if (useInApp) {
        window.electronAPI.openTerminalWindow({
          port: port,
          nodeName: selectedNode.name,
          targetInfo: 'EVE-OS SSH',
          tunnelId: tunnelId
        });
        addLog('In-app terminal launched', 'success');
      } else {
        // Native Terminal Launch
        const sshUser = 'root'; // Default for EVE-OS
        const sshCommand = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${port} ${sshUser}@localhost`;
        addLog(`Launching native terminal: ${sshCommand}`, 'info');
        await window.electronAPI.openExternalTerminal(sshCommand);
      }

      // Refresh session status to reflect potential encryption updates
      await loadSSHStatus(nodeId, false);

      const newConfig = await GetSettings();
      setConfig(newConfig);
      try {
        const sessStatus = await GetSessionStatus(nodeId);
        setSessionStatus(sessStatus);
      } catch (err) {
        console.error('Failed to refresh session status:', err);
      }
      // NOTE: We do NOT automatically refresh services here anymore.
      // Doing so triggers a new EdgeView query (ExecuteCommand) which opens a SECOND
      // WebSocket connection. On devices with MaxInst=2, this conflicts with the
      // active tunnel (Inst 1) + this query (Inst 2), potentially hitting the limit
      // or causing stability issues if the query takes time.
      // Users can manually refresh if needed, but the initial fetch is usually sufficient.

      cancelled = true;
      clearInterval(intervalId);
      setGlobalStatus(null);
      setLoadingSSH(false);
    } catch (err) {
      cancelled = true;
      clearInterval(intervalId);
      setLoadingSSH(false);
      setGlobalStatus(null);
      console.error('Failed to connect:', err);
      const userMessage = extractErrorMessage(err);
      addLog(`Connection failed: ${userMessage}`, 'error');
      // Don't show error banner - activity log entry is sufficient
      // Error banner blocks "Running Applications" section and there's no recovery action
    }
  };

  const handleSetupSSH = async () => {
    if (!selectedNode) return;
    setLoadingSSH(true);
    setGlobalStatus({ type: 'loading', message: "Enabling SSH access..." });
    addLog("Enabling SSH access...", 'info');
    try {
      await SetupSSH(selectedNode.id);
      setLastSSHUpdate(Date.now()); // Record update time
      addLog("SSH key pushed to cloud successfully", 'success');

      // Warn about propagation delay
      addLog("Device is syncing configuration... This typically takes 60-90 seconds.", 'warning');
      setGlobalStatus({
        type: 'info',
        message: 'SSH enabled. Waiting for device to apply changes...'
      });
      setTimeout(() => setGlobalStatus(null), 10000);

      loadSSHStatus(selectedNode.id);
    } catch (err) {
      console.error(err);
      addLog("Failed to setup SSH: " + err, 'error');
      setLoadingSSH(false);
      setGlobalStatus(null);
    }
  };

  const handleDisableSSH = async () => {
    if (!selectedNode) return;
    if (!confirm("Are you sure you want to disable SSH access? This will remove the public key from the device.")) return;
    setLoadingSSH(true);
    setGlobalStatus({ type: 'loading', message: "Disabling SSH access..." });
    addLog("Disabling SSH access...", 'info');
    try {
      await DisableSSH(selectedNode.id);
      addLog("SSH access disabled successfully", 'success');
      loadSSHStatus(selectedNode.id);
    } catch (err) {
      console.error(err);
      addLog("Failed to disable SSH: " + err, 'error');
      setLoadingSSH(false);
      setGlobalStatus(null);
    }
  };

  const handleToggleVGA = async (enabled) => {
    if (!selectedNode) return;
    setLoadingSSH(true);
    setGlobalStatus({ type: 'loading', message: enabled ? "Enabling VGA..." : "Disabling VGA..." });
    try {
      await SetVGAEnabled(selectedNode.id, enabled);
      loadSSHStatus(selectedNode.id);  // Refresh to get updated status
      addLog(`VGA access ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      console.error(err);
      addLog(`Failed to toggle VGA: ${err}`, 'error');
      setLoadingSSH(false);
      setGlobalStatus(null);
    }
  };

  const handleToggleUSB = async (enabled) => {
    if (!selectedNode) return;
    setLoadingSSH(true);
    setGlobalStatus({ type: 'loading', message: enabled ? "Enabling USB..." : "Disabling USB..." });
    try {
      await SetUSBEnabled(selectedNode.id, enabled);
      loadSSHStatus(selectedNode.id);  // Refresh to get updated status
      addLog(`USB access ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      console.error(err);
      addLog(`Failed to toggle USB: ${err}`, 'error');
      setLoadingSSH(false);
      setGlobalStatus(null);
    }
  };

  const handleToggleConsole = async (enabled) => {
    if (!selectedNode) return;
    setLoadingSSH(true);
    setGlobalStatus({ type: 'loading', message: enabled ? "Enabling Console..." : "Disabling Console..." });
    try {
      await SetConsoleEnabled(selectedNode.id, enabled);
      loadSSHStatus(selectedNode.id);  // Refresh to get updated status
      addLog(`Console access ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      console.error(err);
      addLog(`Failed to toggle Console: ${err}`, 'error');
      setLoadingSSH(false);
      setGlobalStatus(null);
    }
  };

  const handleResetEdgeView = async () => {
    if (!selectedNode) {
      setGlobalStatus({ type: 'error', message: "No node selected for reset." });
      return;
    }

    // Use global status instead of blocking UI with loadingSSH
    setGlobalStatus({ type: 'loading', message: "Resetting EdgeView session..." });
    addLog("Initiating EdgeView session reset...");

    try {
      await ResetEdgeView(selectedNode.id);
      addLog("Reset command sent successfully", 'success');

      setGlobalStatus({
        type: 'info',
        message: 'EdgeView session restarted. Tunnel will reconnect in ~10 seconds...'
      });

      // Wait 10s then refresh, keeping the info message
      setTimeout(() => {
        if (selectedNode) {
          addLog("Refreshing status after reset (waiting for tunnel)...");
          loadSSHStatus(selectedNode.id).catch(err => {
            console.error('Failed to refresh SSH status:', err);
            if (err.toString().includes("no device online")) {
              addLog("Tunnel still establishing...", 'warning');
            } else {
              addLog(`Failed to refresh status: ${err} `, 'error');
            }
          }).finally(() => {
            // Clear global status after refresh attempt
            setGlobalStatus(null);
          });
        } else {
          setGlobalStatus(null);
        }
      }, 10000);
    } catch (err) {
      console.error("ResetEdgeView failed:", err);
      const errMsg = err.message || String(err);

      // Check if it's a server error
      if (errMsg.includes('500') || errMsg.includes('internal server error')) {
        addLog(`Reset failed: ZEDEDA server error - unable to enable EdgeView on device`, 'error');
        setGlobalStatus({
          type: 'error',
          message: 'EdgeView session reset failed. The server cannot enable EdgeView on this device.'
        });
      } else {
        addLog(`Reset failed: ${errMsg}`, 'error');
        setGlobalStatus({ type: 'error', message: `Failed to reset EdgeView: ${errMsg}` });
      }
    }
  };

  const handleCollectInfo = async () => {
    if (!selectedNode) return;

    // Clear any previous job tracking
    collectInfoJobRef.current = null;

    setGlobalStatus({ type: 'loading', message: `Initiating system info collection for ${selectedNode.name}...` });

    try {
      addLog(`Starting collect info request for ${selectedNode.name}...`);
      const response = await StartCollectInfo(selectedNode.id);
      const jobId = response.jobId;
      collectInfoJobRef.current = jobId;

      setGlobalStatus({ type: 'loading', message: 'Waiting for device response...' });

      // Poll progress
      const pollInterval = setInterval(async () => {
        // If job cancelled or switched node, stop polling
        if (!collectInfoJobRef.current || collectInfoJobRef.current !== jobId) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const status = await GetCollectInfoStatus(jobId);

          if (status.status === 'downloading') {
            const progressMB = Math.round(status.progress / 1024 / 1024);
            const totalMB = Math.round(status.totalSize / 1024 / 1024);
            const percent = status.totalSize > 0 ? Math.round((status.progress / status.totalSize) * 100) : 0;

            // Format message with progress
            setGlobalStatus({
              type: 'loading',
              message: `Collecting info: ${progressMB} MB / ${totalMB} MB (${percent}%)`
            });
          } else if (status.status === 'completed') {
            clearInterval(pollInterval);
            addLog('Collect info request completed successfully', 'success');

            setGlobalStatus({ type: 'success', message: 'Collection complete. Saving file...' });

            // Auto-trigger save
            try {
              const saveResult = await SaveCollectInfo(jobId, status.filename);
              if (saveResult.success) {
                setGlobalStatus({ type: 'success', message: `File saved successfully to ${saveResult.filePath}` });
                addLog(`Saved system info to ${saveResult.filePath}`, 'success');
                // Auto-dismiss success message after 5 seconds
                setTimeout(() => setGlobalStatus(null), 5000);
              } else if (saveResult.canceled) {
                setGlobalStatus(null);
                addLog('File save cancelled by user', 'info');
              } else {
                setGlobalStatus({ type: 'error', message: `Failed to save file: ${saveResult.error}` });
                addLog(`Failed to save file: ${saveResult.error}`, 'error');
              }
            } catch (saveErr) {
              setGlobalStatus({ type: 'error', message: `Failed to save file: ${saveErr.message}` });
              addLog(`Failed to save file: ${saveErr.message}`, 'error');
            }

            // Cleanup job ref
            if (collectInfoJobRef.current === jobId) {
              collectInfoJobRef.current = null;
            }
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            const userMsg = extractErrorMessage(status.error);
            addLog(`Collect info request failed: ${userMsg}`, 'error');
            setGlobalStatus({ type: 'error', message: `Collection failed: ${userMsg}` });
            if (collectInfoJobRef.current === jobId) {
              collectInfoJobRef.current = null;
            }
          }
        } catch (err) {
          console.error("Failed to poll collect info:", err);
          const userMessage = extractErrorMessage(err);
          addLog(`Collect info polling failed: ${userMessage}`, 'error');
          setGlobalStatus({ type: 'error', message: `Polling failed: ${userMessage}` });
          clearInterval(pollInterval);
          if (collectInfoJobRef.current === jobId) {
            collectInfoJobRef.current = null;
          }
        }
      }, 1000);

    } catch (err) {
      console.error("Failed to start collect info:", err);
      // Clean up the error message for display
      const userMessage = extractErrorMessage(err);
      setGlobalStatus({ type: 'error', message: `Failed to start: ${userMessage}` });
      addLog(`Failed to start collect info: ${userMessage}`, 'error');
    }
  };

  const handleDownloadCollectInfo = () => {
    // Deprecated in favor of integrated save
  };

  const closeCollectInfoModal = () => {
    // Deprecated
  };

  const handleBack = () => {
    setSelectedNode(null);
    setServices(null);
    setSshStatus(null);
    setShowTerminal(false);
  };

  const recentIds = config.recentDevices || [];
  const recentNodes = nodes.filter(n => recentIds.includes(n.id));
  recentNodes.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
  const otherNodes = nodes.filter(n => !recentIds.includes(n.id));
  const displayNodes = [...recentNodes, ...otherNodes];
  const getNodeAtIndex = (index) => displayNodes[index];

  const handleKeyDown = (e) => {
    if (showSettings || selectedNode) return;
    if (e.key === 'ArrowDown') {
      setSelectedIndex(prev => Math.min(prev + 1, displayNodes.length - 1));
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      const node = getNodeAtIndex(selectedIndex);
      if (node) handleConnect(node);
    } else if (e.metaKey && e.key === ',') {
      e.preventDefault();
      setShowSettings(true);
    }
  };

  const addNewCluster = () => {
    const newName = `Cluster ${config.clusters.length + 1}`;
    const newClusters = [...config.clusters, { name: newName, baseUrl: '', apiToken: '' }];
    setConfig({ ...config, clusters: newClusters });
    setViewingClusterName(newName);
    setEditingCluster({ name: newName, baseUrl: '', apiToken: '' });
    setViewingUserInfo(null);
    setTokenStatus(null);
  };

  const deleteCluster = (name) => {
    const newClusters = config.clusters.filter(c => c.name !== name);
    let newActive = config.activeCluster;
    if (name === config.activeCluster) {
      newActive = newClusters.length > 0 ? newClusters[0].name : '';
    }
    setConfig({ ...config, clusters: newClusters, activeCluster: newActive });
    // If we deleted the viewing cluster, switch view to the new active one (or first available)
    if (name === viewingClusterName) {
      setViewingClusterName(newActive);
      const nextCluster = newClusters.find(c => c.name === newActive);
      if (nextCluster) {
        setEditingCluster({ ...nextCluster });
      }
    }
  };

  const handleClusterSelect = async (name) => {
    setViewingClusterName(name);
    const cluster = config.clusters.find(c => c.name === name);
    if (cluster) {
      setEditingCluster({ ...cluster });
      fetchViewingUserInfo(cluster);
    }
  };

  const activateCluster = async (clusterName = null) => {
    // If no name provided, default to currently viewing cluster (e.g. from "Switch to this Cluster" button)
    const target = clusterName || viewingClusterName;

    try {
      // 1. Clear selection/device state IMMEDIATELY to stop polling and stale UI
      setSelectedNode(null);
      setNodes([]);
      setServices(null);
      setSshStatus(null);
      setSessionStatus(null);
      setProjects({}); // Clear old projects map

      // 2. Update active cluster in config/storage
      const newConfig = { ...config, activeCluster: target };
      await SecureStorageSaveSettings(newConfig);
      setConfig(newConfig);

      // 3. Reload user info for the new active cluster
      // We need to ensure the backend has received the new config
      // SecureStorageSaveSettings handles this via IPC->Backend sync
      await loadUserInfo();

      // Clear any auth errors since we switched
      setAuthError(false);

      // 4. Refresh the device list for the new cluster
      try {
        setLoading(true);
        const results = await SearchNodes('');
        setNodes(results || []);
      } catch (err) {
        console.error('Failed to refresh nodes after switch:', err);
      } finally {
        setLoading(false);
      }
    } catch (err) {
      console.error("Failed to switch cluster:", err);
      setSettingsError("Failed to switch cluster: " + (err.message || String(err)));
    }
  };

  // Update handlers
  const handleDownloadUpdate = async () => {
    try {
      setUpdateState(prev => ({ ...prev, status: 'downloading', downloadProgress: 0 }));
      await DownloadUpdate();
    } catch (err) {
      console.error('Failed to download update:', err);
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: 'Failed to download update'
      }));
    }
  };

  const handleInstallUpdate = async () => {
    try {
      await InstallUpdate();
      // App will restart, so no need to update state
    } catch (err) {
      console.error('Failed to install update:', err);
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: 'Failed to install update'
      }));
    }
  };

  const handleDismissUpdate = () => {
    setUpdateState(prev => ({ ...prev, status: 'dismissed' }));
  };


  const saveSettings = async (targetActiveCluster = null) => {
    setSettingsError(null); // Clear previous errors
    setSaveStatus('Saving...');

    try {
      let clustersToSave = [...config.clusters];
      // Default to current active, unless overridden (e.g. by Switch to this Cluster)
      let activeToSave = targetActiveCluster || config.activeCluster;

      // Update the currently viewed cluster with the edited values
      if (clustersToSave.length > 0) {
        const editingIndex = clustersToSave.findIndex(c => c.name === viewingClusterName);
        if (editingIndex !== -1) {
          // Sanitize Base URL - remove trailing slashes
          const sanitizedCluster = { ...editingCluster };
          if (sanitizedCluster.baseUrl) {
            sanitizedCluster.baseUrl = sanitizedCluster.baseUrl.replace(/\/+$/, '');
          }

          // Check for duplicate cluster (same URL and token)
          // Exclude current editing index from check
          const duplicateIndex = clustersToSave.findIndex((c, idx) =>
            idx !== editingIndex &&
            c.baseUrl === sanitizedCluster.baseUrl &&
            c.apiToken === sanitizedCluster.apiToken
          );

          if (duplicateIndex !== -1) {
            // Duplicate found - don't save, show error or just select existing?
            // To be safe and simple: warn user.
            throw new Error('A cluster with this configuration already exists.');
          }

          clustersToSave[editingIndex] = sanitizedCluster;

          // If we are editing the active cluster (or renamed it), update activeToSave
          // Only update activeToSave if we didn't explicitly override it
          if (!targetActiveCluster && viewingClusterName === config.activeCluster) {
            activeToSave = sanitizedCluster.name;
          }
          // If we explicitly switched to this cluster, ensure activeToSave uses the potentially renamed value
          if (targetActiveCluster === viewingClusterName) {
            activeToSave = sanitizedCluster.name;
          }

          // Update viewingClusterName to the new name so subsequent saves work
          setViewingClusterName(sanitizedCluster.name);

          // Update viewing info with new credentials
          fetchViewingUserInfo(sanitizedCluster);
        }
      } else {
        // If no clusters exist, create one from editingCluster
        // Sanitize Base URL - remove trailing slashes
        const sanitizedCluster = { ...editingCluster };
        if (sanitizedCluster.baseUrl) {
          sanitizedCluster.baseUrl = sanitizedCluster.baseUrl.replace(/\/+$/, '');
        }

        clustersToSave = [sanitizedCluster];
        activeToSave = sanitizedCluster.name;
        setViewingClusterName(sanitizedCluster.name);
        fetchViewingUserInfo(sanitizedCluster);
      }

      // Save using secure storage
      const configToSave = {
        ...config,
        clusters: clustersToSave,
        activeCluster: activeToSave
      };
      await SecureStorageSaveSettings(configToSave);

      const settings = await SecureStorageGetSettings();
      if (settings) {
        const newConfig = {
          baseUrl: settings.baseUrl || '',
          apiToken: settings.apiToken || '',
          clusters: settings.clusters || [],
          activeCluster: settings.activeCluster || '',
          recentDevices: settings.recentDevices || []
        };
        setConfig(newConfig);

        // Test the token by trying to load user info
        const active = newConfig.clusters.find(c => c.name === newConfig.activeCluster);

        // Clear state before reloading to prevent stale data
        setNodes([]);
        setProjects([]);
        setEnterprise(null);

        // Refresh global active user info if we changed the active cluster
        if (newConfig.activeCluster === activeToSave) {
          loadUserInfo().catch(console.error);
        }

        if (active && active.apiToken) {
          setSaveStatus('Settings saved successfully!');
          setTimeout(() => {
            setSaveStatus('');
            // Don't close settings immediately to allow user to verify
          }, 1500);
        } else {
          setSaveStatus('Settings saved successfully!');
          setTimeout(() => {
            setSaveStatus('');
            setShowSettings(false);
          }, 1500);
        }
      }

      if (query) {
        const currentQuery = query;
        setQuery('');
        setTimeout(() => setQuery(currentQuery), 100);
      } else {
        try {
          const results = await SearchNodes('');
          setNodes(results || []);
        } catch (err) {
          console.error('Failed to fetch nodes after save:', err);
        }
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSettingsError('Failed to save settings: ' + (err.message || 'Unknown error'));
      setSaveStatus('');
    }
  };

  return (
    <div className="app-container" onKeyDown={handleKeyDown} tabIndex={0}>
      {!selectedNode && (
        <div className="cluster-info">
          {(() => {
            const active = config.clusters.find(c => c.name === config.activeCluster) ||
              (config.baseUrl ? { baseUrl: config.baseUrl, apiToken: config.apiToken } : null);
            if (!active || !active.baseUrl) return null;
            const entName = enterprise ? enterprise.name : (active.apiToken && active.apiToken.includes(':') ? active.apiToken.split(':')[0] : '');
            const url = active.baseUrl.replace('https://', '').replace('http://', '');
            const tokenOwner = userInfo?.tokenOwner;
            const tokenExpiry = userInfo?.tokenExpiry;

            // Calculate if token is expiring soon (less than 1 hour)
            let isExpiringSoon = false;
            let expiryText = '';
            if (tokenExpiry) {
              const expiryDate = new Date(tokenExpiry);
              const now = new Date();
              const hoursLeft = (expiryDate - now) / (1000 * 60 * 60);
              isExpiringSoon = hoursLeft < 1 && hoursLeft > 0;

              if (hoursLeft <= 0) {
                expiryText = 'Token expired';
                isExpiringSoon = true;
              } else if (hoursLeft < 1) {
                const minutesLeft = Math.round(hoursLeft * 60);
                expiryText = `Token expires in ${minutesLeft} min`;
              } else if (hoursLeft < 24) {
                expiryText = `Token expires in ${Math.round(hoursLeft)} hours`;
              } else {
                const daysLeft = Math.round(hoursLeft / 24);
                expiryText = `Token expires in ${daysLeft} days`;
              }
            }

            return (
              <>
                <span>{entName} • {url}</span>
                {tokenOwner && (
                  <Tooltip content={expiryText || 'Token expiry unknown'}>
                    <span className={`user-email ${isExpiringSoon ? 'expiring-soon' : ''}`}>
                      {tokenOwner}
                    </span>
                  </Tooltip>
                )}
              </>
            );
          })()}
        </div>
      )}
      <div className="search-bar" style={selectedNode ? { paddingLeft: '80px' } : {}}>
        {selectedNode ? (
          <ArrowLeft className="back-icon" size={20} onClick={handleBack} />
        ) : (
          <Search className="search-icon" size={20} />
        )}

        {selectedNode ? (
          <div className="selected-node-header">
            <span className="node-name">{selectedNode.name}</span>
            <span className={`status-dot ${selectedNode.status}`}></span>
          </div>
        ) : (
          <input
            autoFocus={!showSettings}
            type="text"
            placeholder="Search nodes, projects..."
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <div className="header-actions">
          <Info className="settings-icon" size={20} onClick={() => setShowAbout(true)} />
          <Settings className="settings-icon" size={20} onClick={() => setShowSettings(!showSettings)} />
        </div>
      </div>

      {/* Update Banner */}
      <UpdateBanner
        updateState={updateState}
        onDownload={handleDownloadUpdate}
        onInstall={handleInstallUpdate}
        onDismiss={handleDismissUpdate}
      />

      {/* Global Status Banner */}
      <GlobalStatusBanner
        status={globalStatus}
        onDismiss={() => setGlobalStatus(null)}
      />

      {/* Migration Status Banner */}
      {migrationState.inProgress && (
        <div className="migration-banner info-banner">
          <div className="banner-content">
            <RefreshCw size={18} className="spinner" />
            <span>Migrating credentials to secure storage...</span>
          </div>
        </div>
      )}
      {migrationState.completed && (
        <div className="migration-banner success-banner">
          <div className="banner-content">
            <Check size={18} />
            <span>Credentials successfully migrated to secure storage</span>
            <button
              className="banner-dismiss"
              onClick={() => setMigrationState(prev => ({ ...prev, completed: false }))}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      {migrationState.error && (
        <div className="migration-banner error-banner">
          <div className="banner-content">
            <AlertTriangle size={18} />
            <span>Migration failed: {migrationState.error}</span>
            <button
              className="banner-dismiss"
              onClick={() => setMigrationState(prev => ({ ...prev, error: null }))}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      {!migrationState.encryptionAvailable && (
        <div className="migration-banner warning-banner">
          <div className="banner-content">
            <AlertCircle size={18} />
            <span>Secure storage is not available on this system. Credentials are stored in plaintext.</span>
          </div>
        </div>
      )}

      {/* Authentication Error Banner */}
      {authError && !showSettings && (
        <div className="auth-error-banner">
          <div className="auth-error-content">
            <AlertTriangle size={20} />
            <div className="auth-error-text">
              <strong>Authentication Failed</strong>
              <span>Your API token is expired or invalid. Please update it in settings.</span>
            </div>
            <button
              className="auth-error-button"
              onClick={() => {
                setShowSettings(true);
                setAuthError(false);
              }}
            >
              Open Settings
            </button>
          </div>
        </div>
      )}

      {/* Collect Info Modal - Removed in favor of GlobalStatusBanner */}

      {showAbout && <About onClose={() => setShowAbout(false)} />}

      <div className="main-content">
        {showSettings ? (
          <div className="settings-panel">
            <div className="settings-header">
              <h2>Configuration</h2>
              <button className="close-btn" onClick={() => setShowSettings(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="clusters-container">
              <div className="cluster-list">
                <div className="list-header">
                  <span>CLUSTERS</span>
                  <button className="add-cluster-btn" onClick={addNewCluster}>
                    <Plus size={12} /> Add
                  </button>
                </div>
                {config.clusters.map((cluster, idx) => (
                  <div
                    key={idx}
                    className={`cluster-item ${cluster.name === viewingClusterName ? 'active' : ''}`}
                    onClick={() => handleClusterSelect(cluster.name)}
                  >
                    <div className="cluster-name">{cluster.name}</div>
                    {cluster.name === config.activeCluster && <div className="active-badge">Active</div>}
                    {cluster.name !== config.activeCluster && (
                      <button
                        className="switch-cluster-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Explicitly switch to this cluster without saving current form
                          activateCluster(cluster.name);
                        }}
                        title="Switch to this Cluster"
                      >
                        <Play size={12} />
                      </button>
                    )}
                    {config.clusters.length > 1 && (
                      <button
                        className="delete-cluster-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCluster(cluster.name);
                        }}
                        title="Delete Cluster"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="cluster-details">
                {viewingClusterName !== config.activeCluster && (
                  <div className="cluster-actions-bar" style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid #333' }}>
                    <div className="info-text" style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>
                      This cluster is not active.
                    </div>
                    <button
                      className="btn secondary"
                      onClick={() => activateCluster()}
                      style={{ width: '100%', justifyContent: 'center', padding: '8px' }}
                    >
                      Switch to this Cluster
                    </button>
                  </div>
                )}
                <div className="form-group">
                  <label>Cluster Name</label>
                  <input
                    type="text"
                    value={editingCluster.name}
                    onChange={(e) => setEditingCluster({ ...editingCluster, name: e.target.value })}
                    placeholder="e.g. Production, Staging"
                  />
                </div>
                <div className="form-group">
                  <label>Base URL</label>
                  <input
                    type="text"
                    value={editingCluster.baseUrl}
                    onChange={(e) => setEditingCluster({ ...editingCluster, baseUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
                <div className="form-group">
                  <label>API Token</label>
                  <textarea
                    className="token-input"
                    rows="3"
                    value={editingCluster.apiToken}
                    onChange={(e) => handleTokenPaste(e.target.value)}
                    placeholder="Paste token from ZEDEDA Cloud..."
                  />
                  {tokenStatus && (
                    <div
                      className={`token-status ${tokenStatus.valid ? 'valid' : 'expired'}`}
                      onClick={() => setShowTokenStatus(!showTokenStatus)}
                      style={{ cursor: 'pointer' }}
                      title="Click to toggle details"
                    >
                      {tokenStatus.valid ? <Check size={12} /> : <AlertCircle size={12} />}
                      {tokenStatus.message}
                      {tokenStatus.valid && <ChevronDown size={10} style={{ marginLeft: '4px', transform: showTokenStatus ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
                    </div>
                  )}
                </div>

                {/* Token Info - show for viewing cluster */}
                {viewingUserInfo && showTokenStatus && (
                  <div className="token-info-section" style={{ animation: 'slideIn 0.2s ease-out' }}>
                    <label>Token Status</label>
                    <div className="token-info-content" style={{ opacity: loadingTokenInfo ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                      {viewingUserInfo.tokenOwner && (
                        <div className="token-info-row">
                          <span className="token-info-label">Owner:</span>
                          <span className="token-info-value">{viewingUserInfo.tokenOwner}</span>
                        </div>
                      )}
                      {viewingUserInfo.tokenRole && (
                        <div className="token-info-row">
                          <span className="token-info-label">Role:</span>
                          <span className="token-info-value">{viewingUserInfo.tokenRole}</span>
                        </div>
                      )}
                      {false && viewingUserInfo.tokenExpiry && (() => {
                        const expiryDate = new Date(viewingUserInfo.tokenExpiry);
                        const now = new Date();

                        // Check for invalid/zero date (Year 1)
                        // Go zero time is 0001-01-01, JS parses this as year 1 or 1901 depending on browser
                        // We check if year is less than 2000 to be safe
                        if (expiryDate.getFullYear() < 2000) {
                          return (
                            <div className="token-info-row">
                              <span className="token-info-label">Expires:</span>
                              <span className="token-info-value">Unknown</span>
                            </div>
                          );
                        }

                        const hoursLeft = (expiryDate - now) / (1000 * 60 * 60);
                        const isExpired = hoursLeft <= 0;
                        const isExpiringSoon = hoursLeft < 1 && hoursLeft > 0;

                        let statusText = '';
                        let statusClass = '';
                        if (isExpired) {
                          statusText = 'Expired';
                          statusClass = 'expired';
                        } else if (isExpiringSoon) {
                          statusText = `Expires in ${Math.round(hoursLeft * 60)} min`;
                          statusClass = 'expiring';
                        } else if (hoursLeft < 24) {
                          statusText = `Expires in ${Math.round(hoursLeft)} hours`;
                          statusClass = '';
                        } else {
                          const daysLeft = Math.round(hoursLeft / 24);
                          statusText = `Expires in ${daysLeft} days`;
                          statusClass = '';
                        }

                        return (
                          <div className="token-info-row">
                            <span className="token-info-label">Expires:</span>
                            <span className={`token-info-value ${statusClass}`}>
                              {statusText}
                              <span className="token-expiry-date"> ({expiryDate.toLocaleDateString()} {expiryDate.toLocaleTimeString()})</span>
                            </span>
                          </div>
                        );
                      })()}
                      {viewingUserInfo.lastLogin && (() => {
                        const lastLoginDate = new Date(viewingUserInfo.lastLogin);
                        if (lastLoginDate.getFullYear() < 2000) return null;
                        return (
                          <div className="token-info-row">
                            <span className="token-info-label">Last Login:</span>
                            <span className="token-info-value">
                              {lastLoginDate.toLocaleDateString()} {lastLoginDate.toLocaleTimeString()}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Settings Error Banner */}
                {settingsError && (
                  <div className="settings-error-banner">
                    <AlertTriangle size={16} />
                    <span>{settingsError}</span>
                  </div>
                )}

                <div className="settings-actions">
                  {saveStatus && (
                    <span className={`status-text ${saveStatus.includes('Success') ? 'success' : 'muted'}`}>
                      {saveStatus}
                    </span>
                  )}
                  <button className="save-btn" onClick={() => saveSettings(null)}>
                    <Save size={16} /> Save Changes
                  </button>
                </div>

                <div className="settings-separator"></div>

                {/* Version Info and Update Check */}
                <div className="version-info-section">
                  <label>Application Version</label>
                  <div className="version-info-content">
                    <div className="version-row">
                      <span className="version-label">Version:</span>
                      <span className="version-value">
                        {window.electronAPI ? (
                          <VersionDisplay />
                        ) : (
                          'Loading...'
                        )}
                      </span>
                    </div>
                    {updateState.status === 'available' && (
                      <div className="version-row update-available-row">
                        <AlertCircle size={14} />
                        <span>Update available: {updateState.version}</span>
                      </div>
                    )}
                    {updateState.status === 'downloaded' && (
                      <div className="version-row update-ready-row">
                        <Check size={14} />
                        <span>Update ready to install</span>
                      </div>
                    )}
                    <button
                      className="check-updates-btn"
                      onClick={async () => {
                        try {
                          const { CheckForUpdates } = await import('./electronAPI');
                          await CheckForUpdates();
                        } catch (err) {
                          console.error('Failed to check for updates:', err);
                        }
                      }}
                      disabled={updateState.status === 'downloading'}
                    >
                      <RefreshCw size={14} />
                      {updateState.status === 'downloading' ? 'Checking...' : 'Check for Updates'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="content-area">
            {selectedNode && activeTunnels.filter(t => t.nodeId === selectedNode.id && t.status !== 'failed').length > 0 && (
              <div className={`active-tunnels-section ${highlightTunnels ? 'highlight' : ''}`}>
                <div className="section-title">Active Tunnels</div>
                <div className="tunnel-list">
                  {activeTunnels.filter(t => t.nodeId === selectedNode.id && t.status !== 'failed').map(tunnel => (
                    <div key={tunnel.id} className="tunnel-item">
                      <div className="tunnel-info">
                        <div className="tunnel-type">
                          {tunnel.type === 'VNC' && <Monitor size={14} className="tunnel-icon" />}
                          {tunnel.type === 'SSH' && <Terminal size={14} className="tunnel-icon" />}
                          {tunnel.type === 'TCP' && <Activity size={14} className="tunnel-icon" />}
                          <span>{tunnel.type}</span>
                          {tunnel.isEncrypted ? (
                            <span className="tunnel-badge encrypted" title="End-to-End Encrypted">
                              <Lock size={10} />
                            </span>
                          ) : (
                            <span className="tunnel-badge unencrypted" title="Not Encrypted">
                              <Unlock size={10} />
                            </span>
                          )}
                        </div>
                        <div className="tunnel-target">
                          <span>{tunnel.targetIP}:{tunnel.targetPort}</span>
                          <ArrowRight size={12} className="tunnel-arrow" />
                        </div>
                        <div className="tunnel-local">
                          <Copyable text={tunnel.type === 'SSH' ? `ssh -p ${tunnel.localPort} ${tunnel.username || 'root'}@localhost` : `localhost:${tunnel.localPort}`}>
                            <code>localhost:{tunnel.localPort}</code>
                          </Copyable>
                        </div>
                        <button
                          className="icon-btn"
                          title="Open in Browser"
                          onClick={() => window.electronAPI.openExternal(`http://localhost:${tunnel.localPort}`)}
                        >
                          <ExternalLink size={12} />
                        </button>
                        <div className="tunnel-stats">
                          <div
                            className={`activity-dot ${Date.now() - (tunnel.lastActivity || 0) < 5000 ? 'active' : ''}`}
                            title={Date.now() - (tunnel.lastActivity || 0) < 5000 ? "Active (Data transferring)" : "Idle"}
                          ></div>
                          <span className="stats-text" title="Data Transferred">
                            <span title="Bytes Sent">TX: {formatBytes(tunnel.bytesSent)}</span>
                            <span className="divider">|</span>
                            <span title="Bytes Received">RX: {formatBytes(tunnel.bytesReceived)}</span>
                          </span>
                        </div>
                      </div>
                      <div className="tunnel-actions">
                        {tunnel.type === 'VNC' && (
                          <button
                            className="icon-btn"
                            title="Open VNC Viewer"
                            onClick={() => window.electronAPI.openExternal(`vnc://localhost:${tunnel.localPort}`)}
                          >
                            <ExternalLink size={14} />
                          </button>
                        )}
                        {tunnel.type === 'SSH' && (
                          <button
                            className="icon-btn"
                            title="Open Terminal"
                            onClick={() => window.electronAPI.openTerminalWindow({
                              port: tunnel.localPort,
                              username: tunnel.username,
                              nodeName: tunnel.nodeName,
                              targetInfo: `${tunnel.username || 'root'}@${tunnel.nodeName}`
                            })}
                          >
                            <Terminal size={14} />
                          </button>
                        )}
                        <button
                          className="icon-btn danger"
                          title="Stop Tunnel"
                          onClick={() => StopTunnel(tunnel.id)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Global tunnels view (all devices) */}
            {showGlobalTunnels && activeTunnels.filter(t => t.status !== 'failed').length > 0 && (
              <div className="active-tunnels-section global">
                <div className="section-title">All Active Tunnels</div>
                <div className="tunnel-list">
                  {activeTunnels.filter(t => t.status !== 'failed').map(tunnel => (
                    <div key={tunnel.id} className="tunnel-item">
                      <div className="tunnel-info">
                        <div className="tunnel-type">
                          {tunnel.type === 'VNC' && <Monitor size={14} className="tunnel-icon" />}
                          {tunnel.type === 'SSH' && <Terminal size={14} className="tunnel-icon" />}
                          {tunnel.type === 'TCP' && <Activity size={14} className="tunnel-icon" />}
                          <span>{tunnel.type}</span>
                          {tunnel.isEncrypted ? (
                            <span className="tunnel-badge encrypted" title="End-to-End Encrypted">
                              <Lock size={10} />
                            </span>
                          ) : (
                            <span className="tunnel-badge unencrypted" title="Not Encrypted">
                              <Unlock size={10} />
                            </span>
                          )}
                        </div>
                        <div className="tunnel-target">
                          <span>{tunnel.targetIP}:{tunnel.targetPort}</span>
                          <ArrowRight size={12} className="tunnel-arrow" />
                        </div>
                        <div className="tunnel-local">
                          <Copyable text={tunnel.type === 'SSH' ? `ssh -p ${tunnel.localPort} ${tunnel.username || 'root'}@localhost` : `localhost:${tunnel.localPort}`}>
                            <code>localhost:{tunnel.localPort}</code>
                          </Copyable>
                        </div>
                        <div className="tunnel-meta">
                          <span className="tunnel-device">{tunnel.nodeName || tunnel.nodeId}</span>
                          {tunnel.projectId && (
                            <span className="tunnel-project">
                              • {projects[tunnel.projectId] || tunnel.projectId}
                            </span>
                          )}
                        </div>
                        <button
                          className="icon-btn"
                          title="Open in Browser"
                          onClick={() => window.electronAPI.openExternal(`http://localhost:${tunnel.localPort}`)}
                        >
                          <ExternalLink size={12} />
                        </button>
                        <div className="tunnel-stats">
                          <div
                            className={`activity-dot ${Date.now() - (tunnel.lastActivity || 0) < 5000 ? 'active' : ''}`}
                            title={Date.now() - (tunnel.lastActivity || 0) < 5000 ? "Active (Data transferring)" : "Idle"}
                          ></div>
                          <span className="stats-text" title="Data Transferred">
                            <span title="Bytes Sent">TX: {formatBytes(tunnel.bytesSent)}</span>
                            <span className="divider">|</span>
                            <span title="Bytes Received">RX: {formatBytes(tunnel.bytesReceived)}</span>
                          </span>
                        </div>
                      </div>
                      <div className="tunnel-actions">
                        {tunnel.type === 'VNC' && (
                          <button
                            className="icon-btn"
                            title="Open VNC Viewer"
                            onClick={() => window.electronAPI.openExternal(`vnc://localhost:${tunnel.localPort}`)}
                          >
                            <ExternalLink size={14} />
                          </button>
                        )}
                        {tunnel.type === 'SSH' && (
                          <button
                            className="icon-btn"
                            title="Open Terminal"
                            onClick={() => window.electronAPI.openTerminalWindow({
                              port: tunnel.localPort,
                              username: tunnel.username,
                              nodeName: tunnel.nodeName,
                              targetInfo: `${tunnel.username || 'root'}@${tunnel.nodeName}`
                            })}
                          >
                            <Terminal size={14} />
                          </button>
                        )}
                        <button
                          className="icon-btn danger"
                          title="Stop Tunnel"
                          onClick={() => StopTunnel(tunnel.id)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedNode && (
              <div className="ssh-status-section">
                <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>EdgeView Session</span>
                  <div className="split-btn-container" ref={dropdownRef}>
                    <button
                      className={`connect-btn primary split-main`}
                      onClick={() => setShowTerminalMenu(!showTerminalMenu)}
                      disabled={!sshStatus || sshStatus.status !== 'enabled' || !isSessionConnected}
                      title={(!sshStatus || sshStatus.status !== 'enabled')
                        ? "SSH must be enabled first"
                        : !isSessionConnected
                          ? "Session is not connected"
                          : "Open SSH Terminal"}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', fontSize: '12px' }}
                    >
                      <Terminal size={16} />
                      <img src={eveOsIcon} alt="EVE-OS" style={{ height: '14px', width: 'auto' }} />
                      EVE-OS SSH Terminal
                    </button>
                    <button
                      className={`connect-btn primary split-arrow`}
                      onClick={() => setShowTerminalMenu(!showTerminalMenu)}
                      disabled={!sshStatus || sshStatus.status !== 'enabled' || !isSessionConnected}
                      style={{ padding: '6px 8px' }}
                    >
                      <ChevronDown size={14} />
                    </button>
                    {showTerminalMenu && (
                      <div className="dropdown-menu">
                        <div className="dropdown-item" onClick={() => startSession(selectedNode.id, true)} style={{
                          padding: '10px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          borderBottom: '1px solid #333'
                        }}>
                          <Terminal size={16} />
                          <span>Open in Built-in Terminal</span>
                        </div>
                        <div className="dropdown-item" onClick={() => startSession(selectedNode.id, false)} style={{
                          padding: '10px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <ExternalLink size={16} />
                          <span>Use External Terminal</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="ssh-details-wrapper" style={{ position: 'relative', minHeight: '80px' }}>
                  {sshStatus ? (
                    <div className="ssh-details" style={{ opacity: loadingSSH ? 0.3 : 1, transition: 'opacity 0.2s' }}>
                      <div className="status-grid">
                        {(sshStatus.instID !== undefined || sshStatus.maxInst !== undefined) && (
                          <div className="status-item">
                            <div className="status-label">INSTANCE</div>
                            <div className="status-value">
                              {sshStatus.instID !== undefined && sshStatus.maxInst !== undefined
                                ? `${sshStatus.instID}/${sshStatus.maxInst}`
                                : '-'}
                            </div>
                          </div>
                        )}
                        {sshStatus.maxSessions > 0 && (
                          <div className="status-item">
                            <div className="status-label">MAX SESSIONS</div>
                            <div className="status-value">{sshStatus.maxSessions}</div>
                          </div>
                        )}
                        <div className="status-item">
                          <div className="status-label">ENCRYPTION</div>
                          <div className={`status-value ${(sessionStatus?.isEncrypted || sshStatus?.isEncrypted) ? 'success' : 'mismatch'}`}>
                            {(sessionStatus?.isEncrypted || sshStatus?.isEncrypted) ? (
                              <><Lock size={14} /> Encrypted</>
                            ) : (
                              <><Unlock size={14} /> Unencrypted</>
                            )}
                          </div>
                        </div>
                        <div className="status-item">
                          <div className="status-label">SESSION</div>
                          <div className={`status-value ${isSessionConnected ? 'success' : 'error'}`}>
                            {isSessionConnected ? (
                              <><Check size={14} /> Activated</>
                            ) : (
                              <><X size={14} /> Inactive</>
                            )}
                          </div>
                        </div>
                        <div className="status-item">
                          <div className="status-label">EXPIRES</div>
                          <div className={`status-value ${expiryInfo.colorClass}`}>
                            {expiryInfo.timestamp ? (
                              <span title={new Date(expiryInfo.timestamp).toLocaleString(undefined, getTimeFormatOptions())}>
                                {expiryInfo.label}
                              </span>
                            ) : '-'}
                            <button
                              className="inline-icon-btn"
                              title="Restart EdgeView session"
                              onClick={handleResetEdgeView}
                            >
                              <RefreshCw size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      {sshStatus.managementIPs && sshStatus.managementIPs.length > 0 && (
                        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <div className="status-label" style={{ marginBottom: '6px' }}>MANAGEMENT IPS</div>
                          <div className="status-value" style={{ 
                            display: 'flex', 
                            flexWrap: 'wrap', 
                            gap: '6px' 
                          }}>
                            {sshStatus.managementIPs.map((ip, i) => (
                              <Copyable key={i} text={ip}>
                                <span style={{ 
                                  backgroundColor: 'rgba(255, 255, 255, 0.1)', 
                                  padding: '2px 6px', 
                                  borderRadius: '4px', 
                                  fontSize: '11px',
                                  fontFamily: 'monospace',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {ip}
                                </span>
                              </Copyable>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Configuration Controls */}
                      <div className="config-container" style={{ marginTop: '15px', borderTop: '1px solid #333', paddingTop: '15px' }}>
                        <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Device Configuration
                        </div>

                        <div className="config-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'space-between' }}>

                          {/* SSH Control */}
                          <div
                            className={`config-chip ${sshStatus.status === 'enabled' ? 'enabled' : sshStatus.status === 'mismatch' ? 'warning' : 'disabled'}`}
                            onClick={sshStatus.status === 'enabled' ? handleDisableSSH : handleSetupSSH}
                            title={sshStatus.status === 'enabled' ? "SSH Enabled - Click to Disable" : sshStatus.status === 'mismatch' ? "Key Mismatch - Click to Fix" : "SSH Disabled - Click to Enable"}
                            style={{
                              display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                              fontSize: '12px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s',
                              backgroundColor: sshStatus.status === 'enabled' ? 'rgba(35, 134, 54, 0.2)' : sshStatus.status === 'mismatch' ? 'rgba(210, 153, 34, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                              color: sshStatus.status === 'enabled' ? '#238636' : sshStatus.status === 'mismatch' ? '#d29922' : '#c9d1d9',
                              border: 'none'
                            }}
                          >
                            {sshStatus.status === 'enabled' ? <Unlock size={13} style={{ marginRight: '6px' }} /> :
                              sshStatus.status === 'mismatch' ? <AlertTriangle size={13} style={{ marginRight: '6px' }} /> :
                                <Lock size={13} style={{ marginRight: '6px' }} />}
                            {sshStatus.status === 'enabled' ? 'SSH Enabled' : sshStatus.status === 'mismatch' ? 'SSH Key Mismatch' : 'Enable SSH'}
                          </div>

                          {/* VGA Control */}
                          <div
                            className={`config-chip ${sshStatus.vgaEnabled ? 'enabled' : 'disabled'}`}
                            onClick={() => handleToggleVGA(!sshStatus.vgaEnabled)}
                            title={sshStatus.vgaEnabled ? "VGA Enabled - Click to Disable" : "VGA Disabled - Click to Enable"}
                            style={{
                              display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                              fontSize: '12px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s',
                              backgroundColor: sshStatus.vgaEnabled ? 'rgba(35, 134, 54, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                              color: sshStatus.vgaEnabled ? '#238636' : '#c9d1d9',
                              border: 'none'
                            }}
                          >
                            <Monitor size={13} style={{ marginRight: '6px' }} />
                            {sshStatus.vgaEnabled ? 'VGA Enabled' : 'Enable VGA'}
                          </div>

                          {/* USB Control */}
                          <div
                            className={`config-chip ${sshStatus.usbEnabled ? 'enabled' : 'disabled'}`}
                            onClick={() => handleToggleUSB(!sshStatus.usbEnabled)}
                            title={sshStatus.usbEnabled ? "USB Enabled - Click to Disable" : "USB Disabled - Click to Enable"}
                            style={{
                              display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                              fontSize: '12px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s',
                              backgroundColor: sshStatus.usbEnabled ? 'rgba(35, 134, 54, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                              color: sshStatus.usbEnabled ? '#238636' : '#c9d1d9',
                              border: 'none'
                            }}
                          >
                            <Activity size={13} style={{ marginRight: '6px' }} />
                            {sshStatus.usbEnabled ? 'USB Enabled' : 'Enable USB'}
                          </div>

                          {/* Console Control */}
                          <div
                            className={`config-chip ${sshStatus.consoleEnabled ? 'enabled' : 'disabled'}`}
                            onClick={() => handleToggleConsole(!sshStatus.consoleEnabled)}
                            title={sshStatus.consoleEnabled ? "Console Enabled - Click to Disable" : "Console Disabled - Click to Enable"}
                            style={{
                              display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                              fontSize: '12px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s',
                              backgroundColor: sshStatus.consoleEnabled ? 'rgba(35, 134, 54, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                              color: sshStatus.consoleEnabled ? '#238636' : '#c9d1d9',
                              border: 'none'
                            }}
                          >
                            <Terminal size={13} style={{ marginRight: '6px' }} />
                            {sshStatus.consoleEnabled ? 'Console Enabled' : 'Enable Console'}
                          </div>

                          {/* Collect Info */}
                          <div
                            className={`config-chip ${isSessionConnected ? '' : 'disabled'}`}
                            onClick={isSessionConnected ? handleCollectInfo : undefined}
                            title={isSessionConnected ? "Collect system information (tech-support bundle)" : "Session must be active to collect info"}
                            style={{
                              display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                              fontSize: '12px', fontWeight: '500', cursor: isSessionConnected ? 'pointer' : 'default', transition: 'all 0.2s',
                              backgroundColor: isSessionConnected ? 'rgba(56, 139, 253, 0.15)' : 'rgba(255, 255, 255, 0.1)',
                              color: isSessionConnected ? '#58a6ff' : '#c9d1d9',
                              border: isSessionConnected ? '1px solid rgba(56, 139, 253, 0.3)' : 'none'
                            }}
                          >
                            <Download size={13} style={{ marginRight: '6px' }} />
                            Collect Info
                          </div>

                        </div>
                      </div>
                    </div>
                  ) : !loadingSSH && (
                    <div className="error-text">Failed to check status</div>
                  )}
                </div>
              </div>
            )}

            {selectedNode && (
              <div className="details-header">
                <h3>Running Applications</h3>
              </div>
            )}

            {loadingServices ? (
              <div className="loading-state">
                <Activity className="loading-icon animate-spin" size={24} />
                <p>Scanning services...</p>
              </div>
            ) : error ? (
              <div
                className={`error-message ${error.type === 'success' ? 'success-message' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px'
                }}
              >
                {error.type === 'success' && error.message.includes('reconnect') && (
                  <RefreshCw className="animate-spin" size={18} />
                )}
                <span>{error.message}</span>
              </div>
            ) : services ? (
              <div className="services-list">
                {(() => {
                  const rawList = Array.isArray(services) ? services : (services.services || []);
                  
                  // Grouping Logic for Docker Compose
                  const displayList = [];
                  const childrenIds = new Set();
                  const parentsMap = new Map();
                  
                  rawList.forEach(app => {
                    if (app.appType === 'APP_TYPE_DOCKER_COMPOSE') {
                       // Find parent runtime (non-compose app sharing an IP)
                       const parent = rawList.find(p => 
                         p.id !== app.id && 
                         p.appType !== 'APP_TYPE_DOCKER_COMPOSE' &&
                         p.ips && app.ips && 
                         p.ips.some(ip => app.ips.includes(ip))
                       );
                       if (parent) {
                         if (!parentsMap.has(parent.id)) parentsMap.set(parent.id, []);
                         parentsMap.get(parent.id).push(app);
                         childrenIds.add(app.id);
                       }
                    }
                  });
                  
                  rawList.forEach(app => {
                    if (!childrenIds.has(app.id)) {
                      displayList.push({ ...app, isChild: false, isRuntime: parentsMap.has(app.id) });
                      if (parentsMap.has(app.id)) {
                        parentsMap.get(app.id).forEach(child => {
                          displayList.push({ ...child, isChild: true });
                        });
                      }
                    }
                  });

                  const globalError = !Array.isArray(services) ? services.error : null;
                  return (
                    <>
                      {displayList.length > 0 ? (
                        displayList.map((app, idx) => (
                          <div key={idx} className="service-item" style={{ 
                            flexDirection: 'column', 
                            alignItems: 'stretch',
                            marginLeft: app.isChild ? '32px' : '0',
                            paddingLeft: app.isChild ? '12px' : '16px',
                            // Only override borderLeft for children to create the tree line effect
                            // Parents keep the default border from .service-item class
                            ...(app.isChild ? { borderLeft: '2px solid #333' } : {}),
                            position: 'relative',
                            marginBottom: '8px',
                            backgroundColor: app.isChild ? '#161616' : '#1e1e1e' 
                          }}>
                            {app.isChild && (
                                <div style={{
                                  position: 'absolute', left: '-2px', top: '24px', width: '12px', height: '2px', backgroundColor: '#333'
                                }} />
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div className="service-info" style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', height: '100%' }}>
                                  <span className="service-name" style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center' }}>
                                    <Copyable text={app.name}>
                                      {app.name}
                                    </Copyable>
                                    {app.pid && <span style={{ marginLeft: '8px', color: '#666', fontSize: '0.9em', fontWeight: 'normal' }}>(PID: {app.pid})</span>}
                                  </span>
                                  {app.isRuntime && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85em', color: '#a371f7', verticalAlign: 'middle', marginTop: '0px' }}>
                                      <Box size={12} /> Compose Runtime
                                    </span>
                                  )}
                                  {app.appType === 'APP_TYPE_DOCKER_COMPOSE' && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85em', color: '#58a6ff', verticalAlign: 'middle', marginTop: '0px' }}>
                                      <Layers size={12} /> Compose App
                                    </span>
                                  )}
                                  <div className="service-meta" style={{ display: 'flex', alignItems: 'center', height: '100%', flexWrap: 'wrap', gap: '4px' }}>
                                    {app.ips && app.ips.length > 0 && app.ips.map((ip, ipIdx) => {
                                      const savedUser = getSavedSshUsername(app.name);
                                      const popoverKey = `${app.name}-${ip}`;
                                      const isPopoverOpen = sshPopover?.key === popoverKey;
                                      return (
                                        <div key={ipIdx} style={{ position: 'relative', display: 'inline-flex' }}>
                                          <Copyable text={ip}>
                                            <button
                                              className="quick-tunnel-btn"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSshPopover({
                                                  key: popoverKey,
                                                  ip,
                                                  appName: app.name,
                                                  username: savedUser
                                                });
                                              }}
                                              disabled={!!tunnelLoading || !isSessionConnected}
                                              title={`SSH as ${savedUser}@${ip} — click to connect`}
                                              style={{
                                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                borderRadius: '4px',
                                                padding: '2px 6px',
                                                fontSize: '11px',
                                                fontFamily: 'monospace',
                                                color: '#ccc',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                              }}
                                            >
                                              {ip}
                                            </button>
                                          </Copyable>
                                          {isPopoverOpen && (
                                            <div
                                              ref={sshPopoverRef}
                                              className="ssh-popover"
                                              onClick={(e) => e.stopPropagation()}
                                              style={{
                                                position: 'absolute',
                                                top: '100%',
                                                left: '0',
                                                marginTop: '4px',
                                                backgroundColor: '#1e1e1e',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                padding: '8px',
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                                zIndex: 1000,
                                                minWidth: '180px'
                                              }}
                                            >
                                              <div style={{ marginBottom: '8px', fontSize: '12px', color: '#888' }}>
                                                SSH to {ip}
                                              </div>
                                              <input
                                                type="text"
                                                value={sshPopover.username}
                                                onChange={(e) => setSshPopover({ ...sshPopover, username: e.target.value })}
                                                placeholder="Username"
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    setSshPopover(null);
                                                    startQuickSsh(ip, app.name, sshPopover.username || 'root');
                                                  } else if (e.key === 'Escape') {
                                                    setSshPopover(null);
                                                  }
                                                }}
                                                autoFocus
                                                style={{
                                                  width: '100%',
                                                  boxSizing: 'border-box',
                                                  padding: '6px 8px',
                                                  backgroundColor: '#2a2a2a',
                                                  border: '1px solid #444',
                                                  borderRadius: '4px',
                                                  color: '#fff',
                                                  fontSize: '13px',
                                                  marginBottom: '8px'
                                                }}
                                              />
                                              <button
                                                onClick={() => {
                                                  setSshPopover(null);
                                                  startQuickSsh(ip, app.name, sshPopover.username || 'root');
                                                }}
                                                style={{
                                                  width: '100%',
                                                  boxSizing: 'border-box',
                                                  padding: '6px 12px',
                                                  backgroundColor: '#238636',
                                                  border: 'none',
                                                  borderRadius: '4px',
                                                  color: '#fff',
                                                  fontSize: '12px',
                                                  cursor: 'pointer',
                                                  fontWeight: '500'
                                                }}
                                              >
                                                Connect
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {app.vncPort && (
                                      <div style={{ position: 'relative', display: 'inline-flex' }}>
                                        <Copyable text={app.vncPort.toString()}>
                                          <button
                                            className="quick-tunnel-btn"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              // Docker Compose apps require localhost for eve-os guacd
                                              startQuickVnc('localhost', app.vncPort, app.name);
                                            }}
                                            disabled={!!tunnelLoading || !isSessionConnected}
                                            title={`Click to start VNC on port ${app.vncPort}`}
                                            style={{
                                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                              border: '1px solid rgba(255, 255, 255, 0.1)',
                                              borderRadius: '4px',
                                              padding: '2px 6px',
                                              fontSize: '11px',
                                              fontFamily: 'monospace',
                                              color: '#ccc',
                                              cursor: 'pointer',
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '4px'
                                            }}
                                          >
                                            VNC: {app.vncPort}
                                          </button>
                                        </Copyable>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="service-actions">
                                {app.appType === 'APP_TYPE_DOCKER_COMPOSE' && app.containers && app.containers.length > 0 && (
                                  <button
                                    className={`connect-btn ${expandedServiceContainers[idx] ? 'active' : 'secondary'}`}
                                    onClick={() => setExpandedServiceContainers(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                    style={{ marginRight: '8px' }}
                                    title="Show containers"
                                  >
                                    <Box size={14} /> {expandedServiceContainers[idx] ? 'Hide' : 'Containers'}
                                  </button>
                                )}
                                <button
                                  className={`connect-btn ${expandedServiceId === idx ? 'active' : 'secondary'}`}
                                  onClick={() => setExpandedServiceId(expandedServiceId === idx ? null : idx)}
                                  title={!isSessionConnected ? "EdgeView session not active" : "Connect to service"}
                                  disabled={!isSessionConnected}
                                >
                                  <Globe size={14} /> {expandedServiceId === idx ? 'Close' : 'Connect'}
                                </button>
                              </div>
                            </div>
                            {expandedServiceContainers[idx] && app.containers && (
                              <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', width: '100%', overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                  <thead>
                                    <tr style={{ color: 'var(--text-secondary)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                                      <th style={{ padding: '8px 12px', width: '40px', textAlign: 'left' }}>Status</th>
                                      <th style={{ padding: '8px 12px', width: '30%', textAlign: 'left' }}>Name</th>
                                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Port Mapping (Host → Container)</th>
                                      <th style={{ padding: '8px 12px', width: '120px', textAlign: 'center' }}>Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {app.containers.map((c, cIdx) => (
                                      <tr key={cIdx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                        <td style={{ padding: '8px 12px', textAlign: 'left' }}>
                                          <div style={{
                                            width: '8px', height: '8px', borderRadius: '50%',
                                            backgroundColor: c.containerState?.toLowerCase().includes('running') ? 'var(--color-success)' : 'var(--color-danger)'
                                          }} title={c.containerState} />
                                        </td>
                                        <td style={{ padding: '8px 12px', textAlign: 'left' }}>
                                          <Copyable text={c.containerName}>
                                            <span className="entity-name">{c.containerName}</span>
                                          </Copyable>
                                        </td>
                                        <td style={{ padding: '8px 12px', textAlign: 'left' }}>
                                          {c.portMaps && c.portMaps.filter(pm => pm.publicPort > 0).length > 0 ? (
                                            c.portMaps.filter(pm => pm.publicPort > 0).map((pm, pIdx) => (
                                              <div key={pIdx} style={{ marginBottom: '2px', display: 'flex', alignItems: 'center' }}>
                                                <div style={{ width: '130px', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                                                  <Copyable text={`${pm.runtimeIp || '0.0.0.0'}:${pm.publicPort}`}>
                                                    <button
                                                      className="quick-tunnel-btn"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        const targetIp = pm.runtimeIp || app.ips?.[0] || selectedNode?.managementIps?.[0];
                                                        if (targetIp) {
                                                          startQuickTunnel(targetIp, pm.publicPort);
                                                        }
                                                      }}
                                                      disabled={!!tunnelLoading || !isSessionConnected}
                                                      title={`Click to start TCP tunnel to port ${pm.publicPort}`}
                                                    >
                                                      {pm.runtimeIp || '0.0.0.0'}:{pm.publicPort}
                                                    </button>
                                                  </Copyable>
                                                </div>
                                                <span className="entity-meta" style={{ margin: '0 6px', flexShrink: 0 }}>→</span>
                                                <span className="entity-meta">localhost:{pm.privatePort}</span>
                                              </div>
                                            ))
                                          ) : (
                                            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>No public ports</span>
                                          )}
                                        </td>
                                        <td style={{ padding: '8px 12px', textAlign: 'center', position: 'relative' }}>
                                          <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                                            <button
                                              className="connect-btn secondary"
                                              style={{ padding: '4px 10px', fontSize: '11px' }}
                                              disabled={!c.containerState?.toLowerCase().includes('running') || !isSessionConnected || !!tunnelLoading}
                                              title={!c.containerState?.toLowerCase().includes('running') ? 'Container not running' : 'Open shell in container'}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                
                                                if (app.appType === 'APP_TYPE_DOCKER_COMPOSE') {
                                                  if (shellPrompt?.containerName === c.containerName) {
                                                    setShellPrompt(null);
                                                  } else {
                                                    const savedUser = getSavedSshUsername(app.name);
                                                    setShellPrompt({
                                                      containerName: c.containerName,
                                                      username: savedUser || 'root',
                                                      password: ''
                                                    });
                                                  }
                                                  return;
                                                }

                                                handleContainerShell(app, c, 'root', '');
                                              }}
                                            >
                                              {tunnelLoading === `shell-${c.containerName}` ? <Activity size={12} className="animate-spin" /> : <Terminal size={12} />}
                                              <span style={{ marginLeft: '4px' }}>Shell</span>
                                            </button>
                                          </div>

                                          {/* Shell Username Prompt Popover */}
                                          {shellPrompt?.containerName === c.containerName && (
                                            <div
                                              className="ssh-popover"
                                              onClick={(e) => e.stopPropagation()}
                                              style={{
                                                position: 'absolute',
                                                top: '100%',
                                                right: '0',
                                                marginTop: '4px',
                                                backgroundColor: '#1e1e1e',
                                                border: '1px solid #333',
                                                borderRadius: '6px',
                                                padding: '8px',
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                                zIndex: 1000,
                                                minWidth: '220px',
                                                textAlign: 'left'
                                              }}
                                            >
                                              <div style={{ marginBottom: '8px', fontSize: '12px', color: '#888' }}>
                                                SSH Credentials
                                              </div>
                                              <input
                                                type="text"
                                                value={shellPrompt.username}
                                                onChange={(e) => setShellPrompt({ ...shellPrompt, username: e.target.value })}
                                                placeholder="Username (e.g. ubuntu)"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    // Move to password
                                                    e.preventDefault();
                                                    document.getElementById(`shell-pass-${c.containerName}`)?.focus();
                                                  } else if (e.key === 'Escape') {
                                                    setShellPrompt(null);
                                                  }
                                                }}
                                                style={{
                                                  width: '100%',
                                                  boxSizing: 'border-box',
                                                  padding: '6px 8px',
                                                  backgroundColor: '#2a2a2a',
                                                  border: '1px solid #444',
                                                  borderRadius: '4px',
                                                  color: '#fff',
                                                  fontSize: '13px',
                                                  marginBottom: '8px'
                                                }}
                                              />
                                              <input
                                                id={`shell-pass-${c.containerName}`}
                                                type="password"
                                                value={shellPrompt.password || ''}
                                                onChange={(e) => setShellPrompt({ ...shellPrompt, password: e.target.value })}
                                                placeholder="Password (optional)"
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    saveSshUsername(app.name, shellPrompt.username || 'root');
                                                    handleContainerShell(app, c, shellPrompt.username || 'root', shellPrompt.password || '');
                                                    setShellPrompt(null);
                                                  } else if (e.key === 'Escape') {
                                                    setShellPrompt(null);
                                                  }
                                                }}
                                                style={{
                                                  width: '100%',
                                                  boxSizing: 'border-box',
                                                  padding: '6px 8px',
                                                  backgroundColor: '#2a2a2a',
                                                  border: '1px solid #444',
                                                  borderRadius: '4px',
                                                  color: '#fff',
                                                  fontSize: '13px',
                                                  marginBottom: '12px'
                                                }}
                                              />
                                              <button
                                                className="connect-btn primary"
                                                style={{ width: '100%', justifyContent: 'center' }}
                                                onClick={() => {
                                                  saveSshUsername(app.name, shellPrompt.username || 'root');
                                                  handleContainerShell(app, c, shellPrompt.username || 'root', shellPrompt.password || '');
                                                  setShellPrompt(null);
                                                }}
                                              >
                                                Connect
                                              </button>
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {expandedServiceId === idx && (
                              <div className="service-options">
                                {app.vncPort && (
                                  <div className="option-btn-container" style={{ position: 'relative' }}>
                                    <div
                                      className={`option-btn ${tunnelLoading === 'vnc' ? 'loading' : ''} ${sessionExpired ? 'disabled' : ''}`}
                                      onClick={() => {
                                        if (sessionExpired || tunnelLoading) return;
                                        setVncMenuAppId(vncMenuAppId === app.id ? null : app.id);
                                        setShowVncMenu(vncMenuAppId !== app.id);
                                      }}
                                    >
                                      {tunnelLoading === 'vnc' ? <Activity size={20} className="option-icon animate-spin" /> : <Monitor size={20} className="option-icon" />}
                                      <span className="option-label">Launch VNC</span>
                                      <ChevronDown size={16} style={{ marginLeft: '4px' }} />
                                    </div>
                                    {showVncMenu && vncMenuAppId === app.id && (
                                      <div ref={dropdownRef} className="dropdown-menu" style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        marginTop: '4px',
                                        backgroundColor: '#1e1e1e',
                                        border: '1px solid #333',
                                        borderRadius: '6px',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                        zIndex: 1000,
                                        minWidth: '200px'
                                      }}>
                                        <div
                                          className="dropdown-item"
                                          onClick={async () => {
                                            setShowVncMenu(false);
                                            setVncMenuAppId(null);
                                            try {
                                              setTunnelLoading('vnc');
                                              setGlobalStatus({ type: 'loading', message: `Starting VNC tunnel to localhost:${app.vncPort}...` });
                                              const vncTarget = 'localhost';
                                              addLog(`Starting VNC tunnel to ${vncTarget}:${app.vncPort}...`, 'info');
                                              const result = await StartTunnel(selectedNode.id, vncTarget, app.vncPort, 'vnc');
                                              const port = result.port || result;
                                              const tunnelId = result.tunnelId;
                                              addLog(`VNC tunnel active on localhost:${port}`, 'success');
                                              addTunnel('VNC', vncTarget, app.vncPort, port, tunnelId);

                                              // Open VNC in new window
                                              await window.electronAPI.openVncWindow({
                                                port: port,
                                                nodeName: selectedNode.name,
                                                appName: app.name,
                                                tunnelId: tunnelId
                                              });
                                              addLog(`VNC viewer opened in new window`, 'info');
                                              setExpandedServiceId(null);
                                            } catch (err) {
                                              console.error(err);
                                              handleTunnelError(err);
                                              addLog(`Failed to start VNC tunnel: ${err.message}`, 'error');
                                            } finally {
                                              setTunnelLoading(null);
                                              setGlobalStatus(null);
                                            }
                                          }}
                                          style={{
                                            padding: '10px 14px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            borderBottom: '1px solid #333'
                                          }}
                                        >
                                          <Monitor size={16} />
                                          <span>Open in Built-in Viewer</span>
                                        </div>
                                        <div
                                          className="dropdown-item"
                                          onClick={async () => {
                                            setShowVncMenu(false);
                                            setVncMenuAppId(null);
                                            try {
                                              setTunnelLoading('vnc');
                                              setGlobalStatus({ type: 'loading', message: `Starting VNC tunnel to localhost:${app.vncPort}...` });
                                              const vncTarget = 'localhost';
                                              addLog(`Starting VNC tunnel to ${vncTarget}:${app.vncPort}...`, 'info');
                                              const result = await StartTunnel(selectedNode.id, vncTarget, app.vncPort, 'vnc-tcp');
                                              const port = result.port || result;
                                              const tunnelId = result.tunnelId;
                                              addLog(`VNC tunnel active on localhost:${port}`, 'success');
                                              addTunnel('VNC', vncTarget, app.vncPort, port, tunnelId);
                                              setHighlightTunnels(true);
                                              setTimeout(() => setHighlightTunnels(false), 2000);
                                              addLog(
                                                `Connect your VNC client to localhost:${port}`,
                                                'info'
                                              );
                                              setExpandedServiceId(null);
                                            } catch (err) {
                                              console.error(err);
                                              handleTunnelError(err);
                                              addLog(`Failed to start VNC tunnel: ${err.message}`, 'error');
                                            } finally {
                                              setTunnelLoading(null);
                                              setGlobalStatus(null);
                                            }
                                          }}
                                          style={{
                                            padding: '10px 14px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                          }}
                                        >
                                          <ExternalLink size={16} />
                                          <span>Use External Client</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div
                                  className={`option-btn ${tunnelLoading === 'ssh' ? 'loading' : ''} ${sessionExpired ? 'disabled' : ''}`}
                                  onClick={() => {
                                    if (sessionExpired) {
                                      addLog('Cannot start SSH tunnel: EdgeView session has expired. Restart the session first.', 'warning');
                                      return;
                                    }
                                    if (tunnelLoading) return;
                                    const ip = app.ips && app.ips.length > 0 ? app.ips[0] : '10.2.255.254';
                                    const savedUser = getSavedSshUsername(app.name);
                                    setSshUser(savedUser);
                                    setSshTunnelConfig({ ip, appName: app.name });
                                  }}
                                >
                                  {tunnelLoading === 'ssh' ? <Activity size={20} className="option-icon animate-spin" /> : <Terminal size={20} className="option-icon" />}
                                  <span className="option-label">Launch SSH</span>
                                </div>
                                <div
                                  className={`option-btn ${tunnelLoading ? 'loading' : ''} ${sessionExpired ? 'disabled' : ''}`}
                                  onClick={() => {
                                    if (sessionExpired) {
                                      addLog('Cannot start TCP tunnel: EdgeView session has expired. Restart the session first.', 'warning');
                                      return;
                                    }
                                    if (tunnelLoading) return;
                                    const ip = app.ips && app.ips.length > 0 ? app.ips[0] : '127.0.0.1';
                                    setTcpTunnelConfig({ ip, appName: app.name, containers: app.containers });
                                    setTcpIpInput(ip);
                                    setTcpPortInput('80');
                                    setTcpError('');
                                  }}>
                                  <Activity size={20} className="option-icon" />
                                  <span className="option-label">TCP Tunnel</span>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="empty-state">No apps found</div>
                      )}
                      {globalError && (
                        <div className="error-message">
                          {globalError.includes("can't have more than 2 peers")
                            ? "All EdgeView sessions are occupied (max 2 concurrent sessions). Please reset the connection to free up a session slot."
                            : globalError.includes("no device online")
                              ? "Device is not connected to EdgeView. Real-time status and connections unavailable."
                              : `Warning: ${globalError}`}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div >
            ) : null}

            {selectedNode && <ActivityLog logs={logs} />}

            {tcpTunnelConfig && (
              <Modal
                title="Start TCP Tunnel"
                isOpen={!!tcpTunnelConfig}
                onDismiss={() => setTcpTunnelConfig(null)}
                size="small"
                footer={
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => setTcpTunnelConfig(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={startCustomTunnel}
                      disabled={!tcpIpInput || !tcpPortInput || !!tunnelLoading}
                      isLoading={tunnelLoading === 'tcp'}
                    >
                      Start Tunnel
                    </Button>
                  </>
                }
              >
                <div className="form-group">
                  <label>Target IP</label>
                  <input
                    type="text"
                    value={tcpIpInput}
                    onChange={(e) => setTcpIpInput(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Target Port</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="number"
                      value={tcpPortInput}
                      onChange={(e) => setTcpPortInput(e.target.value)}
                      placeholder="e.g. 8080"
                      style={{ width: '100px' }}
                    />

                    {tcpTunnelConfig && tcpTunnelConfig.containers && tcpTunnelConfig.containers.length > 0 && (() => {
                      // Flatten all exposed ports
                      const exposedPorts = tcpTunnelConfig.containers.flatMap(c =>
                        (c.portMaps || [])
                          .filter(pm => pm.publicPort > 0)
                          .map(pm => ({ ...pm, containerName: c.containerName }))
                      );

                      if (exposedPorts.length > 0) {
                        return (
                          <PortSelect
                            ports={exposedPorts}
                            selectedValue={tcpPortInput}
                            onChange={setTcpPortInput}
                            placeholder="Select exposed port..."
                          />
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>

                {tcpError && (
                  <div style={{ color: 'var(--color-danger)', fontSize: '13px', marginBottom: '16px' }}>
                    {tcpError}
                  </div>
                )}
              </Modal>
            )}

            {sshTunnelConfig && (
              <Modal
                title="Start SSH Session"
                isOpen={!!sshTunnelConfig}
                onDismiss={() => {
                  setSshTunnelConfig(null);
                  setSshError(null);
                }}
                size="small"
              >
                <div style={{ fontSize: '13px', marginBottom: '20px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                  {selectedNode?.name} • <span className="data-value-code">{sshTunnelConfig.ip}</span>
                </div>

                {sshError && (
                  <div className="error-banner-inline" style={{
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    border: '1px solid rgba(231, 76, 60, 0.3)',
                    color: 'var(--color-danger)',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <AlertCircle size={14} />
                    <span>{sshError}</span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '12px', marginBottom: '4px' }}>
                  <div className="form-group" style={{ flex: '3' }}>
                    <label>Username</label>
                    <input
                      type="text"
                      value={sshUser}
                      onChange={(e) => setSshUser(e.target.value)}
                      placeholder="root"
                    />
                  </div>
                  <div className="form-group" style={{ flex: '1' }}>
                    <label>Port</label>
                    <input
                      type="number"
                      value={sshPort}
                      onChange={(e) => setSshPort(e.target.value)}
                      placeholder="22"
                      min="1"
                      max="65535"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Password (Optional)</label>
                  <input
                    type="password"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    placeholder="Leave empty if using key-based auth"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') startSshModalTunnel('builtin');
                      if (e.key === 'Escape') setSshTunnelConfig(null);
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '20px' }}>
                  <Button
                    variant="primary"
                    onClick={() => startSshModalTunnel('builtin')}
                    isLoading={tunnelLoading === 'ssh'}
                    icon={!tunnelLoading && <Terminal size={14} />}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    Open Built-in Terminal
                  </Button>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      variant="secondary"
                      onClick={() => startSshModalTunnel('native')}
                      disabled={tunnelLoading}
                      style={{ flex: 1, justifyContent: 'center' }}
                      icon={<ExternalLink size={14} />}
                    >
                      Native Terminal
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => startSshModalTunnel('tunnel-only')}
                      disabled={tunnelLoading}
                      style={{ flex: 1, justifyContent: 'center' }}
                      icon={<Activity size={14} />}
                    >
                      Tunnel Only
                    </Button>
                  </div>
                </div>
              </Modal>
            )}

            {!selectedNode && (
              <div className="results-list">
                {loading && (
                  <div className="loading-state">
                    <Activity className="loading-icon animate-spin" size={24} />
                    <p>Loading nodes...</p>
                  </div>
                )}
                {displayNodes.length === 0 && !loading && (
                  <div className="empty-state">No results found</div>
                )}
                {recentNodes.length > 0 && (
                  <div className="section-header">Recent Devices</div>
                )}
                {recentNodes.map((node, index) => (
                  <div
                    key={node.id}
                    className={`result-item ${index === selectedIndex ? 'selected' : ''} ${node.status !== 'online' ? 'disabled' : ''}`}
                    onClick={() => handleConnect(node)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="node-icon">
                      {node.edgeView ? <Server size={18} /> : <Server size={18} />}
                    </div>
                    <div className="node-info">
                      <div className="node-name">
                        {node.name}
                        <span className="node-project" title={node.project}>
                          {' '}• {projects[node.project] || node.project}
                        </span>
                      </div>
                    </div>
                    <div className="node-status">
                      <span className={`status-dot ${node.status}`}></span>
                      {node.status}
                    </div>
                    {index === selectedIndex && node.status === 'online' && (
                      <div className="node-actions">
                        <span className="shortcut">↵ Details</span>
                      </div>
                    )}
                  </div>
                ))}
                {(recentNodes.length > 0 && otherNodes.length > 0) && (
                  <div className="section-header">All Devices</div>
                )}
                {otherNodes.map((node, index) => {
                  const globalIndex = index + recentNodes.length;
                  return (
                    <div
                      key={node.id}
                      className={`result-item ${globalIndex === selectedIndex ? 'selected' : ''} ${node.status !== 'online' ? 'disabled' : ''}`}
                      onClick={() => handleConnect(node)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                    >
                      <div className="node-icon">
                        {node.edgeView ? <Server size={18} /> : <Server size={18} />}
                      </div>
                      <div className="node-info">
                        <div className="node-name">
                          {node.name}
                          <span className="node-project" title={node.project}>
                            {' '}• {projects[node.project] || node.project}
                          </span>
                        </div>
                      </div>
                      <div className="node-status">
                        <span className={`status-dot ${node.status}`}></span>
                        {node.status}
                      </div>
                      {globalIndex === selectedIndex && node.status === 'online' && (
                        <div className="node-actions">
                          <span className="shortcut">↵ Details</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        <div className="status-bar">
          <div className="status-item">
            <Monitor size={14} />
            <span>{config.apiToken || (config.clusters && config.clusters.some(c => c.name === config.activeCluster && c.apiToken)) ? "Ready" : "Setup Required"}</span>
          </div>
          <div className="status-item center">
            <Tooltip text="Shows all tunnels currently open across all connected devices" position="top">
              <button
                className="link-button"
                onClick={() => setShowGlobalTunnels(prev => !prev)}
              >
                {showGlobalTunnels ? 'Hide All Tunnels' : 'All Tunnels'}
              </button>
            </Tooltip>
          </div>
          <div className="status-item right">
            <span>{showSettings ? "Configuration" : selectedNode ? "Device Details" : `${nodes.length} results`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ActivityLog({ logs }) {
  const logContentRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && logContentRef.current) {
      logContentRef.current.scrollTop = logContentRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!logContentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContentRef.current;

    // If user scrolls up, disable auto-scroll
    // Tolerance of 10px
    if (scrollHeight - scrollTop - clientHeight > 10) {
      setAutoScroll(false);
    } else {
      // If user scrolls to bottom, re-enable auto-scroll
      setAutoScroll(true);
    }
  };

  return (
    <div className="activity-log-section">
      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Activity Log</span>
        {!autoScroll && (
          <button
            className="link-button"
            style={{ fontSize: '11px' }}
            onClick={() => setAutoScroll(true)}
          >
            Resume Auto-scroll
          </button>
        )}
      </div>
      <div className="activity-log">
        <div
          className="log-content"
          ref={logContentRef}
          onScroll={handleScroll}
          onClick={() => setAutoScroll(false)}
        >
          {logs.length === 0 ? (
            <div className="log-entry muted">No activity recorded</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`log-entry ${log.type}`}>
                <span className="log-time">[{log.timestamp}]</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default App;