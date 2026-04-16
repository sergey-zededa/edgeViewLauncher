import { describe, it, expect } from 'vitest';
import { formatStatus, statusClass, isInteractive } from './status';

describe('formatStatus', () => {
  it('title-cases single-word lowercase status', () => {
    expect(formatStatus('online')).toBe('Online');
    expect(formatStatus('offline')).toBe('Offline');
    expect(formatStatus('suspect')).toBe('Suspect');
    expect(formatStatus('provisioned')).toBe('Provisioned');
  });

  it('splits underscore-joined enums', () => {
    expect(formatStatus('maintenance_mode')).toBe('Maintenance Mode');
  });

  it('strips RUN_STATE_ prefix from app status', () => {
    expect(formatStatus('RUN_STATE_ONLINE')).toBe('Online');
    expect(formatStatus('RUN_STATE_HALTING')).toBe('Halting');
  });

  it('handles empty / nullish input', () => {
    expect(formatStatus('')).toBe('');
    expect(formatStatus(null)).toBe('');
    expect(formatStatus(undefined)).toBe('');
  });

  it('passes through already-formatted values', () => {
    expect(formatStatus('Online')).toBe('Online');
  });
});

describe('statusClass', () => {
  it('maps known lowercase device states', () => {
    expect(statusClass('online')).toBe('online');
    expect(statusClass('offline')).toBe('offline');
    expect(statusClass('suspect')).toBe('suspect');
    expect(statusClass('provisioned')).toBe('provisioned');
  });

  it('maps maintenance_mode to maintenance', () => {
    expect(statusClass('maintenance_mode')).toBe('maintenance');
    expect(statusClass('maintenance')).toBe('maintenance');
  });

  it('handles app RUN_STATE_ prefix', () => {
    expect(statusClass('RUN_STATE_ONLINE')).toBe('online');
  });

  it('returns unknown for missing/unrecognized values', () => {
    expect(statusClass('')).toBe('unknown');
    expect(statusClass(null)).toBe('unknown');
    expect(statusClass('some_new_state')).toBe('unknown');
  });
});

describe('isInteractive', () => {
  it('is true for online and maintenance_mode', () => {
    expect(isInteractive('online')).toBe(true);
    expect(isInteractive('maintenance_mode')).toBe(true);
    expect(isInteractive('maintenance')).toBe(true);
    expect(isInteractive('RUN_STATE_ONLINE')).toBe(true);
  });

  it('is false for other states', () => {
    expect(isInteractive('offline')).toBe(false);
    expect(isInteractive('suspect')).toBe(false);
    expect(isInteractive('provisioned')).toBe(false);
    expect(isInteractive(null)).toBe(false);
    expect(isInteractive('')).toBe(false);
  });
});
