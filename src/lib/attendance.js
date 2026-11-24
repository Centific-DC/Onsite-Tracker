import { dayKey } from './time.js';
import { replacedIds, shiftTimes } from './schedule.js';
import { graceFor } from './rules.js';
import { LOCATIONS } from './config.js';

// Minutes after a shift's start when a clock-in counts as a late arrival.
export const LATE_AFTER_MIN = 5;

// Where `now` sits against a shift: before clock-in opens, inside the grace window
// before the start, during the shift, or after it ended.
export function clockWindow(shift, now = new Date()) {
  const { start, end } = shiftTimes(shift);
  const grace = graceFor(shift);
  const opensAt = new Date(start.getTime() - grace * 6e4);
  if (now < opensAt) return { state: 'early', start, end, opensAt, grace };
  if (now < start) return { state: 'grace', start, end, opensAt, grace, graceUsed: Math.ceil((start - now) / 6e4) };
  if (now < end) return { state: 'open', start, end, opensAt, grace, lateMin: Math.floor((now - start) / 6e4) };
  return { state: 'over', start, end, opensAt, grace };
}

// Today's shifts for one operator, earliest first, each with its window and
// whether it has already been clocked into.
export function myShiftsToday(schedule, punches, email, now = new Date()) {
  const k = dayKey(now);
  const used = new Set(punches.filter((p) => p.email === email && p.type === 'in' && p.shiftId).map((p) => p.shiftId));
  return (schedule || [])
    .filter((r) => r.email === email && r.date === k)
    .map((r) => ({ ...r, window: clockWindow(r, now), clocked: used.has(r.id) }))
    .sort((a, b) => a.window.start - b.window.start);
}

// The shift a clock-in tap right now belongs to: the first one not clocked into
// that hasn't ended. Null when the operator has nothing left today.
export function nextShift(schedule, punches, email, now = new Date()) {
  return myShiftsToday(schedule, punches, email, now).find((r) => !r.clocked && r.window.state !== 'over') || null;
}

// What a clock-in tap is allowed to do: block it before the window opens, warn
// and record grace inside it, or go ahead. With no shift there's nothing to clock
// into (user rule, 2026-11-06): an open spot books a shift first.
// `ctx` ({ schedule, punches, email }) also applies the no-triples rule.
export function clockInCheck(shift, now = new Date(), ctx = null) {
  if (!shift) return { allowed: false, reason: 'no_shift' };
  if (ctx && workedShifts(ctx.punches, ctx.email, shift.date).filter((x) => x !== shift.id).length >= MAX_SHIFTS_PER_DAY) return { allowed: false, reason: 'third_shift' };
  const w = clockWindow(shift, now);
  if (w.state === 'early') return { allowed: false, reason: 'early', window: w };
  if (w.state === 'over') return { allowed: false, reason: 'over', window: w };
  return { allowed: true, grace: w.state === 'grace' ? w.graceUsed : 0, late: w.state === 'open' && w.lateMin >= LATE_AFTER_MIN, window: w };
}

// Doubles are fine, a third shift in one day isn't (Spencer, John and David,
// 2026-11-23): nobody is booked for, or clocks in to, a third shift.
export const MAX_SHIFTS_PER_DAY = 2;
export const THIRD_SHIFT_TEXT = 'You already have two shifts today. A third shift in one day isn’t allowed.';

// The shifts an operator clocked in to on day `k` (by clock-in time): one entry per
// booked shift (its id), plus one per provisional clock-in (its punch id).
export function workedShifts(punches, email, k) {
  return [...new Set((punches || [])
    .filter((p) => p.email === email && p.type === 'in' && dayKey(new Date(p.ts)) === k)
    .map((p) => (p.flag !== 'provisional' && p.shiftId) || p.id))];
}

// Shifts that fill an operator's day `k`: booked ones they worked or can still work
// (not replaced by someone else, and not over without a clock-in), plus provisional
// clock-ins. A provisional clock-in is refused once this reaches two.
export function dayShifts(schedule, punches, email, k, now = new Date()) {
  const gone = replacedIds(schedule);
  const worked = new Set(workedShifts(punches, email, k));
  const booked = (schedule || []).filter((r) => r.email === email && r.date === k && !gone.has(r.id) && (worked.has(r.id) || now < shiftTimes(r).end)).map((r) => r.id);
  return [...new Set([...booked, ...worked])];
}

// The lab shift a provisional clock-in at `at` belongs to: the latest one already
// started (12:10 at Redmond is the Afternoon, not the last minutes of the Morning),
// else the next one starting within the hour. Null late at night, when no shift runs.
export const PROVISIONAL_LEAD_MIN = 60;
export function provisionalSlot(location, at = new Date()) {
  const L = LOCATIONS.find((l) => l.id === location);
  if (!L) return null;
  const k = dayKey(at);
  const all = [k, dayKey(new Date(+at - 864e5))].flatMap((date) => L.templates.map((t) => ({ template: t, date, ...shiftTimes({ date, start: t.start, end: t.end }) })));
  const started = all.filter((x) => x.start <= at && at < x.end).sort((a, b) => b.start - a.start)[0];
  if (started) return started;
  return all.filter((x) => x.start > at && +x.start - +at <= PROVISIONAL_LEAD_MIN * 6e4).sort((a, b) => a.start - b.start)[0] || null;
}

// Whether an operator can clock in provisionally right now: only with no booked shift
// to clock into now, not while clocked in, and never as a third shift that day.
export function provisionalCheck({ schedule, punches, email }, now = new Date()) {
  const next = nextShift(schedule, punches, email, now);
  if (next && next.window.state !== 'early') return { allowed: false, reason: 'has_shift', shift: next };
  if (dayShifts(schedule, punches, email, dayKey(now), now).length >= MAX_SHIFTS_PER_DAY) return { allowed: false, reason: 'third_shift' };
  return { allowed: true };
}
