// Shift swaps with a 24-hour cutoff, and the approaching-40-hours notice (2026-11-23
// meeting: Spencer Woods, John Uraya, David). Times are Pacific. Synthetic people only.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWAP_CUTOFF_HOURS, normSwap, planSwap, swapCheck } from '../src/lib/swaps.js';
import { hoursWatch, levelOf, weekOutlook, wouldReach } from '../src/lib/overtime.js';
import { demo, setDemoActor } from '../src/lib/api.js';
import { parseDay } from '../src/lib/time.js';

const at = (day, hm) => { const d = parseDay(day); const [h, m] = hm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const avery = { id: 'OP-1', email: 'avery@example.com', name: 'Avery Lin', location: 'RED' };
const sky = { id: 'OP-2', email: 'sky@example.com', name: 'Sky Patel', location: 'RED' };
const alex = { id: 'OP-3', email: 'alex@example.com', name: 'Alex Moreno', location: 'MTV' };
const ops = [avery, sky, alex];
const sh = (id, who, date, start, end, extra = {}) => ({ id, date, email: who.email, name: who.name, operatorId: who.id, location: 'RED', station: 'Robot 1', template: '', start, end, pair: '', replaces: '', ...extra });

describe('swap requests: the 24-hour cutoff', () => {
  const S = sh('S-1', avery, '2026-11-26', '17:00', '23:00');
  it('is open 24 hours or more before the shift', () => {
    expect(swapCheck(S, [], at('2026-11-25', '16:59'))).toMatchObject({ allowed: true });
    expect(swapCheck(S, [], at('2026-11-25', '17:00')).allowed).toBe(true);
  });
  it('is refused under 24 hours', () => {
    expect(SWAP_CUTOFF_HOURS).toBe(24);
    expect(swapCheck(S, [], at('2026-11-25', '17:01'))).toMatchObject({ allowed: false, reason: 'too_late' });
    expect(swapCheck(S, [], at('2026-11-26', '18:00')).reason).toBe('too_late');
  });
  it('one open request per shift', () => {
    expect(swapCheck(S, [{ shiftId: 'S-1', status: 'open' }], at('2026-11-24', '09:00')).reason).toBe('pending');
    expect(swapCheck(S, [{ shiftId: 'S-1', status: 'declined' }], at('2026-11-24', '09:00')).allowed).toBe(true);
  });
  it('reads the flow’s rows', () => {
    expect(normSwap({ Title: 'W-1', ShiftID: 'S-1', Email: 'A@x.com', Status: 'done', HoursBefore: '52.5', Taker: ' Sky ' })).toMatchObject({ id: 'W-1', email: 'a@x.com', status: 'done', hoursBefore: 52.5, taker: 'Sky' });
  });
});

describe('making the change', () => {
  const S = sh('S-1', avery, '2026-11-26', '17:00', '23:00');
  const P = sh('S-2', { ...ops[0], email: 'pat@example.com', name: 'Pat Q' }, '2026-11-26', '17:00', '23:00');
  const swap = { shiftId: 'S-1', email: avery.email, name: avery.name };
  it('moves the shift, keeping the pair', () => {
    const p = planSwap(swap, [S, P], ops, sky);
    expect(p.problem).toBe('');
    expect(p.next).toMatchObject({ email: sky.email, date: '2026-11-26', start: '17:00', end: '23:00', station: 'Robot 1', note: 'Swapped from Avery Lin' });
    expect(p.next.pair).toMatch(/^P-/);
    expect(p.linked.map((r) => r.id)).toEqual(['S-2']);
    expect(p.linked[0].pair).toBe(p.next.pair);
  });
  it('refuses the other lab, the same person, and a third shift', () => {
    expect(planSwap(swap, [S], ops, alex).problem).toMatch(/Mountain View/);
    expect(planSwap(swap, [S], ops, avery).problem).toMatch(/already has this shift/);
    const two = [sh('A', sky, '2026-11-26', '07:00', '12:30'), sh('B', sky, '2026-11-26', '12:00', '17:30')];
    expect(planSwap(swap, [S, ...two], ops, sky).problem).toMatch(/third shift/);
    expect(planSwap({ ...swap, shiftId: 'gone' }, [S], ops, sky).problem).toMatch(/no longer/);
  });
});

describe('demo mode behaves like the Corrections flow', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at('2026-11-24', '09:00')); demo.reset(); });
  it('asks, refuses late, and moves the shift', () => {
    const d = demo.load();
    const later = d.schedule.find((r) => +at(r.date, r.start) - Date.now() > 48 * 36e5 && !d.swaps.some((x) => x.shiftId === r.id));
    const soon = d.schedule.find((r) => { const h = (+at(r.date, r.start) - Date.now()) / 36e5; return h > 0 && h < 20; });
    setDemoActor(later.email);
    expect(() => demo.requestSwap({ shiftId: later.id, taker: ' ' })).toThrow(/who is taking/);
    const w = demo.requestSwap({ shiftId: later.id, taker: 'Someone', message: 'x' });
    expect(w).toMatchObject({ status: 'open', shiftId: later.id });
    expect(() => demo.requestSwap({ shiftId: later.id, taker: 'Someone' })).toThrow(/already/);
    if (soon) { setDemoActor(soon.email); expect(() => demo.requestSwap({ shiftId: soon.id, taker: 'X' })).toThrow(/24 hours/); }
    setDemoActor('scheduler@example.com');
    const taker = d.operators.find((o) => o.email !== later.email && o.location === later.location && !d.schedule.some((r) => r.email === o.email && r.date === later.date));
    const out = demo.resolveSwap({ id: w.id, status: 'done', takerEmail: taker.email });
    expect(out.swap.status).toBe('done');
    const after = demo.load();
    expect(after.schedule.some((r) => r.id === later.id)).toBe(false);
    expect(after.schedule.find((r) => r.id === out.shift.id)).toMatchObject({ email: taker.email, date: later.date, start: later.start });
    vi.useRealTimers();
  });
});

describe('approaching 40 hours', () => {
  const MON = '2026-11-23';
  const wk0 = parseDay(MON);
  const days = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
  const punchesFor = (who, n) => days.slice(0, n).flatMap((day, i) => [
    { id: `i${i}`, ts: at(day, '07:00').toISOString(), email: who.email, name: who.name, type: 'in', shiftId: `S${i}`, flag: '' },
    { id: `o${i}`, ts: at(day, '13:00').toISOString(), email: who.email, name: who.name, type: 'out', shiftId: `S${i}`, flag: '' },
  ]);

  it('levels: over 37 is near, 40 or more is overtime', () => {
    expect(levelOf(37)).toBe('');
    expect(levelOf(37.5)).toBe('near');
    expect(levelOf(40)).toBe('over');
  });

  it('counts clocked time plus booked shifts still ahead', () => {
    // Three 6-hour days clocked (18), four 6-hour shifts still booked (24) = 42.
    const schedule = days.map((d, i) => sh(`S${i}`, avery, d, '07:00', '13:00'));
    const data = { schedule, punches: punchesFor(avery, 3), operators: ops };
    const o = weekOutlook(data, avery.email, wk0, at('2026-11-25', '20:00'));
    expect(o.worked).toBeCloseTo(18);
    expect(o.ahead).toBeCloseTo(24);
    expect(o.level).toBe('over');
    // A booked shift they didn't work doesn't count, nor one replaced by someone else.
    const replaced = [...schedule, sh('R', sky, days[6], '07:00', '13:00', { replaces: 'S6' })];
    expect(weekOutlook({ ...data, schedule: replaced }, avery.email, wk0, at('2026-11-25', '20:00')).total).toBeCloseTo(36);
  });

  it('lists only people over the limit, highest first', () => {
    const schedule = [...days.map((d, i) => sh(`S${i}`, avery, d, '07:00', '13:00')), sh('K', sky, days[4], '07:00', '13:00')];
    const w = hoursWatch({ schedule, punches: [], operators: ops }, wk0, at(MON, '06:00'));
    expect(w.map((x) => x.name)).toEqual(['Avery Lin']);
    expect(w[0].total).toBeCloseTo(42);
  });

  it('tells an operator when one more shift would reach 40', () => {
    expect(wouldReach({ total: 35 }, 5.5)).toBe('over');
    expect(wouldReach({ total: 30 }, 5.5)).toBe('');
  });
});
