import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import UpdateBanner from './UpdateBanner';
import * as api from '../tauriAPI';

vi.mock('../tauriAPI', () => ({
    openExternal: vi.fn(),
}));

// Mock window.electronAPI for the tests
beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
});
describe('UpdateBanner', () => {
    it('should not render when status is not-available', () => {
        const updateState = {
            status: 'not-available',
            version: null,
            downloadProgress: 0,
            error: null
        };

        const { container } = render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        expect(container.firstChild).toBeNull();
    });

    it('should not render when status is dismissed', () => {
        const updateState = {
            status: 'dismissed',
            version: '1.0.0',
            downloadProgress: 0,
            error: null
        };

        const { container } = render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        expect(container.firstChild).toBeNull();
    });

    it('should render update available message with version', () => {
        const updateState = {
            status: 'available',
            version: '1.2.3',
            downloadProgress: 0,
            error: null
        };

        render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        expect(screen.getByText(/New version/)).toBeInTheDocument();
        expect(screen.getByText(/1.2.3/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Dismiss/i })).toBeInTheDocument();
    });

    it('should call onDownload when Download button is clicked', () => {
        const onDownload = vi.fn();
        const updateState = {
            status: 'available',
            version: '1.2.3',
            downloadProgress: 0,
            error: null
        };

        render(
            <UpdateBanner
                updateState={updateState}
                onDownload={onDownload}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        const downloadButton = screen.getByRole('button', { name: /Download/i });
        fireEvent.click(downloadButton);

        expect(onDownload).toHaveBeenCalledTimes(1);
    });

    it('should call onDismiss when Dismiss button is clicked', () => {
        const onDismiss = vi.fn();
        const updateState = {
            status: 'available',
            version: '1.2.3',
            downloadProgress: 0,
            error: null
        };

        render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={onDismiss}
            />
        );

        const dismissButton = screen.getByRole('button', { name: /Dismiss/i });
        fireEvent.click(dismissButton);

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('should render downloading state with progress', () => {
        const updateState = {
            status: 'downloading',
            version: '1.2.3',
            downloadProgress: 45,
            error: null
        };

        render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        expect(screen.getByText(/Downloading update\.\.\. 45%/)).toBeInTheDocument();

        // Check progress bar width
        const progressBar = document.querySelector('.update-banner-progress-bar');
        expect(progressBar).toHaveStyle({ width: '45%' });
    });

    it('should render downloaded state with install button', () => {
        const updateState = {
            status: 'downloaded',
            version: '1.2.3',
            downloadProgress: 100,
            error: null
        };

        render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        expect(screen.getByText(/Update/)).toBeInTheDocument();
        expect(screen.getByText(/1.2.3/)).toBeInTheDocument();
        expect(screen.getByText(/ready to install/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Restart & Install/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Later/i })).toBeInTheDocument();
    });

    it('should call onInstall when Restart & Install button is clicked', () => {
        const onInstall = vi.fn();
        const updateState = {
            status: 'downloaded',
            version: '1.2.3',
            downloadProgress: 100,
            error: null
        };

        render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={onInstall}
                onDismiss={vi.fn()}
            />
        );

        const installButton = screen.getByRole('button', { name: /Restart & Install/i });
        fireEvent.click(installButton);

        expect(onInstall).toHaveBeenCalledTimes(1);
    });

    it('should render error state with error message', () => {
        const updateState = {
            status: 'error',
            version: '1.2.3',
            downloadProgress: 0,
            error: 'Network connection failed'
        };

        render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        expect(screen.getByText(/Update failed/)).toBeInTheDocument();
        expect(screen.getByText(/Network connection failed/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Dismiss/i })).toBeInTheDocument();
    });

    it('should apply error class when status is error', () => {
        const updateState = {
            status: 'error',
            version: '1.2.3',
            downloadProgress: 0,
            error: 'Something went wrong'
        };

        const { container } = render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        const banner = container.querySelector('.update-banner');
        expect(banner).toHaveClass('error');
    });

    it('should handle unknown error gracefully', () => {
        const updateState = {
            status: 'error',
            version: '1.2.3',
            downloadProgress: 0,
            error: null
        };

        render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        expect(screen.getByText(/Unknown error/)).toBeInTheDocument();
    });
});

describe('UpdateBanner macOS behavior', () => {
    // The isMacOS constant is evaluated at module load time from navigator.platform.
    // In jsdom (test env), navigator.platform defaults to '' so isMacOS is false.
    // We need to re-import the module with a mocked navigator.platform.

    it('should show manual download message on macOS when update available', async () => {
        // Set navigator.platform before importing the module
        Object.defineProperty(navigator, 'platform', {
            value: 'MacIntel',
            writable: true,
            configurable: true,
        });

        // Re-import the module so it picks up the new platform
        vi.resetModules();
        const { default: MacUpdateBanner } = await import('./UpdateBanner');

        const updateState = {
            status: 'available',
            version: '2.0.0',
            downloadProgress: 0,
            error: null,
        };

        render(
            <MacUpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        expect(screen.getByText(/Auto-updates are temporarily unavailable on macOS/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Download from GitHub/i })).toBeInTheDocument();
        // Should NOT show the normal Download button
        expect(screen.queryByRole('button', { name: /^Download$/i })).not.toBeInTheDocument();

        // Restore
        Object.defineProperty(navigator, 'platform', {
            value: '',
            writable: true,
            configurable: true,
        });
    });

    it('should show manual download message on macOS for downloading state', async () => {
        Object.defineProperty(navigator, 'platform', {
            value: 'MacIntel',
            writable: true,
            configurable: true,
        });

        vi.resetModules();
        const { default: MacUpdateBanner } = await import('./UpdateBanner');

        const updateState = {
            status: 'downloading',
            version: '2.0.0',
            downloadProgress: 50,
            error: null,
        };

        render(
            <MacUpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        // Should show manual download, not the progress bar
        expect(screen.getByText(/Auto-updates are temporarily unavailable on macOS/)).toBeInTheDocument();
        expect(screen.queryByText(/Downloading update/)).not.toBeInTheDocument();

        Object.defineProperty(navigator, 'platform', {
            value: '',
            writable: true,
            configurable: true,
        });
    });

    it('should show manual download message on macOS for downloaded state', async () => {
        Object.defineProperty(navigator, 'platform', {
            value: 'MacIntel',
            writable: true,
            configurable: true,
        });

        vi.resetModules();
        const { default: MacUpdateBanner } = await import('./UpdateBanner');

        const updateState = {
            status: 'downloaded',
            version: '2.0.0',
            downloadProgress: 100,
            error: null,
        };

        render(
            <MacUpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        // Should show manual download, not Restart & Install
        expect(screen.getByText(/Auto-updates are temporarily unavailable on macOS/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Restart & Install/i })).not.toBeInTheDocument();

        Object.defineProperty(navigator, 'platform', {
            value: '',
            writable: true,
            configurable: true,
        });
    });

    it('should show normal download button on non-macOS', () => {
        // navigator.platform is '' in jsdom (not Mac), so the default import works
        const updateState = {
            status: 'available',
            version: '2.0.0',
            downloadProgress: 0,
            error: null,
        };

        render(
            <UpdateBanner
                updateState={updateState}
                onDownload={vi.fn()}
                onInstall={vi.fn()}
                onDismiss={vi.fn()}
            />
        );

        expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument();
        expect(screen.queryByText(/Auto-updates are temporarily unavailable/)).not.toBeInTheDocument();
    });
});
