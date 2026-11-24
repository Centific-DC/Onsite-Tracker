// Shift changes from the 2026-11-23 meeting (Spencer Woods, John Uraya, David):
// 1. Provisional clock-in: an operator who isn't on the schedule can still clock in.
//    It goes to review; accepted, the time counts, declined, it doesn't.
// 2. Doubles stay allowed; a third shift in one day is blocked everywhere.
// Times are Pacific (npm test sets TZ), the labs' local time. Synthetic people only.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clockInCheck, dayShifts, provisionalCheck, provisionalSlot, workedShifts } from '../src/lib/attendance.js';
import { buildSessions } from '../src/lib/hours.js';
import { reviewDays } from '../src/lib/review.js';
import { dayPlan, openSpots } from '../src/lib/schedule.js';
import { thirdShiftProblem } from '../src/lib/rules.js';
import { planScheduleImport } from '../src/lib/importer.js';
import { planSheetSync } from '../src/lib/sheetSync.js';
import { demo, normPunch, punchFlag, setDemoActor } from '../src/lib/api.js';
import { parseDay } from '../src/lib/time.js';

const DAY = '2026-11-02'; // a Monday
const at = (hm, day = DAY) => { const d = parseDay(day); const [h, m] = hm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const quinn = { email: 'quinn@example.com', name: 'Quinn Ray', id: 'OP-0009', location: 'RED' };
const shift = (id, start, end, extra = {}) => ({ id, date: DAY, email: quinn.email, name: quinn.name, location: 'RED', station: 'Robot 1', start, end, template: '', ...extra });
const AM = shift('S-am', '07:00', '12:30');
const MID = shift('S-mid', '12:00', '17:30');
const NIGHT = shift('S-night', '17:00', '23:00');
let n = 0;
const punch = (type, hm, extra = {}) => ({ id: `P${++n}`, ts: at(hm).toISOString(), email: quinn.email, name: quinn.name, type, station: 'Robot 1', location: 'RED', shiftId: '', grace: 0, flag: '', note: '', ...extra });
const provIn = (hm, extra = {}) => punch('in', hm, { flag: 'provisional', note: 'Swapped with Sam', template: 'RED-MID', until: at('17:30').toISOString(), ...extra });
const dayOf = (schedule, punches, now = at('23:59'), resolutions = []) => reviewDays({ schedule, punches, operators: [quinn], resolutions }, parseDay(DAY), parseDay('2026-11-03'), now)[0];

describe('provisional clock-in: when it is offered', () => {
  it('picks the lab shift the clock-in falls in', () => {
    expect(provisionalSlot('RED', at('12:10')).template.id).toBe('RED-MID'); // the later one already started
    expect(provisionalSlot('RED', at('11:30')).template.id).toBe('RED-AM');
    expect(provisionalSlot('RED', at('06:30')).template.id).toBe('RED-AM'); // starting within the hour
    expect(provisionalSlot('MTV', at('12:15')).template.id).toBe('MTV-MID');
    expect(provisionalSlot('RED', at('23:30'))).toBeNull();
    expect(+provisionalSlot('RED', at('12:10')).end).toBe(+at('17:30'));
  });

  it('is allowed with no shift, or before a later shift opens', () => {
    expect(provisionalCheck({ schedule: [], punches: [], email: quinn.email }, at('12:10')).allowed).toBe(true);
    expect(provisionalCheck({ schedule: [NIGHT], punches: [], email: quinn.email }, at('12:10')).allowed).toBe(true);
  });

  it('is not offered when a booked shift is open to clock into', () => {
    expect(provisionalCheck({ schedule: [MID], punches: [], email: quinn.email }, at('12:10'))).toMatchObject({ allowed: false, reason: 'has_shift' });
  });

  it('is never a third shift', () => {
    expect(provisionalCheck({ schedule: [AM, NIGHT], punches: [punch('in', '07:00', { shiftId: 'S-am' }), punch('out', '12:30')], email: quinn.email }, at('13:00'))).toMatchObject({ allowed: false, reason: 'third_shift' });
    // A booked shift that ended with no clock-in doesn't fill the day.
    expect(provisionalCheck({ schedule: [AM, NIGHT], punches: [], email: quinn.email }, at('13:00')).allowed).toBe(true);
    // Two provisional clock-ins already today: no third.
    const two = [provIn('07:00'), punch('out', '11:00'), provIn('12:00'), punch('out', '13:00')];
    expect(dayShifts([], two, quinn.email, DAY, at('14:00'))).toHaveLength(2);
    expect(provisionalCheck({ schedule: [], punches: two, email: quinn.email }, at('14:00')).reason).toBe('third_shift');
  });
});

describe('provisional clock-in: the record', () => {
  it('reads the flow’s Flag, Template and PlannedEnd', () => {
    expect(punchFlag('Provisional')).toBe('provisional');
    const p = normPunch({ Timestamp: '2026-11-02T20:05:00Z', InOut: 'IN', Email: 'Q@example.com', Flag: 'Provisional', Template: 'RED-MID', PlannedEnd: '2026-11-03T01:30:00Z', Note: 'Swapped' });
    expect(p).toMatchObject({ flag: 'provisional', template: 'RED-MID', until: '2026-11-03T01:30:00.000Z', shiftId: '', note: 'Swapped' });
    expect(normPunch({ Timestamp: '2026-11-02T20:05:00Z', InOut: 'IN', Email: 'q@example.com' }).until).toBe('');
  });

  it('keeps the reason on the session', () => {
    const { sessions } = buildSessions([provIn('12:05'), punch('out', '15:10')], at('23:00'));
    expect(sessions[0]).toMatchObject({ provisional: true, reason: 'Swapped with Sam' });
  });
});

describe('provisional clock-in: review', () => {
  const P = [provIn('12:05'), punch('out', '15:05')];

  it('needs a decision and counts nothing until accepted', () => {
    const d = dayOf([], P);
    expect(d.flags.map((f) => f.code)).toEqual(['provisional']);
    expect(d.flags[0].detail).toContain('Swapped with Sam');
    expect(d.flags[0].minutes).toBe(180);
    expect(d.status).toBe('needs_review');
    expect(d.computed).toBe(0);
    expect(d.recorded).toBeCloseTo(3);
  });

  it('accepted: the time counts; declined: it doesn’t', () => {
    const key = dayOf([], P).flags[0].key;
    const yes = dayOf([], P, at('23:59'), [{ key, outcome: 'accept', reason: 'Lead confirmed the swap', at: '2026-11-02T23:00:00Z' }]);
    expect(yes.computed).toBeCloseTo(3);
    expect(yes.status).toBe('ready');
    const no = dayOf([], P, at('23:59'), [{ key, outcome: 'decline', reason: 'Not needed on site', at: '2026-11-02T23:00:00Z' }]);
    expect(no.computed).toBe(0);
  });

  it('never counts toward a booked shift it overlaps', () => {
    // Booked for Night, came in at noon on a swap and stayed to 17:30: the night shift
    // still needs its own clock-in.
    const d = dayOf([NIGHT], [provIn('12:00'), punch('out', '17:30')]);
    expect(d.flags.map((f) => f.code).sort()).toEqual(['no_show', 'provisional']);
    expect(d.inShift).toBe(0);
  });

  it('a forgotten clock-out suggests the lab shift’s end', () => {
    const d = dayOf([], [provIn('12:05')], at('23:59', '2026-11-03'));
    const f = d.flags.find((x) => x.code === 'no_clockout');
    expect(+f.suggested).toBe(+at('17:30'));
    expect(f.detail).toContain('Provisional');
  });

  it('an Auto clock-out at the planned end is flagged in the detail', () => {
    const d = dayOf([], [provIn('12:05'), punch('out', '17:30', { flag: 'auto' })]);
    expect(d.flags[0].detail).toContain('Auto clock-out');
  });
});

describe('provisional clock-in: Today and open spots', () => {
  it('shows on Today even for someone booked later, without marking their shift worked', () => {
    const { sessions, issues } = buildSessions([provIn('12:05')], at('13:00'));
    const p = dayPlan([NIGHT], sessions, issues, at('13:00'), at('13:00'), { trackFrom: '2026-01-01' });
    expect(p.unscheduled).toHaveLength(1);
    expect(p.unscheduled[0].provisional).toBe(true);
    expect(p.rows[0].status).toBe('upcoming');
  });

  it('no open spots for someone already booked twice today', () => {
    const other = { id: 'S-x', date: DAY, email: 'sam@example.com', name: 'Sam', location: 'RED', station: 'Robot 2', start: '12:00', end: '17:30' };
    const data = { schedule: [other, AM, NIGHT], punches: [] };
    expect(openSpots(data, quinn.email, 'RED', at('12:30'))).toEqual([]);
    expect(openSpots({ schedule: [other, NIGHT], punches: [] }, quinn.email, 'RED', at('12:30'))).toHaveLength(1);
  });
});

describe('no third shift in one day', () => {
  it('Add shift refuses a third, not a second', () => {
    expect(thirdShiftProblem(MID, [AM])).toBe('');
    expect(thirdShiftProblem(NIGHT, [AM, MID])).toMatch(/already has 2 shifts/);
    // A shift someone else replaced (a no-show's) doesn't count.
    const cover = { id: 'S-c', date: DAY, email: 'sam@example.com', name: 'Sam', start: '12:00', end: '17:30', replaces: 'S-mid' };
    expect(thirdShiftProblem(NIGHT, [AM, MID, cover])).toBe('');
    // Editing one of the two isn't a third.
    expect(thirdShiftProblem({ ...MID, end: '17:00' }, [AM, MID])).toBe('');
  });

  it('clock-in refuses a third booked shift after two worked', () => {
    const LATE = shift('S-late', '22:00', '23:30');
    const worked = [punch('in', '07:00', { shiftId: 'S-am' }), punch('out', '12:30'), punch('in', '12:30', { shiftId: 'S-mid' }), punch('out', '17:30')];
    expect(workedShifts(worked, quinn.email, DAY)).toEqual(['S-am', 'S-mid']);
    const ctx = { schedule: [AM, MID, LATE], punches: worked, email: quinn.email };
    expect(clockInCheck(LATE, at('22:00'), ctx)).toMatchObject({ allowed: false, reason: 'third_shift' });
    // The second shift of a double still clocks in.
    expect(clockInCheck(MID, at('12:30'), { ...ctx, punches: worked.slice(0, 2) }).allowed).toBe(true);
  });

  it('Import skips a third row for the same person and day', () => {
    const ops = [{ id: 'OP-1', email: 'avery.lin@example.com', name: 'Avery Lin', location: 'RED' }];
    const csv = 'Date,Lab,Start,End,Operator\n11/16/2026,Redmond Lab,07:00,12:00,Avery Lin\n11/16/2026,Redmond Lab,12:30,16:30,Avery Lin\n11/16/2026,Redmond Lab,17:00,23:00,Avery Lin\n';
    const plan = planScheduleImport(csv, ops, []);
    expect(plan.add).toHaveLength(2);
    expect(plan.skip.map((x) => x.reason)).toEqual(['Already has two shifts that day (no third shift)']);
  });

  it('the Master List sync skips a third shift and reports it', () => {
    const users = [{ id: 'OP-1', email: 'avery.lin@example.com', name: 'Avery Lin', location: 'RED' }];
    const row = (shift, time) => ({ table: 'tblRedmondSchedule', date: '2026-11-12', shift, time, name: 'Avery Lin', email: 'avery.lin@example.com' });
    const rows = [row('Morning', '7:00 AM - 12:30 PM PT'), row('Afternoon', '12:00 PM - 5:30 PM PT'), row('Night', '5:00 PM - 11:00 PM PT')];
    const p = planSheetSync({ rows, shifts: [], users, skips: [], today: '2026-11-10', labs: [] });
    expect(p.add).toHaveLength(2);
    expect(p.skipped).toEqual([expect.objectContaining({ shift: 'Night', reason: 'third_shift' })]);
    // One already booked by hand that day counts too.
    const byHand = [{ id: 'S-h', date: '2026-11-12', email: 'avery.lin@example.com', start: '09:00', end: '11:00', source: 'app' }];
    const q = planSheetSync({ rows: rows.slice(1), shifts: byHand, users, skips: [], today: '2026-11-10', labs: [] });
    expect(q.add).toHaveLength(1);
    expect(q.skipped[0].reason).toBe('third_shift');
  });
});

describe('demo mode behaves like the Punch flow', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at('12:10', '2026-11-25')); demo.reset(); setDemoActor('tester@example.com'); });

  it('saves a provisional clock-in with its reason, and needs one', () => {
    const me = { type: 'in', name: 'Test Op', email: 'nobody.booked@example.com', location: 'RED', station: 'Robot 1', provisional: true };
    expect(() => demo.punch({ ...me, note: ' ' })).toThrow(/why/);
    const p = demo.punch({ ...me, note: 'Covering for a teammate', template: 'RED-MID', until: at('17:30', '2026-11-25').toISOString() });
    expect(p).toMatchObject({ flag: 'provisional', shiftId: '', note: 'Covering for a teammate', template: 'RED-MID' });
    expect(p.until).toBe(at('17:30', '2026-11-25').toISOString());
    // Already clocked in: the same answer as the flow.
    expect(() => demo.punch({ ...me, note: 'again' })).toThrow(/already clocked in/);
    vi.useRealTimers();
  });
});
