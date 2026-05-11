import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the tauriAPI
vi.mock('../tauriAPI', () => ({
    CloseTunnel: vi.fn(),
}));

// Mock RFB as a class to simulate noVNC behavior without a real WebSocket
const mockDisconnect = vi.fn();
const mockFocus = vi.fn();
const mockAddEventListener = vi.fn();

vi.mock('@novnc/novnc', () => {
    class MockRFB {
        constructor() {
            this.disconnect = mockDisconnect;
            this.focus = mockFocus;
            this.addEventListener = mockAddEventListener;
            this.clipboardPaste = vi.fn();
        }
    }
    // noVNC 1.7.x exposes RFB as the default export of the package root.
    return { default: MockRFB };
});

import VncViewer from './VncViewer';

describe('VncViewer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders without constructor error and shows connecting status', () => {
        const { container } = render(
            <VncViewer url="ws://localhost:5900" onClose={() => {}} />
        );
        expect(container.querySelector('.vnc-viewer-overlay')).toBeTruthy();
        expect(screen.getByText('Connecting...')).toBeTruthy();
    });

    it('RFB import resolves to a usable constructor', async () => {
        const rfbModule = await import('@novnc/novnc');
        const RFB = rfbModule.default || rfbModule;
        expect(typeof RFB).toBe('function');
        const instance = new RFB(document.createElement('div'), 'ws://localhost:5900', {});
        expect(instance).toBeDefined();
        expect(instance.disconnect).toBeDefined();
    });

    it('registers event listeners on RFB instance', () => {
        render(<VncViewer url="ws://localhost:5900" onClose={() => {}} />);
        const events = mockAddEventListener.mock.calls.map(c => c[0]);
        expect(events).toContain('connect');
        expect(events).toContain('disconnect');
        expect(events).toContain('credentialsrequired');
        expect(events).toContain('clipboard');
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(<VncViewer url="ws://localhost:5900" onClose={onClose} />);
        const closeBtn = Array.from(document.querySelectorAll('.icon-btn'))
            .find(b => b.title?.includes('Close Window'));
        expect(closeBtn).toBeTruthy();
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalled();
    });

    it('renders stop tunnel button when tunnelId is provided', () => {
        render(<VncViewer url="ws://localhost:5900" onClose={() => {}} tunnelId="t1" />);
        const stopBtn = document.querySelector('.icon-btn.danger');
        expect(stopBtn).toBeTruthy();
        expect(stopBtn.title).toContain('Stop Tunnel');
    });

    it('disconnects RFB on unmount', () => {
        const { unmount } = render(
            <VncViewer url="ws://localhost:5900" onClose={() => {}} />
        );
        unmount();
        expect(mockDisconnect).toHaveBeenCalled();
    });
});
