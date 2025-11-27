import { useState, useEffect, useRef } from 'react';
import { SearchNodes, ConnectToNode, GetSettings, SaveSettings, GetDeviceServices, SetupSSH, GetSSHStatus, DisableSSH, ResetEdgeView, VerifyTunnel, GetUserInfo, GetEnterprise, GetProjects, GetSessionStatus, GetAppInfo, StartTunnel, CloseTunnel, ListTunnels, AddRecentDevice } from './electronAPI';
import VncViewer from './components/VncViewer';
import { Search, Settings, Server, Activity, Save, Monitor, ArrowLeft, Terminal, Globe, Lock, Unlock, AlertTriangle, ChevronDown, X, Plus, Check, AlertCircle, Cpu, Wifi, HardDrive, Clock, Hash, ExternalLink, Copy, Play, RefreshCw } from 'lucide-react';
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

  // Helper to check token validity
  // Validate Zededa API token format per API_TOKEN_ANALYSIS.md
  // Format: <7-char-random>:<base64-128-bytes> (total ~180 chars)
  // Note: Zededa tokens are NOT JWTs - they're opaque random data
  // Expiration is stored server-side in Redis, not in the token itself
  const validateToken = (token) => {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is empty or invalid type' };
    }

    // Check basic format: must contain exactly one colon
    const parts = token.split(':');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid format (expected: name:key)' };
    }

    const [tokenName, base64Key] = parts;

    // Validate token name: should be 7 characters
    if (tokenName.length !== 7) {
      return {
        valid: false,
        error: `Token name should be 7 characters (got ${tokenName.length})`
      };
    }

    // Validate base64 key: 128 bytes → ~171 base64 chars
    // Allow some flexibility (170-175 chars)
    if (base64Key.length < 170 || base64Key.length > 180) {
      return {
        valid: false,
        error: `Session key length unusual (${base64Key.length} chars, expected ~171)`
      };
    }

    // Check if it looks like base64
    const base64Regex = /^[A-Za-z0-9_-]+$/;
    if (!base64Regex.test(base64Key)) {
      return {
        valid: false,
        error: 'Session key contains invalid characters (must be base64)'
      };
    }

    return { valid: true };
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
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

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
  // error state already declared above
  const [loadingMessage, setLoadingMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [localPort, setLocalPort] = useState(null);

  // Dropdown state
  const [showTerminalMenu, setShowTerminalMenu] = useState(false);
  const dropdownRef = useRef(null);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  // Tunnel management functions
  const addTunnel = (type, targetIP, targetPort, localPort, tunnelId) => {
    const tunnel = {
      id: tunnelId, // Use backend ID
      nodeId: selectedNode?.id,
      nodeName: selectedNode?.name,
      type, // 'SSH', 'VNC', 'TCP'
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
      // Remove from UI anyway if it's gone
      setActiveTunnels(prev => prev.filter(t => t.id !== tunnelId));
    }
  };


  useEffect(() => {
    // Close dropdown when clicking outside
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
      // Fetch enterprise info
      const ent = await GetEnterprise();
      setEnterprise(ent);

      // Fetch projects
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
    // Load settings on start
    GetSettings().then(cfg => {
      if (cfg) {
        setConfig({
          baseUrl: cfg.baseUrl || '',
          apiToken: cfg.apiToken || '',
          clusters: cfg.clusters || [],
          activeCluster: cfg.activeCluster || '',
          recentDevices: cfg.recentDevices || []
        });

        // If we have a token (either legacy or active cluster), load info
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
      // If query is empty, we still want to fetch all nodes to show recents/all
      setLoading(true);
      try {
        const results = await SearchNodes(query);
        setNodes(results || []);
        setSelectedIndex(0);
      } catch (err) {
        console.error(err);
        setNodes([]); // Clear on error
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(search, 300);
    return () => clearTimeout(timeoutId);
  }, [query]);

  // Refresh config when connecting to update recents
  const handleConnect = async (node) => {
    if (node.status !== 'online') return;

    // Add to recents immediately
    try {
      await AddRecentDevice(node.id);
      const newConfig = await GetSettings();
      setConfig(newConfig);
    } catch (err) {
      console.error("Failed to update recents:", err);
    }

    // Select node and fetch services
    setSelectedNode(node);
    setServices(null);
    setSshStatus(null);
    setLogs([]); // Clear logs on new connection
    setLoadingServices(true);
    setLoadingSSH(true);
    setLoadingMessage("Fetching device services...");
    addLog(`Connecting to ${node.name}...`);
    setShowTerminal(false); // Reset terminal view

    // Fetch Services (Cloud API)
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
      // Refresh session status again in case GetDeviceServices created a new session
      GetSessionStatus(node.id).then(status => {
        if (status.active) {
          setSessionStatus(status);
          addLog(`EdgeView session active (refreshed)`, 'success');
        }
      }).catch(console.error);
    });

    // Fetch SSH Status and Verify Tunnel
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

      // Fetch session status
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
          // Explicitly verify tunnel connectivity
          await VerifyTunnel(nodeId);
          setTunnelConnected(true);
          addLog("Tunnel verified: Connected", 'success');
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
      setShowTerminalMenu(false); // Close menu

      // Pass the terminal preference to the backend
      // Note: ConnectToNode in backend handles launching native terminal if useInApp is false
      // If useInApp is true, it just sets up the tunnel and returns success, 
      // and we handle the UI here.
      // Pass the terminal preference to the backend
      const result = await ConnectToNode(nodeId, useInApp);

      if (useInApp) {
        // Parse port from "Session started on port X"
        const match = result.match(/port (\d+)/);
        if (match && match[1]) {
          const port = match[1];
          window.electronAPI.openTerminalWindow(port);
        } else {
          console.error("Could not parse port from result:", result);
          setError({ type: 'error', message: "Failed to start terminal: Could not determine port." });
        }
      }

      // Refresh config to get updated recents
      const newConfig = await GetSettings();
      setConfig(newConfig);

      // Refresh session status
      try {
        const sessStatus = await GetSessionStatus(nodeId);
        setSessionStatus(sessStatus);
      } catch (err) {
        console.error('Failed to refresh session status:', err);
      }

      // Refresh services to trigger enrichment with newly cached session
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
      refreshSSHStatus(selectedNode.id);
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
      refreshSSHStatus(selectedNode.id);
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

      // Clear success message after a few seconds
      setTimeout(() => {
        setError(null);
        // Optionally refresh status
        if (selectedNode) {
          addLog("Refreshing status after reset (waiting for tunnel)...");
          loadSSHStatus(selectedNode.id).catch(err => {
            console.error('Failed to refresh SSH status:', err);
            // Don't log as error if it's just not ready yet
            if (err.toString().includes("no device online")) {
              addLog("Tunnel still establishing...", 'warning');
            } else {
              addLog(`Failed to refresh status: ${err} `, 'error');
            }
          });
        }
      }, 15000); // Wait 15s for tunnel to re-establish
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

  // Filter nodes
  const recentIds = config.recentDevices || [];
  const recentNodes = nodes.filter(n => recentIds.includes(n.id));
  // Sort recents by order in config
  recentNodes.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));

  const otherNodes = nodes.filter(n => !recentIds.includes(n.id));

  // Combined list for navigation
  const displayNodes = [...recentNodes, ...otherNodes];

  // Helper to get node from index
  const getNodeAtIndex = (index) => {
    return displayNodes[index];
  }

  const handleKeyDown = (e) => {
    if (showSettings || selectedNode) return; // Disable nav when settings/details open

    if (e.key === 'ArrowDown') {
      setSelectedIndex(prev => Math.min(prev + 1, displayNodes.length - 1));
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      const node = getNodeAtIndex(selectedIndex);
      if (node) {
        handleConnect(node);
      }
    } else if (e.metaKey && e.key === ',') {
      e.preventDefault();
      setShowSettings(true);
    }
  };

  const saveConfig = async () => {
    try {
      // If we have clusters, save them. If not (legacy UI state), create a default one.
      let clustersToSave = config.clusters;
      let activeToSave = config.activeCluster;

      if (!clustersToSave || clustersToSave.length === 0) {
        // Fallback for safety, though UI should prevent this
        clustersToSave = [{
          name: 'Default Cluster',
          baseUrl: config.baseUrl,
          apiToken: config.apiToken
        }];
        activeToSave = 'Default Cluster';
      }

      await SaveSettings(clustersToSave, activeToSave);
      setShowSettings(false);

      // Clear current data and refresh
      setNodes([]);
      setProjects([]);
      setEnterprise(null);

      // Reload settings to get any backend normalizations
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

        // Force reload of user info if we have a valid active cluster
        const active = newConfig.clusters.find(c => c.name === newConfig.activeCluster);
        if (active && active.apiToken) {
          loadUserInfo();
        }
      }

      // Trigger search refresh
      if (query) {
        const currentQuery = query;
        setQuery(''); // Clear first
        setTimeout(() => setQuery(currentQuery), 100); // Then restore to trigger effect
      } else {
        // If no query, fetch all nodes immediately to show the full list for the new cluster
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
            // Find active cluster to display
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="search-input"
            disabled={showSettings}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            autoComplete="off"
          />
        )}

        {loading && <Activity className="loading-icon animate-spin" size={16} />}
        <Settings
          className="settings-icon"
          size={18}
          onClick={() => setShowSettings(true)}
        />
      </div>

      {showSettings ? (
        <div className="settings-panel">
          <div className="settings-header">
            <h2>Cluster Configuration</h2>
            <button className="close-btn" onClick={() => setShowSettings(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="clusters-container">
            <div className="cluster-list">
              <div className="list-header">
                <span>Clusters</span>
                <button
                  className="add-cluster-btn"
                  onClick={() => {
                    const newName = `Cluster ${config.clusters.length + 1}`;
                    const newClusters = [...config.clusters, { name: newName, baseUrl: '', apiToken: '' }];
                    setConfig({ ...config, clusters: newClusters, activeCluster: newName });
                  }}
                >
                  <Plus size={14} /> Add
                </button>
              </div>
              {config.clusters.map((cluster, idx) => (
                <div
                  key={idx}
                  className={`cluster-item ${cluster.name === config.activeCluster ? 'active' : ''}`}
                  onClick={() => setConfig({ ...config, activeCluster: cluster.name })}
                >
                  <div className="cluster-name">{cluster.name}</div>
                  {cluster.name === config.activeCluster && <div className="active-badge">Active</div>}
                  {config.clusters.length > 1 && (
                    <button
                      className="delete-cluster-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        const newClusters = config.clusters.filter(c => c.name !== cluster.name);
                        let newActive = config.activeCluster;
                        if (cluster.name === config.activeCluster) {
                          newActive = newClusters[0].name;
                        }
                        setConfig({ ...config, clusters: newClusters, activeCluster: newActive });
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="cluster-details">
              {(() => {
                const activeCluster = config.clusters.find(c => c.name === config.activeCluster);
                if (!activeCluster) return <div className="no-cluster-selected">Select a cluster</div>;

                const tokenValidation = validateToken(activeCluster.apiToken);

                return (
                  <>
                    <div className="form-group">
                      <label>Cluster Name</label>
                      <input
                        type="text"
                        value={activeCluster.name}
                        onChange={e => {
                          const newClusters = config.clusters.map(c =>
                            c.name === config.activeCluster ? { ...c, name: e.target.value } : c
                          );
                          setConfig({ ...config, clusters: newClusters, activeCluster: e.target.value });
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>ZEDEDA Cloud URL</label>
                      <input
                        type="text"
                        value={activeCluster.baseUrl}
                        onChange={e => {
                          const newClusters = config.clusters.map(c =>
                            c.name === config.activeCluster ? { ...c, baseUrl: e.target.value } : c
                          );
                          setConfig({ ...config, clusters: newClusters });
                        }}
                        placeholder="https://zedcontrol.zededa.net"
                      />
                    </div>
                    <div className="form-group">
                      <label>API Token</label>
                      <textarea
                        className="token-input"
                        value={activeCluster.apiToken}
                        onChange={e => {
                          const newClusters = config.clusters.map(c =>
                            c.name === config.activeCluster ? { ...c, apiToken: e.target.value } : c
                          );
                          setConfig({ ...config, clusters: newClusters });
                        }}
                        placeholder="Paste your API token here (format: ABC1234:base64key)"
                        rows={4}
                      />
                      {activeCluster.apiToken && (
                        <div className={`token-status ${tokenValidation.valid ? 'valid' : 'expired'}`}>
                          {tokenValidation.valid ? (
                            <>
                              <Check size={12} />
                              Valid token format • {tokenValidation.totalLength} characters
                              <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.7 }}>
                                Token ID: {tokenValidation.tokenName} • Key length: {tokenValidation.keyLength} chars
                                <br />
                                Note: Expiration is managed server-side (check with API if needed)
                              </div>
                            </>
                          ) : (
                            <>
                              <AlertCircle size={12} />
                              Invalid token: {tokenValidation.error}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          <div className="settings-actions">
            <button className="cancel-btn" onClick={() => setShowSettings(false)}>Cancel</button>
            <button className="save-btn" onClick={saveConfig}>
              <Save size={16} /> Save & Apply
            </button>
          </div>
        </div>
      ) : selectedNode ? (
        <div className="details-panel">
          {/* EdgeView Session Section (Unified) */}
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
              <div className="ssh-controls-container">
                {/* Unified Status Row */}
                <div className="edgeview-status-row" style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto', gap: '15px 20px', alignItems: 'center', marginBottom: '15px' }}>

                  {/* Status */}
                  <div className="status-item">
                    <span className="label" style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#888' }}>Status</span>
                    {sshStatus.status === 'enabled' ? (
                      <span className="status-text success" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="status-dot online"></span> Active
                      </span>
                    ) : (
                      <span className="status-text muted">Disabled</span>
                    )}
                  </div>

                  {/* Connection */}
                  <div className="status-item">
                    <span className="status-label">Connection</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {tunnelConnected ? (
                        <span className="status-text success">Connected</span>
                      ) : (
                        <span className="status-text muted">Disconnected</span>
                      )}
                      <Tooltip text={tunnelConnected ? "Reset Connection" : "Connect Tunnel"}>
                        <button
                          className="icon-btn"
                          onClick={handleResetEdgeView}
                        >
                          <RefreshCw size={12} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>

                  {/* Proxy Port */}
                  <div className="status-item">
                    <span className="status-label">Proxy Port</span>
                    <span className="value" style={{ fontFamily: 'monospace' }}>
                      {sessionStatus && sessionStatus.port ? sessionStatus.port : '-'}
                    </span>
                  </div>

                  {/* Expires */}
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

                {/* Controls Row */}
                <div className="ssh-controls" style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '5px' }}>
                  {sshStatus.status === 'enabled' ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <div className="status-badge enabled">
                        <Unlock size={14} /> SSH Enabled
                      </div>
                      <Tooltip text="Remove public key and disable SSH access on the device">
                        <button
                          className="action-link danger"
                          onClick={handleDisableSSH}
                        >
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
                          <button
                            className="action-link danger"
                            onClick={handleDisableSSH}
                          >
                            Disable SSH
                          </button>
                        </Tooltip>
                        <span className="separator">•</span>
                        <Tooltip text="Replace device's SSH public key with your local key">
                          <button
                            className="action-link"
                            onClick={handleSetupSSH}
                          >
                            Re-enable SSH
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  ) : sshStatus.status === 'error' ? (
                    <div className="status-badge error" title={sshStatus.details}>
                      <AlertTriangle size={14} /> Error
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <div className="status-badge disabled">
                        <Lock size={14} /> Disabled
                      </div>
                      <Tooltip text="Install your local SSH public key on the device">
                        <button
                          className="action-link"
                          onClick={handleSetupSSH}
                        >
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

          {/* Active Tunnels Section */}
          {selectedNode && activeTunnels.filter(t => t.nodeId === selectedNode.id).length > 0 && (
            <div className={`active-tunnels-section ${highlightTunnels ? 'highlight' : ''}`}>
              <div className="section-header">Active Tunnels</div>
              <div className="tunnel-list">
                {activeTunnels.filter(t => t.nodeId === selectedNode.id).map(tunnel => (
                  <div key={tunnel.id} className="tunnel-item">
                    <div className="tunnel-info">
                      <div className="tunnel-type">
                        {tunnel.type === 'VNC' && <Monitor size={16} className="tunnel-icon vnc" />}
                        {tunnel.type === 'SSH' && <Terminal size={16} className="tunnel-icon ssh" />}
                        {tunnel.type === 'TCP' && <Activity size={16} className="tunnel-icon tcp" />}
                        <span className="tunnel-type-label">{tunnel.type}</span>
                      </div>
                      <div className="tunnel-target">
                        <span className="tunnel-arrow">→</span>
                        <span>{tunnel.targetIP}:{tunnel.targetPort}</span>
                      </div>
                      <div className="tunnel-local">
                        <code>localhost:{tunnel.localPort}</code>
                      </div>
                    </div>
                    <div className="tunnel-actions">
                      {tunnel.type === 'SSH' && (
                        <button
                          className="icon-btn"
                          onClick={() => window.electronAPI.openTerminalWindow(tunnel.localPort)}
                          title="Open Terminal"
                        >
                          <Terminal size={16} />
                        </button>
                      )}
                      <button
                        className="icon-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(`localhost:${tunnel.localPort}`);
                          addLog(`Copied localhost:${tunnel.localPort} to clipboard`, 'success');
                        }}
                        title="Copy Address"
                      >
                        <Copy size={16} />
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => removeTunnel(tunnel.id)}
                        title="Close Tunnel"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="details-header" style={{ marginTop: '20px' }}>
            <h3>Running Services</h3>
          </div>

          {loadingServices ? (
            <div className="loading-state">
              <Activity className="loading-icon animate-spin" size={24} />
              <p>Scanning device services...</p>
            </div>
          ) : error ? (
            <div className={`error-message ${error.type === 'success' ? 'success-message' : ''}`}>
              {error.message}
            </div>
          ) : services ? (
            <div className="services-list">
              {/* Display Apps if available */}
              {(() => {
                const servicesList = Array.isArray(services) ? services : (services.services || []);
                const globalError = !Array.isArray(services) ? services.error : null;

                return (
                  <>
                    {servicesList.length > 0 ? (
                      servicesList.map((app, idx) => (
                        <div key={idx} className="service-item">
                          <div className="service-info">
                            <div className="service-name">{app.name || "Unknown App"}</div>
                            {(() => {
                              const statusInfo = (() => {
                                const runState = app.status;
                                if (!runState) return { class: 'unknown', text: 'Unknown' };
                                const state = runState.replace('RUN_STATE_', '').toLowerCase();
                                let className = 'unknown';
                                if (state === 'online' || state === 'running') className = 'online';
                                else if (state === 'suspect' || state === 'rebooting' || state === 'updating') className = 'suspect';
                                else if (state === 'halted' || state === 'offline') className = 'offline';
                                else if (state === 'provisioned') className = 'provisioned';
                                return { class: className, text: state };
                              })();
                              return (
                                <div className="service-meta">
                                  <span className={`status-dot ${statusInfo.class}`}></span>
                                  {statusInfo.text}
                                  {app.edgeViewState && app.edgeViewState !== statusInfo.text && (
                                    <span style={{ marginLeft: '8px', color: '#888', fontSize: '12px' }}>
                                      (EdgeView: {app.edgeViewState})
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                            {/* Display IPs if available */}
                            {app.ips && app.ips.length > 0 && (
                              <div style={{ marginTop: '4px', fontSize: '12px', color: '#888' }}>
                                IP: {app.ips.join(', ')}
                              </div>
                            )}
                            {/* Display VNC if available */}
                            {app.vncPort && (
                              <div style={{ marginTop: '2px', fontSize: '12px', color: '#888' }}>
                                VNC: Port {app.vncPort}
                              </div>
                            )}
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

                          {/* Inline Connection Options */}
                          {expandedServiceId === idx && (
                            <div className="service-options">
                              {/* VNC Option */}
                              {app.vncPort && (
                                <div className="option-btn" onClick={async () => {
                                  try {
                                    const vncTarget = 'localhost';
                                    addLog(`Starting VNC tunnel to ${vncTarget}:${app.vncPort}...`, 'info');
                                    const result = await StartTunnel(selectedNode.id, vncTarget, app.vncPort);
                                    const port = result.port || result;
                                    const tunnelId = result.tunnelId;
                                    addLog(`VNC Tunnel active on localhost:${port}`, 'success');

                                    // Track tunnel
                                    addTunnel('VNC', vncTarget, app.vncPort, port, tunnelId);
                                    setHighlightTunnels(true);
                                    setTimeout(() => setHighlightTunnels(false), 2000);

                                    // Auto-launch VNC using macOS Screen Sharing
                                    const vncUrl = `vnc://localhost:${port}`;
                                    window.electronAPI.openExternal(vncUrl);
                                    addLog(`Launching VNC viewer with ${vncUrl}`, 'info');

                                    addLog(`Note: macOS Screen Sharing may ask for a password. Try pressing Enter.`, 'warning');
                                    setExpandedServiceId(null);
                                  } catch (err) {
                                    console.error(err);
                                    addLog(`Failed to start VNC tunnel: ${err.message}`, 'error');
                                  }
                                }}>
                                  <Monitor size={20} className="option-icon" />
                                  <span className="option-label">Launch VNC</span>
                                </div>
                              )}

                              {/* SSH Option */}
                              <div className="option-btn" onClick={async () => {
                                try {
                                  const portInput = prompt("Enter SSH Port:", "22");
                                  if (!portInput) return;

                                  const ip = app.ips && app.ips.length > 0 ? app.ips[0] : '127.0.0.1';
                                  addLog(`Starting SSH tunnel to ${ip}:${portInput}...`, 'info');
                                  const result = await StartTunnel(selectedNode.id, ip, parseInt(portInput));
                                  const localPort = result.port || result;
                                  const tunnelId = result.tunnelId;
                                  addLog(`SSH Tunnel active on localhost:${localPort}`, 'success');

                                  // Track tunnel
                                  addTunnel('SSH', ip, parseInt(portInput), localPort, tunnelId);
                                  setHighlightTunnels(true);
                                  setTimeout(() => setHighlightTunnels(false), 2000);

                                  window.electronAPI.openTerminalWindow(localPort);
                                  setExpandedServiceId(null);
                                } catch (err) {
                                  console.error(err);
                                  addLog(`Failed to start SSH tunnel: ${err.message}`, 'error');
                                }
                              }}>
                                <Terminal size={20} className="option-icon" />
                                <span className="option-label">SSH Terminal</span>
                              </div>

                              {/* TCP Tunnel Option */}
                              <div className="option-btn" onClick={async () => {
                                try {
                                  const portInput = prompt("Enter Target Port:", "80");
                                  if (!portInput) return;

                                  // Validate that we have IPs - do not fall back to 127.0.0.1
                                  if (!app.ips || app.ips.length === 0) {
                                    addLog(`Cannot start TCP tunnel: Service has no IP addresses`, 'error');
                                    addLog(`This usually means EdgeView hasn't detected this app's network info yet`, 'warning');
                                    alert('No IP address available for this service.\n\nThe application might not be running, or EdgeView hasn\'t detected its network interfaces yet.\n\nTry refreshing the services or check the application status.');
                                    return;
                                  }

                                  const ip = app.ips[0];
                                  addLog(`Starting TCP tunnel to ${ip}:${portInput}...`, 'info');
                                  const result = await StartTunnel(selectedNode.id, ip, parseInt(portInput));
                                  const localPort = result.port || result;
                                  const tunnelId = result.tunnelId;
                                  addLog(`TCP Tunnel active: localhost:${localPort} -> ${ip}:${portInput}`, 'success');

                                  // Track tunnel
                                  addTunnel('TCP', ip, parseInt(portInput), localPort, tunnelId);
                                  setHighlightTunnels(true);
                                  setTimeout(() => setHighlightTunnels(false), 2000);

                                  alert(`Tunnel Active!\n\nConnect to: localhost:${localPort}\n\nForwards to: ${ip}:${portInput}`);
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

              {/* Activity Log */}
              <div className="activity-log">
                <div className="log-header">Activity Log</div>
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
          ) : (
            <div className="results-list">
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
                    <div className="node-name">{node.name}</div>
                    <div className="node-project" title={node.project}>
                      {projects[node.project] || node.project}
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
                      <div className="node-name">{node.name}</div>
                      <div className="node-project" title={node.project}>
                        {projects[node.project] || node.project}
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
          )
          }

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
      );
}

      export default App;
