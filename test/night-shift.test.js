import { describe, it, expect } from 'vitest';
import { statusOf, buildSessions, OPEN_MAX_HOURS } from '../src/lib/hours.js';

// 2026-11-17: an operator clocked in on an evening shift; after midnight the page
// forgot the open clock-in, showed Clock in and 0 hours, and wouldn't let them clock out.
const e = 'op@example.com';
const p = (type, ts, extra = {}) => ({ type, ts, email: e, name: 'Op', station: 'r1', ...extra });

describe('a clock-in that runs past midnight', () => {
  const inAt = '2026-11-18T05:30:00.000Z'; // 9:30 PM PT on Nov 17
  const afterMidnight = new Date('2026-11-18T08:01:00.000Z'); // 12:01 AM PT on Nov 18

  it('is still open after midnight, so the page shows Clock out', () => {
    expect(statusOf([p('in', inAt)], e, afterMidnight).open?.ts).toBe(inAt);
  });

  it('counts as a live session on the day it started', () => {
    const { sessions, issues } = buildSessions([p('in', inAt)], afterMidnight);
    expect(issues).toEqual([]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].live).toBe(true);
    expect(sessions[0].hours).toBeCloseTo(2.52, 1);
  });

  it(`stops being open after ${OPEN_MAX_HOURS} hours and becomes a missing clock-out`, () => {
    const late = new Date(Date.parse(inAt) + (OPEN_MAX_HOURS + 1) * 36e5);
    expect(statusOf([p('in', inAt)], e, late).open).toBeNull();
    const { sessions, issues } = buildSessions([p('in', inAt)], late);
    expect(sessions).toEqual([]);
    expect(issues.map((i) => i.kind)).toEqual(['noout']);
  });

  it('is closed once there is a clock-out, including an Auto clock-out', () => {
    const st = statusOf([p('in', inAt), p('out', '2026-11-18T07:45:00.000Z', { flag: 'auto' })], e, afterMidnight);
    expect(st.open).toBeNull();
    expect(st.last.flag).toBe('auto');
  });
});
