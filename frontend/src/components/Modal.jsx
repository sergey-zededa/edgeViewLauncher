import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

/**
 * Standard Modal Component
 * 
 * @param {Object} props
 * @param {string} props.title - Modal title text
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {function} props.onDismiss - Function called when closing (bg click, escapes, close btn)
 * @param {string} [props.size='medium'] - 'small' | 'medium' | 'large'
 * @param {React.ReactNode} [props.footer] - Optional footer actions
 * @param {React.ReactNode} props.children - Modal body content
 */
function Modal({
    title,
    isOpen,
    onDismiss,
    size = 'medium',
    footer,
    children
}) {
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onDismiss();
            }
        };

        if (isOpen) {
            window.addEventListener('keydown', handleEscape);
        }

        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onDismiss]);

    if (!isOpen) return null;

    return (
        <div
            className="modal-backdrop"
            onClick={(e) => {
                // Close only if clicking the backdrop itself
                if (e.target === e.currentTarget) onDismiss();
            }}
        >
            <div className={`modal-container size-${size}`}>
                <div className="modal-header">
                    <h3 className="modal-title">{title}</h3>
                    <button
                        className="modal-close-btn"
                        onClick={onDismiss}
                        title="Close"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="modal-body">
                    {children}
                </div>

                {footer && (
                    <div className="modal-footer">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}

export default Modal;
