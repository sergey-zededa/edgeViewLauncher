import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { openExternal } from '../tauriAPI';

const Tooltip = ({ text, children, position = 'top', simple = false, helpUrl = null, helpLabel = null, usePortal = false }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const [offset, setOffset] = useState({ left: '50%', transform: 'translateX(-50%)' });
    const [copied, setCopied] = useState(false);
    const [portalPos, setPortalPos] = useState(null);
    const tooltipRef = useRef(null);
    const containerRef = useRef(null);
    const timeoutRef = useRef(null);

    // Determine if we should show copy button (if text length > 50 chars and not simple mode)
    const showCopy = !simple && !helpUrl && typeof text === 'string' && text.length > 50;

    // When helpUrl is present, treat as interactive (not simple) so user can hover to click link
    const isInteractive = !!helpUrl || (!simple && showCopy);

    const handleCopy = (e) => {
        e.stopPropagation(); // Prevent closing if logic relies on click
        if (typeof text === 'string') {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleMouseEnter = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setIsVisible(true);
    };

    const handleMouseLeave = () => {
        // Simple tooltips close immediately, interactive ones (with links or copy) have delay
        const delay = (simple && !helpUrl) ? 0 : 300;
        timeoutRef.current = setTimeout(() => {
            setIsVisible(false);
            if (copied) setTimeout(() => setCopied(false), 300);
        }, delay);
    };

    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    useEffect(() => {
        if (isVisible && tooltipRef.current && containerRef.current) {
            const tooltip = tooltipRef.current.getBoundingClientRect();
            const container = containerRef.current.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            let newPosition = position;
            let newOffset = { left: '50%', transform: 'translateX(-50%)' };

            // Check vertical overflow
            const wouldOverflowTop = container.top - tooltip.height - 10 < 0;
            const wouldOverflowBottom = container.bottom + tooltip.height + 10 > windowHeight;

            // Adjust vertical position if needed
            if (position === 'top' && wouldOverflowTop && !wouldOverflowBottom) {
                newPosition = 'bottom';
            } else if (position === 'bottom' && wouldOverflowBottom && !wouldOverflowTop) {
                newPosition = 'top';
            }

            // Check horizontal overflow and adjust
            const tooltipLeft = container.left + container.width / 2 - tooltip.width / 2;
            const tooltipRight = container.left + container.width / 2 + tooltip.width / 2;

            if (tooltipRight > windowWidth - 10) {
                // Tooltip would overflow on the right
                const overflow = tooltipRight - (windowWidth - 10);
                newOffset = {
                    left: '50%',
                    transform: `translateX(calc(-50% - ${overflow}px))`
                };
            } else if (tooltipLeft < 10) {
                // Tooltip would overflow on the left
                const overflow = 10 - tooltipLeft;
                newOffset = {
                    left: '50%',
                    transform: `translateX(calc(-50% + ${overflow}px))`
                };
            }

            setAdjustedPosition(newPosition);
            setOffset(newOffset);
        }
    }, [isVisible, position, text]);

    // Portal mode: position tooltip absolutely on the page using trigger's bounding rect
    useEffect(() => {
        if (!usePortal || !isVisible || !tooltipRef.current || !containerRef.current) return;
        const container = containerRef.current.getBoundingClientRect();
        const tooltip = tooltipRef.current.getBoundingClientRect();
        const gap = 8;
        let top, left;

        if (adjustedPosition === 'bottom') {
            top = container.bottom + gap;
        } else {
            top = container.top - tooltip.height - gap;
        }
        left = container.left + container.width / 2 - tooltip.width / 2;

        // Clamp horizontally
        const windowWidth = window.innerWidth;
        if (left < 10) left = 10;
        if (left + tooltip.width > windowWidth - 10) left = windowWidth - 10 - tooltip.width;

        setPortalPos({ top, left });
    }, [usePortal, isVisible, adjustedPosition]);

    const portalStyle = usePortal ? {
        position: 'fixed',
        zIndex: 99999,
        top: portalPos ? portalPos.top : -9999,
        left: portalPos ? portalPos.left : -9999,
        bottom: 'auto',
        right: 'auto',
        transform: 'none',
        margin: 0,
        visibility: portalPos ? 'visible' : 'hidden',
    } : null;

    const tooltipContent = (
        <div
            ref={tooltipRef}
            className={`tooltip-content tooltip-${adjustedPosition} ${(simple && !helpUrl) ? 'tooltip-simple' : ''} ${helpUrl ? 'tooltip-with-help' : ''}`}
            style={portalStyle || offset}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {showCopy && (
                <div className="tooltip-header">
                    <button className="tooltip-copy-btn" onClick={handleCopy} title="Copy full message">
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>
            )}
            <div className="tooltip-body">
                {text}
            </div>
            {helpUrl && (
                <div
                    className="tooltip-help-link"
                    onClick={(e) => {
                        e.stopPropagation();
                        openExternal(helpUrl);
                    }}
                >
                    <ExternalLink size={11} />
                    <span>{helpLabel || 'Learn more →'}</span>
                </div>
            )}
        </div>
    );

    return (
        <div
            ref={containerRef}
            className="tooltip-container"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {children}
            {isVisible && (usePortal
                ? createPortal(tooltipContent, document.body)
                : tooltipContent
            )}
        </div>
    );
};

export default Tooltip;
