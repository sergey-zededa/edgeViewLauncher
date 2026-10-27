import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Tooltip, { visibleBounds } from './Tooltip';

vi.mock('../tauriAPI', () => ({ openExternal: vi.fn() }));

const rect = (r) => ({ x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r, ...r });

// The details pane scrolls below a 36px title bar in an 800×600 window.
function mockLayout({ triggerTop }) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('scroller')) return rect({ top: 36, left: 0, right: 800, bottom: 600 });
    if (this.classList.contains('tooltip-container')) return rect({ top: triggerTop, left: 100, right: 200, bottom: triggerTop + 16 });
    if (this.classList.contains('tooltip-content')) return rect({ top: 0, left: 0, right: 300, bottom: 120 });
    return rect({ top: 0, left: 0, right: 0, bottom: 0 });
  });
}

function renderTip(props = {}) {
  render(
    <div className="scroller" style={{ overflowY: 'auto' }}>
      <Tooltip text={'Sessions in use\n\nSlot 1: free\nSlot 2: in use'} helpUrl="https://example.test" openDelay={0} {...props}>
        <span>SESSIONS</span>
      </Tooltip>
    </div>
  );
  act(() => { fireEvent.mouseEnter(screen.getByText('SESSIONS').closest('.tooltip-container')); });
  act(() => { vi.runAllTimers(); });
  return document.querySelector('.tooltip-content');
}

describe('Tooltip placement', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('visibleBounds narrows the window by clipping ancestors', () => {
    mockLayout({ triggerTop: 60 });
    const { container } = render(<div className="scroller" style={{ overflow: 'auto' }}><span id="t">x</span></div>);
    expect(visibleBounds(container.querySelector('#t'))).toEqual({ top: 36, left: 0, right: 800, bottom: 600 });
  });

  it('flips below when the scrolling pane, not the window, has no room above', () => {
    vi.useFakeTimers();
    // 150px from the window top: a 120px tooltip (+10 gap) fits in the
    // window, but the pane starts at 36px, leaving only 114px above.
    mockLayout({ triggerTop: 150 });
    const tip = renderTip();
    expect(tip).toHaveClass('tooltip-bottom');
  });

  it('stays above when the pane has room', () => {
    vi.useFakeTimers();
    mockLayout({ triggerTop: 400 });
    const tip = renderTip();
    expect(tip).toHaveClass('tooltip-top');
  });

  it('keeps the line breaks of a help-link tooltip', () => {
    vi.useFakeTimers();
    mockLayout({ triggerTop: 400 });
    const tip = renderTip();
    expect(tip).toHaveClass('tooltip-with-help');
    expect(tip.querySelector('.tooltip-body').textContent).toContain('Slot 1: free\nSlot 2: in use');
  });
});
