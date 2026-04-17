import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ConnectToNode, GetSettings, SaveSettings, GetDeviceServices, SetupSSH, GetSSHStatus, DisableSSH, SetVGAEnabled, SetUSBEnabled, SetConsoleEnabled, EnableExternalPolicy, ResetEdgeView, VerifyTunnel, GetUserInfo, GetEnterprise, GetProjects, GetSessionStatus, GetConnectionProgress, GetAppInfo, StartTunnel, CloseTunnel, ListTunnels, AddRecentDevice, VerifyToken, OnUpdateAvailable, OnUpdateNotAvailable, OnUpdateDownloadProgress, OnUpdateDownloaded, OnUpdateError, DownloadUpdate, InstallUpdate, SecureStorageStatus, SecureStorageMigrate, SecureStorageGetSettings, SecureStorageSaveSettings, StartCollectInfo, GetCollectInfoStatus, SaveCollectInfo, StartComposeDiagnostics, GetComposeDiagnosticsStatus, SaveComposeDiagnostics, CheckForUpdates, openTerminalWindow, openVncWindow, openExternalTerminal, getElectronAppInfo, startContainerShell, getSystemTimeFormat, openExternal, InjectSecureConfig, GetDeviceCache, RefreshDeviceCache } from './tauriAPI';
import { Search, Settings, Server, Activity, Save, Monitor, ArrowLeft, Terminal, Globe, Lock, Unlock, AlertTriangle, ChevronDown, ChevronRight, X, Plus, Check, AlertCircle, Cpu, Wifi, HardDrive, Clock, Hash, ExternalLink, Copy, Play, RefreshCw, Trash2, ArrowRight, Info, Download, Box, Layers, Shield, Moon, Sun, HelpCircle } from 'lucide-react';
import eveOsIcon from './assets/eve-os.png';
import Tooltip from './components/Tooltip';
import About from './components/About';
import UpdateBanner from './components/UpdateBanner';
import GlobalStatusBanner from './components/GlobalStatusBanner';
import Modal from './components/Modal';
import Button from './components/Button';
import Badge from './components/Badge';
import './components/Tooltip.css';
import TokenGuide from './components/TokenGuide';
import TokenField from './components/TokenField';
import { DeviceListSkeleton, ServicesListSkeleton, SshDetailsSkeleton } from './components/Skeleton';
import { formatStatus, statusClass, isInteractive } from './utils/status';
import './App.css';

// Simple component to display version info
function VersionDisplay() {
  const [versionInfo, setVersionInfo] = React.useState(null);

  React.useEffect(() => {
    getElectronAppInfo().then(info => {
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
const WELL_KNOWN_PORTS = [
  { port: 21, label: 'FTP', description: 'File Transfer Protocol' },
  { port: 22, label: 'SSH', description: 'Secure Shell' },
  { port: 23, label: 'Telnet', description: 'Unencrypted Text Communications' },
  { port: 25, label: 'SMTP', description: 'Simple Mail Transfer Protocol' },
  { port: 53, label: 'DNS', description: 'Domain Name System' },
  { port: 80, label: 'HTTP', description: 'Web Server' },
  { port: 110, label: 'POP3', description: 'Post Office Protocol v3' },
  { port: 143, label: 'IMAP', description: 'Internet Message Access Protocol' },
  { port: 443, label: 'HTTPS', description: 'Secure Web Server' },
  { port: 3306, label: 'MySQL', description: 'MySQL Database' },
  { port: 3389, label: 'RDP', description: 'Remote Desktop' },
  { port: 5432, label: 'PostgreSQL', description: 'PostgreSQL Database' },
  { port: 5900, label: 'VNC', description: 'Virtual Network Computing' },
  { port: 6379, label: 'Redis', description: 'Redis Key-Value Store' },
  { port: 8000, label: 'HTTP-Alt', description: 'Alternative Web Port' },
  { port: 8080, label: 'HTTP-Alt', description: 'Alternative Web Port' },
  { port: 27017, label: 'MongoDB', description: 'MongoDB Database' },
];

const PortComboBox = ({ value, onChange, exposedPorts = [], showCommonPorts = true, placeholder = 'Port' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const blurTimeoutRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    const handleResize = () => setIsOpen(false);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Filter ports based on the input value as search term
  const searchTerm = value || '';
  const filteredExposed = exposedPorts.filter(p => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.publicPort.toString().includes(term) ||
      p.privatePort.toString().includes(term) ||
      (p.containerName && p.containerName.toLowerCase().includes(term))
    );
  });

  const filteredCommon = showCommonPorts ? WELL_KNOWN_PORTS.filter(p => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.port.toString().includes(term) ||
      p.label.toLowerCase().includes(term) ||
      p.description.toLowerCase().includes(term)
    );
  }) : [];

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => [
    ...filteredExposed.map(p => ({ type: 'exposed', port: p.publicPort, data: p })),
    ...filteredCommon.map(p => ({ type: 'common', port: p.port, data: p }))
  ], [filteredExposed, filteredCommon]);

  const hasResults = flatItems.length > 0;

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightIndex(-1);
  }, [searchTerm]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && itemRefs.current[highlightIndex]) {
      itemRefs.current[highlightIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  const updateCoords = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  };

  const openDropdown = () => {
    if (!isOpen) {
      updateCoords();
      setIsOpen(true);
      setHighlightIndex(-1);
    }
  };

  const selectItem = (port) => {
    clearTimeout(blurTimeoutRef.current);
    onChange(port.toString());
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleBlur = () => {
    blurTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const handleFocus = () => {
    clearTimeout(blurTimeoutRef.current);
    openDropdown();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openDropdown();
      setHighlightIndex(prev => (prev + 1) % Math.max(flatItems.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openDropdown();
      setHighlightIndex(prev => prev <= 0 ? flatItems.length - 1 : prev - 1);
    } else if (e.key === 'Enter') {
      if (isOpen && highlightIndex >= 0 && highlightIndex < flatItems.length) {
        e.preventDefault();
        selectItem(flatItems[highlightIndex].port);
      } else if (isOpen) {
        // If exactly one result, auto-select it
        if (flatItems.length === 1) {
          e.preventDefault();
          selectItem(flatItems[0].port);
        }
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  // Determine if the current value matches a known port for the hint label
  const matchedPort = useMemo(() => {
    const num = value;
    if (!num) return null;
    const exposed = exposedPorts.find(p => p.publicPort.toString() === num);
    if (exposed) return exposed.containerName;
    const common = WELL_KNOWN_PORTS.find(p => p.port.toString() === num);
    if (common) return common.label;
    return null;
  }, [value, exposedPorts]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          openDropdown();
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '8px',
          paddingRight: matchedPort ? '80px' : '28px',
          fontSize: '13px',
          backgroundColor: 'var(--bg-secondary)',
          border: `1px solid ${isOpen ? 'var(--color-accent)' : 'var(--border-color)'}`,
          borderRadius: '4px',
          color: 'var(--text-primary)',
          height: '34px',
          boxSizing: 'border-box',
          outline: 'none',
          fontFamily: 'var(--font-mono)'
        }}
      />
      {matchedPort && (
        <span style={{
          position: 'absolute',
          right: '28px',
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: '11px',
          color: 'var(--color-accent)',
          fontWeight: '600',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '50px'
        }}>
          {matchedPort}
        </span>
      )}
      <ChevronDown
        size={14}
        style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: `translateY(-50%) ${isOpen ? 'rotate(180deg)' : ''}`,
          transition: 'transform 0.2s',
          color: 'var(--text-secondary)',
          pointerEvents: 'none'
        }}
      />

      {isOpen && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998, cursor: 'default' }}
            onMouseDown={(e) => {
              // Prevent blur so we can close cleanly
              if (!containerRef.current?.contains(e.target)) {
                setIsOpen(false);
              }
            }}
          />
          <div className="custom-select-options" style={{
            position: 'fixed',
            top: coords.top + 4,
            right: window.innerWidth - (coords.left + coords.width),
            minWidth: '220px',
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 9999,
            maxHeight: '300px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {!hasResults && (
              <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>
                No matching ports found
              </div>
            )}

            {filteredExposed.length > 0 && (
              <>
                <div style={{ padding: '6px 12px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-hover)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Exposed Ports
                </div>
                {filteredExposed.map((pm, idx) => {
                  const flatIdx = idx;
                  return (
                    <div
                      key={`exposed-${idx}`}
                      ref={el => itemRefs.current[flatIdx] = el}
                      className="custom-option"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectItem(pm.publicPort);
                      }}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: 'var(--text-primary)',
                        borderBottom: '1px solid var(--border-subtle)',
                        transition: 'background 0.1s',
                        backgroundColor: highlightIndex === flatIdx ? 'var(--bg-hover)' : 'transparent'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; setHighlightIndex(flatIdx); }}
                      onMouseLeave={(e) => { if (highlightIndex !== flatIdx) e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', pointerEvents: 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{pm.publicPort}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>→</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{pm.privatePort}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-accent)', marginLeft: '12px' }}>{pm.containerName}</div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {filteredCommon.length > 0 && (
              <>
                <div style={{ padding: '6px 12px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-hover)', textTransform: 'uppercase', letterSpacing: '0.5px', borderTop: filteredExposed.length > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                  Common Ports
                </div>
                {filteredCommon.map((p, idx) => {
                  const flatIdx = filteredExposed.length + idx;
                  return (
                    <div
                      key={`common-${idx}`}
                      ref={el => itemRefs.current[flatIdx] = el}
                      className="custom-option"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectItem(p.port);
                      }}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: 'var(--text-primary)',
                        borderBottom: idx < filteredCommon.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                        transition: 'background 0.1s',
                        backgroundColor: highlightIndex === flatIdx ? 'var(--bg-hover)' : 'transparent'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; setHighlightIndex(flatIdx); }}
                      onMouseLeave={(e) => { if (highlightIndex !== flatIdx) e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', width: '100%' }}
                        title={`${p.label} - ${p.description}`}
                      >
                        <div style={{ width: '45px', textAlign: 'right', marginRight: '12px', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{p.port}</span>
                        </div>
                        <div style={{ width: '65px', textAlign: 'left', marginRight: '8px', flexShrink: 0 }}>
                          <span style={{ color: 'var(--color-accent)', fontSize: '12px', fontWeight: 'bold' }}>{p.label}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{p.description}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [authError, setAuthError] = useState(false); // Track authentication failures
  const [deviceCache, setDeviceCache] = useState(null); // { devices, projects, updatedAt, isRefreshing }
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showClusterDropdown, setShowClusterDropdown] = useState(null); // null | 'header' | 'icon'
  const clusterDropdownRef = useRef(null);
  const clusterHeaderRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [enterprise, setEnterprise] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [projects, setProjects] = useState({});
  const projectsLoadedRef = useRef(false);

  // Tracks the cluster the user is currently on. Updated synchronously at the
  // start of a cluster switch so any in-flight async work from the old cluster
  // (polling fetchCache, loadUserInfo, the delayed inline fetch in
  // activateCluster) can short-circuit before writing stale data into React
  // state. This is what prevents the "old cluster's list flashes for 20–30s
  // after switching" symptom.
  const activeClusterRef = useRef('');

  // Theme State
  // Default to 'auto' if no theme is set
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'auto');

  useEffect(() => {
    const applyTheme = (targetTheme) => {
      let activeTheme = targetTheme;
      if (targetTheme === 'auto') {
        activeTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', activeTheme);
    };

    applyTheme(theme);
    localStorage.setItem('theme', theme);

    // Listener for system theme changes when in auto mode
    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme('auto');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  // Click-outside handler for cluster dropdown
  useEffect(() => {
    if (!showClusterDropdown) return;
    const handleClickOutside = (e) => {
      const inIcon = clusterDropdownRef.current && clusterDropdownRef.current.contains(e.target);
      const inHeader = clusterHeaderRef.current && clusterHeaderRef.current.contains(e.target);
      if (!inIcon && !inHeader) {
        setShowClusterDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showClusterDropdown]);


  const toggleTheme = () => {
    // Cycle: dark -> light -> auto -> dark
    setTheme(prev => {
      if (prev === 'dark') return 'light';
      if (prev === 'light') return 'auto';
      return 'dark';
    });
  };

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
    encryptionAvailable: true,
    requiresReauth: false
  });

  // Lock state - removed as we are reverting to auto-unlock
  // const [isLocked, setIsLocked] = useState(false);
  // const [unlocking, setUnlocking] = useState(false);

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

      // First, check if this Docker Compose app itself has internal IPs (airgapped network)
      if (app.internalIps && app.internalIps.length > 0) {
        targetAppIp = app.internalIps[0];
        console.log('[DEBUG-SHELL] Found Internal IP directly on Docker Compose app:', targetAppIp);
        addLog(`Using Docker Compose app's own Internal IP: ${targetAppIp}`, 'info');
      }

      const appExternalIps = app.ips || [];
      console.log('[DEBUG-SHELL] App External IPs:', appExternalIps);

      // If no self-internal IP, find sibling app that:
      // - Shares at least one External IP with this app
      // - Has an Internal IP (identified by backend via airgapped network)
      if (!targetAppIp) {
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
            // Check if fallback app has internalIps from backend
            if (fallbackApp.internalIps && fallbackApp.internalIps.length > 0) {
              targetAppIp = fallbackApp.internalIps[0];
              console.log('[DEBUG-SHELL] Found Runtime IP via fallback app internalIps:', targetAppIp, 'from app:', fallbackApp.name);
              addLog(`Found Runtime IP via fallback: ${targetAppIp}`, 'info');
            } else {
              const otherIps = fallbackApp.ips || [];
              // Find IP that is NOT in appExternalIps
              const uniqueIps = otherIps.filter(ip => !appExternalIps.includes(ip));
              if (uniqueIps.length > 0) {
                targetAppIp = uniqueIps[0];
                console.log('[DEBUG-SHELL] Found Runtime IP via Heuristic (Non-Shared IP):', targetAppIp, 'from app:', fallbackApp.name, 'candidates:', uniqueIps);
                addLog(`Found Runtime IP via Heuristic: ${targetAppIp}`, 'info');
              }
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

      const result = await startContainerShell(
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
  const [editingCluster, setEditingCluster] = useState({ name: '', baseUrl: '', apiToken: '', environment: '' });
  const [clusterFilter, setClusterFilter] = useState('');
  const [refreshSpinHold, setRefreshSpinHold] = useState(false);
  const [viewingClusterName, setViewingClusterName] = useState('');
  const [viewingUserInfo, setViewingUserInfo] = useState(null);
  const [loadingTokenInfo, setLoadingTokenInfo] = useState(false);
  const [showTokenStatus, setShowTokenStatus] = useState(false);
  const [showTokenGuide, setShowTokenGuide] = useState(false);
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

  // Compose Diagnostics State
  const composeDiagJobRef = useRef(null);
  const [diagPrompt, setDiagPrompt] = useState(null); // { app, idx }

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
          // Preserve username from previous tunnel state (not returned by backend)
          const others = prev.filter(t => t.nodeId !== selectedNode.id);
          const prevByIdMap = new Map(prev.map(t => [t.id, t]));
          const mergedMapped = mapped.map(t => ({
            ...t,
            username: prevByIdMap.get(t.id)?.username || ''
          }));
          return [...others, ...mergedMapped];
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

  // Poll all tunnels globally when the "All Tunnels" panel is open.
  // This catches tunnels closed from child windows (VNC viewer, terminal)
  // that bypass the per-node polling above.
  useEffect(() => {
    if (!showGlobalTunnels) return;

    let cancelled = false;

    const fetchAllTunnels = async () => {
      if (cancelled) return;
      try {
        const tunnels = await ListTunnels('');
        if (cancelled || tunnels === null || !Array.isArray(tunnels)) return;

        const mapped = tunnels.map(t => {
          const rawTarget = t.TargetIP || '';
          const [ipPart, portPart] = rawTarget.split(':');
          const targetPort = parseInt(portPart || '0', 10);

          let type = t.Type || 'TCP';
          if (type === 'TCP') {
            if (targetPort === 22) type = 'SSH';
            else if (targetPort === 5900) type = 'VNC';
          }

          return {
            id: t.ID,
            nodeId: t.NodeID,
            nodeName: t.NodeName || '',
            projectId: t.ProjectID || '',
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
          // Preserve username from previous state (not returned by backend)
          const prevById = new Map(prev.map(t => [t.id, t]));
          return mapped.map(t => ({
            ...t,
            username: prevById.get(t.id)?.username || '',
          }));
        });
      } catch (err) {
        console.error('Failed to list all tunnels:', err);
      }
    };

    fetchAllTunnels();
    const intervalId = setInterval(fetchAllTunnels, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [showGlobalTunnels]);

  // Polling for device services (every 15-60 seconds while a node is selected)
  // This ensures VNC details and real-time status are updated as background enrichment finishes.
  useEffect(() => {
    if (!selectedNode || showSettings) {
      return;
    }

    let cancelled = false;
    let intervalId = null;
    let currentInterval = 15000;

    const pollServices = async () => {
      try {
        const result = await GetDeviceServices(selectedNode.id, selectedNode.name);
        if (!result || cancelled) return;

        try {
          const parsed = JSON.parse(result);
          const servicesList = parsed.services || [];

          if (cancelled) return;
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
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [selectedNode, showSettings]);

  // Keep selectedNode.status in sync with the latest device cache.
  // This ensures the device details view reflects status changes (e.g. offline→online)
  // that occur after the user opened the device details panel.
  useEffect(() => {
    if (!selectedNode || !deviceCache?.devices) return;
    const fresh = deviceCache.devices.find(d => d.id === selectedNode.id);
    if (fresh && fresh.status !== selectedNode.status) {
      setSelectedNode(prev => ({ ...prev, status: fresh.status }));
    }
  }, [deviceCache?.devices]);

  // Cache polling effect — fetches device cache from backend periodically.
  // Runs independently of showSettings so cluster switches populate data
  // immediately while the settings panel is still closing.
  // Uses fast polling (2s) while a refresh is in progress, then slows to 15s.
  useEffect(() => {
    if (!config.activeCluster) return;
    const myCluster = config.activeCluster;
    activeClusterRef.current = myCluster;
    let cancelled = false;
    let intervalId = null;
    let currentInterval = 2000; // Start fast to catch initial load / refresh completion

    const scheduleNext = (ms) => {
      if (intervalId) clearInterval(intervalId);
      currentInterval = ms;
      intervalId = setInterval(fetchCache, ms);
    };

    const fetchCache = async () => {
      try {
        const data = await GetDeviceCache();
        // Drop results if the effect has torn down OR the user switched
        // clusters mid-request. Both guards are needed: activateCluster flips
        // activeClusterRef before cancelled becomes true.
        if (cancelled || activeClusterRef.current !== myCluster || !data) return;
        setDeviceCache(data);
        if (!cacheLoaded && (data.devices?.length > 0 || !data.isRefreshing)) {
          setCacheLoaded(true);
        }
        // Derive projects map
        const map = {};
        (data.projects || []).forEach(p => { map[p.id] = p.name; });
        setProjects(map);
        projectsLoadedRef.current = true;

        // Adaptive polling: fast while refreshing, slow when idle
        if (data.isRefreshing && currentInterval !== 2000) {
          scheduleNext(2000);
        } else if (!data.isRefreshing && currentInterval !== 15000) {
          scheduleNext(15000);
        }
      } catch (err) {
        if (err.message?.includes('401')) setAuthError(true);
      } finally {
        if (!cancelled && activeClusterRef.current === myCluster) setLoading(false);
      }
    };

    // Only show skeleton on first load, not on every poll cycle
    if (!cacheLoaded) setLoading(true);
    fetchCache();
    intervalId = setInterval(fetchCache, currentInterval);
    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); };
  }, [config.activeCluster]);


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
  const isDeviceOnline = isInteractive(selectedNode?.status);

  // State for time format preference
  const [use24HourTime, setUse24HourTime] = useState(false);

  useEffect(() => {
    // Fetch system time format preference on mount
    const checkTimeFormat = async () => {
      try {
        const is24h = await getSystemTimeFormat();

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
      setGlobalStatus(prev => prev?.type === 'error' ? prev : null);
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
      setGlobalStatus(prev => prev?.type === 'error' ? prev : null);
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
      await openVncWindow({
        port: localPort,
        nodeName: selectedNode.name,
        appName: appName,
        tunnelId,
        theme
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
      setGlobalStatus(prev => prev?.type === 'error' ? prev : null);
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
      await openTerminalWindow({
        port: localPort,
        nodeName: selectedNode.name,
        targetInfo: `${username}@${ip}:22`,
        tunnelId,
        username,
        theme
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
      setGlobalStatus(prev => prev?.type === 'error' ? prev : null);
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
        await openExternalTerminal(sshCommand);
        addLog('Launched native terminal', 'success');
      } else if (mode === 'builtin') {
        await openTerminalWindow({
          port: localPort,
          nodeName: selectedNode.name,
          targetInfo: `${sshUser}@${selectedNode.name}`,
          tunnelId: tunnelId,
          username: sshUser,
          password: sshPassword,
          theme
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
      setGlobalStatus(prev => prev?.type === 'error' ? prev : null);
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
    // Detect external policy denial — show persistent banner
    if (errorMsg.includes('External Connection Policy is disabled')) {
      setGlobalStatus({ type: 'error', message: errorMsg });
    }
  };

  const loadUserInfo = async () => {
    // Snapshot the cluster we started for so a mid-flight cluster switch
    // doesn't cause us to write stale projects/enterprise into state.
    const startCluster = activeClusterRef.current;
    try {
      const ent = await GetEnterprise();
      if (activeClusterRef.current !== startCluster) return;
      setEnterprise(ent);
      const projList = await GetProjects();
      if (activeClusterRef.current !== startCluster) return;
      const map = {};
      if (projList) {
        projList.forEach(p => { map[p.id] = p.name; });
        setProjects(map);
      }
      projectsLoadedRef.current = true;
      // Fetch user info (token owner)
      const info = await GetUserInfo();
      if (activeClusterRef.current !== startCluster) return;
      setUserInfo(info);
    } catch (err) {
      console.log('Error loading user info:', err);
      throw err; // Re-throw to propagate error to saveSettings
    }
  };

  // Ref to track if initialization has already run to prevent double-execution in Strict Mode
  const initRef = useRef(false);

  useEffect(() => {
    // Check secure storage status and perform migration if needed
    const initializeSettings = async () => {
      if (initRef.current) return;
      initRef.current = true;

      // Small delay to allow the window to paint and become active before
      // invoking any commands that might trigger a native modal (keychain).
      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        const status = await SecureStorageStatus();

        setMigrationState(prev => ({
          ...prev,
          needed: status.needsMigration,
          encryptionAvailable: status.encryptionAvailable,
          requiresReauth: status.requiresReauth
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
            // Inject secure config to backend now that we have tokens
            InjectSecureConfig().catch(err => console.error("Failed to inject config:", err));
          } else {
            setLoading(false);
            setShowSettings(true);
          }
        } else {
          setLoading(false);
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
          setLoading(false);
          setShowSettings(true);
        }
      }
    };

    initializeSettings();
  }, []);

  // Removed loadSettingsAndUnlock as we are back to auto-init

  // Local filtering with useMemo — instant search over cached devices
  const filteredDevices = useMemo(() => {
    const devices = deviceCache?.devices || [];
    if (!query.trim()) return devices;
    const q = query.toLowerCase().trim();
    return devices.filter(d => {
      if (d.name?.toLowerCase().includes(q)) return true;
      const projName = projects[d.project] || '';
      if (projName.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [deviceCache?.devices, query, projects]);

  // Use filteredDevices directly — no intermediate nodes state needed
  const nodes = filteredDevices;

  const handleConnect = async (node) => {
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
    setShowTerminal(false);
    setLoadingServices(true);
    setLoadingSSH(true);
    setGlobalStatus({ type: 'loading', message: "Fetching device services..." });
    addLog(`Opening ${node.name} details...`);

    // Trigger a background cache refresh so device online/offline status is up-to-date
    RefreshDeviceCache().catch(() => {});

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
        openTerminalWindow({
          port: port,
          nodeName: selectedNode.name,
          targetInfo: 'EVE-OS SSH',
          tunnelId: tunnelId,
          theme
        });
        addLog('In-app terminal launched', 'success');
      } else {
        // Native Terminal Launch
        const sshUser = 'root'; // Default for EVE-OS
        const sshCommand = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${port} ${sshUser}@localhost`;
        addLog(`Launching native terminal: ${sshCommand}`, 'info');
        await openExternalTerminal(sshCommand);
      }

      // Refresh session status to reflect potential encryption updates
      await loadSSHStatus(nodeId, false);

      // Reload React config from the secure-storage source of truth
      // (disk + keychain). Previously we called the Go `/api/settings`
      // endpoint which returns stale in-memory state, clobbering any
      // unsynced fields like per-cluster `environment`.
      try {
        const refreshed = await SecureStorageGetSettings();
        if (refreshed) {
          setConfig({
            baseUrl: refreshed.baseUrl || '',
            apiToken: refreshed.apiToken || '',
            clusters: refreshed.clusters || [],
            activeCluster: refreshed.activeCluster || '',
            recentDevices: refreshed.recentDevices || []
          });
        }
      } catch (err) {
        console.error('Failed to refresh settings after connect:', err);
      }
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
      // Optimistic UI update — cloud API may not have propagated yet
      setSshStatus(prev => prev ? { ...prev, consoleEnabled: enabled } : prev);
      addLog(`Console access ${enabled ? 'enabled' : 'disabled'}`, 'success');
      setLoadingSSH(false);
      setGlobalStatus({ type: 'success', message: `Console ${enabled ? 'enabled' : 'disabled'}` });
      setTimeout(() => setGlobalStatus(null), 3000);
      // Background refresh after cloud propagation delay
      setTimeout(() => loadSSHStatus(selectedNode.id), 2000);
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

  const handleEnableExternalPolicy = async () => {
    if (!selectedNode || !sshStatus) {
      setGlobalStatus({ type: 'error', message: "No node selected or status unknown." });
      return;
    }

    const currentStatus = sshStatus.externalPolicy;
    const action = currentStatus ? "disable" : "enable";
    const newState = !currentStatus;

    setGlobalStatus({ type: 'loading', message: `${action === "enable" ? "Enabling" : "Disabling"} external policy...` });

    try {
      await EnableExternalPolicy(selectedNode.id, newState);
      addLog(`External policy ${action}d successfully`, 'success');

      // Update local state immediately for better UX, though reloadSSHStatus will also catch it
      setSshStatus(prev => ({ ...prev, externalPolicy: newState }));

      setGlobalStatus({
        type: 'success',
        message: `External policy ${action}d. Device configuration updated.`
      });

      // Refresh status to be sure
      setTimeout(() => loadSSHStatus(selectedNode.id), 1000);
      setTimeout(() => setGlobalStatus(null), 5000);
    } catch (err) {
      console.error(`Failed to ${action} external policy:`, err);
      const errMsg = err.message || String(err);
      addLog(`Failed to ${action} external policy: ${errMsg}`, 'error');
      setGlobalStatus({ type: 'error', message: `Failed to ${action} external policy: ${errMsg}` });
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

  // ── Compose Diagnostics ────────────────────────────────────────────────────

  const resolveComposeRuntimeIP = (app) => {
    const servicesList = Array.isArray(services) ? services : (services?.services || []);

    // Prefer the app's own internal (airgapped) IP
    if (app.internalIps && app.internalIps.length > 0) {
      return app.internalIps[0];
    }

    const appExternalIps = app.ips || [];

    // Find sibling app sharing an external IP that has internalIps
    const runtimeApp = servicesList.find(otherApp => {
      if (otherApp.id === app.id) return false;
      const otherIps = otherApp.ips || [];
      const hasSharedIp = otherIps.some(ip => appExternalIps.includes(ip));
      const hasInternalIps = otherApp.internalIps && otherApp.internalIps.length > 0;
      return hasSharedIp && hasInternalIps;
    });

    if (runtimeApp) {
      return runtimeApp.internalIps[0];
    }

    // Fallback: sibling with a non-shared IP
    const fallbackApp = servicesList.find(otherApp => {
      if (otherApp.id === app.id) return false;
      const otherIps = otherApp.ips || [];
      return otherIps.some(ip => appExternalIps.includes(ip));
    });

    if (fallbackApp) {
      if (fallbackApp.internalIps && fallbackApp.internalIps.length > 0) {
        return fallbackApp.internalIps[0];
      }
      const otherIps = fallbackApp.ips || [];
      const uniqueIps = otherIps.filter(ip => !appExternalIps.includes(ip));
      if (uniqueIps.length > 0) {
        return uniqueIps[0];
      }
    }

    return null;
  };

  const openDiagnosticsPrompt = (app, idx) => {
    const savedUser = getSavedSshUsername(app.name);
    setDiagPrompt({ app, idx, username: savedUser || 'root', password: '' });
  };

  const handleComposeDiagnostics = async (app, username, password) => {
    if (!selectedNode) return;
    setDiagPrompt(null);

    // Resolve the airgapped/internal IP for SSH access
    const appIP = resolveComposeRuntimeIP(app);
    if (!appIP) {
      setGlobalStatus({ type: 'error', message: 'Could not determine the runtime internal IP. Ensure the device has an airgapped network configured.' });
      addLog('Failed to resolve compose runtime internal IP for diagnostics', 'error');
      return;
    }

    addLog(`Resolved compose runtime IP: ${appIP}`, 'info');

    // Save username for future use
    if (username && username !== 'root') {
      saveSshUsername(app.name, username);
    }

    composeDiagJobRef.current = null;
    setGlobalStatus({ type: 'loading', message: `Starting diagnostics collection for ${app.name}...` });

    try {
      addLog(`Starting compose diagnostics for ${app.name} (${appIP})...`);
      const response = await StartComposeDiagnostics(selectedNode.id, app.name, appIP, username, password);
      const jobId = response.jobId;
      composeDiagJobRef.current = jobId;

      setGlobalStatus({ type: 'loading', message: 'Connecting to compose runtime...' });

      const pollInterval = setInterval(async () => {
        if (!composeDiagJobRef.current || composeDiagJobRef.current !== jobId) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const status = await GetComposeDiagnosticsStatus(jobId);

          if (status.status === 'connecting') {
            setGlobalStatus({ type: 'loading', message: 'Establishing SSH tunnel to compose runtime...' });
          } else if (status.status === 'running-script') {
            setGlobalStatus({ type: 'loading', message: 'Running diagnostics script (this may take a few minutes)...' });
          } else if (status.status === 'downloading') {
            const progressMB = (status.progress / 1024 / 1024).toFixed(1);
            const totalMB = (status.totalSize / 1024 / 1024).toFixed(1);
            const percent = status.totalSize > 0 ? Math.round((status.progress / status.totalSize) * 100) : 0;
            setGlobalStatus({ type: 'loading', message: `Downloading diagnostics: ${progressMB} MB / ${totalMB} MB (${percent}%)` });
          } else if (status.status === 'completed') {
            clearInterval(pollInterval);
            addLog('Compose diagnostics collection completed', 'success');
            setGlobalStatus({ type: 'success', message: 'Diagnostics collected. Saving file...' });

            try {
              const saveResult = await SaveComposeDiagnostics(jobId, status.filename);
              if (saveResult.success) {
                setGlobalStatus({ type: 'success', message: `File saved to ${saveResult.filePath}` });
                addLog(`Saved diagnostics to ${saveResult.filePath}`, 'success');
                setTimeout(() => setGlobalStatus(null), 5000);
              } else if (saveResult.canceled) {
                setGlobalStatus(null);
                addLog('File save cancelled by user', 'info');
              } else {
                setGlobalStatus({ type: 'error', message: `Failed to save: ${saveResult.error}` });
                addLog(`Failed to save diagnostics: ${saveResult.error}`, 'error');
              }
            } catch (saveErr) {
              setGlobalStatus({ type: 'error', message: `Failed to save: ${saveErr.message}` });
              addLog(`Failed to save diagnostics: ${saveErr.message}`, 'error');
            }

            if (composeDiagJobRef.current === jobId) {
              composeDiagJobRef.current = null;
            }
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            const userMsg = extractErrorMessage(status.error);
            addLog(`Compose diagnostics failed: ${userMsg}`, 'error');
            setGlobalStatus({ type: 'error', message: `Diagnostics failed: ${userMsg}` });
            if (composeDiagJobRef.current === jobId) {
              composeDiagJobRef.current = null;
            }
          }
        } catch (err) {
          console.error('Failed to poll compose diagnostics:', err);
          const userMessage = extractErrorMessage(err);
          addLog(`Diagnostics polling failed: ${userMessage}`, 'error');
          setGlobalStatus({ type: 'error', message: `Polling failed: ${userMessage}` });
          clearInterval(pollInterval);
          if (composeDiagJobRef.current === jobId) {
            composeDiagJobRef.current = null;
          }
        }
      }, 1000);

    } catch (err) {
      console.error('Failed to start compose diagnostics:', err);
      const userMessage = extractErrorMessage(err);
      setGlobalStatus({ type: 'error', message: `Failed to start diagnostics: ${userMessage}` });
      addLog(`Failed to start compose diagnostics: ${userMessage}`, 'error');
    }
  };

  const handleBack = () => {
    setSelectedNode(null);
    setServices(null);
    setSshStatus(null);
    setShowTerminal(false);
    setExpandedServiceId(null);
    setSessionStatus(null);
    setTunnelConnected(false);
    setLoadingServices(false);
    setLoadingSSH(false);
    setGlobalStatus(null);
    setSshPopover(null);
  };

  const [refreshingDevice, setRefreshingDevice] = useState(false);
  const handleRefreshDeviceStatus = async () => {
    if (!selectedNode || refreshingDevice) return;
    setRefreshingDevice(true);
    addLog(`Refreshing ${selectedNode.name} status...`);
    try {
      // Trigger a backend cache refresh so the next cache poll picks up fresh data
      await RefreshDeviceCache();
      // Also re-fetch services and SSH status for the current device
      const [servicesResult] = await Promise.all([
        GetDeviceServices(selectedNode.id, selectedNode.name),
        loadSSHStatus(selectedNode.id, true),
      ]);
      try {
        const parsed = JSON.parse(servicesResult);
        setServices(parsed);
        addLog("Services list updated", 'success');
      } catch (e) {
        console.error("Failed to parse services JSON:", e);
      }
    } catch (err) {
      console.error("Failed to refresh device status:", err);
      addLog(`Refresh failed: ${err}`, 'error');
    } finally {
      setRefreshingDevice(false);
    }
  };

  const recentIds = config.recentDevices || [];
  const recentNodes = nodes.filter(n => recentIds.includes(n.id));
  recentNodes.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
  const otherNodes = nodes.filter(n => !recentIds.includes(n.id));
  const displayNodes = [...recentNodes, ...otherNodes];
  const getNodeAtIndex = (index) => displayNodes[index];

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && showClusterDropdown) {
      e.preventDefault();
      setShowClusterDropdown(null);
      return;
    }
    if (e.key === 'Escape' && showSettings) {
      e.preventDefault();
      setShowSettings(false);
      return;
    }
    if (e.key === 'Escape' && selectedNode) {
      // Skip when a modal/popover/input already wants Escape.
      const target = e.target;
      const isEditable = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isEditable || showGlobalTunnels || sshTunnelConfig || sshPopover || showTerminalMenu) return;
      e.preventDefault();
      handleBack();
      return;
    }
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
    setEditingCluster({ name: newName, baseUrl: '', apiToken: '', environment: '' });
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
      // 0. Flip the ref FIRST. Any in-flight async work from the old cluster
      //    (polling fetchCache, loadUserInfo, the earlier GetDeviceCache
      //    triggered by the previous polling tick) will see a mismatch when
      //    it resumes and drop its result instead of overwriting cleared state.
      activeClusterRef.current = target;

      // 1. Clear selection/device state IMMEDIATELY to stop polling and stale UI
      setSelectedNode(null);
      setServices(null);
      setSshStatus(null);
      setSessionStatus(null);
      setProjects({}); // Clear old projects map
      projectsLoadedRef.current = false;
      setDeviceCache(null);
      setCacheLoaded(false);
      setLoading(true); // Show skeletons while new cluster cache loads

      // 2. Save config to storage (but DON'T update React config yet —
      //    updating config.activeCluster triggers the polling effect, which
      //    would fetch from the OLD backend before InjectSecureConfig runs)
      const newConfig = { ...config, activeCluster: target };
      await SecureStorageSaveSettings(newConfig);

      // 2b. Update the viewing state so the settings panel reflects the new active cluster
      setViewingClusterName(target);
      const targetCluster = newConfig.clusters.find(c => c.name === target);
      if (targetCluster) {
        setEditingCluster({ ...targetCluster });
        fetchViewingUserInfo(targetCluster);
      }

      // 3. Close settings panel immediately so the user sees the device list
      setShowSettings(false);
      setShowClusterDropdown(null);

      // 4. Push updated config to the Go backend FIRST (triggers cache switch + refresh)
      await InjectSecureConfig().catch(err => console.error('Failed to inject config:', err));

      // 5. NOW update React config — this triggers the polling effect, which will
      //    fetch from the correctly-configured backend
      setConfig(newConfig);

      // 6. Immediately fetch the new cluster's cache (may have disk-cached data)
      try {
        const data = await GetDeviceCache();
        // Bail if the user switched again while we were awaiting.
        if (data && activeClusterRef.current === target) {
          setDeviceCache(data);
          if (data.devices?.length > 0 || !data.isRefreshing) {
            setCacheLoaded(true);
          }
          const map = {};
          (data.projects || []).forEach(p => { map[p.id] = p.name; });
          setProjects(map);
          projectsLoadedRef.current = true;
        }
      } catch (err) {
        console.error('Failed to fetch cache after cluster switch:', err);
      }

      // 7. Reload user info (non-blocking for device list)
      loadUserInfo().catch(err => console.error('Failed to load user info:', err));

      // Clear any auth errors since we switched
      setAuthError(false);
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
      const msg = typeof err === 'string' ? err : err?.message || String(err);
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: msg
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
    setSaveStatus('saving');

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

      // Keep the Go backend's in-memory config in sync with disk so any
      // subsequent /api/settings GET returns up-to-date data instead of
      // stale state frozen at last inject.
      InjectSecureConfig().catch(err => console.error('Failed to inject config after save:', err));

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
        setDeviceCache(null);
        setCacheLoaded(false);
        setLoading(true);
        setProjects({});
        projectsLoadedRef.current = false;
        setEnterprise(null);

        // Refresh global active user info if we changed the active cluster
        if (newConfig.activeCluster === activeToSave) {
          loadUserInfo().catch(console.error);
        }

        if (active && active.apiToken) {
          setSaveStatus('success');
          setTimeout(() => {
            setSaveStatus('');
            // Don't close settings immediately to allow user to verify
          }, 1500);
        } else {
          setSaveStatus('success');
          setTimeout(() => {
            setSaveStatus('');
            setShowSettings(false);
          }, 1500);
        }
      }

      // Trigger a cache refresh so the device list updates
      try {
        await RefreshDeviceCache();
      } catch (err) {
        console.error('Failed to trigger cache refresh after save:', err);
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
        <div className="cluster-info" data-tauri-drag-region>
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
                <Tooltip text={config.clusters.filter(c => c.baseUrl && c.apiToken).length > 1 ? "Switch cluster" : "Active cluster"} simple position="bottom">
                  <span
                    ref={clusterHeaderRef}
                    onClick={() => {
                      const configured = config.clusters.filter(c => c.baseUrl && c.apiToken);
                      if (configured.length > 1) setShowClusterDropdown(showClusterDropdown ? null : 'header');
                    }}
                    style={{
                      cursor: config.clusters.filter(c => c.baseUrl && c.apiToken).length > 1 ? 'pointer' : 'default',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      transition: 'background 0.15s',
                      WebkitAppRegion: 'no-drag',
                    }}
                    onMouseEnter={(e) => { if (config.clusters.filter(c => c.baseUrl && c.apiToken).length > 1) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {entName} • {url}
                    {active.environment && (
                      <span className={`env-pill env-${active.environment}`} style={{ marginLeft: '4px' }}>{active.environment}</span>
                    )}
                    {config.clusters.filter(c => c.baseUrl && c.apiToken).length > 1 && (
                      <ChevronDown size={12} style={{ transition: 'transform 0.2s', transform: showClusterDropdown === 'header' ? 'rotate(180deg)' : 'none' }} />
                    )}
                  </span>
                </Tooltip>
                {tokenOwner && (
                  <Tooltip text={expiryText || 'Token expiry unknown'} simple={true}>
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
      <div className="search-bar" data-tauri-drag-region style={selectedNode ? { paddingLeft: '80px' } : {}}>
        {selectedNode ? (
          <button
            type="button"
            className="back-icon-btn"
            onClick={handleBack}
            title="Back (Esc)"
            aria-label="Back"
          >
            <ArrowLeft size={24} />
          </button>
        ) : (
          <Search className="search-icon" size={20} />
        )}

        {selectedNode ? (
          <div className="selected-node-header">
            <Copyable text={selectedNode.name}>
              <span className="node-name">{selectedNode.name}</span>
            </Copyable>
            <span className={`status-dot ${statusClass(selectedNode.status)}`} title={formatStatus(selectedNode.status)}></span>
            <button
              className="inline-icon-btn"
              title="Refresh device status"
              onClick={handleRefreshDeviceStatus}
              disabled={refreshingDevice}
              style={{ marginLeft: '4px', opacity: refreshingDevice ? 0.5 : 0.7 }}
            >
              <RefreshCw size={14} className={refreshingDevice ? 'animate-spin' : ''} />
            </button>
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
          {config.clusters.filter(c => c.baseUrl && c.apiToken).length > 1 && (
            <div ref={clusterDropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Tooltip text="Switch cluster" simple position="bottom">
                <Layers
                  className="settings-icon"
                  size={20}
                  onClick={() => setShowClusterDropdown(showClusterDropdown ? null : 'icon')}
                  title="Switch Cluster"
                />
              </Tooltip>
              {showClusterDropdown && (() => {
                const anchorRef = showClusterDropdown === 'header' ? clusterHeaderRef : clusterDropdownRef;
                const rect = anchorRef.current?.getBoundingClientRect();
                const dropdownStyle = rect ? {
                  position: 'fixed',
                  top: rect.bottom + 8,
                  left: showClusterDropdown === 'header' ? rect.left : undefined,
                  right: showClusterDropdown === 'icon' ? (window.innerWidth - rect.right) : undefined,
                } : {
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                };
                return (
                <div style={{
                  ...dropdownStyle,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                  minWidth: '220px',
                  maxWidth: '280px',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  zIndex: 1000,
                  animation: 'slideIn 0.15s ease-out',
                }}>
                  <div style={{
                    padding: '8px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    borderBottom: '1px solid var(--border-color)',
                  }}>
                    Switch Cluster
                  </div>
                  {config.clusters.filter(c => c.baseUrl && c.apiToken).map((cluster) => {
                    const isActive = cluster.name === config.activeCluster;
                    return (
                      <div
                        key={cluster.name}
                        onClick={() => {
                          if (!isActive) {
                            setShowClusterDropdown(null);
                            activateCluster(cluster.name);
                          } else {
                            setShowClusterDropdown(null);
                          }
                        }}
                        style={{
                          padding: '8px 12px',
                          fontSize: '13px',
                          cursor: isActive ? 'default' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          color: isActive ? 'var(--color-accent, var(--accent-color))' : 'var(--text-primary)',
                          fontWeight: isActive ? 500 : 400,
                          transition: 'background 0.1s',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Check size={14} style={{ flexShrink: 0, visibility: isActive ? 'visible' : 'hidden' }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{cluster.name}</span>
                        {cluster.environment && (
                          <span className={`env-pill env-${cluster.environment}`}>{cluster.environment}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );})()}
            </div>
          )}
          {!selectedNode && (
            <Tooltip text="Refresh device list" simple position="bottom">
              <RefreshCw
                className={`settings-icon ${deviceCache?.isRefreshing || refreshSpinHold ? 'spinning' : ''}`}
                size={20}
                title="Refresh device list"
                onClick={async () => {
                  setRefreshSpinHold(true);
                  const holdUntil = Date.now() + 500;
                  try {
                    await RefreshDeviceCache();
                    const data = await GetDeviceCache();
                    if (data) setDeviceCache(data);
                  } finally {
                    const remaining = holdUntil - Date.now();
                    if (remaining > 0) {
                      setTimeout(() => setRefreshSpinHold(false), remaining);
                    } else {
                      setRefreshSpinHold(false);
                    }
                  }
                }}
              />
            </Tooltip>
          )}
          <Tooltip text="About" simple position="bottom">
            <Info className="settings-icon" size={20} title="About" onClick={() => setShowAbout(true)} />
          </Tooltip>
          <Tooltip text="Settings" simple position="bottom">
            <Settings className="settings-icon" size={20} title="Settings" onClick={() => setShowSettings(!showSettings)} />
          </Tooltip>
        </div>
      </div>

      {/* Unlock Prompt Overlay Removed */}

      {/* Notification Toasts Container */}
      <div className="toast-container">
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
              <span>Secure storage not available on this system. Tokens will be stored locally.</span>
            </div>
          </div>
        )}
        {migrationState.requiresReauth && (
          <div className="migration-banner warning-banner" style={{ backgroundColor: 'rgba(255, 149, 0, 0.1)', border: '1px solid rgba(255, 149, 0, 0.3)', color: '#ff9500' }}>
            <div className="banner-content">
              <Lock size={18} />
              <span><strong>Major Update:</strong> For security reasons, your API tokens could not be automatically migrated from the old version. Please re-authenticate your clusters in Settings.</span>
              <button
                className="banner-dismiss"
                onClick={() => setMigrationState(prev => ({ ...prev, requiresReauth: false }))}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

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
      </div>

      {/* Collect Info Modal - Removed in favor of GlobalStatusBanner */}

      {showAbout && <About onClose={() => setShowAbout(false)} />}
      <TokenGuide isOpen={showTokenGuide} onClose={() => setShowTokenGuide(false)} />

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
                <div className="cluster-search-row">
                  <div className="cluster-search-input-wrap">
                    <Search size={12} className="cluster-search-icon" />
                    <input
                      type="text"
                      className="cluster-search-input"
                      placeholder="Search clusters..."
                      value={clusterFilter}
                      onChange={(e) => setClusterFilter(e.target.value)}
                      spellCheck={false}
                    />
                    {clusterFilter && (
                      <button
                        type="button"
                        className="cluster-search-clear"
                        onClick={() => setClusterFilter('')}
                        title="Clear"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <button className="add-cluster-btn icon-only" onClick={addNewCluster} title="Add cluster">
                    <Plus size={14} />
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {config.clusters
                    .map((cluster, idx) => ({ cluster, idx }))
                    .filter(({ cluster }) => {
                      const q = clusterFilter.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        cluster.name?.toLowerCase().includes(q) ||
                        cluster.baseUrl?.toLowerCase().includes(q) ||
                        cluster.environment?.toLowerCase().includes(q)
                      );
                    })
                    .map(({ cluster, idx }) => (
                    <div
                      key={idx}
                      className={`cluster-item ${cluster.name === viewingClusterName ? 'active' : ''}`}
                      onClick={() => handleClusterSelect(cluster.name)}
                    >
                      <div className="cluster-name-row">
                        <div className="cluster-name">{cluster.name}</div>
                        {cluster.environment && (
                          <span className={`env-pill env-${cluster.environment}`}>{cluster.environment}</span>
                        )}
                      </div>
                      {cluster.name === config.activeCluster && <div className="active-badge">Active</div>}
                      {cluster.name !== config.activeCluster && (
                        <button
                          className="switch-cluster-btn"
                          onClick={(e) => {
                            e.stopPropagation();
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
                {/* APP section pinned at bottom */}
                <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>APP</div>
                  <Tooltip text="Toggle theme" simple position="top" usePortal>
                    <div
                      onClick={toggleTheme}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        gap: '8px',
                        fontSize: '12px',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Monitor size={14} />}
                      <span style={{ color: 'var(--text-primary)' }}>
                        {theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto'}
                      </span>
                    </div>
                  </Tooltip>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <span>v<VersionDisplay /></span>
                    <button
                      onClick={async () => {
                        try {
                          const res = await CheckForUpdates();
                          if (res?.upToDate || res?.noReleases) {
                            setGlobalStatus({ type: 'success', message: 'You are on the latest version.', duration: 3000 });
                          }
                        } catch (err) {
                          console.error('Failed to check for updates:', err);
                        }
                      }}
                      disabled={updateState.status === 'downloading'}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent-color)',
                        cursor: updateState.status === 'downloading' ? 'not-allowed' : 'pointer',
                        fontSize: '11px',
                        padding: '2px 4px',
                        borderRadius: '3px',
                        opacity: updateState.status === 'downloading' ? 0.5 : 1,
                      }}
                    >
                      {updateState.status === 'downloading' ? 'Checking...' : 'Check for Updates'}
                    </button>
                  </div>
                  {updateState.status === 'available' && (
                    <div style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--color-accent, var(--accent-color))', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertCircle size={12} /> Update available: {updateState.version}
                    </div>
                  )}
                  {updateState.status === 'downloaded' && (
                    <div style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Check size={12} /> Update ready to install
                    </div>
                  )}
                </div>
              </div>
              <div className="cluster-details">
                {viewingClusterName !== config.activeCluster && (
                  <div className="cluster-actions-bar" style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div className="info-text" style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
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
                  <Tooltip text="A friendly name for this ZEDEDA Cloud cluster." simple>
                    <label style={{ cursor: 'help' }}>Cluster Name</label>
                  </Tooltip>
                  <input
                    type="text"
                    value={editingCluster.name}
                    onChange={(e) => setEditingCluster({ ...editingCluster, name: e.target.value })}
                    placeholder="e.g. Production, Staging"
                  />
                </div>
                <div className="form-group">
                  <Tooltip text="The ZEDEDA Cloud controller URL (e.g. zedcontrol.zededa.net)." simple>
                    <label style={{ cursor: 'help' }}>Base URL</label>
                  </Tooltip>
                  <input
                    type="text"
                    value={editingCluster.baseUrl}
                    onChange={(e) => setEditingCluster({ ...editingCluster, baseUrl: e.target.value })}
                    placeholder="https://zedcontrol.zededa.net"
                  />
                </div>
                <div className="form-group">
                  <Tooltip text="Optional tag to distinguish customer-prod from staging/demo clusters at a glance." simple>
                    <label style={{ cursor: 'help' }}>Environment</label>
                  </Tooltip>
                  <select
                    value={editingCluster.environment || ''}
                    onChange={(e) => setEditingCluster({ ...editingCluster, environment: e.target.value })}
                  >
                    <option value="">None</option>
                    <option value="prod">Production</option>
                    <option value="staging">Staging</option>
                    <option value="demo">Demo</option>
                  </select>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Tooltip text="A bearer token from ZEDEDA Cloud for authenticating API requests." helpUrl="https://help.zededa.com/hc/en-us/articles/21466243767579-Configure-Session-Tokens" simple>
                      <span style={{ cursor: 'help' }}>API Token</span>
                    </Tooltip>
                    <HelpCircle
                      size={14}
                      style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }}
                      onClick={() => setShowTokenGuide(true)}
                      title="How to get your API token"
                    />
                  </label>
                  <TokenField
                    key={viewingClusterName || 'new-cluster'}
                    value={editingCluster.apiToken}
                    onChange={handleTokenPaste}
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
                  <button
                    className={`save-btn ${saveStatus === 'success' ? 'save-success' : ''}`}
                    onClick={() => saveSettings(null)}
                    disabled={saveStatus === 'saving'}
                  >
                    {saveStatus === 'success' ? <><Check size={16} /> Saved!</> :
                     saveStatus === 'saving' ? <><Save size={16} /> Saving...</> :
                     <><Save size={16} /> Save Changes</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="content-area">
            {selectedNode && (
              <div className={`active-tunnels-section ${activeTunnels.filter(t => t.nodeId === selectedNode.id && t.status !== 'failed').length > 0 ? 'expanded' : 'collapsed'} ${highlightTunnels ? 'highlight' : ''}`}>
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
                        {tunnel.type === 'TCP' && (
                          <button
                            className="icon-btn"
                            title="Open in Browser"
                            onClick={() => openExternal(`http://localhost:${tunnel.localPort}`)}
                          >
                            <ExternalLink size={12} />
                          </button>
                        )}
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
                          <>
                            <button
                              className="icon-btn"
                              title="Open External VNC Viewer"
                              onClick={() => openExternal(`vnc://localhost:${tunnel.localPort}`)}
                            >
                              <ExternalLink size={14} />
                            </button>
                            <button
                              className="icon-btn"
                              title="Open Built-in VNC Viewer"
                              onClick={() => openVncWindow({
                                port: tunnel.localPort,
                                nodeName: tunnel.nodeName || selectedNode.name,
                                tunnelId: tunnel.id,
                                theme
                              })}
                            >
                              <Monitor size={14} />
                            </button>
                          </>
                        )}
                        {tunnel.type === 'SSH' && (
                          <>
                            <button
                              className="icon-btn"
                              title="Open External Terminal"
                              onClick={() => openExternalTerminal(`ssh -p ${tunnel.localPort} ${tunnel.username || 'root'}@localhost`)}
                            >
                              <ExternalLink size={14} />
                            </button>
                            <button
                              className="icon-btn"
                              title="Open Built-in Terminal"
                              onClick={() => openTerminalWindow({
                                port: tunnel.localPort,
                                username: tunnel.username,
                                nodeName: tunnel.nodeName || selectedNode.name,
                                targetInfo: `${tunnel.username || 'root'}@${tunnel.nodeName || selectedNode.name}`,
                                tunnelId: tunnel.id,
                                theme
                              })}
                            >
                              <Terminal size={14} />
                            </button>
                          </>
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
              <div className="active-tunnels-section global expanded">
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
                          <button
                            className="tunnel-device tunnel-device-link"
                            title="Open device details"
                            onClick={() => {
                              const node = nodes.find(n => n.id === tunnel.nodeId);
                              if (node) {
                                setShowGlobalTunnels(false);
                                handleConnect(node);
                              }
                            }}
                          >
                            {tunnel.nodeName || tunnel.nodeId}
                          </button>
                          {tunnel.projectId && (
                            <span className="tunnel-project">
                              • {projects[tunnel.projectId] || tunnel.projectId}
                            </span>
                          )}
                        </div>
                        {tunnel.type === 'TCP' && (
                          <button
                            className="icon-btn"
                            title="Open in Browser"
                            onClick={() => openExternal(`http://localhost:${tunnel.localPort}`)}
                          >
                            <ExternalLink size={12} />
                          </button>
                        )}
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
                          <>
                            <button
                              className="icon-btn"
                              title="Open External VNC Viewer"
                              onClick={() => openExternal(`vnc://localhost:${tunnel.localPort}`)}
                            >
                              <ExternalLink size={14} />
                            </button>
                            <button
                              className="icon-btn"
                              title="Open Built-in VNC Viewer"
                              onClick={() => openVncWindow({
                                port: tunnel.localPort,
                                nodeName: tunnel.nodeName || tunnel.nodeId,
                                tunnelId: tunnel.id,
                                theme
                              })}
                            >
                              <Monitor size={14} />
                            </button>
                          </>
                        )}
                        {tunnel.type === 'SSH' && (
                          <>
                            <button
                              className="icon-btn"
                              title="Open External Terminal"
                              onClick={() => openExternalTerminal(`ssh -p ${tunnel.localPort} ${tunnel.username || 'root'}@localhost`)}
                            >
                              <ExternalLink size={14} />
                            </button>
                            <button
                              className="icon-btn"
                              title="Open Built-in Terminal"
                              onClick={() => openTerminalWindow({
                                port: tunnel.localPort,
                                username: tunnel.username,
                                nodeName: tunnel.nodeName || tunnel.nodeId,
                                targetInfo: `${tunnel.username || 'root'}@${tunnel.nodeName || tunnel.nodeId}`,
                                tunnelId: tunnel.id,
                                theme
                              })}
                            >
                              <Terminal size={14} />
                            </button>
                          </>
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

            {selectedNode && !isDeviceOnline && (
              <div className="device-offline-banner">
                <AlertTriangle size={14} />
                Device is {formatStatus(selectedNode.status)} — EdgeView tunnel operations are unavailable.
                Cloud configuration and last-known status are shown below.
              </div>
            )}

            {
              selectedNode && (
                <div className="ssh-status-section">
                  <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>EdgeView Session</span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                      {sshStatus?.externalPolicy && (
                        <div style={{ position: 'relative', display: 'flex' }}>
                            <button
                              className={`connect-btn secondary`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 12px',
                                fontSize: '12px',
                                height: '100%'
                              }}
                              onClick={() => {
                                setTcpIpInput('');
                                setTcpPortInput('');
                                setTcpTunnelConfig({ id: 'manual' });
                              }}
                              disabled={!isSessionConnected}
                              title={!isSessionConnected ? "Session is not connected" : "Open TCP tunnel to external endpoint"}
                            >
                              <Activity size={16} style={{ color: !isSessionConnected ? 'var(--text-secondary)' : 'var(--color-primary)' }} />
                              External Endpoint TCP Tunnel
                            </button>
                        </div>
                      )}
                      <div className="split-btn-container" ref={dropdownRef}>
                        <button
                          className={`connect-btn secondary split-main`}
                          onClick={() => setShowTerminalMenu(!showTerminalMenu)}
                          disabled={!sshStatus || sshStatus.status !== 'enabled' || !isSessionConnected || !isDeviceOnline}
                          title={!isDeviceOnline
                            ? "Device is offline"
                            : (!sshStatus || sshStatus.status !== 'enabled')
                            ? "SSH must be enabled first"
                            : !isSessionConnected
                              ? "Session is not connected"
                              : "Open SSH Terminal"}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', fontSize: '12px' }}
                        >
                          <Terminal size={16} />
                          <img src={eveOsIcon} alt="EVE-OS" style={{ height: '14px', width: 'auto', filter: theme === 'dark' ? 'brightness(0) invert(1)' : 'none', opacity: theme === 'dark' ? 0.9 : 1 }} />
                          EVE-OS SSH Terminal
                        </button>
                        <button
                          className={`connect-btn secondary split-arrow`}
                          onClick={() => setShowTerminalMenu(!showTerminalMenu)}
                          disabled={!sshStatus || sshStatus.status !== 'enabled' || !isSessionConnected || !isDeviceOnline}
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
                            borderBottom: '1px solid var(--border-subtle)'
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
                  </div>

                  <div className="ssh-details-wrapper" style={{ position: 'relative', minHeight: '200px' }}>
                    {!sshStatus && loadingSSH && <SshDetailsSkeleton />}
                    {sshStatus ? (
                      <div className="ssh-details" style={{ opacity: loadingSSH ? 0.6 : 1, transition: 'opacity 0.2s' }}>
                        <div className="status-grid">
                          {(sshStatus.instID !== undefined || sshStatus.maxInst !== undefined) && (
                            <div className="status-item">
                              <Tooltip text="Current EdgeView instance / max allowed concurrent instances." helpUrl="https://lf-edge.atlassian.net/wiki/spaces/EVE/pages/14584954/EdgeView+Commands#Multi-Instances" simple>
                                <div className="status-label" style={{ cursor: 'help' }}>INSTANCE</div>
                              </Tooltip>
                              <div className="status-value">
                                {sshStatus.instID !== undefined && sshStatus.maxInst !== undefined
                                  ? `${sshStatus.instID}/${sshStatus.maxInst}`
                                  : '-'}
                              </div>
                            </div>
                          )}
                          {sshStatus.maxSessions > 0 && (
                            <div className="status-item">
                              <Tooltip text="Maximum number of concurrent tunnels to the edge node allowed, controlled by Project or edge-node level EdgeView policy." helpUrl="https://help.zededa.com/hc/en-us/articles/43171861150491-Configure-the-Project-Policies#h_01K5K3W1FJVZN3Z55JFKFDKHJE" simple>
                                <div className="status-label" style={{ cursor: 'help' }}>MAX SESSIONS</div>
                              </Tooltip>
                              <div className="status-value">{sshStatus.maxSessions}</div>
                            </div>
                          )}
                          <div className="status-item">
                            <Tooltip text="Whether the EdgeView tunnel uses end-to-end encryption (JWT-based)." helpUrl="https://lf-edge.atlassian.net/wiki/spaces/EVE/pages/14584760/Edge-View+Architecture#Data-Path" simple>
                              <div className="status-label" style={{ cursor: 'help' }}>ENCRYPTION</div>
                            </Tooltip>
                            <div className={`status-value ${(sessionStatus?.isEncrypted || sshStatus?.isEncrypted) ? 'success' : 'mismatch'}`}>
                              {(sessionStatus?.isEncrypted || sshStatus?.isEncrypted) ? (
                                <><Lock size={14} /> Encrypted</>
                              ) : (
                                <><Unlock size={14} /> Unencrypted</>
                              )}
                            </div>
                          </div>
                          <div className="status-item">
                            <Tooltip text="Whether an active EdgeView session is established to this device." helpUrl="https://help.zededa.com/hc/en-us/articles/39473586111003-Edge-View-Overview" simple>
                              <div className="status-label" style={{ cursor: 'help' }}>SESSION</div>
                            </Tooltip>
                            <div className={`status-value ${isSessionConnected ? 'success' : 'error'}`}>
                              {isSessionConnected ? (
                                <><Check size={14} /> Activated</>
                              ) : (
                                <><X size={14} /> Inactive</>
                              )}
                            </div>
                          </div>
                          <div className="status-item">
                            <Tooltip text="Time remaining before the EdgeView session token expires (~5h default)." helpUrl="https://lf-edge.atlassian.net/wiki/spaces/EVE/pages/14584760/Edge-View+Architecture" simple>
                              <div className="status-label" style={{ cursor: 'help' }}>EXPIRES</div>
                            </Tooltip>
                            <div className={`status-value ${expiryInfo.colorClass}`}>
                              {expiryInfo.timestamp ? (
                                <span title={new Date(expiryInfo.timestamp).toLocaleString(undefined, getTimeFormatOptions())}>
                                  {expiryInfo.label}
                                </span>
                              ) : '-'}
                              <button
                                className="inline-icon-btn"
                                title={!isDeviceOnline ? "Device is offline" : "Restart EdgeView session"}
                                onClick={handleResetEdgeView}
                                disabled={!isDeviceOnline}
                                style={{ opacity: isDeviceOnline ? 1 : 0.5 }}
                              >
                                <RefreshCw size={14} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {sshStatus.managementIPs && sshStatus.managementIPs.length > 0 && (() => {
                          const ipv4 = sshStatus.managementIPs.filter(ip => !ip.includes(':'));
                          const ipv6 = sshStatus.managementIPs.filter(ip => ip.includes(':'));
                          const renderBadge = (ip, i) => (
                            <Copyable key={i} text={ip}>
                              <span style={{
                                backgroundColor: 'var(--bg-tertiary, rgba(255, 255, 255, 0.08))',
                                padding: '3px 10px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontFamily: 'monospace',
                                whiteSpace: 'nowrap',
                                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
                              }}>
                                {ip}
                              </span>
                            </Copyable>
                          );
                          return (
                            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.05))' }}>
                              <div className="status-label" style={{ marginBottom: '10px', textAlign: 'center' }}>MANAGEMENT IPS</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {ipv4.length > 0 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary, #888)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '32px', flexShrink: 0 }}>IPv4</span>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                      {ipv4.map(renderBadge)}
                                    </div>
                                  </div>
                                )}
                                {ipv6.length > 0 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary, #888)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '32px', flexShrink: 0 }}>IPv6</span>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                      {ipv6.map(renderBadge)}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Configuration Controls */}
                        <div className="config-container" style={{ marginTop: '15px', borderTop: '1px solid #333', paddingTop: '15px' }}>
                          <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Device Configuration
                          </div>

                          <div className="config-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'space-between' }}>

                            {/* SSH Control */}
                            <Tooltip text="Enable SSH access to the EVE-OS shell via EdgeView tunnel." helpUrl="https://help.zededa.com/hc/en-us/articles/39473586111003-Edge-View-Overview#h_01K2NBYMH255X6QMJHP079XVXQ" simple>
                            <div
                              className={`config-chip ${sshStatus.status === 'enabled' ? 'enabled' : sshStatus.status === 'mismatch' ? 'warning' : 'disabled'}`}
                              onClick={isDeviceOnline ? (sshStatus.status === 'enabled' ? handleDisableSSH : handleSetupSSH) : undefined}
                              title={!isDeviceOnline ? "Device is offline" : sshStatus.status === 'enabled' ? "SSH Enabled - Click to Disable" : sshStatus.status === 'mismatch' ? "Key Mismatch - Click to Fix" : "SSH Disabled - Click to Enable"}
                              style={{
                                display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                                fontSize: '12px', fontWeight: '500', cursor: isDeviceOnline ? 'pointer' : 'default', transition: 'all 0.2s', opacity: isDeviceOnline ? 1 : 0.5,
                                backgroundColor: sshStatus.status === 'enabled' ? 'var(--color-success-bg)' : sshStatus.status === 'mismatch' ? 'var(--color-warning-bg)' : 'var(--bg-secondary)',
                                color: sshStatus.status === 'enabled' ? 'var(--color-success)' : sshStatus.status === 'mismatch' ? 'var(--color-warning)' : 'var(--text-primary)',
                                border: 'none'
                              }}
                            >
                              {sshStatus.status === 'enabled' ? <Unlock size={13} style={{ marginRight: '6px' }} /> :
                                sshStatus.status === 'mismatch' ? <AlertTriangle size={13} style={{ marginRight: '6px' }} /> :
                                  <Lock size={13} style={{ marginRight: '6px' }} />}
                              {sshStatus.status === 'enabled' ? 'SSH Enabled' : sshStatus.status === 'mismatch' ? 'SSH Key Mismatch' : 'Enable SSH'}
                            </div>
                            </Tooltip>

                            {/* VGA Control */}
                            <Tooltip text="Enable VGA console output on the device for local display or remote VNC access." helpUrl="https://help.zededa.com/hc/en-us/sections/40376827750043-Local-UI-for-Direct-Edge-Node-Access" simple>
                            <div
                              className={`config-chip ${sshStatus.vgaEnabled ? 'enabled' : 'disabled'}`}
                              onClick={isDeviceOnline ? () => handleToggleVGA(!sshStatus.vgaEnabled) : undefined}
                              title={!isDeviceOnline ? "Device is offline" : sshStatus.vgaEnabled ? "VGA Enabled - Click to Disable" : "VGA Disabled - Click to Enable"}
                              style={{
                                display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                                fontSize: '12px', fontWeight: '500', cursor: isDeviceOnline ? 'pointer' : 'default', transition: 'all 0.2s', opacity: isDeviceOnline ? 1 : 0.5,
                                backgroundColor: sshStatus.vgaEnabled ? 'var(--color-success-bg)' : 'var(--bg-secondary)',
                                color: sshStatus.vgaEnabled ? 'var(--color-success)' : 'var(--text-primary)',
                                border: 'none'
                              }}
                            >
                              <Monitor size={13} style={{ marginRight: '6px' }} />
                              {sshStatus.vgaEnabled ? 'VGA Enabled' : 'Enable VGA'}
                            </div>
                            </Tooltip>

                            {/* USB Control */}
                            <Tooltip text="Allow USB devices (e.g. keyboards) on the device for local access." helpUrl="https://help.zededa.com/hc/en-us/sections/40376827750043-Local-UI-for-Direct-Edge-Node-Access" simple>
                            <div
                              className={`config-chip ${sshStatus.usbEnabled ? 'enabled' : 'disabled'}`}
                              onClick={isDeviceOnline ? () => handleToggleUSB(!sshStatus.usbEnabled) : undefined}
                              title={!isDeviceOnline ? "Device is offline" : sshStatus.usbEnabled ? "USB Enabled - Click to Disable" : "USB Disabled - Click to Enable"}
                              style={{
                                display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                                fontSize: '12px', fontWeight: '500', cursor: isDeviceOnline ? 'pointer' : 'default', transition: 'all 0.2s', opacity: isDeviceOnline ? 1 : 0.5,
                                backgroundColor: sshStatus.usbEnabled ? 'var(--color-success-bg)' : 'var(--bg-secondary)',
                                color: sshStatus.usbEnabled ? 'var(--color-success)' : 'var(--text-primary)',
                                border: 'none'
                              }}
                            >
                              <Activity size={13} style={{ marginRight: '6px' }} />
                              {sshStatus.usbEnabled ? 'USB Enabled' : 'Enable USB'}
                            </div>
                            </Tooltip>

                            {/* Console Control */}
                            <Tooltip text="Enable serial console access on the device for low-level debugging." helpUrl="https://help.zededa.com/hc/en-us/sections/40376827750043-Local-UI-for-Direct-Edge-Node-Access" simple>
                            <div
                              className={`config-chip ${sshStatus.consoleEnabled ? 'enabled' : 'disabled'}`}
                              onClick={isDeviceOnline ? () => handleToggleConsole(!sshStatus.consoleEnabled) : undefined}
                              title={!isDeviceOnline ? "Device is offline" : sshStatus.consoleEnabled ? "Console Enabled - Click to Disable" : "Console Disabled - Click to Enable"}
                              style={{
                                display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                                fontSize: '12px', fontWeight: '500', cursor: isDeviceOnline ? 'pointer' : 'default', transition: 'all 0.2s', opacity: isDeviceOnline ? 1 : 0.5,
                                backgroundColor: sshStatus.consoleEnabled ? 'var(--color-success-bg)' : 'var(--bg-secondary)',
                                color: sshStatus.consoleEnabled ? 'var(--color-success)' : 'var(--text-primary)',
                                border: 'none'
                              }}
                            >
                              <Terminal size={13} style={{ marginRight: '6px' }} />
                              {sshStatus.consoleEnabled ? 'Console Enabled' : 'Enable Console'}
                            </div>
                            </Tooltip>

                            {/* External Policy Control */}
                            <Tooltip text="Allow EdgeView to route traffic to external IPs beyond the device's local network." helpUrl="https://lf-edge.atlassian.net/wiki/spaces/EVE/pages/14584954/EdgeView+Commands#Access-TCP-Services-of-External-Hosts" simple>
                            <div
                              className={`config-chip ${sshStatus.externalPolicy ? 'enabled' : 'disabled'}`}
                              onClick={isDeviceOnline ? handleEnableExternalPolicy : undefined}
                              title={!isDeviceOnline ? "Device is offline" : sshStatus.externalPolicy ? "External Policy Enabled - Click to Disable" : "External Policy Disabled - Click to Enable"}
                              style={{
                                display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                                fontSize: '12px', fontWeight: '500', cursor: isDeviceOnline ? 'pointer' : 'default', transition: 'all 0.2s', opacity: isDeviceOnline ? 1 : 0.5,
                                backgroundColor: sshStatus.externalPolicy ? 'var(--color-success-bg)' : 'var(--bg-secondary)',
                                color: sshStatus.externalPolicy ? 'var(--color-success)' : 'var(--text-primary)',
                                border: 'none'
                              }}
                            >
                              <Shield size={13} style={{ marginRight: '6px' }} />
                              {sshStatus.externalPolicy ? 'Ext. Policy Enabled' : 'Enable Ext. Policy'}
                            </div>
                            </Tooltip>

                            {/* Collect Info */}
                            <Tooltip text="Download a tech-support bundle with logs, network state, and diagnostics." helpUrl="https://lf-edge.atlassian.net/wiki/spaces/EVE/pages/14584954/EdgeView+Commands#CollectInfo" simple>
                            <div
                              className={`config-chip ${isSessionConnected ? '' : 'disabled'}`}
                              onClick={isSessionConnected ? handleCollectInfo : undefined}
                              title={!isDeviceOnline ? "Device is offline" : !isSessionConnected ? "Session must be active to collect info" : "Collect system information (tech-support bundle)"}
                              style={{
                                display: 'flex', alignItems: 'center', padding: '4px 12px', borderRadius: '9999px',
                                fontSize: '12px', fontWeight: '500', cursor: isSessionConnected ? 'pointer' : 'default', transition: 'all 0.2s',
                                backgroundColor: isSessionConnected ? 'var(--color-primary-bg)' : 'var(--bg-secondary)',
                                color: isSessionConnected ? 'var(--color-primary)' : 'var(--text-primary)',
                                border: isSessionConnected ? '1px solid var(--color-primary-border)' : 'none',
                                opacity: isDeviceOnline ? 1 : 0.5
                              }}
                            >
                              <Download size={13} style={{ marginRight: '6px' }} />
                              Collect Info
                            </div>
                            </Tooltip>

                          </div>
                        </div>
                      </div>
                    ) : !loadingSSH && (
                      <div className="error-text">Failed to check status</div>
                    )}
                  </div>
                </div>
              )
            }

            {/* Contextual Action Button placeholder (button moved to session header) */}
            {selectedNode && (
              <div style={{ marginBottom: '16px', marginTop: '-8px' }}>
              </div>
            )}


            {
              selectedNode && (
                <div className="details-header">
                  <h3>Running Applications</h3>
                </div>
              )
            }

            {selectedNode && (
              loadingServices ? (
                <div className="services-list">
                  <ServicesListSkeleton count={3} />
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
                        const isRuntime = parentsMap.has(app.id);
                        // Detect compose runtime v2+ from the runtime app's appVersion (from ZEDEDA API swInfo)
                        let composeV2Plus = false;
                        if (isRuntime && app.appVersion) {
                          const majorMatch = app.appVersion.match(/^(\d+)\./);
                          composeV2Plus = majorMatch ? parseInt(majorMatch[1], 10) >= 2 : false;
                        }
                        displayList.push({ ...app, isChild: false, isRuntime, composeV2Plus });
                        if (isRuntime) {
                          const children = parentsMap.get(app.id);
                          children.forEach((child, index) => {
                            displayList.push({ ...child, isChild: true, isLastChild: index === children.length - 1 });
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
                              position: 'relative',
                              marginBottom: '8px',
                              overflow: 'visible'
                            }}>
                              {app.isChild && (
                                <>
                                  <div style={{
                                    position: 'absolute',
                                    left: '-16px',
                                    top: '-10px',
                                    width: '2px',
                                    height: app.isLastChild ? '34px' : 'calc(100% + 18px)',
                                    backgroundColor: 'var(--border-color)'
                                  }} />
                                  <div style={{
                                    position: 'absolute',
                                    left: '-16px',
                                    top: '24px',
                                    width: '16px',
                                    height: '2px',
                                    backgroundColor: 'var(--border-color)'
                                  }} />
                                </>
                              )}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div className="service-info" style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', height: '100%' }}>
                                    <span className="service-name" style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center' }}>
                                      <Copyable text={app.name}>
                                        {app.name}
                                      </Copyable>
                                      {app.status && (
                                        <div style={{ display: 'flex', alignItems: 'center', marginLeft: '12px', gap: '6px' }}>
                                          <div
                                            className={`status-dot ${statusClass(app.status)}`}
                                            title={formatStatus(app.status)}
                                          />
                                          <span style={{
                                            fontSize: '0.85em',
                                            color: isInteractive(app.status) ? 'var(--color-success)' : 'var(--text-secondary)',
                                          }}>
                                            {formatStatus(app.status)}
                                          </span>
                                          {/* Error Display */}
                                          {app.error && (
                                            <Tooltip text={app.error}>
                                              <span style={{ display: 'flex', alignItems: 'center', color: 'var(--color-danger)', marginLeft: '8px', cursor: 'help' }}>
                                                <AlertCircle size={12} style={{ marginRight: '4px' }} />
                                                <span style={{ fontSize: '0.85em', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                  {app.error}
                                                </span>
                                              </span>
                                            </Tooltip>
                                          )}
                                        </div>
                                      )}
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
                                                disabled={!!tunnelLoading || !isSessionConnected || !isInteractive(app.status)}
                                                title={(!isSessionConnected)
                                                  ? "EdgeView session not active"
                                                  : !isInteractive(app.status)
                                                    ? `App is not online (${formatStatus(app.status) || 'Unknown'})`
                                                    : `SSH as ${savedUser}@${ip} — click to connect`}
                                                style={{
                                                  backgroundColor: 'var(--bg-tertiary)',
                                                  border: '1px solid var(--border-subtle)',
                                                  borderRadius: '4px',
                                                  padding: '2px 6px',
                                                  fontSize: '11px',
                                                  fontFamily: 'monospace',
                                                  color: 'var(--text-secondary)',
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
                                              disabled={!!tunnelLoading || !isSessionConnected || !isInteractive(app.status)}
                                              title={(!isSessionConnected)
                                                ? "EdgeView session not active"
                                                : !isInteractive(app.status)
                                                  ? `App is not online (${formatStatus(app.status) || 'Unknown'})`
                                                  : `Click to start VNC on port ${app.vncPort}`}
                                              style={{
                                                backgroundColor: 'var(--bg-tertiary)',
                                                border: '1px solid var(--border-subtle)',
                                                borderRadius: '4px',
                                                padding: '2px 6px',
                                                fontSize: '11px',
                                                fontFamily: 'monospace',
                                                color: 'var(--text-secondary)',
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
                                  {app.isRuntime && app.composeV2Plus && (
                                    <div style={{ position: 'relative', display: 'inline-block' }}>
                                      <button
                                        className="connect-btn secondary"
                                        onClick={() => {
                                          if (diagPrompt && diagPrompt.idx === idx) {
                                            setDiagPrompt(null);
                                          } else {
                                            openDiagnosticsPrompt(app, idx);
                                          }
                                        }}
                                        disabled={!isSessionConnected || !isInteractive(app.status) || !!composeDiagJobRef.current}
                                        style={{ marginRight: '8px' }}
                                        title="Collect runtime diagnostics bundle from compose VM"
                                      >
                                        <Download size={14} /> Diagnostics
                                      </button>
                                      {diagPrompt && diagPrompt.idx === idx && (
                                        <div
                                          className="ssh-popover"
                                          onClick={(e) => e.stopPropagation()}
                                          style={{
                                            position: 'absolute',
                                            top: '100%',
                                            right: '0',
                                            marginTop: '4px',
                                            backgroundColor: 'var(--bg-panel)',
                                            border: '1px solid var(--border-subtle)',
                                            borderRadius: '6px',
                                            padding: '8px',
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                            zIndex: 1000,
                                            minWidth: '220px',
                                            textAlign: 'left'
                                          }}
                                        >
                                          <div style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            SSH Credentials
                                          </div>
                                          <input
                                            type="text"
                                            value={diagPrompt.username}
                                            onChange={e => setDiagPrompt(prev => ({ ...prev, username: e.target.value }))}
                                            placeholder="Username (e.g. ubuntu)"
                                            autoFocus
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                e.preventDefault();
                                                document.getElementById('diag-password-input')?.focus();
                                              } else if (e.key === 'Escape') {
                                                setDiagPrompt(null);
                                              }
                                            }}
                                            style={{
                                              width: '100%',
                                              boxSizing: 'border-box',
                                              padding: '6px 8px',
                                              backgroundColor: 'var(--bg-surface)',
                                              border: '1px solid var(--border-subtle)',
                                              borderRadius: '4px',
                                              color: 'var(--text-primary)',
                                              fontSize: '13px',
                                              marginBottom: '8px'
                                            }}
                                          />
                                          <input
                                            id="diag-password-input"
                                            type="password"
                                            value={diagPrompt.password}
                                            onChange={e => setDiagPrompt(prev => ({ ...prev, password: e.target.value }))}
                                            placeholder="Password"
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                handleComposeDiagnostics(diagPrompt.app, diagPrompt.username, diagPrompt.password);
                                              } else if (e.key === 'Escape') {
                                                setDiagPrompt(null);
                                              }
                                            }}
                                            style={{
                                              width: '100%',
                                              boxSizing: 'border-box',
                                              padding: '6px 8px',
                                              backgroundColor: 'var(--bg-surface)',
                                              border: '1px solid var(--border-subtle)',
                                              borderRadius: '4px',
                                              color: 'var(--text-primary)',
                                              fontSize: '13px',
                                              marginBottom: '12px'
                                            }}
                                          />
                                          <button
                                            className="connect-btn primary"
                                            style={{ width: '100%', justifyContent: 'center' }}
                                            onClick={() => handleComposeDiagnostics(diagPrompt.app, diagPrompt.username, diagPrompt.password)}
                                          >
                                            Collect
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
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
                                    title={!isSessionConnected
                                      ? "EdgeView session not active"
                                      : !isInteractive(app.status)
                                        ? `App is not online (${formatStatus(app.status) || 'Unknown'})`
                                        : "Connect to service"}
                                    disabled={!isSessionConnected || !isInteractive(app.status)}
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
                                                  backgroundColor: 'var(--bg-panel)',
                                                  border: '1px solid var(--border-subtle)',
                                                  borderRadius: '6px',
                                                  padding: '8px',
                                                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                                  zIndex: 1000,
                                                  minWidth: '220px',
                                                  textAlign: 'left'
                                                }}
                                              >
                                                <div style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
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
                                                    backgroundColor: 'var(--bg-surface)',
                                                    border: '1px solid var(--border-subtle)',
                                                    borderRadius: '4px',
                                                    color: 'var(--text-primary)',
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
                                                    backgroundColor: 'var(--bg-surface)',
                                                    border: '1px solid var(--border-subtle)',
                                                    borderRadius: '4px',
                                                    color: 'var(--text-primary)',
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
                                          backgroundColor: 'var(--bg-panel)',
                                          border: '1px solid var(--border-subtle)',
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
                                                await openVncWindow({
                                                  port: port,
                                                  nodeName: selectedNode.name,
                                                  appName: app.name,
                                                  tunnelId: tunnelId,
                                                  theme
                                                });
                                                addLog(`VNC viewer opened in new window`, 'info');
                                                setExpandedServiceId(null);
                                              } catch (err) {
                                                console.error(err);
                                                handleTunnelError(err);
                                                addLog(`Failed to start VNC tunnel: ${err.message}`, 'error');
                                              } finally {
                                                setTunnelLoading(null);
                                                setGlobalStatus(prev => prev?.type === 'error' ? prev : null);
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
                                                setGlobalStatus(prev => prev?.type === 'error' ? prev : null);
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
                                      const allIps = app.ips && app.ips.length > 0 ? app.ips : ['10.2.255.254'];
                                      const ip = allIps[0];
                                      const savedUser = getSavedSshUsername(app.name);
                                      setSshUser(savedUser);
                                      setSshTunnelConfig({ ip, allIps, appName: app.name });
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
              ) : null
            )}

            {selectedNode && <ActivityLog logs={logs} />}

            {
              tcpTunnelConfig && (
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
                    {(() => {
                      const exposedPorts = tcpTunnelConfig ? (tcpTunnelConfig.containers || []).flatMap(c =>
                        (c.portMaps || [])
                          .filter(pm => pm.publicPort > 0)
                          .map(pm => ({ ...pm, containerName: c.containerName }))
                      ) : [];
                      return (
                        <PortComboBox
                          value={tcpPortInput}
                          onChange={setTcpPortInput}
                          exposedPorts={exposedPorts}
                          placeholder="e.g. 8080"
                          showCommonPorts={true}
                        />
                      );
                    })()}
                  </div>

                  {tcpError && (
                    <div style={{ color: 'var(--color-danger)', fontSize: '13px', marginBottom: '16px' }}>
                      {tcpError}
                    </div>
                  )}
                </Modal>
              )
            }

            {
              sshTunnelConfig && (
                <Modal
                  title="Start SSH Session"
                  isOpen={!!sshTunnelConfig}
                  onDismiss={() => {
                    setSshTunnelConfig(null);
                    setSshError(null);
                  }}
                  size="small"
                >
                  <div style={{ fontSize: '13px', marginBottom: '20px', color: 'var(--text-secondary)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <span>{selectedNode?.name} •</span>
                    {sshTunnelConfig.allIps && sshTunnelConfig.allIps.length > 1 ? (
                      <select
                        value={sshTunnelConfig.ip}
                        onChange={(e) => setSshTunnelConfig(prev => ({ ...prev, ip: e.target.value }))}
                        style={{
                          background: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          fontSize: '13px',
                          fontFamily: 'monospace',
                          cursor: 'pointer'
                        }}
                      >
                        {sshTunnelConfig.allIps.map(ip => (
                          <option key={ip} value={ip}>{ip}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="data-value-code">{sshTunnelConfig.ip}</span>
                    )}
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
                    <div className="form-group" style={{ flex: '1 1 0' }}>
                      <label>Username</label>
                      <input
                        type="text"
                        value={sshUser}
                        onChange={(e) => setSshUser(e.target.value)}
                        placeholder="root"
                      />
                    </div>
                    <div className="form-group" style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}>
                      <label>Port</label>
                      <PortComboBox
                        value={sshPort}
                        onChange={setSshPort}
                        placeholder="22"
                        showCommonPorts={true}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Password (Optional)</label>
                    <input
                      type="password"
                      value={sshPassword}
                      onChange={(e) => setSshPassword(e.target.value)}
                      placeholder="Leave empty for interactive password prompt"
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
              )
            }

            {
              !selectedNode && (
                <div className="results-list" key={config.activeCluster || 'default'}>
                  {loading && !cacheLoaded && <DeviceListSkeleton count={6} />}
                  {!(loading && !cacheLoaded) && displayNodes.length === 0 && cacheLoaded && query && (
                    <div className="empty-state">No results found</div>
                  )}
                  {!(loading && !cacheLoaded) && displayNodes.length === 0 && cacheLoaded && !query && (
                    <div className="empty-state">No devices</div>
                  )}
                  {!(loading && !cacheLoaded) && recentNodes.length > 0 && (
                    <div className="section-header">Recent Devices</div>
                  )}
                  {!(loading && !cacheLoaded) && recentNodes.map((node, index) => (
                    <div
                      key={node.id}
                      className={`result-item ${index === selectedIndex ? 'selected' : ''}`}
                      onClick={() => handleConnect(node)}
                    >
                      <div className="node-icon">
                        <Server size={18} />
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
                        <span className={`status-dot ${statusClass(node.status)}`}></span>
                        {formatStatus(node.status)}
                      </div>
                      <div className="node-trailing">
                        {index === selectedIndex && (
                          <span className="shortcut" title="Press Enter to open">↵</span>
                        )}
                        <ChevronRight size={16} className="node-chevron" />
                      </div>
                    </div>
                  ))}
                  {!(loading && !cacheLoaded) && (recentNodes.length > 0 && otherNodes.length > 0) && (
                    <div className="section-header">All Devices</div>
                  )}
                  {!(loading && !cacheLoaded) && otherNodes.map((node, index) => {
                    const globalIndex = index + recentNodes.length;
                    return (
                      <div
                        key={node.id}
                        className={`result-item ${globalIndex === selectedIndex ? 'selected' : ''}`}
                        onClick={() => handleConnect(node)}
                      >
                        <div className="node-icon">
                          <Server size={18} />
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
                          <span className={`status-dot ${statusClass(node.status)}`}></span>
                          {formatStatus(node.status)}
                        </div>
                        <div className="node-trailing">
                          {globalIndex === selectedIndex && (
                            <span className="shortcut" title="Press Enter to open">↵</span>
                          )}
                          <ChevronRight size={16} className="node-chevron" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            }
          </div >
        )}
        <div className="status-bar">
          {activeTunnels.filter(t => t.status !== 'failed').length > 0 && (
            <div className="status-item center">
              <Tooltip text="Shows all tunnels currently open across all connected devices" position="top" simple={true}>
                <button
                  className="link-button"
                  onClick={() => setShowGlobalTunnels(prev => !prev)}
                >
                  {showGlobalTunnels ? 'Hide All Tunnels' : 'All Tunnels'}
                </button>
              </Tooltip>
            </div>
          )}
          <div className="status-item right">
            <span>{showSettings ? "Configuration" : selectedNode ? "Device Details" : `${nodes.length} results`}</span>
          </div>
        </div>
      </div >
    </div >
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