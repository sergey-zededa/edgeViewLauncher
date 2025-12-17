import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import GlobalStatusBanner from './GlobalStatusBanner';

describe('GlobalStatusBanner', () => {
    it('does not render when status is null', () => {
        const { container } = render(<GlobalStatusBanner status={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders info status correctly', () => {
        const status = { type: 'info', message: 'Info message' };
        render(<GlobalStatusBanner status={status} />);
        
        const banner = screen.getByText('Info message').closest('.global-status-banner');
        expect(banner).toHaveClass('info');
        expect(screen.getByText('Info message')).toBeInTheDocument();
    });

    it('renders success status correctly', () => {
        const status = { type: 'success', message: 'Success message' };
        render(<GlobalStatusBanner status={status} />);
        
        const banner = screen.getByText('Success message').closest('.global-status-banner');
        expect(banner).toHaveClass('success');
    });

    it('renders error status correctly', () => {
        const status = { type: 'error', message: 'Error message' };
        render(<GlobalStatusBanner status={status} />);
        
        const banner = screen.getByText('Error message').closest('.global-status-banner');
        expect(banner).toHaveClass('error');
    });

    it('renders loading status correctly', () => {
        const status = { type: 'loading', message: 'Loading...' };
        const { container } = render(<GlobalStatusBanner status={status} />);
        
        expect(screen.getByText('Loading...')).toBeInTheDocument();
        expect(container.querySelector('.status-spinner')).toBeInTheDocument();
    });

    it('calls onDismiss when close button is clicked', () => {
        const status = { type: 'info', message: 'Dismiss me' };
        const handleDismiss = vi.fn();
        
        render(<GlobalStatusBanner status={status} onDismiss={handleDismiss} />);
        
        const closeButton = screen.getByRole('button');
        fireEvent.click(closeButton);
        
        expect(handleDismiss).toHaveBeenCalledTimes(1);
    });

    it('does not render close button if onDismiss is not provided', () => {
        const status = { type: 'info', message: 'No dismiss' };
        render(<GlobalStatusBanner status={status} />);
        
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
