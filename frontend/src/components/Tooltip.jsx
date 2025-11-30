import React, { useState, useRef, useEffect } from 'react';

const Tooltip = ({ text, children, position = 'top' }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const [offset, setOffset] = useState({ left: '50%', transform: 'translateX(-50%)' });
    const tooltipRef = useRef(null);
    const containerRef = useRef(null);

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
    }, [isVisible, position]);

    return (
        <div
            ref={containerRef}
            className="tooltip-container"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div
                    ref={tooltipRef}
                    className={`tooltip-content tooltip-${adjustedPosition}`}
                    style={offset}
                >
                    {text}
                </div>
            )}
        </div>
    );
};

export default Tooltip;
