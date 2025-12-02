import React, { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc/lib/rfb';
import { Maximize, Minimize, X } from 'lucide-react';

const VncViewer = ({ url, onClose, password = '' }) => {
    const rfbRef = useRef(null);
    const containerRef = useRef(null);
    const [status, setStatus] = useState('Connecting...');
    const [isConnected, setIsConnected] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize RFB
        const rfb = new RFB(containerRef.current, url, {
            credentials: { password: password }
        });

        rfb.addEventListener("connect", () => {
            setStatus("Connected");
            setIsConnected(true);
            rfb.focus();
        });

        rfb.addEventListener("disconnect", (e) => {
            setStatus("Disconnected: " + (e.detail.clean ? "Closed cleanly" : "Connection dropped"));
            setIsConnected(false);
        });

        rfb.addEventListener("credentialsrequired", () => {
            setStatus("Password required");
            // If we had a password prompt UI, we'd handle it here
        });

        rfbRef.current = rfb;

        return () => {
            if (rfbRef.current) {
                rfbRef.current.disconnect();
            }
        };
    }, [url, password]);

    const toggleFullscreen = () => {
        const targetElement = document.querySelector('.vnc-viewer-overlay');
        if (!document.fullscreenElement) {
            targetElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    return (
        <div className="vnc-viewer-overlay" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#000',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Toolbar */}
            <div className="vnc-toolbar" style={{
                padding: '10px',
                paddingLeft: '80px',
                backgroundColor: '#1a1a1a',
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'center',
                borderBottom: '1px solid #333',
                WebkitAppRegion: 'drag'
            }}>
                <div></div>
                <div className="vnc-status" style={{
                    color: isConnected ? '#4caf50' : '#ff9800',
                    textAlign: 'center',
                    whiteSpace: 'nowrap'
                }}>
                    <span style={{ marginRight: '10px' }}>●</span>
                    {status}
                </div>
                <div className="vnc-controls" style={{
                    display: 'flex',
                    gap: '10px',
                    WebkitAppRegion: 'no-drag',
                    justifyContent: 'flex-end'
                }}>
                    <button
                        onClick={toggleFullscreen}
                        className="icon-btn"
                        title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        style={{ color: '#fff' }}
                    >
                        {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                    </button>
                    <button
                        onClick={onClose}
                        className="icon-btn"
                        title="Close Viewer"
                        style={{ color: '#fff' }}
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* VNC Canvas Container */}
            <div
                ref={containerRef}
                className="vnc-container"
                style={{
                    flex: 1,
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: '#000'
                }}
            />
        </div>
    );
};

export default VncViewer;
