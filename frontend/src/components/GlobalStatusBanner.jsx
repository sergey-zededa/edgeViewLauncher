import React from 'react';
import { X, Check, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import './GlobalStatusBanner.css';

function GlobalStatusBanner({ status, onDismiss, onCancel }) {
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

    const showCancel = type === 'loading' && typeof onCancel === 'function';

    const handleDismiss = () => {
        // For an in-progress connection toast, the X also cancels the backend
        // retry loop so the toast doesn't immediately reappear from a polled
        // progress update.
        if (showCancel) {
            try { onCancel(); } catch (_) { /* ignore */ }
        }
        if (onDismiss) onDismiss();
    };

    return (
        <div className={`global-status-banner ${type || 'info'}`}>
            <div className="status-content">
                {getIcon()}
                <span>{message}</span>
            </div>
            <div className="status-actions">
                {showCancel && (
                    <button
                        className="cancel-btn"
                        onClick={() => {
                            try { onCancel(); } catch (_) { /* ignore */ }
                            if (onDismiss) onDismiss();
                        }}
                        title="Stop connection attempts"
                    >
                        Cancel
                    </button>
                )}
                {onDismiss && (
                    <button className="dismiss-btn" onClick={handleDismiss}>
                        <X size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}

export default GlobalStatusBanner;
