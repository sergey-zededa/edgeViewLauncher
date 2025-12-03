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

        term.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Connect to WebSocket
        const wsUrl = `ws://localhost:8080/api/ssh/term?port=${port}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            setStatus('Connected');
            setIsConnected(true);
            term.writeln('\x1b[1;32mConnected to EdgeView SSH Proxy...\x1b[0m');
            // Send resize event immediately
            const dims = { cols: term.cols, rows: term.rows };
            ws.send(JSON.stringify({ type: 'resize', ...dims }));
        };

        ws.onmessage = (event) => {
            term.write(event.data);
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

        // Handle Resize
        const handleResize = () => {
            fitAddon.fit();
            if (ws.readyState === WebSocket.OPEN) {
                const dims = { cols: term.cols, rows: term.rows };
                ws.send(JSON.stringify({ type: 'resize', ...dims }));
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
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
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #333',
                WebkitAppRegion: 'drag',
                position: 'relative'
            }}>
                <div style={{
                    color: '#999',
                    fontSize: '13px',
                    flex: 1
                }}>
                    {connectionInfo.nodeName} • {connectionInfo.targetInfo}
                </div>
                <div className="terminal-status" style={{
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: isConnected ? '#4caf50' : '#ff9800',
                    whiteSpace: 'nowrap',
                    fontSize: '13px'
                }}>
                    <span style={{ marginRight: '8px' }}>●</span>
                    {status}
                </div>
                <div className="terminal-controls" style={{
                    display: 'flex',
                    gap: '10px',
                    WebkitAppRegion: 'no-drag',
                    flex: 1,
                    justifyContent: 'flex-end'
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
        </div>
    );
};

export default TerminalView;
