import React from 'react';
import { Download, RefreshCw, X, AlertCircle } from 'lucide-react';
import './UpdateBanner.css';

function UpdateBanner({ updateState, onDownload, onInstall, onDismiss }) {
    const { status, version, downloadProgress, error } = updateState;

    if (status === 'not-available' || status === 'dismissed') {
        return null;
    }

    const renderContent = () => {
        switch (status) {
            case 'available':
                return (
                    <>
                        <div className="update-banner-message">
                            <AlertCircle size={18} />
                            <span>New version <strong>{version}</strong> is available</span>
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
