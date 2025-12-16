import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import UpdateBanner from './UpdateBanner';

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
