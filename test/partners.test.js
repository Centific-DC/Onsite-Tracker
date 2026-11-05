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
  it('gives no partners to a shift with no robot set', () => {
    const blank = { ...mine, station: '' };
    const data = { schedule: [blank, s('S2', 'a@x.com', 'Avery Lin', '', '17:00', '23:00')] };
    expect(partnersOf(data, blank)).toEqual([]);
  });
});

import { backfills, openSpots } from '../src/lib/schedule.js';
import { pairingRisks } from '../src/lib/rules.js';

describe('pairs without a robot', () => {
  const a = s('S1', 'a@x.com', 'Avery Lin', '', '07:00', '12:30', { pair: 'P-1' });
  const b = s('S2', 'b@x.com', 'Blair Kim', '', '07:00', '12:30', { pair: 'P-1' });
  const c = s('S3', 'c@x.com', 'Casey Novak', '', '09:15', '12:30', { pair: 'P-1', replaces: 'S1' });
  it('pairs by pair id, whatever the robot', () => {
    expect(partnersOf({ schedule: [a, b] }, a)).toEqual(['Blair Kim']);
    expect(partnersOf({ schedule: [a, { ...b, station: 'Robot 2' }] }, a)).toEqual(['Blair Kim']);
  });
  it('a pair id beats the robot: same robot, different pair is not a partner', () => {
    expect(partnersOf({ schedule: [{ ...a, station: 'Robot 1' }, s('S9', 'z@x.com', 'Zed', 'Robot 1', '07:00', '12:30')] }, { ...a, station: 'Robot 1' })).toEqual([]);
  });
  it('a replacement takes the no-show’s place in the pair', () => {
    const data = { schedule: [a, b, c] };
    expect(partnersOf(data, b)).toEqual(['Casey Novak']);
    expect(partnersOf(data, c)).toEqual(['Blair Kim']);
  });
  it('flags two new operators paired by id', () => {
    const ops = [{ email: 'a@x.com', experience: 'new' }, { email: 'b@x.com', experience: 'new' }];
    expect(pairingRisks([a, b], ops, [])).toHaveLength(1);
    expect(pairingRisks([a, b, c], [...ops, { email: 'c@x.com', experience: 'experienced' }], [])).toHaveLength(0);
  });
  it('asks for a replacement per pair', () => {
    const rows = [{ ...a, status: 'late' }, { ...b, status: 'onsite' }];
    expect(backfills(rows)).toHaveLength(1);
    expect(backfills([...rows, { ...c, status: 'onsite' }])).toHaveLength(0);
  });
});

describe('openSpots', () => {
  const now = new Date(2026, 10, 5, 8, 0);
  const a = s('S1', 'a@x.com', 'Avery Lin', 'Robot 1', '07:00', '12:30');
  const b = s('S2', 'b@x.com', 'Blair Kim', 'Robot 1', '07:00', '12:30');
  const inAt = (email) => ({ email, type: 'in', ts: new Date(2026, 10, 5, 6, 58).toISOString() });
  it('lists a no-show’s shift in my lab, without names', () => {
    const spots = openSpots({ schedule: [a, b], punches: [inAt('b@x.com')] }, 'c@x.com', 'RED', now);
    expect(spots).toEqual([{ shiftId: 'S1', location: 'RED', station: 'Robot 1', start: '07:00', end: '12:30', template: undefined, date: '2026-11-05' }]);
    expect(JSON.stringify(spots)).not.toMatch(/Avery|a@x/);
  });
  it('not before the grace period ends, not in another lab, not once replaced, not if I clocked in', () => {
    expect(openSpots({ schedule: [a], punches: [] }, 'c@x.com', 'RED', new Date(2026, 10, 5, 7, 10))).toEqual([]);
    expect(openSpots({ schedule: [a], punches: [] }, 'c@x.com', 'MTV', now)).toEqual([]);
    expect(openSpots({ schedule: [a, s('S3', 'c@x.com', 'C', 'Robot 1', '08:00', '12:30', { replaces: 'S1' })], punches: [] }, 'd@x.com', 'RED', now)).toEqual([]);
    expect(openSpots({ schedule: [a], punches: [inAt('c@x.com')] }, 'c@x.com', 'RED', now)).toEqual([]);
  });
});
