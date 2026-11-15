import { describe, expect, it } from 'vitest';
import { dayPlan } from '../src/lib/schedule.js';
import { reviewDays } from '../src/lib/review.js';
import { isTracked } from '../src/lib/config.js';

// Synthetic demo people only.
const shift = (date) => ({ id: `S-${date}`, date, email: 'avery.lin@example.com', name: 'Avery Lin', location: 'RED', station: 'Robot 1', start: '07:00', end: '12:30' });
const after = new Date(2026, 10, 20, 18, 0);

describe('before Lotus went live', () => {
  it('a booked shift nobody clocked is Not tracked, not a no-show', () => {
    const before = dayPlan([shift('2026-11-13')], [], [], new Date(2026, 10, 13), after, { trackFrom: '2026-11-16' });
    expect(before.rows[0].status).toBe('untracked');
    const live = dayPlan([shift('2026-11-17')], [], [], new Date(2026, 10, 17), after, { trackFrom: '2026-11-16' });
    expect(live.rows[0].status).toBe('noshow');
  });
  it('makes no review day or no-show flag before go-live', () => {
    const data = { schedule: [shift('2026-11-13'), shift('2026-11-17')], punches: [], operators: [], resolutions: [], approvals: [], corrections: [] };
    const days = reviewDays(data, new Date(2026, 10, 9), new Date(2026, 10, 21), after, { trackFrom: '2026-11-16' });
    expect(days.map((d) => d.day)).toEqual(['2026-11-17']);
    expect(days[0].flags.map((f) => f.code)).toContain('no_show');
  });
  it('isTracked compares site-local days', () => {
    expect(isTracked('2026-11-15', '2026-11-16')).toBe(false);
    expect(isTracked('2026-11-16', '2026-11-16')).toBe(true);
    expect(isTracked('2026-11-01', '')).toBe(true);
  });
});
