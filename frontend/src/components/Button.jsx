import React from 'react';
import './Button.css';

/**
 * Standard Button Component
 * 
 * @param {Object} props
 * @param {string} [props.variant='primary'] - 'primary' | 'secondary' | 'ghost' | 'danger'
 * @param {boolean} [props.isLoading] - Show spinner
 * @param {React.ReactNode} [props.icon] - Icon to show before text
 * @param {function} [props.onClick] - Click handler
 * @param {boolean} [props.disabled] - Disabled state
 * @param {string} [props.className] - Extra classes
 * @param {React.ReactNode} props.children - Button label/content
 */
function Button({
    variant = 'primary',
    isLoading = false,
    icon,
    onClick,
    disabled,
    className = '',
    children,
    ...rest
}) {
    return (
        <button
            className={`btn ${variant} ${className}`}
            onClick={onClick}
            disabled={disabled || isLoading}
            {...rest}
        >
            {isLoading && <div className="spinner" />}
            {!isLoading && icon}
            {children}
        </button>
    );
}

export default Button;
