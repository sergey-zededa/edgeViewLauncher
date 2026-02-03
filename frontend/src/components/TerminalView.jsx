import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { X } from 'lucide-react';
import 'xterm/css/xterm.css';

const TerminalView = ({ port }) => {
    const terminalRef = useRef(null);
    const wsRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);
    const [isConnected, setIsConnected] = useState(false);
    const [status, setStatus] = useState('Connecting...');
    const [connectionInfo, setConnectionInfo] = useState({
        nodeName: 'Unknown Device',
        targetInfo: 'EVE-OS SSH'
    });

    const [theme, setTheme] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('theme') || localStorage.getItem('theme') || 'dark';
    });

    useEffect(() => {
        // Read connection info from URL parameters
        const params = new URLSearchParams(window.location.search);
        setConnectionInfo({
            nodeName: params.get('nodeName') || 'Unknown Device',
            targetInfo: params.get('targetInfo') || 'EVE-OS SSH'
        });

        // Listen for theme changes in other windows
        const handleStorageChange = (e) => {
            if (e.key === 'theme' && e.newValue) {
                setTheme(e.newValue);
            }
        };
        window.addEventListener('storage', handleStorageChange);

        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    useEffect(() => {
        // Apply theme to document
        document.documentElement.setAttribute('data-theme', theme);

        // Update xterm theme if it exists
        if (xtermRef.current) {
            xtermRef.current.options.theme = theme === 'light' ? {
                background: '#ffffff',
                foreground: '#1d1d1f',
                cursor: '#007aff',
                selection: 'rgba(0, 122, 255, 0.3)',
                black: '#1d1d1f',
                red: '#ff3b30',
                green: '#34c759',
                yellow: '#ff9500',
                blue: '#007aff',
                magenta: '#af52de',
                cyan: '#5ac8fa',
                white: '#8e8e93',
            } : {
                background: '#1e1e1e',
                foreground: '#ffffff',
                cursor: '#58a6ff',
                selection: 'rgba(88, 166, 255, 0.3)',
            };
        }
    }, [theme]);

    useEffect(() => {
        if (!port) return;

        // Initialize xterm.js
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: theme === 'light' ? {
                background: '#ffffff',
                foreground: '#1d1d1f',
                cursor: '#007aff',
                selection: 'rgba(0, 122, 255, 0.3)',
                black: '#1d1d1f',
                red: '#ff3b30',
                green: '#34c759',
                yellow: '#ff9500',
                blue: '#007aff',
                magenta: '#af52de',
                cyan: '#5ac8fa',
                white: '#8e8e93',
            } : {
                background: '#1e1e1e',
                foreground: '#ffffff',
                cursor: '#58a6ff',
                selection: 'rgba(88, 166, 255, 0.3)',
            },
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        // Handle Copy/Paste
        const handleKeyDown = (e) => {
            const ctrlOrCmd = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            if (ctrlOrCmd && key === 'c') {
                // Copy
                const selection = term.getSelection();
                if (selection) {
                    navigator.clipboard.writeText(selection);
                    return false; // Prevent default (SIGINT) if copying
                }
                return true; // Allow default (SIGINT) if no selection
            }

            if (ctrlOrCmd && key === 'v') {
                // Paste
                navigator.clipboard.readText().then(text => {
                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: 'input', data: text }));
                    }
                }).catch(err => {
                    console.error('Failed to read clipboard:', err);
                });
                return false; // Prevent default browser paste
            }
            return true;
        };

        term.attachCustomKeyEventHandler(handleKeyDown);

        term.open(terminalRef.current);
        fitAddon.fit();
        term.focus(); // Ensure focus

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Connect to WebSocket
        const connectWebSocket = async (initialCols, initialRows) => {
            try {
                let backendPort = 8080; // Default fallback
                if (window.electronAPI && window.electronAPI.getBackendPort) {
                    const port = await window.electronAPI.getBackendPort();
                    if (port) backendPort = port;
                }

                // Get username from URL params
                const params = new URLSearchParams(window.location.search);
                const username = params.get('username') || '';
                const password = params.get('password') || '';
                const initialCommand = params.get('initialCommand') || '';

                // Pass initial keys to backend to avoid race condition
                const wsUrl = `ws://localhost:${backendPort}/api/ssh/term?port=${port}&user=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&cols=${initialCols}&rows=${initialRows}&command=${encodeURIComponent(initialCommand)}`;
                const ws = new WebSocket(wsUrl);
                ws.binaryType = 'arraybuffer'; // Ensure we receive raw bytes
                wsRef.current = ws;

                // DIAGNOSTIC STATE
                let totalRxBytes = 0;
                let escCount = 0;
                let fixedSequences = 0;

                const updateDiagnostic = () => {
                    setStatus(`Connected | B:${totalRxBytes} E:${escCount} F:${fixedSequences}`);
                };

                ws.onopen = () => {
                    setStatus('Connected');
                    setIsConnected(true);
                    term.writeln(`\x1b[1;32mConnected to EdgeView SSH Proxy (User: ${username || 'root'})...\x1b[0m`);
                    term.focus();

                    // Check for initial command (used for container shell access)
                    const initialCommand = params.get('initialCommand');
                    if (initialCommand) {
                        term.writeln(`\x1b[1;36mAuto-Executing: ${initialCommand}\x1b[0m`);
                    }
                };

                ws.onmessage = (event) => {
                    if (event.data instanceof ArrayBuffer) {
                        const u8 = new Uint8Array(event.data);
                        totalRxBytes += u8.length;
                        // Pass raw PTY data directly to xterm.js
                        // Previous "ANSI Repair Logic" was causing corruption by injecting ESCs
                        // at chunk boundaries and possibly interfering with ISO-2022 sequences.
                        term.write(u8);
                    } else {
                        // Should not happen with binaryType=arraybuffer, but just in case
                        term.write(event.data);
                    }
                };

                ws.onclose = () => {
                    setStatus('Disconnected');
                    setIsConnected(false);
                    term.writeln('\r\n\x1b[1;31mConnection closed.\x1b[0m');
                };

                ws.onerror = (error) => {
                    setStatus('Error');
                    setIsConnected(false);
                    term.writeln(`\r\n\x1b[1;31mWebSocket Error: ${error}\x1b[0m`);
                };

                // Terminal -> WebSocket
                term.onData((data) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'input', data }));
                    }
                });
            } catch (err) {
                console.error('Failed to connect to backend:', err);
                term.writeln(`\r\n\x1b[1;31mFailed to connect to backend: ${err}\x1b[0m`);
            }
        };

        // Dynamic Resizing Logic
        // Use FitAddon to calculate available cols/rows based on container size
        const calculateAndResize = () => {
            try {
                fitAddon.fit();
                const dims = fitAddon.proposeDimensions();
                if (dims && dims.cols && dims.rows) {
                    // Update Electron window size if needed (optional, or just sync PTY)
                    // For now, we prioritize syncing the PTY to the current container size
                    return { cols: dims.cols, rows: dims.rows };
                }
            } catch (e) {
                console.error("FitAddon failed to propose dimensions:", e);
            }
            return null; // Not ready
        };

        // Wait for renderer to be ready
        const initConnection = () => {
            // Give the renderer a moment to layout
            setTimeout(() => {
                const dims = calculateAndResize();
                // Default to standard size if fit fails
                const cols = dims ? dims.cols : 80;
                const rows = dims ? dims.rows : 24;

                console.log(`Initializing PTY with dimensions: ${cols}x${rows}`);
                connectWebSocket(cols, rows);
            }, 100);
        };

        initConnection();

        // Handle Resize events
        const handleResize = () => {
            fitAddon.fit();
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                const dims = fitAddon.proposeDimensions();
                if (dims) {
                    console.log(`Resizing PTY to ${dims.cols}x${dims.rows}`);
                    wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
                }
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.close();
            }
            term.dispose();
        };
    }, [port]);

    const handleClose = () => {
        if (window.electronAPI && window.electronAPI.closeWindow) {
            window.electronAPI.closeWindow();
        } else {
            window.close();
        }
    };

    return (
        <div
            style={{
                height: '100vh',
                width: '100vw',
                backgroundColor: 'var(--bg-app)',
                padding: '0',
                margin: '0',
                boxSizing: 'border-box',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            {/* Toolbar */}
            <div className="terminal-toolbar" style={{
                padding: '10px',
                paddingLeft: window.electronAPI?.platform === 'darwin' ? '80px' : '10px',
                backgroundColor: 'var(--bg-panel)',
                borderBottom: '1px solid var(--border-subtle)',
                WebkitAppRegion: 'drag',
                position: 'relative',
                height: '40px',
                display: 'block'
            }}>
                <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    fontSize: '13px',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none'
                }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                        {connectionInfo.nodeName} • {connectionInfo.targetInfo}
                    </span>
                    <span style={{
                        color: status === 'Connected' ? 'var(--color-success)' :
                            status === 'Connecting...' ? 'var(--color-warning)' : 'var(--color-danger)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}>
                        <span>●</span>
                        {status}
                    </span>
                </div>
                <div className="terminal-controls" style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    gap: '10px',
                    WebkitAppRegion: 'no-drag'
                }}>
                    <button
                        onClick={handleClose}
                        className="icon-btn"
                        title="Close Terminal"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Terminal Container */}
            <div
                ref={terminalRef}
                style={{
                    flex: 1,
                    width: '100%',
                    textAlign: 'left',
                    display: 'block',
                    padding: '10px'
                }}
            />
        </div >
    );
};

export default TerminalView;
