import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { openExternal } from '../tauriAPI';

// Default delay (ms) before a tooltip appears on hover. 500 ms is the
// sweet spot most design systems land on (Material, Atlassian, Fluent UI
// all sit between 400–700 ms) — long enough that tooltips don't flash
// while the cursor is just passing over controls, short enough that
// users who do want help don't feel the UI is sluggish. macOS's native
// help-tag default is ~750 ms; we pick 500 ms because tooltip content
// here is action-oriented rather than purely supplemental help text.
const DEFAULT_OPEN_DELAY = 500;

// The area a tooltip rendered next to `el` can actually be seen in: the
// window, narrowed by every ancestor that clips its overflow. The device
// details pane, for one, scrolls below the title bar, so a tooltip that fits
// in the window can still be cut off at the top of that pane.
export function visibleBounds(el) {
    let top = 0, left = 0, right = window.innerWidth, bottom = window.innerHeight;
    for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = window.getComputedStyle(p);
        if (/auto|scroll|hidden|clip/.test(`${s.overflow} ${s.overflowX} ${s.overflowY}`)) {
            const r = p.getBoundingClientRect();
            top = Math.max(top, r.top);
            left = Math.max(left, r.left);
            right = Math.min(right, r.right);
            bottom = Math.min(bottom, r.bottom);
        }
    }
    return { top, left, right, bottom };
}

const Tooltip = ({ text, children, position = 'top', simple = false, helpUrl = null, helpLabel = null, usePortal = false, openDelay = DEFAULT_OPEN_DELAY }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const [offset, setOffset] = useState({ left: '50%', transform: 'translateX(-50%)' });
    const [copied, setCopied] = useState(false);
    const [portalPos, setPortalPos] = useState(null);
    const tooltipRef = useRef(null);
    const containerRef = useRef(null);
    // Pending "hide" timeout (so the tooltip lingers briefly when the
    // mouse crosses the gap between trigger and the interactive panel).
    const hideTimeoutRef = useRef(null);
    // Pending "show" timeout — kept separately so a quick mouse-out can
    // cancel a not-yet-fired show without affecting hide scheduling.
    const showTimeoutRef = useRef(null);

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
        // Any pending hide cancels: user came back before the close
        // grace period expired, keep the tooltip up.
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = null;
        }
        // Already visible (e.g. cursor moved from trigger into the
        // tooltip body for an interactive tooltip) — no need to
        // re-schedule the show timer.
        if (isVisible) return;
        // Avoid stacking show timers if the user wiggles in/out fast.
        if (showTimeoutRef.current) return;
        showTimeoutRef.current = setTimeout(() => {
            showTimeoutRef.current = null;
            setIsVisible(true);
        }, openDelay);
    };

    const handleMouseLeave = () => {
        // Cancel a pending show — the user moved away before the
        // open delay elapsed, so the tooltip should never appear.
        if (showTimeoutRef.current) {
            clearTimeout(showTimeoutRef.current);
            showTimeoutRef.current = null;
            return;
        }
        // Simple tooltips close immediately, interactive ones (with
        // links or copy) get a short grace period so the cursor can
        // bridge the gap between trigger and tooltip body without
        // dismissing the panel.
        const delay = (simple && !helpUrl) ? 0 : 300;
        hideTimeoutRef.current = setTimeout(() => {
            hideTimeoutRef.current = null;
            setIsVisible(false);
            if (copied) setTimeout(() => setCopied(false), 300);
        }, delay);
    };

    useEffect(() => {
        return () => {
            if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        if (isVisible && tooltipRef.current && containerRef.current) {
            const tooltip = tooltipRef.current.getBoundingClientRect();
            const container = containerRef.current.getBoundingClientRect();
            // A portal tooltip escapes clipping ancestors; an inline one
            // must fit in what they leave visible.
            const bounds = usePortal
                ? { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
                : visibleBounds(containerRef.current);

            let newPosition = position;
            let newOffset = { left: '50%', transform: 'translateX(-50%)' };

            // Check vertical overflow
            const spaceAbove = container.top - bounds.top;
            const spaceBelow = bounds.bottom - container.bottom;
            const needed = tooltip.height + 10;
            const wouldOverflowTop = spaceAbove < needed;
            const wouldOverflowBottom = spaceBelow < needed;

            // Flip to the side that fits; when neither does, take the roomier one.
            if (position === 'top' && wouldOverflowTop && (!wouldOverflowBottom || spaceBelow > spaceAbove)) {
                newPosition = 'bottom';
            } else if (position === 'bottom' && wouldOverflowBottom && (!wouldOverflowTop || spaceAbove > spaceBelow)) {
                newPosition = 'top';
            }

            // Check horizontal overflow and adjust
            const tooltipLeft = container.left + container.width / 2 - tooltip.width / 2;
            const tooltipRight = container.left + container.width / 2 + tooltip.width / 2;

            if (tooltipRight > bounds.right - 10) {
                // Tooltip would overflow on the right
                const overflow = tooltipRight - (bounds.right - 10);
                newOffset = {
                    left: '50%',
                    transform: `translateX(calc(-50% - ${overflow}px))`
                };
            } else if (tooltipLeft < bounds.left + 10) {
                // Tooltip would overflow on the left
                const overflow = bounds.left + 10 - tooltipLeft;
                newOffset = {
                    left: '50%',
                    transform: `translateX(calc(-50% + ${overflow}px))`
                };
            }

            setAdjustedPosition(newPosition);
            setOffset(newOffset);
        }
    }, [isVisible, position, text, usePortal]);

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
