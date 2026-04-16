import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TokenField from './TokenField';

describe('TokenField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom does not implement clipboard; stub it.
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders an editable password input when no token is stored', () => {
    const onChange = vi.fn();
    render(<TokenField value="" onChange={onChange} placeholder="paste..." />);
    const input = screen.getByPlaceholderText('paste...');
    expect(input).toHaveProperty('type', 'password');
  });

  it('masks a stored token showing only the last 4 chars', () => {
    render(<TokenField value="verylongsecret1234" onChange={() => {}} />);
    expect(screen.getByText(/••••.*1234$/)).toBeTruthy();
  });

  it('reveals the token when the eye is clicked and hides after timeout', () => {
    const token = 'verylongsecret1234';
    render(<TokenField value={token} onChange={() => {}} />);
    const revealBtn = screen.getByLabelText('Reveal token');
    fireEvent.click(revealBtn);
    expect(screen.getByText(token)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(15001);
    });
    expect(screen.queryByText(token)).toBeNull();
  });

  it('auto-hides on window blur', () => {
    const token = 'verylongsecret1234';
    render(<TokenField value={token} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText('Reveal token'));
    expect(screen.getByText(token)).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.queryByText(token)).toBeNull();
  });

  it('copies the raw token to the clipboard', async () => {
    const token = 'verylongsecret1234';
    render(<TokenField value={token} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText('Copy token'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(token);
  });

  it('switches to edit mode when Replace is clicked', () => {
    const onChange = vi.fn();
    render(<TokenField value="stored-token-abcd" onChange={onChange} placeholder="paste..." />);
    fireEvent.click(screen.getByLabelText('Replace token'));
    expect(screen.getByPlaceholderText('paste...')).toHaveProperty('type', 'password');
  });
});
