// Missed clock-ins and outs: requests, admin corrections, and the warning ladder.
// Times are Pacific (npm test sets TZ).
import { describe, expect, it } from 'vitest';
import { approvedRows, clockSpan, reviewDays } from '../src/lib/review.js';
import { RESET_DAYS, isLateReport, nextSteps, reasonsFor, standing, stepText } from '../src/lib/strikes.js';
import { demo, setDemoActor } from '../src/lib/api.js';
import { addDays, parseDay } from '../src/lib/time.js';

const DAY = '2026-11-02';
const MON = parseDay(DAY);
const at = (hm, day = DAY) => { const d = parseDay(day); const [h, m] = hm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const AFTER = at('23:59', '2026-11-03');
const quinn = { id: 'OP-0010', name: 'Quinn Hale', email: 'quinn.hale@example.com', location: 'RED', roles: ['operator'] };
const shift = { id: 'S-1', date: DAY, name: quinn.name, email: quinn.email, operatorId: quinn.id, location: 'RED', station: 'Robot 1', start: '07:00', end: '12:30', template: '', note: '' };
const base = (over = {}) => ({ operators: [quinn], punches: [], schedule: [shift], resolutions: [], approvals: [], corrections: [], strikes: [], ...over });
const dayOf = (d) => reviewDays(d, MON, addDays(MON, 2), AFTER).find((x) => x.email === quinn.email);
const strike = (daysAgo, now, extra = {}) => ({ id: `K-${daysAgo}`, email: quinn.email, date: DAY, reason: 'missed_in', at: addDays(now, -daysAgo).toISOString(), voided: false, ...extra });

describe('the warning ladder', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('goes soft warning, then strikes 1 to 3, and stays at strike 3', () => {
    expect([1, 2, 3, 4, 5].map(stepText)).toEqual(['Soft warning', 'Strike 1 of 3', 'Strike 2 of 3', 'Strike 3 of 3', 'Strike 3 of 3']);
    const s = standing([strike(9, now), strike(6, now), strike(3, now), strike(1, now)], quinn.email, now);
    expect(s.count).toBe(4);
    expect(s.step.label).toBe('Strike 3');
    expect(s.step.note).toMatch(/PM/);
  });
  it(`clears after ${RESET_DAYS} days with no new miss, and restarts from a soft warning`, () => {
    expect(standing([strike(31, now)], quinn.email, now).count).toBe(0);
    const s = standing([strike(80, now), strike(70, now), strike(5, now)], quinn.email, now);
    expect(s.count).toBe(1);
    expect(s.text).toBe('Soft warning');
    expect(s.list.map((x) => x.count)).toEqual([1, 2, 1]);
  });
  it('never counts a cancelled one, but keeps it in the history', () => {
    const s = standing([strike(3, now, { voided: true, voidReason: 'Wi-Fi down' })], quinn.email, now);
    expect(s.count).toBe(0);
    expect(s.list).toHaveLength(1);
  });
  it('only counts the operator’s own', () => {
    expect(standing([strike(1, now, { email: 'someone@example.com' })], quinn.email, now).count).toBe(0);
  });
  it('previews what a request would bring them to', () => {
    expect(nextSteps([strike(20, now)], quinn.email, 2, now).map((x) => x.text)).toEqual(['Strike 1 of 3', 'Strike 2 of 3']);
  });
});

describe('what counts', () => {
  it('a request more than 24 hours after the shift also counts as a late report', () => {
    expect(isLateReport(shift, at('12:00', '2026-11-03').toISOString())).toBe(false);
    expect(isLateReport(shift, at('13:00', '2026-11-03').toISOString())).toBe(true);
    expect(reasonsFor({ missed: 'out', requestedAt: at('15:00').toISOString() }, shift)).toEqual(['missed_out']);
    expect(reasonsFor({ missed: 'both', requestedAt: at('09:00', '2026-11-05').toISOString() }, shift)).toEqual(['missed_both', 'late_report']);
  });
});

describe('a corrected shift', () => {
  const fix = { id: 'C-1', email: quinn.email, name: quinn.name, date: DAY, shiftId: 'S-1', missed: 'both', status: 'approved', timeIn: at('07:00').toISOString(), timeOut: at('12:30').toISOString(), partnerConfirmed: true, note: 'Taylor confirmed', resolvedBy: 'admin@example.com' };
  it('turns a no-show into the hours the admin set, with no open flag', () => {
    const before = dayOf(base());
    expect(before.flags.map((f) => f.code)).toEqual(['no_show']);
    expect(before.computed).toBe(0);
    const after = dayOf(base({ corrections: [fix] }));
    expect(after.flags.map((f) => f.code)).toEqual(['corrected']);
    expect(after.openFlags).toBe(0);
    expect(after.computed).toBeCloseTo(5.5);
    expect(after.recorded).toBe(0); // the clock record itself never changes
    expect(after.status).toBe('ready');
  });
  it('replaces a missing clock-out and goes into the approved export with its times', () => {
    const punches = [{ id: 'P1', ts: at('07:02').toISOString(), name: quinn.name, email: quinn.email, operatorId: quinn.id, type: 'in', station: 'Robot 1', location: 'RED', shiftId: 'S-1' }];
    const d = base({ punches, corrections: [{ ...fix, missed: 'out', timeIn: at('07:02').toISOString(), timeOut: at('12:30').toISOString() }] });
    const day = dayOf(d);
    expect(day.flags.some((f) => f.code === 'no_clockout')).toBe(false);
    expect(clockSpan(day)).toEqual({ time_in: '07:02', time_out: '12:30' });
    const approved = { ...d, approvals: [{ email: quinn.email, operatorId: quinn.id, date: DAY, status: 'approved', hours: day.computed, computed: day.computed, note: '', by: 'a', at: AFTER.toISOString() }] };
    expect(approvedRows(approved, MON, addDays(MON, 2), AFTER)[0].time_out).toBe('12:30');
  });
  it('holds the day while a request is open', () => {
    const day = dayOf(base({ corrections: [{ ...fix, status: 'open', timeIn: '', timeOut: '' }] }));
    expect(day.requests).toHaveLength(1);
    expect(day.status).toBe('needs_review');
  });
});

describe('demo flow', () => {
  it('logs a request, corrects it and adds the warning and late-report strike, once', () => {
    demo.reset();
    const d = demo.load();
    const r = d.corrections.find((c) => c.status === 'open' && c.missed === 'both');
    expect(r).toBeTruthy();
    const quinnBefore = standing(d.strikes, r.email).count;
    setDemoActor('admin@example.com');
    const shiftRow = d.schedule.find((x) => x.id === r.shiftId);
    const out = demo.resolveCorrection({ id: r.id, status: 'approved', timeIn: at(shiftRow.start, shiftRow.date).toISOString(), timeOut: at(shiftRow.end, shiftRow.date).toISOString(), partnerConfirmed: true, note: 'Taylor confirmed', counts: true });
    expect(out.strikes.map((s) => s.reason)).toEqual(['missed_both', 'late_report']);
    expect(standing(demo.load().strikes, r.email).count).toBe(quinnBefore + 2);
    expect(() => demo.resolveCorrection({ id: r.id, status: 'declined', note: 'x' })).toThrow(/already/);
    expect(demo.load().audit.some((a) => a.action === 'correction_resolve')).toBe(true);
  });
  it('a correction that doesn’t count needs a reason and adds nothing', () => {
    demo.reset();
    const r = demo.load().corrections.find((c) => c.status === 'open' && c.missed === 'out');
    const s = demo.load().schedule.find((x) => x.id === r.shiftId);
    const body = { id: r.id, status: 'approved', timeIn: at(s.start, s.date).toISOString(), timeOut: at(s.end, s.date).toISOString(), note: 'ok', counts: false };
    expect(() => demo.resolveCorrection(body)).toThrow(/doesn’t count/);
    expect(demo.resolveCorrection({ ...body, noCountReason: 'Lotus was down' }).strikes).toEqual([]);
  });
  it('an operator can only ask about their own shift, once', () => {
    demo.reset();
    const d = demo.load();
    const mine = d.schedule.find((x) => x.name === 'Avery Lin' && new Date(`${x.date}T${x.end}`) < new Date());
    setDemoActor(mine.email);
    const other = d.schedule.find((x) => x.email !== mine.email);
    expect(() => demo.requestCorrection({ shiftId: other.id, missed: 'in', message: 'x' })).toThrow(/isn’t yours/);
    const c = demo.requestCorrection({ shiftId: mine.id, missed: 'in', message: 'Forgot' });
    expect(c.status).toBe('open');
    expect(() => demo.requestCorrection({ shiftId: mine.id, missed: 'in', message: 'again' })).toThrow(/already/);
  });
  it('cancelling a strike needs a reason and keeps it', () => {
    demo.reset();
    const st = demo.load().strikes.find((x) => !x.voided);
    expect(() => demo.voidStrike(st.id, ' ')).toThrow();
    expect(demo.voidStrike(st.id, 'Scheduler error').voided).toBe(true);
    expect(demo.load().strikes.find((x) => x.id === st.id).voidReason).toBe('Scheduler error');
  });
});
