import { describe, expect, it } from 'vitest';
import { partnersOf } from '../src/lib/schedule.js';

const s = (id, email, name, station, start, end, extra = {}) => ({ id, email, name, station, location: 'RED', date: '2026-11-05', start, end, ...extra });

describe('partnersOf', () => {
  const mine = s('S1', 'me@x.com', 'Me', 'Robot 1', '17:00', '23:00');
  it('names operators on the same robot and shift, not the next shift at handover', () => {
    const data = { schedule: [mine, s('S2', 'a@x.com', 'Avery Lin', 'Robot 1', '17:00', '23:00'), s('S3', 'b@x.com', 'Blair Kim', 'Robot 2', '17:00', '23:00'), s('S4', 'c@x.com', 'Casey Novak', 'Robot 1', '12:00', '17:00')] };
    expect(partnersOf(data, mine)).toEqual(['Avery Lin']);
  });
  it('ignores other labs and other days', () => {
    const data = { schedule: [mine, s('S2', 'a@x.com', 'Avery Lin', 'Robot 1', '17:00', '23:00', { location: 'MTV' }), s('S3', 'b@x.com', 'Blair Kim', 'Robot 1', '17:00', '23:00', { date: '2026-11-06' })] };
    expect(partnersOf(data, mine)).toEqual([]);
  });
  it('uses the names the Read flow sends an operator', () => {
    const data = { schedule: [mine], partners: [{ shiftId: 'S1', name: 'Avery Lin' }, { shiftId: 'S9', name: 'Someone Else' }] };
    expect(partnersOf(data, mine)).toEqual(['Avery Lin']);
  });
});
