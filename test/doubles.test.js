// Back-to-back doubles (Kate Young and David, 2026-11-13): an approved double is two
// shifts, each clocked on its own. The operator clocks out of the first shift and
// straight into the next, and that handover raises no Late or Left early flag.
// Times are Pacific (npm test sets TZ), the labs' local time.
import { describe, expect, it } from 'vitest';
import { reviewDays } from '../src/lib/review.js';
import { buildSessions, delivered } from '../src/lib/hours.js';
import { bookedHours, dayPlan, nextBackToBack, openSpots, prevBackToBack } from '../src/lib/schedule.js';
import { conflicts, weeklyLoad } from '../src/lib/rules.js';
import { parseDay } from '../src/lib/time.js';

const DAY = '2026-11-02'; // a Monday
const at = (hm) => { const d = parseDay(DAY); const [h, m] = hm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const quinn = { email: 'quinn@example.com', name: 'Quinn Ray', id: 'OP-0009', location: 'RED' };
const shift = (id, start, end, extra = {}) => ({ id, date: DAY, email: quinn.email, name: quinn.name, location: 'RED', station: 'Robot 1', start, end, template: '', ...extra });
const AM = shift('S-am', '07:00', '12:30');
const MID = shift('S-mid', '12:00', '17:30');
const NIGHT = shift('S-night', '17:00', '23:00');
let n = 0;
const punch = (type, hm, s, extra = {}) => ({ id: `P${++n}`, ts: at(hm).toISOString(), email: quinn.email, name: quinn.name, type, station: s.station, location: 'RED', shiftId: s.id, grace: 0, flag: '', note: '', ...extra });
const dayOf = (schedule, punches, now = at('23:59')) => reviewDays({ schedule, punches, operators: [quinn] }, parseDay(DAY), parseDay('2026-11-03'), now)[0];
const codes = (d) => d.flags.filter((f) => !f.info).map((f) => f.code);

describe('back-to-back doubles', () => {
  it('finds the next and previous shift only when they follow on', () => {
    expect(nextBackToBack([AM, MID, NIGHT], AM).id).toBe('S-mid');
    expect(nextBackToBack([AM, MID, NIGHT], MID).id).toBe('S-night');
    expect(prevBackToBack([AM, MID, NIGHT], MID).id).toBe('S-am');
    // Morning and Night have a gap: a split double, not back to back.
    expect(nextBackToBack([AM, NIGHT], AM)).toBeNull();
  });

  it('switching at the end of the first shift flags nothing', () => {
    const d = dayOf([AM, MID], [punch('in', '07:00', AM), punch('out', '12:30', AM), punch('in', '12:30', MID), punch('out', '17:30', MID)]);
    expect(codes(d)).toEqual([]);
    expect(d.inShift).toBeCloseTo(10.5);
    expect(d.scheduled).toBeCloseTo(10.5);
    expect(d.status).toBe('ready');
  });

  it('switching when the second shift starts flags nothing either', () => {
    const d = dayOf([AM, MID], [punch('in', '07:00', AM), punch('out', '12:00', AM), punch('in', '12:01', MID), punch('out', '17:30', MID)]);
    expect(codes(d)).toEqual([]);
    expect(d.inShift).toBeCloseTo(10.48, 1);
  });

  it('a real gap at the handover is still a late arrival', () => {
    const d = dayOf([AM, MID], [punch('in', '07:00', AM), punch('out', '12:30', AM), punch('in', '13:00', MID), punch('out', '17:30', MID)]);
    expect(codes(d)).toContain('late');
  });

  it('leaving before the next shift opens is still leaving early', () => {
    const d = dayOf([AM, MID], [punch('in', '07:00', AM), punch('out', '11:00', AM), punch('in', '11:01', MID, { shiftId: 'S-mid' })]);
    expect(codes(d)).toContain('left_early');
  });

  it('forgetting to switch is still an auto clock-out', () => {
    const d = dayOf([AM, MID], [punch('in', '07:00', AM), punch('out', '12:30', AM, { flag: 'auto' }), punch('in', '12:46', MID), punch('out', '17:30', MID)]);
    expect(codes(d)).toEqual(expect.arrayContaining(['auto_clockout', 'late']));
  });

  it('Hours worked per robot still counts the robot once', () => {
    const { sessions } = buildSessions([punch('in', '07:00', AM), punch('out', '12:30', AM), punch('in', '12:30', MID), punch('out', '17:30', MID)], at('23:59'));
    expect(delivered(sessions)).toEqual([{ day: DAY, station: 'Robot 1', hours: 10.5 }]);
  });

  it('a skipped second shift shows as missing and opens the spot', () => {
    const punches = [punch('in', '07:00', AM), punch('out', '12:30', AM)];
    const { sessions, issues } = buildSessions(punches, at('13:00'));
    const rows = dayPlan([AM, MID], sessions, issues, parseDay(DAY), at('13:00')).rows;
    expect(rows.map((r) => [r.id, r.status])).toEqual([['S-am', 'done'], ['S-mid', 'late']]);
    // Before it starts, the second shift is still due, not "on site".
    const early = buildSessions([punch('in', '07:00', AM)], at('08:00'));
    expect(dayPlan([AM, MID], early.sessions, early.issues, parseDay(DAY), at('08:00')).rows.map((r) => r.status)).toEqual(['onsite', 'upcoming']);
    const other = { schedule: [AM, MID], punches };
    expect(openSpots(other, 'casey@example.com', 'RED', at('12:20')).map((s) => s.shiftId)).toEqual(['S-mid']);
  });

  it('counts the handover overlap once in booked hours', () => {
    expect(bookedHours([AM, MID])).toBeCloseTo(10.5);
    expect(weeklyLoad([AM, MID], parseDay(DAY))[0].hours).toBeCloseTo(10.5);
  });

  it('a double that changes robot at the handover is not double-booked', () => {
    expect(conflicts([AM, { ...MID, station: 'Robot 2' }])).toEqual([]);
    expect(conflicts([AM, { ...MID, start: '10:00' }]).map((c) => c.kind)).toEqual(['overlap']);
  });
});
