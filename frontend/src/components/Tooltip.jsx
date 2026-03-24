import React, { useState, useRef, useEffect } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { openExternal } from '../tauriAPI';

const Tooltip = ({ text, children, position = 'top', simple = false, helpUrl = null, helpLabel = null }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const [offset, setOffset] = useState({ left: '50%', transform: 'translateX(-50%)' });
    const [copied, setCopied] = useState(false);
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

    return (
        <div
            ref={containerRef}
            className="tooltip-container"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {children}
            {isVisible && (
                <div
                    ref={tooltipRef}
                    className={`tooltip-content tooltip-${adjustedPosition} ${(simple && !helpUrl) ? 'tooltip-simple' : ''} ${helpUrl ? 'tooltip-with-help' : ''}`}
                    style={offset}
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
            )}
        </div>
    );
};

export default Tooltip;
