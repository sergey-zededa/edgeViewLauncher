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

    useEffect(() => {
        // Read connection info from URL parameters
        const params = new URLSearchParams(window.location.search);
        setConnectionInfo({
            nodeName: params.get('nodeName') || 'Unknown Device',
            targetInfo: params.get('targetInfo') || 'EVE-OS SSH'
        });
    }, []);

    useEffect(() => {
        if (!port) return;

        // Initialize xterm.js
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#ffffff',
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
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'input', data: text }));
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

                // Pass initial keys to backend to avoid race condition
                const wsUrl = `ws://localhost:${backendPort}/api/ssh/term?port=${port}&user=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&cols=${initialCols}&rows=${initialRows}`;
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
        // We want a standard size of 120 cols x 80 rows
        // We need to wait for the renderer to have valid dimensions (which might take >100ms)
        const resizePoller = setInterval(() => {
            try {
                // Access internal metrics to get actual cell dimensions
                const core = term._core;
                if (core && core._renderService && core._renderService.dimensions) {
                    const { actualCellWidth, actualCellHeight } = core._renderService.dimensions;

                    if (actualCellWidth > 0 && actualCellHeight > 0) {
                        clearInterval(resizePoller); // Stop polling once we have valid dims

                        const targetCols = 120;
                        const targetRows = 80;
                        const toolbarHeight = 40; // Height of our custom toolbar
                        const padding = 20; // 10px padding on each side/top-bottom

                        const width = Math.ceil(targetCols * actualCellWidth + padding);
                        const height = Math.ceil(targetRows * actualCellHeight + toolbarHeight + padding);

                        console.log(`Resizing to ${width}x${height} for ${targetCols}x${targetRows} term (Cell: ${actualCellWidth}x${actualCellHeight})`);

                        if (window.electronAPI && window.electronAPI.resizeWindow) {
                            window.electronAPI.resizeWindow(width, height);

                            // Re-fit after resize (give Electron time to resize window)
                            setTimeout(() => {
                                fitAddon.fit();
                                // Trigger connection AFTER resize is complete and we have target dims
                                connectWebSocket(targetCols, targetRows);
                            }, 500);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to calculate dynamic window size:", e);
                clearInterval(resizePoller);
            }
        }, 100);

        // Stop polling after 2 seconds to prevent infinite loop
        setTimeout(() => {
            clearInterval(resizePoller);
            // If we haven't connected yet (wsRef.current is null), force connection with defaults
            if (!wsRef.current) {
                console.warn("Resize polling timed out, forcing connection with defaults");
                // Attempt to resize to target anyway (best effort)
                if (window.electronAPI && window.electronAPI.resizeWindow) {
                    window.electronAPI.resizeWindow(1024, 768); // 1024x768 approx for 120x80
                }
                connectWebSocket(120, 80);
            }
        }, 2000);

        // Handle Resize events (for subsequent manual resizing)
        const handleResize = () => {
            fitAddon.fit();
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                const dims = { cols: term.cols, rows: term.rows };
                wsRef.current.send(JSON.stringify({ type: 'resize', ...dims }));
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.close();
            }
            term.dispose();
            clearInterval(resizePoller);
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
                backgroundColor: '#1e1e1e',
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
                paddingLeft: '80px',
                backgroundColor: '#1a1a1a',
                borderBottom: '1px solid #333',
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
                    <span style={{ color: '#999' }}>
                        {connectionInfo.nodeName} • {connectionInfo.targetInfo}
                    </span>
                    <span style={{
                        color: status === 'Connected' ? '#4caf50' :
                            status === 'Connecting...' ? '#ff9800' : '#f44336',
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
                        style={{ color: '#fff' }}
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
