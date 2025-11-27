import React, { useState } from 'react';

const Tooltip = ({ text, children, position = 'top' }) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div
            className="tooltip-container"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div className={`tooltip-content tooltip-${position}`}>
                    {text}
                </div>
            )}
        </div>
    );
};

export default Tooltip;
