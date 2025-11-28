import React, { useState, useEffect, useRef } from 'react';
import { SearchNodes, ConnectToNode, GetSettings, SaveSettings, GetDeviceServices, SetupSSH, GetSSHStatus, DisableSSH, ResetEdgeView, VerifyTunnel, GetUserInfo, GetEnterprise, GetProjects, GetSessionStatus, GetAppInfo, StartTunnel, CloseTunnel, ListTunnels, AddRecentDevice } from './electronAPI';
import VncViewer from './components/VncViewer';
import { Search, Settings, Server, Activity, Save, Monitor, ArrowLeft, Terminal, Globe, Lock, Unlock, AlertTriangle, ChevronDown, X, Plus, Check, AlertCircle, Cpu, Wifi, HardDrive, Clock, Hash, ExternalLink, Copy, Play, RefreshCw, Trash2, ArrowRight } from 'lucide-react';
import eveOsIcon from './assets/eve-os.png';
import Tooltip from './components/Tooltip';
import './components/Tooltip.css';
import './App.css';

function App() {
  const [config, setConfig] = useState({ baseUrl: '', apiToken: '', clusters: [], activeCluster: '' });
  const [query, setQuery] = useState('');
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [enterprise, setEnterprise] = useState(null);
  const [projects, setProjects] = useState([]);

  // Device Details State
  const [services, setServices] = useState(null);
  const [loadingServices, setLoadingServices] = useState(false);
  const [sshStatus, setSshStatus] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [loadingSSH, setLoadingSSH] = useState(false);
  const [expandedServiceId, setExpandedServiceId] = useState(null);
  const [highlightTunnels, setHighlightTunnels] = useState(false);
  const [activeVncSession, setActiveVncSession] = useState(null); // { url, port }
  const [activeTunnels, setActiveTunnels] = useState([]); // Track active tunnels
  const [tunnelConnected, setTunnelConnected] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [localPort, setLocalPort] = useState(null);

  // Dropdown state
  const [showTerminalMenu, setShowTerminalMenu] = useState(false);
  const dropdownRef = useRef(null);

  // Settings editing state
  const [editingCluster, setEditingCluster] = useState({ name: '', baseUrl: '', apiToken: '' });
  const [saveStatus, setSaveStatus] = useState('');
  const [tokenStatus, setTokenStatus] = useState(null);

  // Helper to check token validity
  const validateToken = (token) => {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is empty or invalid type' };
    }
    const parts = token.split(':');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid format (expected: name:key)' };
    }
    const [tokenName, base64Key] = parts;
    if (tokenName.length !== 7) {
      return { valid: false, error: `Token name should be 7 characters (got ${tokenName.length})` };
    }
    if (base64Key.length < 170 || base64Key.length > 180) {
      return { valid: false, error: `Session key length unusual (${base64Key.length} chars, expected ~171)` };
    }
    const base64Regex = /^[A-Za-z0-9_-]+$/;
    if (!base64Regex.test(base64Key)) {
      return { valid: false, error: 'Session key contains invalid characters (must be base64)' };
    }
    return { valid: true };
  };

  const handleTokenPaste = (token) => {
    setEditingCluster({ ...editingCluster, apiToken: token });
    const status = validateToken(token);
    setTokenStatus(status.valid ? { valid: true, message: "Valid token format" } : { valid: false, message: status.error });
  };

  // Sync tunnels on node selection
  useEffect(() => {
    if (selectedNode) {
      ListTunnels(selectedNode.id).then(tunnels => {
        if (tunnels) {
          const mapped = tunnels.map(t => ({
            id: t.ID,
            nodeId: t.NodeID,
            nodeName: selectedNode.name,
            type: t.Type,
            targetIP: t.TargetIP.split(':')[0],
            targetPort: parseInt(t.TargetIP.split(':')[1] || '0'),
            localPort: t.LocalPort,
            createdAt: t.CreatedAt
          }));
          setActiveTunnels(mapped);
        }
      }).catch(err => console.error("Failed to list tunnels:", err));
    } else {
      setActiveTunnels([]);
    }
  }, [selectedNode]);

  // Sync editingCluster with activeCluster when settings open
  useEffect(() => {
    if (showSettings) {
      const active = config.clusters.find(c => c.name === config.activeCluster);
      if (active) {
        setEditingCluster({ ...active });
        // Also validate the token immediately for visual feedback
        if (active.apiToken) {
          const status = validateToken(active.apiToken);
          setTokenStatus(status.valid ? { valid: true, message: "Valid token format" } : { valid: false, message: status.error });
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

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  // Tunnel management functions
  const addTunnel = (type, targetIP, targetPort, localPort, tunnelId) => {
    const tunnel = {
      id: tunnelId,
      nodeId: selectedNode?.id,
      nodeName: selectedNode?.name,
      type,
      targetIP,
      targetPort,
      localPort,
      createdAt: new Date().toISOString()
    };
    setActiveTunnels(prev => [...prev, tunnel]);
    return tunnel;
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
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    } catch (err) {
      console.log('Error loading user info:', err);
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
      try {
        const results = await SearchNodes(query);
        setNodes(results || []);
        setSelectedIndex(0);
      } catch (err) {
        console.error(err);
        setNodes([]);
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
    try {
      const status = await GetSSHStatus(nodeId);
      setSshStatus(status);
      addLog(`SSH Status: ${status.status} `);
      try {
        const sessStatus = await GetSessionStatus(nodeId);
        setSessionStatus(sessStatus);
        if (sessStatus.active) {
          addLog(`EdgeView session active(expires: ${new Date(sessStatus.expiresAt).toLocaleString()})`, 'success');
        }
      } catch (err) {
        console.error('Failed to get session status:', err);
      }
      if (checkTunnel) {
        setLoadingMessage("Verifying EdgeView tunnel...");
        addLog("Verifying EdgeView tunnel connectivity...");
        try {
          await VerifyTunnel(nodeId);
          setTunnelConnected(true);
          addLog("EdgeView session verified: Connected", 'success');
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
    try {
      setShowTerminalMenu(false);
      const result = await ConnectToNode(nodeId, useInApp);
      if (useInApp) {
        const match = result.match(/port (\d+)/);
        if (match && match[1]) {
          const port = match[1];
          window.electronAPI.openTerminalWindow(port);
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
          const result = await GetDeviceServices(nodeId, selectedNode.name);
          setServices(JSON.parse(result));
          addLog('Services refreshed with enrichment data', 'success');
        } catch (err) {
          console.error('Failed to refresh services:', err);
        }
      }
    } catch (err) {
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
      addLog(`Reset failed: ${err} `, 'error');
      setError({ type: 'error', message: `Failed to reset EdgeView: ${err.message || err} ` });
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
      setShowSettings(false);
      setNodes([]);
      setProjects([]);
      setEnterprise(null);
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
        const active = newConfig.clusters.find(c => c.name === newConfig.activeCluster);
        if (active && active.apiToken) {
          loadUserInfo();
        }
      }
      if (query) {
        const currentQuery = query;
        setQuery('');
        setTimeout(() => setQuery(currentQuery), 100);
      } else {
        setLoading(true);
        SearchNodes('').then(results => {
          setNodes(results || []);
          setSelectedIndex(0);
        }).catch(err => {
          console.error("Failed to fetch nodes after save:", err);
          setNodes([]);
        }).finally(() => setLoading(false));
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
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
            return `${entName} • ${url}`;
          })()}
        </div>
      )}
      <div className="search-bar">
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
        <Settings className="settings-icon" size={20} onClick={() => setShowSettings(!showSettings)} />
      </div>

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
                <div className="form-group">
                  <label>Base URL</label>
                  <input
                    type="text"
                    value={editingCluster.baseUrl}
                    onChange={(e) => setEditingCluster({ ...editingCluster, baseUrl: e.target.value })}
                    placeholder="https://..."
                  />
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
            {selectedNode && activeTunnels.filter(t => t.nodeId === selectedNode.id).length > 0 && (
              <div className={`active-tunnels-section ${highlightTunnels ? 'highlight' : ''}`}>
                <div className="section-title">Active Tunnels</div>
                <div className="tunnel-list">
                  {activeTunnels.filter(t => t.nodeId === selectedNode.id).map(tunnel => (
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

            {selectedNode && (
              <div className="ssh-status-section">
                <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>EdgeView Session</span>
                  <div className="split-btn-container" ref={dropdownRef}>
                    <button
                      className={`connect-btn primary split-main`}
                      onClick={() => setShowTerminalMenu(!showTerminalMenu)}
                      disabled={!sshStatus || sshStatus.status !== 'enabled' || !tunnelConnected}
                      title={(!sshStatus || sshStatus.status !== 'enabled') ? "SSH must be enabled first" : !tunnelConnected ? "Tunnel is disconnected" : "Open SSH Terminal"}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', fontSize: '12px' }}
                    >
                      <Terminal size={16} />
                      <img src={eveOsIcon} alt="EVE-OS" style={{ height: '14px', width: 'auto' }} />
                      EVE-OS SSH Terminal
                    </button>
                    <button
                      className={`connect-btn primary split-arrow`}
                      onClick={() => setShowTerminalMenu(!showTerminalMenu)}
                      disabled={!sshStatus || sshStatus.status !== 'enabled' || !tunnelConnected}
                      style={{ padding: '6px 8px' }}
                    >
                      <ChevronDown size={14} />
                    </button>
                    {showTerminalMenu && (
                      <div className="dropdown-menu">
                        <div className="dropdown-item" onClick={() => startSession(selectedNode.id, false)}>
                          Native Terminal
                        </div>
                        <div className="dropdown-item" onClick={() => startSession(selectedNode.id, true)}>
                          In-App Terminal (xTerm.js)
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
                      <div className="status-item">
                        <span className="status-label">SSH Status</span>
                        <div className={`status-value ${sshStatus.status}`}>
                          {sshStatus.status === 'enabled' ? <Unlock size={14} /> :
                            sshStatus.status === 'mismatch' ? <AlertTriangle size={14} /> :
                              sshStatus.status === 'error' ? <AlertCircle size={14} /> : <Lock size={14} />}
                          {sshStatus.status.charAt(0).toUpperCase() + sshStatus.status.slice(1)}
                        </div>
                      </div>
                      <div className="status-item">
                        <div className="status-label">SESSION</div>
                        <div className={`status-value ${tunnelConnected ? 'success' : 'error'}`}>
                          {tunnelConnected ? (
                            <><Check size={14} /> Connected</>
                          ) : (
                            <><X size={14} /> Disconnected</>
                          )}
                        </div>
                      </div>
                      <div className="status-item">
                        <span className="status-label">Expires</span>
                        <span className="value">
                          {sessionStatus && sessionStatus.expiresAt ? (
                            <span title={new Date(sessionStatus.expiresAt).toLocaleString()}>
                              {getRelativeTime(new Date(sessionStatus.expiresAt).getTime())}
                            </span>
                          ) : sshStatus.expiry ? (
                            <span title={new Date(parseInt(sshStatus.expiry) * 1000).toLocaleString()}>
                              {getRelativeTime(parseInt(sshStatus.expiry) * 1000)}
                            </span>
                          ) : '-'}
                        </span>
                      </div>
                    </div>
                    <div className="ssh-controls" style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '5px' }}>
                      {sshStatus.status === 'enabled' ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <div className="status-badge enabled">
                            <Unlock size={14} /> SSH Enabled
                          </div>
                          <Tooltip text="Remove public key and disable SSH access on the device">
                            <button className="action-link danger" onClick={handleDisableSSH}>
                              Disable EVE-OS SSH
                            </button>
                          </Tooltip>
                        </div>
                      ) : sshStatus.status === 'mismatch' ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <div className="status-badge warning" title="Key on device does not match local key">
                            <AlertTriangle size={14} /> Key Mismatch
                          </div>
                          <div className="ssh-actions-row">
                            <Tooltip text="Remove public key and disable SSH access on the device">
                              <button className="action-link danger" onClick={handleDisableSSH}>
                                Disable SSH
                              </button>
                            </Tooltip>
                            <span className="separator">•</span>
                            <Tooltip text="Replace device's SSH public key with your local key">
                              <button className="action-link" onClick={handleSetupSSH}>
                                Re-enable SSH
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <div className="status-badge disabled">
                            <Lock size={14} /> Disabled
                          </div>
                          <Tooltip text="Install your local SSH public key on the device">
                            <button className="action-link" onClick={handleSetupSSH}>
                              Enable EVE-OS SSH
                            </button>
                          </Tooltip>
                        </div>
                      )}
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
                                  title="Connect to service"
                                >
                                  <Globe size={14} /> {expandedServiceId === idx ? 'Close' : 'Connect'}
                                </button>
                              </div>
                            </div>
                            {expandedServiceId === idx && (
                              <div className="service-options">
                                {app.vncPort && (
                                  <div
                                    className={`option-btn ${loadingServices ? 'loading' : ''}`}
                                    onClick={async () => {
                                      if (loadingServices) return;
                                      try {
                                        setLoadingServices(true);
                                        const vncTarget = 'localhost';
                                        addLog(`Starting VNC tunnel to ${vncTarget}:${app.vncPort}...`, 'info');
                                        const result = await StartTunnel(selectedNode.id, vncTarget, app.vncPort);
                                        const port = result.port || result;
                                        const tunnelId = result.tunnelId;
                                        addLog(`VNC Tunnel active on localhost:${port}`, 'success');
                                        addTunnel('VNC', vncTarget, app.vncPort, port, tunnelId);
                                        setHighlightTunnels(true);
                                        setTimeout(() => setHighlightTunnels(false), 2000);
                                        const vncUrl = `vnc://localhost:${port}`;
                                        window.electronAPI.openExternal(vncUrl);
                                        addLog(`Launching VNC viewer with ${vncUrl}`, 'info');
                                        addLog(`Note: macOS Screen Sharing may ask for a password. Try pressing Enter.`, 'warning');
                                        setExpandedServiceId(null);
                                      } catch (err) {
                                        console.error(err);
                                        addLog(`Failed to start VNC tunnel: ${err.message}`, 'error');
                                      } finally {
                                        setLoadingServices(false);
                                      }
                                    }}>
                                    {loadingServices ? <Activity size={20} className="option-icon animate-spin" /> : <Monitor size={20} className="option-icon" />}
                                    <span className="option-label">Launch VNC</span>
                                  </div>
                                )}
                                <div
                                  className={`option-btn ${loadingServices ? 'loading' : ''}`}
                                  onClick={async () => {
                                    if (loadingServices) return;
                                    try {
                                      setLoadingServices(true);
                                      const sshTarget = '10.2.255.254';
                                      addLog(`Starting SSH tunnel to ${sshTarget}:22...`, 'info');
                                      const result = await StartTunnel(selectedNode.id, sshTarget, 22);
                                      const localPort = result.port || result;
                                      const tunnelId = result.tunnelId;
                                      addLog(`SSH Tunnel active on localhost:${localPort}`, 'success');
                                      addTunnel('SSH', sshTarget, 22, localPort, tunnelId);
                                      setHighlightTunnels(true);
                                      setTimeout(() => setHighlightTunnels(false), 2000);
                                      setExpandedServiceId(null);
                                    } catch (err) {
                                      console.error(err);
                                      addLog(`Failed to start SSH tunnel: ${err.message}`, 'error');
                                    } finally {
                                      setLoadingServices(false);
                                    }
                                  }}>
                                  {loadingServices ? <Activity size={20} className="option-icon animate-spin" /> : <Terminal size={20} className="option-icon" />}
                                  <span className="option-label">SSH Terminal</span>
                                </div>
                                <div className="option-btn" onClick={async () => {
                                  try {
                                    const portInput = prompt("Enter target port (e.g. 80, 8080):", "80");
                                    if (!portInput) return;
                                    const port = parseInt(portInput);
                                    if (isNaN(port)) {
                                      alert("Invalid port number");
                                      return;
                                    }
                                    const ip = app.ips && app.ips.length > 0 ? app.ips[0] : '127.0.0.1';
                                    addLog(`Starting TCP tunnel to ${ip}:${port}...`, 'info');
                                    const result = await StartTunnel(selectedNode.id, ip, port);
                                    const localPort = result.port || result;
                                    const tunnelId = result.tunnelId;
                                    addLog(`TCP Tunnel active: localhost:${localPort} -> ${ip}:${port}`, 'success');
                                    addTunnel('TCP', ip, port, localPort, tunnelId);
                                    setHighlightTunnels(true);
                                    setTimeout(() => setHighlightTunnels(false), 2000);
                                    alert(`Tunnel Active!\n\nConnect to: localhost:${localPort}\n\nForwards to: ${ip}:${port}`);
                                    setExpandedServiceId(null);
                                  } catch (err) {
                                    console.error(err);
                                    addLog(`Failed to start TCP tunnel: ${err.message}`, 'error');
                                  }
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
          <div className="status-item right">
            <span>{showSettings ? "Configuration" : selectedNode ? "Device Details" : `${nodes.length} results`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ActivityLog({ logs }) {
  return (
    <div className="activity-log-section">
      <div className="section-title">Activity Log</div>
      <div className="activity-log">
        <div className="log-content">
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
