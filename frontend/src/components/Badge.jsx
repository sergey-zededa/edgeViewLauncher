import React from 'react';
import './Badge.css';

/**
 * Standard Status Badge
 * 
 * @param {Object} props
 * @param {string} props.label - Text content
 * @param {string} [props.variant='default'] - 'success' | 'warning' | 'error' | 'info' | 'default'
 * @param {React.ReactNode} [props.icon] - Optional icon component
 * @param {boolean} [props.dot] - Whether to show a colored dot (status indicator style)
 */
function Badge({ label, variant = 'default', icon, dot = false }) {
    return (
        <span className={`badge ${variant}`}>
            {dot && <span className="badge-dot" />}
            {icon}
            {label}
        </span>
    );
}

export default Badge;
