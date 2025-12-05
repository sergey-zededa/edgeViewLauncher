import React, { useState, useEffect, useRef } from 'react';
import { SearchNodes, ConnectToNode, GetSettings, SaveSettings, GetDeviceServices, SetupSSH, GetSSHStatus, DisableSSH, SetVGAEnabled, SetUSBEnabled, SetConsoleEnabled, ResetEdgeView, VerifyTunnel, GetUserInfo, GetEnterprise, GetProjects, GetSessionStatus, GetConnectionProgress, GetAppInfo, StartTunnel, CloseTunnel, ListTunnels, AddRecentDevice, VerifyToken } from './electronAPI';
import { Search, Settings, Server, Activity, Save, Monitor, ArrowLeft, Terminal, Globe, Lock, Unlock, AlertTriangle, ChevronDown, X, Plus, Check, AlertCircle, Cpu, Wifi, HardDrive, Clock, Hash, ExternalLink, Copy, Play, RefreshCw, Trash2, ArrowRight, Info } from 'lucide-react';
import eveOsIcon from './assets/eve-os.png';
import Tooltip from './components/Tooltip';
import About from './components/About';
import './components/Tooltip.css';
import './App.css';

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
  const [loadingMessage, setLoadingMessage] = useState('');
  const [tunnelLoading, setTunnelLoading] = useState(null);
  const [tunnelLoadingMessage, setTunnelLoadingMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [localPort, setLocalPort] = useState(null);
  const [tcpTunnelConfig, setTcpTunnelConfig] = useState(null); // { ip, appName }
  const [tcpPortInput, setTcpPortInput] = useState('');
  const [tcpIpInput, setTcpIpInput] = useState('');
  const [tcpError, setTcpError] = useState('');

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


  // Sync editingCluster with activeCluster when settings open
  useEffect(() => {
    if (showSettings) {
      const active = config.clusters.find(c => c.name === config.activeCluster);
      if (active) {
        setEditingCluster({ ...active });
        // Token verification disabled - will be re-enabled in future
        setTokenStatus(null);
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

  // Helper to detect user's time format preference (12h vs 24h)
  const getTimeFormatOptions = () => {
    return { hour12: !use24HourTime };
  };

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString(undefined, getTimeFormatOptions());
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  // Tunnel management functions
  const addTunnel = (type, targetIP, targetPort, localPort, tunnelId) => {
    const tunnel = {
      id: tunnelId,
      nodeId: selectedNode?.id,
      nodeName: selectedNode?.name,
      projectId: selectedNode?.project,
      type,
      targetIP,
      targetPort,
      localPort,
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
      setTunnelLoadingMessage(`Starting TCP tunnel to ${ip}:${port}...`);
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
      setTunnelLoadingMessage('');
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
    GetSettings().then(cfg => {
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
    });
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
      const newConfig = await GetSettings();
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
    setLoadingMessage("Fetching device services...");
    addLog(`Connecting to ${node.name}...`);
    setShowTerminal(false);

    GetDeviceServices(node.id, node.name).then(result => {
      addLog(`Services fetched from Cloud API`);
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
    setLoadingMessage("Checking SSH configuration...");
    addLog("Checking SSH status...");
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
        setLoadingMessage("Verifying EdgeView tunnel...");
        addLog("Verifying EdgeView tunnel connectivity...");
        try {
          await VerifyTunnel(nodeId);
          // Only set as connected if we also have a valid active session with expiry
          if (sessStatus && sessStatus.active && sessStatus.expiresAt) {
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
    }
  };

  const startSession = async (nodeId, useInApp) => {
    let cancelled = false;

    const pollProgress = async () => {
      if (cancelled) return;
      try {
        const progress = await GetConnectionProgress(nodeId);
        if (progress && typeof progress.status === 'string' && progress.status.trim().length > 0) {
          setLoadingMessage(progress.status);
        }
      } catch (e) {
        // Ignore polling errors – connection attempts may still be in progress.
      }
    };

    try {
      setShowTerminalMenu(false);
      setLoadingSSH(true);
      setLoadingMessage('Starting EdgeView session...');
      addLog(`Starting EdgeView SSH session (${useInApp ? 'In-App Terminal' : 'Native Terminal'})...`, 'info');

      // Start polling connection progress while backend works.
      pollProgress();
      const intervalId = setInterval(pollProgress, 1000);

      const result = await ConnectToNode(nodeId, useInApp);
      if (useInApp) {
        const match = result.match(/port (\d+)/);
        if (match && match[1]) {
          const port = match[1];
          window.electronAPI.openTerminalWindow({
            port: parseInt(port),
            nodeName: selectedNode.name,
            targetInfo: 'EVE-OS SSH',
            tunnelId: '' // Could be extracted from result if available
          });
        } else {
          console.error("Could not parse port from result:", result);
          setError({ type: 'error', message: "Failed to start terminal: Could not determine port." });
        }
      }
      const newConfig = await GetSettings();
      setConfig(newConfig);
      try {
        const sessStatus = await GetSessionStatus(nodeId);
        setSessionStatus(sessStatus);
      } catch (err) {
        console.error('Failed to refresh session status:', err);
      }
      if (selectedNode) {
        addLog('Refreshing services with EdgeView data...', 'info');
        try {
          const refreshed = await GetDeviceServices(nodeId, selectedNode.name);
          setServices(JSON.parse(refreshed));
          addLog('Services refreshed with enrichment data', 'success');
        } catch (err) {
          console.error('Failed to refresh services:', err);
        }
      }

      cancelled = true;
      clearInterval(intervalId);
      setLoadingMessage('');
      setLoadingSSH(false);
    } catch (err) {
      cancelled = true;
      setLoadingSSH(false);
      setLoadingMessage('');
      console.error('Failed to connect:', err);
      setError({ type: 'error', message: `Failed to connect: ${err.message || err} ` });
    }
  };

  const handleSetupSSH = async () => {
    if (!selectedNode) return;
    setLoadingSSH(true);
    setLoadingMessage("Enabling SSH access...");
    try {
      await SetupSSH(selectedNode.id);
      loadSSHStatus(selectedNode.id);
    } catch (err) {
      alert("Failed to setup SSH: " + err);
      setLoadingSSH(false);
    }
  };

  const handleDisableSSH = async () => {
    if (!selectedNode) return;
    if (!confirm("Are you sure you want to disable SSH access? This will remove the public key from the device.")) return;
    setLoadingSSH(true);
    try {
      await DisableSSH(selectedNode.id);
      loadSSHStatus(selectedNode.id);
    } catch (err) {
      alert("Failed to disable SSH: " + err);
      setLoadingSSH(false);
    }
  };

  const handleToggleVGA = async (enabled) => {
    if (!selectedNode) return;
    setLoadingSSH(true);
    try {
      await SetVGAEnabled(selectedNode.id, enabled);
      loadSSHStatus(selectedNode.id);  // Refresh to get updated status
      addLog(`VGA access ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      alert("Failed to toggle VGA: " + err);
      setLoadingSSH(false);
    }
  };

  const handleToggleUSB = async (enabled) => {
    if (!selectedNode) return;
    setLoadingSSH(true);
    try {
      await SetUSBEnabled(selectedNode.id, enabled);
      loadSSHStatus(selectedNode.id);  // Refresh to get updated status
      addLog(`USB access ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      alert("Failed to toggle USB: " + err);
      setLoadingSSH(false);
    }
  };

  const handleToggleConsole = async (enabled) => {
    if (!selectedNode) return;
    setLoadingSSH(true);
    try {
      await SetConsoleEnabled(selectedNode.id, enabled);
      loadSSHStatus(selectedNode.id);  // Refresh to get updated status
      addLog(`Console access ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      alert("Failed to toggle Console: " + err);
      setLoadingSSH(false);
    }
  };

  const handleResetEdgeView = async () => {
    if (!selectedNode) {
      setError({ type: 'error', message: "No node selected for reset." });
      return;
    }
    setLoadingSSH(true);
    setLoadingMessage("Resetting EdgeView session...");
    addLog("Initiating EdgeView session reset...");
    setError(null);
    try {
      await ResetEdgeView(selectedNode.id);
      addLog("Reset command sent successfully", 'success');
      setError({ type: 'success', message: 'EdgeView session restarted. Tunnel will reconnect in ~10 seconds.' });
      setTimeout(() => {
        setError(null);
        if (selectedNode) {
          addLog("Refreshing status after reset (waiting for tunnel)...");
          loadSSHStatus(selectedNode.id).catch(err => {
            console.error('Failed to refresh SSH status:', err);
            if (err.toString().includes("no device online")) {
              addLog("Tunnel still establishing...", 'warning');
            } else {
              addLog(`Failed to refresh status: ${err} `, 'error');
            }
          });
        }
      }, 15000);
    } catch (err) {
      console.error("ResetEdgeView failed:", err);
      const errMsg = err.message || String(err);

      // Check if it's a server error
      if (errMsg.includes('500') || errMsg.includes('internal server error')) {
        addLog(`Reset failed: ZEDEDA server error - unable to enable EdgeView on device`, 'error');
        setError({
          type: 'error',
          message: 'EdgeView session reset failed. The server cannot enable EdgeView on this device. The device may be offline or not support EdgeView.'
        });
      } else {
        addLog(`Reset failed: ${errMsg}`, 'error');
        setError({ type: 'error', message: `Failed to reset EdgeView: ${errMsg}` });
      }
    } finally {
      setLoadingSSH(false);
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

  const switchCluster = (name) => {
    setConfig({ ...config, activeCluster: name });
    const cluster = config.clusters.find(c => c.name === name);
    if (cluster) {
      setEditingCluster({ ...cluster });
    }
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
          clustersToSave[activeIndex] = editingCluster;
          activeToSave = editingCluster.name;
        }
      } else {
        // If no clusters exist, create one from editingCluster
        clustersToSave = [editingCluster];
        activeToSave = editingCluster.name;
      }

      await SaveSettings(clustersToSave, activeToSave);

      const settings = await GetSettings();
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

      setNodes([]);
      setProjects([]);
      setEnterprise(null);

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
            return (
              <>
                <span>{entName} • {url}</span>
                {tokenOwner && <span className="user-email">{tokenOwner}</span>}
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
                            navigator.clipboard.writeText(`localhost:${tunnel.localPort}`);
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
                            onClick={() => window.electronAPI.openTerminalWindow(tunnel.localPort)}
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
                            navigator.clipboard.writeText(`localhost:${tunnel.localPort}`);
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
                            onClick={() => window.electronAPI.openTerminalWindow(tunnel.localPort)}
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

                {loadingSSH ? (
                  <div className="ssh-loading">
                    <div className="loading-spinner-container">
                      <Activity className="animate-spin" size={18} />
                    </div>
                    <span className="loading-text">{loadingMessage || "Checking status..."}</span>
                  </div>
                ) : sshStatus ? (
                  <div className="ssh-details">
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
                            backgroundColor: sshStatus.status === 'enabled' ? 'rgba(35, 134, 54, 0.2)' : sshStatus.status === 'mismatch' ? 'rgba(210, 153, 34, 0.2)' : 'rgba(218, 54, 51, 0.2)',
                            color: sshStatus.status === 'enabled' ? '#238636' : sshStatus.status === 'mismatch' ? '#d29922' : '#da3633',
                            border: 'none'
                          }}
                        >
                          {sshStatus.status === 'enabled' ? <Unlock size={13} style={{ marginRight: '6px' }} /> :
                            sshStatus.status === 'mismatch' ? <AlertTriangle size={13} style={{ marginRight: '6px' }} /> :
                              <Lock size={13} style={{ marginRight: '6px' }} />}
                          SSH {sshStatus.status === 'enabled' ? 'Enabled' : sshStatus.status === 'mismatch' ? 'Key Mismatch' : 'Disabled'}
                        </div>

                        {/* VGA Control */}
                        <div
                          className={`config-chip ${sshStatus.vgaEnabled ? 'enabled' : 'disabled'}`}
                          onClick={() => handleToggleVGA(!sshStatus.vgaEnabled)}
                          title={sshStatus.vgaEnabled ? "VGA Enabled - Click to Disable" : "VGA Disabled - Click to Enable"}
                          style={{
                            display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                            fontSize: '12px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s',
                            backgroundColor: sshStatus.vgaEnabled ? 'rgba(35, 134, 54, 0.2)' : 'rgba(218, 54, 51, 0.2)',
                            color: sshStatus.vgaEnabled ? '#238636' : '#da3633',
                            border: 'none'
                          }}
                        >
                          <Monitor size={13} style={{ marginRight: '6px' }} />
                          VGA {sshStatus.vgaEnabled ? 'Enabled' : 'Disabled'}
                        </div>

                        {/* USB Control */}
                        <div
                          className={`config-chip ${sshStatus.usbEnabled ? 'enabled' : 'disabled'}`}
                          onClick={() => handleToggleUSB(!sshStatus.usbEnabled)}
                          title={sshStatus.usbEnabled ? "USB Enabled - Click to Disable" : "USB Disabled - Click to Enable"}
                          style={{
                            display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                            fontSize: '12px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s',
                            backgroundColor: sshStatus.usbEnabled ? 'rgba(35, 134, 54, 0.2)' : 'rgba(218, 54, 51, 0.2)',
                            color: sshStatus.usbEnabled ? '#238636' : '#da3633',
                            border: 'none'
                          }}
                        >
                          <Activity size={13} style={{ marginRight: '6px' }} />
                          USB {sshStatus.usbEnabled ? 'Enabled' : 'Disabled'}
                        </div>

                        {/* Console Control */}
                        <div
                          className={`config-chip ${sshStatus.consoleEnabled ? 'enabled' : 'disabled'}`}
                          onClick={() => handleToggleConsole(!sshStatus.consoleEnabled)}
                          title={sshStatus.consoleEnabled ? "Console Enabled - Click to Disable" : "Console Disabled - Click to Enable"}
                          style={{
                            display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                            fontSize: '12px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s',
                            backgroundColor: sshStatus.consoleEnabled ? 'rgba(35, 134, 54, 0.2)' : 'rgba(218, 54, 51, 0.2)',
                            color: sshStatus.consoleEnabled ? '#238636' : '#da3633',
                            border: 'none'
                          }}
                        >
                          <Terminal size={13} style={{ marginRight: '6px' }} />
                          Console {sshStatus.consoleEnabled ? 'Enabled' : 'Disabled'}
                        </div>

                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="error-text">Failed to check status</div>
                )}
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
              <div className={`error-message ${error.type === 'success' ? 'success-message' : ''}`}>
                {error.message}
              </div>
            ) : services ? (
              <div className="services-list">
                {tunnelLoading && (
                  <div className="tunnel-loading-banner">
                    <Activity className="loading-icon animate-spin" size={16} />
                    <span className="loading-text">
                      {tunnelLoadingMessage || 'Connecting tunnel...'}
                    </span>
                  </div>
                )}
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
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
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
                                              setTunnelLoadingMessage(`Starting VNC tunnel to localhost:${app.vncPort}...`);
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
                                              setTunnelLoadingMessage('');
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
                                              setTunnelLoadingMessage(`Starting VNC tunnel to localhost:${app.vncPort}...`);
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
                                              setTunnelLoadingMessage('');
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
                                  onClick={async () => {
                                    if (sessionExpired) {
                                      addLog('Cannot start SSH tunnel: EdgeView session has expired. Restart the session first.', 'warning');
                                      return;
                                    }
                                    if (tunnelLoading) return;
                                    try {
                                      setTunnelLoading('ssh');
                                      setTunnelLoadingMessage('Starting SSH tunnel to 10.2.255.254:22...');
                                      const sshTarget = '10.2.255.254';
                                      addLog(`Starting SSH tunnel to ${sshTarget}:22...`, 'info');
                                      const result = await StartTunnel(selectedNode.id, sshTarget, 22);
                                      const localPort = result.port || result;
                                      const tunnelId = result.tunnelId;
                                      addLog(`SSH tunnel active on localhost:${localPort}`, 'success');
                                      addTunnel('SSH', sshTarget, 22, localPort, tunnelId);
                                      setHighlightTunnels(true);
                                      setTimeout(() => setHighlightTunnels(false), 2000);
                                      addLog(
                                        `Connect to EVE-OS: ssh -p ${localPort} root@localhost`,
                                        'info'
                                      );
                                      setExpandedServiceId(null);
                                    } catch (err) {
                                      console.error(err);
                                      handleTunnelError(err);
                                      addLog(`Failed to start SSH tunnel: ${err.message}`, 'error');
                                    } finally {
                                      setTunnelLoading(null);
                                      setTunnelLoadingMessage('');
                                    }
                                  }}>
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
              </div>
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
                      style={{ width: '100%' }}
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
                      style={{ width: '100%' }}
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
