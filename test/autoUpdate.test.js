import { describe, expect, it } from 'vitest';
import { COUNTDOWN_S, nextLeft, waitReason } from '../src/lib/autoUpdate.js';

// A stand-in page: whether something dialog-like is open, and the focused element.
const doc = (open = false, active = null) => ({ querySelector: () => (open ? {} : null), activeElement: active });
const el = (tagName, type, value = 'abc') => ({ tagName, type, value, isContentEditable: false });

describe('auto-refresh to a new build', () => {
  it('waits while anything is being sent', () => {
    expect(waitReason({ tasks: [{ id: 't' }], jobs: [] }, doc())).toBe('saving');
    expect(waitReason({ tasks: [], jobs: [{ state: 'sending' }] }, doc())).toBe('saving');
  });

  it('does not wait for queued edits that are only waiting (they survive a reload)', () => {
    expect(waitReason({ tasks: [], jobs: [{ state: 'waiting' }, { state: 'stuck' }] }, doc())).toBe('');
  });

  it('refreshes when nothing is going on', () => {
    expect(waitReason({ tasks: [], jobs: [] }, doc())).toBe('');
  });

  it('waits while a sheet or dialog is open, or someone is typing', () => {
    expect(waitReason({}, doc(true))).toBe('open');
    expect(waitReason({}, doc(false, el('INPUT', 'text')))).toBe('typing');
    expect(waitReason({}, doc(false, el('TEXTAREA', 'textarea')))).toBe('typing');
    expect(waitReason({}, doc(false, el('INPUT', 'text', '')))).toBe('');
    expect(waitReason({}, doc(false, el('BUTTON', 'button')))).toBe('');
    expect(waitReason({}, doc(false, el('INPUT', 'checkbox')))).toBe('');
  });

  it('counts down, holds while paused, and starts over after waiting', () => {
    let left = COUNTDOWN_S;
    for (let i = 0; i < 3; i++) left = nextLeft(left, {});
    expect(left).toBe(COUNTDOWN_S - 3);
    expect(nextLeft(left, { paused: true })).toBe(left);
    expect(nextLeft(left, { waiting: true })).toBe(COUNTDOWN_S);
    expect(nextLeft(1, {})).toBe(0);
    expect(nextLeft(0, {})).toBe(0);
  });
});
