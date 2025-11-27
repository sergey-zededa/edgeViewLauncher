import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

const TerminalView = ({ port }) => {
    const terminalRef = useRef(null);
    const wsRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);

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
            term.writeln('\x1b[1;32mConnected to EdgeView SSH Proxy...\x1b[0m');
            // Send resize event immediately
            const dims = { cols: term.cols, rows: term.rows };
            ws.send(JSON.stringify({ type: 'resize', ...dims }));
        };

        ws.onmessage = (event) => {
            term.write(event.data);
        };

        ws.onclose = () => {
            term.writeln('\r\n\x1b[1;31mConnection closed.\x1b[0m');
        };

        ws.onerror = (error) => {
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
                flexDirection: 'column',
                textAlign: 'left'
            }}
        >
            <div
                ref={terminalRef}
                style={{
                    flex: 1,
                    width: '100%',
                    textAlign: 'left',
                    display: 'block'
                }}
            />
        </div>
    );
};

export default TerminalView;
