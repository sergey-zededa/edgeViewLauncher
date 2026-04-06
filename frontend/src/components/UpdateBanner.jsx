import React from 'react';
import { Download, ExternalLink, RefreshCw, X, AlertCircle } from 'lucide-react';
import { openExternal } from '../tauriAPI';
import './UpdateBanner.css';

const RELEASES_URL = 'https://github.com/sergey-zededa/edgeViewLauncher/releases/latest';

const isMacOS = typeof navigator !== 'undefined' && (
    navigator.platform?.startsWith('Mac') ||
    navigator.userAgent?.includes('Macintosh')
);

function UpdateBanner({ updateState, onDownload, onInstall, onDismiss }) {
    const { status, version, downloadProgress, error } = updateState;

    if (status === 'not-available' || status === 'dismissed') {
        return null;
    }

    // On macOS, auto-updates fail due to missing code signing.
    // Show a manual download message instead of download/install controls.
    const renderMacOSManualUpdate = () => (
        <>
            <div className="update-banner-message">
                <AlertCircle size={18} />
                <div className="update-text-container">
                    <span>Version <strong>{version}</strong> is available.</span>
                    <span className="update-macos-note">Auto-updates are temporarily unavailable on macOS. Please download the latest version manually.</span>
                </div>
            </div>
            <div className="update-banner-actions">
                <button
                    className="update-banner-button primary"
                    onClick={() => openExternal(RELEASES_URL)}
                >
                    <ExternalLink size={16} />
                    Download from GitHub
                </button>
                <button
                    className="update-banner-button secondary"
                    onClick={onDismiss}
                >
                    <X size={16} />
                    Dismiss
                </button>
            </div>
        </>
    );

    const renderContent = () => {
        // Intercept all update-in-progress states on macOS
        if (isMacOS && (status === 'available' || status === 'downloading' || status === 'downloaded')) {
            return renderMacOSManualUpdate();
        }

        switch (status) {
            case 'available':
                return (
                    <>
                        <div className="update-banner-message">
                            <AlertCircle size={18} />
                            <div className="update-text-container">
                                <span>New version <strong>{version}</strong> is available</span>
                                <a
                                    href="#"
                                    className="update-whats-new-link"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        openExternal('https://github.com/sergey-zededa/edgeViewLauncher/releases');
                                    }}
                                >
                                    (What's new?)
                                </a>
                            </div>
                        </div>
                        <div className="update-banner-actions">
                            <button
                                className="update-banner-button primary"
                                onClick={onDownload}
                            >
                                <Download size={16} />
                                Download
                            </button>
                            <button
                                className="update-banner-button secondary"
                                onClick={onDismiss}
                            >
                                <X size={16} />
                                Dismiss
                            </button>
                        </div>
                    </>
                );

            case 'downloading':
                return (
                    <>
                        <div className="update-banner-message">
                            <div className="update-banner-spinner" />
                            <span>Downloading update... {downloadProgress}%</span>
                        </div>
                        <div className="update-banner-progress">
                            <div
                                className="update-banner-progress-bar"
                                style={{ width: `${downloadProgress}%` }}
                            />
                        </div>
                    </>
                );

            case 'downloaded':
                return (
                    <>
                        <div className="update-banner-message">
                            <RefreshCw size={18} />
                            <span>Update <strong>{version}</strong> is ready to install</span>
                        </div>
                        <div className="update-banner-actions">
                            <button
                                className="update-banner-button primary"
                                onClick={onInstall}
                            >
                                <RefreshCw size={16} />
                                Restart & Install
                            </button>
                            <button
                                className="update-banner-button secondary"
                                onClick={onDismiss}
                            >
                                Later
                            </button>
                        </div>
                    </>
                );

            case 'error':
                return (
                    <>
                        <div className="update-banner-message error">
                            <AlertCircle size={18} />
                            <span>Update failed: {error || 'Unknown error'}</span>
                        </div>
                        <div className="update-banner-actions">
                            <button
                                className="update-banner-button secondary"
                                onClick={onDismiss}
                            >
                                <X size={16} />
                                Dismiss
                            </button>
                        </div>
                    </>
                );

            default:
                return null;
        }
    };

    return (
        <div className={`update-banner ${status === 'error' ? 'error' : ''}`}>
            {renderContent()}
        </div>
    );
}

export default UpdateBanner;
