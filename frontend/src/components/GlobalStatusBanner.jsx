import React from 'react';
import { X, Check, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import './GlobalStatusBanner.css';

function GlobalStatusBanner({ status, onDismiss }) {
    if (!status) return null;

    const { type, message } = status;

    const getIcon = () => {
        switch (type) {
            case 'loading':
                return <div className="status-spinner" />;
            case 'success':
                return <Check size={16} />;
            case 'warning':
                return <AlertTriangle size={16} />;
            case 'error':
                return <AlertCircle size={16} />;
            case 'info':
            default:
                return <Info size={16} />;
        }
    };

    return (
        <div className={`global-status-banner ${type || 'info'}`}>
            <div className="status-content">
                {getIcon()}
                <span>{message}</span>
            </div>
            {onDismiss && (
                <button className="dismiss-btn" onClick={onDismiss}>
                    <X size={16} />
                </button>
            )}
        </div>
    );
}

export default GlobalStatusBanner;
