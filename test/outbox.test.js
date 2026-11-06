import { describe, expect, it } from 'vitest';
import { KINDS, MAX_TRIES, afterFail, overlay, ready, refused } from '../src/lib/outbox.js';

const job = (id, kind, body, extra = {}) => ({ id, kind, body, state: 'waiting', nextAt: 0, tries: 0, ...extra });
const shift = (id, extra = {}) => ({ id, email: 'a@x.com', date: '2026-11-09', start: '07:00', end: '12:30', location: 'RED', ...extra });

describe('save queue', () => {
  it('shows unsent changes on top of the server copy', () => {
    const base = { schedule: [shift('S-1'), shift('S-2')], operators: [{ email: 'a@x.com', name: 'A' }] };
    const jobs = [
      job('1', 'shifts', { shifts: [shift('tmp-a', { date: '2026-11-10' })] }),
      job('2', 'shiftDelete', { id: 'S-2' }),
      job('3', 'users', { users: [{ email: 'a@x.com', experience: 'new' }] }),
    ];
    const d = overlay(base, jobs);
    expect(d.schedule.map((r) => r.id)).toEqual(['S-1', 'tmp-a']);
    expect(d.schedule[1].pending).toBe(true);
    expect(d.operators[0]).toMatchObject({ name: 'A', experience: 'new', pending: true });
    expect(base.schedule).toHaveLength(2);
  });

  it('swaps the tmp shift for the saved one when it lands', () => {
    const b = { shifts: [shift('tmp-a')] };
    const d = KINDS.shifts.settle({ schedule: [shift('S-1')] }, b, [shift('S-9')]);
    expect(d.schedule.map((r) => r.id)).toEqual(['S-1', 'S-9']);
  });

  it('keeps changes to the same shift in order, and sends at most three at once', () => {
    const jobs = [
      job('1', 'shifts', { shifts: [shift('S-1')] }, { state: 'sending' }),
      job('2', 'shiftDelete', { id: 'S-1' }),
      job('3', 'shiftDelete', { id: 'S-2' }),
      job('4', 'client', { week: '2026-11-09', hours: 10 }),
      job('5', 'flag', { key: 'k' }),
    ];
    expect(ready(jobs, Date.now()).map((j) => j.id)).toEqual(['3', '4']);
  });

  it('waits longer after each failure, then stops and keeps the change', () => {
    let j = job('1', 'client', { week: 'w', hours: 1 });
    j = afterFail(j, { status: 503, message: 'busy' }, 0);
    expect(j).toMatchObject({ state: 'waiting', tries: 1, nextAt: 5000, unsure: false });
    for (let i = 1; i < MAX_TRIES; i++) j = afterFail(j, { status: 504, message: 'timeout' }, 0);
    expect(j).toMatchObject({ state: 'stuck', unsure: true });
  });

  it('a refusal is final; busy, timeouts and sign-in trouble are not', () => {
    expect(refused({ status: 400 })).toBe(true);
    expect(refused({ status: 409 })).toBe(true);
    for (const status of [401, 429, 500, 503, 504, undefined]) expect(refused({ status })).toBe(false);
  });

  it('after a try that may have saved, a new shift already on the server is not sent again', () => {
    const b = { shifts: [shift('tmp-a'), shift('tmp-b', { date: '2026-11-11' })] };
    const fresh = { schedule: [shift('S-7')] };
    const f = KINDS.shifts.found(fresh, b);
    expect(f.saved.map((r) => r.id)).toEqual(['S-7']);
    expect(f.rest.shifts.map((r) => r.id)).toEqual(['tmp-b']);
  });
});
