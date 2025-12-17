import React, { useState, useEffect, useRef } from 'react';
import { SearchNodes, ConnectToNode, GetSettings, SaveSettings, GetDeviceServices, SetupSSH, GetSSHStatus, DisableSSH, SetVGAEnabled, SetUSBEnabled, SetConsoleEnabled, ResetEdgeView, VerifyTunnel, GetUserInfo, GetEnterprise, GetProjects, GetSessionStatus, GetConnectionProgress, GetAppInfo, StartTunnel, CloseTunnel, ListTunnels, AddRecentDevice, VerifyToken, OnUpdateAvailable, OnUpdateNotAvailable, OnUpdateDownloadProgress, OnUpdateDownloaded, OnUpdateError, DownloadUpdate, InstallUpdate, SecureStorageStatus, SecureStorageMigrate, SecureStorageGetSettings, SecureStorageSaveSettings } from './electronAPI';
import { Search, Settings, Server, Activity, Save, Monitor, ArrowLeft, Terminal, Globe, Lock, Unlock, AlertTriangle, ChevronDown, X, Plus, Check, AlertCircle, Cpu, Wifi, HardDrive, Clock, Hash, ExternalLink, Copy, Play, RefreshCw, Trash2, ArrowRight, Info } from 'lucide-react';
import eveOsIcon from './assets/eve-os.png';
import Tooltip from './components/Tooltip';
import About from './components/About';
import UpdateBanner from './components/UpdateBanner';
import GlobalStatusBanner from './components/GlobalStatusBanner';
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

  // Settings editing state
  const [editingCluster, setEditingCluster] = useState({ name: '', baseUrl: '', apiToken: '' });
  const [saveStatus, setSaveStatus] = useState('');
  const [tokenStatus, setTokenStatus] = useState(null);
  const [settingsError, setSettingsError] = useState(null); // Track settings save errors
  const [globalStatus, setGlobalStatus] = useState(null);
  const [sshError, setSshError] = useState(null);

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
              addLog(`Tunnel closed: ${t.type} localhost:${t.localPort} -> ${t.targetIP}:${t.targetPort}`, 'info');
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


  // Sync editingCluster with activeCluster when settings open and load user info
  useEffect(() => {
    if (showSettings) {
      const active = config.clusters.find(c => c.name === config.activeCluster);
      if (active) {
        setEditingCluster({ ...active });
        // Token verification disabled - will be re-enabled in future
        setTokenStatus(null);
        // Load user info when opening settings
        if (active.apiToken) {
          loadUserInfo().catch(err => {
            console.log('Failed to load user info when opening settings:', err);
          });
        }
      }
    }
  }, [showSettings, config.activeCluster, config.clusters]);

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
    const cleaned = fullMessage
      .replace(/^Error invoking remote method '[^']+': Error: /, '')
      .replace(/^Error: /, '');
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
      createdAt: new Date().toISOString()
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

    try {
      setTcpError('');
      setTunnelLoading('tcp');
      setGlobalStatus({ type: 'loading', message: `Starting TCP tunnel to ${ip}:${port}...` });
      addLog(`Starting TCP tunnel to ${ip}:${port}...`, 'info');

      const result = await StartTunnel(selectedNode.id, ip, port);
      const localPort = result.port || result;
      const tunnelId = result.tunnelId;

      addLog(`TCP tunnel active: localhost:${localPort} -> ${ip}:${port}`, 'success');
      addTunnel('TCP', ip, port, localPort, tunnelId);
      setHighlightTunnels(true);
      setTimeout(() => setHighlightTunnels(false), 2000);

      setTcpTunnelConfig(null);
      setTcpPortInput('');
      setTcpIpInput('');
    } catch (err) {
      console.error(err);
      handleTunnelError(err);
      const msg = err.message || String(err);
      setTcpError(msg);
      addLog(`Failed to start TCP tunnel: ${msg}`, 'error');
    } finally {
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

    try {
      setTunnelLoading('ssh');
      const sshTarget = ip;
      setGlobalStatus({ type: 'loading', message: `Starting SSH tunnel to ${sshTarget}:${targetPort}...` });
      addLog(`Starting SSH tunnel to ${sshTarget}:${targetPort}...`, 'info');

      const result = await StartTunnel(selectedNode.id, sshTarget, targetPort);
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
    } catch (err) {
      console.error(err);
      handleTunnelError(err);
      setSshError(err.message);
      addLog(`Failed to start SSH tunnel: ${err.message}`, 'error');
    } finally {
      setTunnelLoading(null);
      setGlobalStatus(null);
    }
  };

  const removeTunnel = async (tunnelId) => {
    try {
      await CloseTunnel(tunnelId);
      setActiveTunnels(prev => prev.filter(t => t.id !== tunnelId));
      addLog(`Tunnel closed`, 'info');
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
      // If loadSSHStatus finishes first, we don't want to clear it.
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
      addLog("SSH access enabled successfully", 'success');
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
    setConfig({ ...config, clusters: newClusters, activeCluster: newName });
    setEditingCluster({ name: newName, baseUrl: '', apiToken: '' });
  };

  const deleteCluster = (name) => {
    const newClusters = config.clusters.filter(c => c.name !== name);
    let newActive = config.activeCluster;
    if (name === config.activeCluster) {
      newActive = newClusters.length > 0 ? newClusters[0].name : '';
    }
    setConfig({ ...config, clusters: newClusters, activeCluster: newActive });
  };

  const switchCluster = async (name) => {
    setConfig({ ...config, activeCluster: name });
    const cluster = config.clusters.find(c => c.name === name);
    if (cluster) {
      setEditingCluster({ ...cluster });
      // Refresh user info when switching clusters
      if (cluster.apiToken) {
        try {
          await loadUserInfo();
        } catch (err) {
          console.log('Failed to load user info for switched cluster:', err);
          // Don't block the switch, just log the error
        }
      }
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

  const saveSettings = async () => {
    setSettingsError(null); // Clear previous errors
    setSaveStatus('Saving...');

    try {
      let clustersToSave = [...config.clusters];
      let activeToSave = config.activeCluster;

      // Update the currently active cluster with the edited values
      if (clustersToSave.length > 0) {
        const activeIndex = clustersToSave.findIndex(c => c.name === config.activeCluster);
        if (activeIndex !== -1) {
          // Sanitize Base URL - remove trailing slashes
          const sanitizedCluster = { ...editingCluster };
          if (sanitizedCluster.baseUrl) {
            sanitizedCluster.baseUrl = sanitizedCluster.baseUrl.replace(/\/+$/, '');
          }

          clustersToSave[activeIndex] = sanitizedCluster;
          activeToSave = sanitizedCluster.name;
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

        if (active && active.apiToken) {
          try {
            await loadUserInfo();
            // If user info loads successfully, token is valid
            setSaveStatus('Settings saved successfully!');
            setTimeout(() => {
              setSaveStatus('');
              setShowSettings(false); // Only close on success
            }, 1500);
          } catch (err) {
            // Check if this is an authentication error
            if (err.message && (err.message.includes('401') || err.message.includes('unauthorized'))) {
              setSettingsError('Authentication failed. Please check your API token and Base URL.');
              setSaveStatus('');
              return; // Don't close settings
            }
            throw err; // Re-throw if it's a different error
          }
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
                    className={`cluster-item ${cluster.name === config.activeCluster ? 'active' : ''}`}
                    onClick={() => switchCluster(cluster.name)}
                  >
                    <div className="cluster-name">{cluster.name}</div>
                    {cluster.name === config.activeCluster && <div className="active-badge">Active</div>}
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
                    <div className={`token-status ${tokenStatus.valid ? 'valid' : 'expired'}`}>
                      {tokenStatus.valid ? <Check size={12} /> : <AlertCircle size={12} />}
                      {tokenStatus.message}
                    </div>
                  )}
                </div>

                {/* Token Info - only show for active cluster when userInfo is loaded */}
                {userInfo && editingCluster.name === config.activeCluster && (userInfo.tokenOwner || userInfo.tokenExpiry || userInfo.tokenRole || userInfo.lastLogin) && (
                  <div className="token-info-section">
                    <label>Token Status</label>
                    <div className="token-info-content">
                      {userInfo.tokenOwner && (
                        <div className="token-info-row">
                          <span className="token-info-label">Owner:</span>
                          <span className="token-info-value">{userInfo.tokenOwner}</span>
                        </div>
                      )}
                      {userInfo.tokenRole && (
                        <div className="token-info-row">
                          <span className="token-info-label">Role:</span>
                          <span className="token-info-value">{userInfo.tokenRole}</span>
                        </div>
                      )}
                      {userInfo.tokenExpiry && (() => {
                        const expiryDate = new Date(userInfo.tokenExpiry);
                        const now = new Date();
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
                      {userInfo.lastLogin && (() => {
                        const lastLoginDate = new Date(userInfo.lastLogin);
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

                <div className="settings-actions">
                  {saveStatus && (
                    <span className={`status-text ${saveStatus.includes('Success') ? 'success' : 'muted'}`}>
                      {saveStatus}
                    </span>
                  )}
                  <button className="save-btn" onClick={saveSettings}>
                    <Save size={16} /> Save Changes
                  </button>
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
                        </div>
                        <div className="tunnel-target">
                          <span>{tunnel.targetIP}:{tunnel.targetPort}</span>
                          <ArrowRight size={12} className="tunnel-arrow" />
                        </div>
                        <div className="tunnel-local">
                          <code>localhost:{tunnel.localPort}</code>
                        </div>
                        <button
                          className="icon-btn copy-btn"
                          title="Copy address"
                          onClick={() => {
                            if (tunnel.type === 'SSH') {
                              navigator.clipboard.writeText(`ssh -p ${tunnel.localPort} ${tunnel.username || 'root'}@localhost`);
                            } else {
                              navigator.clipboard.writeText(`localhost:${tunnel.localPort}`);
                            }
                          }}
                        >
                          <Copy size={12} />
                        </button>
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
                        </div>
                        <div className="tunnel-target">
                          <span>{tunnel.targetIP}:{tunnel.targetPort}</span>
                          <ArrowRight size={12} className="tunnel-arrow" />
                        </div>
                        <div className="tunnel-local">
                          <code>localhost:{tunnel.localPort}</code>
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
                          className="icon-btn copy-btn"
                          title="Copy address"
                          onClick={() => {
                            if (tunnel.type === 'SSH') {
                              navigator.clipboard.writeText(`ssh -p ${tunnel.localPort} ${tunnel.username || 'root'}@localhost`);
                            } else {
                              navigator.clipboard.writeText(`localhost:${tunnel.localPort}`);
                            }
                          }}
                        >
                          <Copy size={12} />
                        </button>
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
                  const servicesList = Array.isArray(services) ? services : (services.services || []);
                  const globalError = !Array.isArray(services) ? services.error : null;
                  return (
                    <>
                      {servicesList.length > 0 ? (
                        servicesList.map((app, idx) => (
                          <div key={idx} className="service-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div className="service-info">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                  <span className="service-name">
                                    {app.name}
                                    {app.pid && <span style={{ marginLeft: '8px', color: '#666', fontSize: '0.9em' }}>(PID: {app.pid})</span>}
                                  </span>
                                  <div className="service-meta">
                                    {app.ips && app.ips.length > 0 && (
                                      <span title="IP Addresses">{app.ips.join(', ')}</span>
                                    )}
                                    {app.vncPort && (
                                      <span style={{ marginLeft: app.ips && app.ips.length > 0 ? '8px' : '0' }}>
                                        • VNC: Port {app.vncPort}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="service-actions">
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
                                    setSshTunnelConfig({ ip });
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
                                    setTcpTunnelConfig({ ip, appName: app.name });
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
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 2100,
                }}
              >
                <div
                  style={{
                    backgroundColor: '#1e1e1e',
                    borderRadius: '8px',
                    padding: '16px 20px',
                    minWidth: '320px',
                    maxWidth: '420px',
                    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.4)',
                    border: '1px solid #333',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px' }}>Start TCP Tunnel</h4>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        setTcpTunnelConfig(null);
                        setTcpPortInput('');
                        setTcpIpInput('');
                        setTcpError('');
                      }}
                      title="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div style={{ fontSize: '12px', marginBottom: '10px', color: '#ccc' }}>
                    <div>Device: {selectedNode?.name}</div>
                    {tcpTunnelConfig.appName && <div>Application: {tcpTunnelConfig.appName}</div>}
                  </div>
                  <div className="form-group" style={{ marginBottom: '8px' }}>
                    <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>Target IP</label>
                    <input
                      type="text"
                      value={tcpIpInput}
                      onChange={(e) => setTcpIpInput(e.target.value)}
                      placeholder="e.g. 10.0.0.1, localhost"
                      style={{ width: '100%', padding: '8px', backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', color: '#fff', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: '8px' }}>
                    <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>Target Port</label>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={tcpPortInput}
                      onChange={(e) => setTcpPortInput(e.target.value)}
                      placeholder="e.g. 80, 8080"
                      style={{ width: '30%', minWidth: '80px', padding: '8px', backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', color: '#fff', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  {tcpError && (
                    <div className="error-text" style={{ marginBottom: '8px' }}>
                      {tcpError}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                    <button
                      className="connect-btn secondary"
                      onClick={() => {
                        setTcpTunnelConfig(null);
                        setTcpPortInput('');
                        setTcpIpInput('');
                        setTcpError('');
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className={`connect-btn primary ${tunnelLoading === 'tcp' ? 'loading' : ''}`}
                      onClick={startCustomTunnel}
                      disabled={tunnelLoading}
                    >
                      {tunnelLoading === 'tcp' ? (
                        <>
                          <Activity size={14} className="animate-spin" />
                          <span style={{ marginLeft: '6px' }}>Starting...</span>
                        </>
                      ) : (
                        'Start Tunnel'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {sshTunnelConfig && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 2100,
                }}
              >
                <div
                  style={{
                    backgroundColor: '#1e1e1e',
                    borderRadius: '8px',
                    padding: '16px 20px',
                    minWidth: '380px',
                    maxWidth: '480px',
                    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.4)',
                    border: '1px solid #333',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px' }}>Start SSH Session</h4>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        setSshTunnelConfig(null);
                        setSshError(null);
                      }}
                      title="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div style={{ fontSize: '12px', marginBottom: '20px', color: '#888', textAlign: 'center' }}>
                    {selectedNode?.name} • <span style={{ fontFamily: 'monospace' }}>{sshTunnelConfig.ip}</span>
                  </div>

                  {sshError && (
                    <div className="error-banner-inline" style={{
                      backgroundColor: 'rgba(231, 76, 60, 0.1)',
                      border: '1px solid rgba(231, 76, 60, 0.3)',
                      color: '#ff6b6b',
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

                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <div className="form-group" style={{ flex: '3' }}>
                      <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px', color: '#ccc' }}>Username</label>
                      <input
                        type="text"
                        value={sshUser}
                        onChange={(e) => setSshUser(e.target.value)}
                        placeholder="root"
                        style={{ width: '100%', padding: '8px 10px', backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', color: '#fff', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>

                    <div className="form-group" style={{ flex: '1' }}>
                      <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px', color: '#ccc' }}>Port</label>
                      <input
                        type="number"
                        value={sshPort}
                        onChange={(e) => setSshPort(e.target.value)}
                        placeholder="22"
                        min="1"
                        max="65535"
                        style={{ width: '100%', padding: '8px 10px', backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', color: '#fff', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: '24px' }}>
                    <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px', color: '#ccc' }}>Password (Optional)</label>
                    <input
                      type="password"
                      value={sshPassword}
                      onChange={(e) => setSshPassword(e.target.value)}
                      placeholder="Leave empty if using key-based auth"
                      style={{ width: '100%', padding: '8px', backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', color: '#fff', outline: 'none', boxSizing: 'border-box' }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') startSshModalTunnel('builtin');
                        if (e.key === 'Escape') setSshTunnelConfig(null);
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                    <button
                      className={`connect-btn primary ${tunnelLoading === 'ssh' ? 'loading' : ''}`}
                      onClick={() => startSshModalTunnel('builtin')}
                      disabled={tunnelLoading}
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      {tunnelLoading === 'ssh' ? (
                        <>
                          <Activity size={14} className="animate-spin" />
                          <span style={{ marginLeft: '6px' }}>Connecting...</span>
                        </>
                      ) : (
                        <>
                          <Terminal size={14} style={{ marginRight: '6px' }} />
                          Open Built-in Terminal
                        </>
                      )}
                    </button>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="connect-btn secondary"
                        onClick={() => startSshModalTunnel('native')}
                        disabled={tunnelLoading}
                        style={{ flex: 1, justifyContent: 'center' }}
                      >
                        <ExternalLink size={14} style={{ marginRight: '6px' }} />
                        Native Terminal
                      </button>
                      <button
                        className="connect-btn secondary"
                        onClick={() => startSshModalTunnel('tunnel-only')}
                        disabled={tunnelLoading}
                        style={{ flex: 1, justifyContent: 'center' }}
                      >
                        <Activity size={14} style={{ marginRight: '6px' }} />
                        Tunnel Only
                      </button>
                    </div>
                  </div>
                </div>
              </div>
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
          <div className="status-item">
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
