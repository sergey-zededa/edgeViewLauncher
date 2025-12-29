import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

import TerminalView from './components/TerminalView';

const container = document.getElementById('root')
const root = createRoot(container)

// Simple routing based on query params
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');

if (mode === 'terminal') {
    const port = params.get('port');
    root.render(
        <React.StrictMode>
            <TerminalView port={port} />
        </React.StrictMode>
    );
} else {
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}
