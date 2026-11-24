import { LOCATIONS, locOf } from './config.js';
import { thirdShiftProblem, conflicts, weeklyLoad } from './rules.js';
import { newPairId, pairOf, shiftTimes } from './schedule.js';
import { mondayOf, parseDay } from './time.js';

// Shift swaps (Spencer Woods, John Uraya and David, 2026-11-23). An operator who
// can't make a booked shift asks for a swap from their page and says who is taking
// it. A scheduler checks it and makes the change (the shift moves to the other
// operator) or declines it. Swaps are fine; last-minute ones are the problem (John),
// and Brian Leong warned a swap button could make them easier. So a swap has to be
// asked for at least 24 hours before the shift starts: later than that the request
// is refused, and the operator talks to their lead (whoever covers can clock in
// without a shift for review). The flows enforce the cutoff too (docs/lotus-flows.md).
//
// Privacy: the operator types the name of who is taking it; Lotus never shows them
// a list of other operators.

export const SWAP_CUTOFF_HOURS = 24;

export const SWAP_STATUS = {
  open: { label: 'Sent to schedulers', tone: 'yellow' },
  done: { label: 'Swapped', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: null },
};

export const normSwap = (x) => ({
  id: String(x.id ?? x.Title ?? ''),
  shiftId: String(x.shiftId ?? x.ShiftID ?? ''),
  date: String(x.date ?? x.Date ?? '').slice(0, 10),
  start: String(x.start ?? x.Start ?? ''),
  end: String(x.end ?? x.End ?? ''),
  location: String(x.location ?? x.Location ?? ''),
  email: String(x.email ?? x.Email ?? '').trim().toLowerCase(),
  name: String(x.name ?? x.Name ?? '').trim(),
  operatorId: String(x.operatorId ?? x.OperatorID ?? ''),
  taker: String(x.taker ?? x.Taker ?? '').trim(),
  takerEmail: String(x.takerEmail ?? x.TakerEmail ?? '').trim().toLowerCase(),
  message: String(x.message ?? x.Message ?? ''),
  status: ['open', 'done', 'declined', 'cancelled'].includes(String(x.status ?? x.Status)) ? String(x.status ?? x.Status) : 'open',
  requestedAt: String(x.requestedAt ?? x.RequestedAt ?? ''),
  hoursBefore: Number(x.hoursBefore ?? x.HoursBefore) || 0,
  resolvedBy: String(x.resolvedBy ?? x.ResolvedBy ?? ''),
  resolvedAt: String(x.resolvedAt ?? x.ResolvedAt ?? ''),
  newShiftId: String(x.newShiftId ?? x.NewShiftID ?? ''),
  note: String(x.note ?? x.Note ?? ''),
});

export const hoursUntil = (shift, now = new Date()) => (shiftTimes(shift).start - now) / 36e5;

/** Can this shift be offered for a swap now? */
export function swapCheck(shift, swaps, now = new Date()) {
  if (!shift) return { allowed: false, reason: 'no_shift' };
  const h = hoursUntil(shift, now);
  if ((swaps || []).some((s) => s.shiftId === shift.id && s.status === 'open')) return { allowed: false, reason: 'pending', hours: h };
  if (h < SWAP_CUTOFF_HOURS) return { allowed: false, reason: 'too_late', hours: h };
  return { allowed: true, hours: h };
}
export const TOO_LATE_TEXT = `Swaps close ${SWAP_CUTOFF_HOURS} hours before the shift. Talk to your lead: whoever covers can clock in without a shift, and a manager reviews it.`;

/**
 * Moving a swapped shift to the operator taking it: the new shift (same day, lab,
 * robot, times and pair) and the partners who need the pair id, or the reason it
 * can't happen. Warnings (weekly limit, a clash) don't stop the scheduler.
 */
export function planSwap(swap, schedule, operators, taker) {
  const shift = (schedule || []).find((r) => r.id === swap.shiftId);
  if (!shift) return { problem: 'That shift is no longer on the schedule.' };
  if (!taker) return { problem: 'Pick who is taking the shift.' };
  if (taker.email === shift.email) return { problem: `${taker.name} already has this shift.` };
  if (taker.active === false) return { problem: `${taker.name} is inactive.` };
  if (taker.location && taker.location !== locOf(shift)) return { problem: `${taker.name} works at ${LOCATIONS.find((l) => l.id === taker.location)?.name || taker.location} only.` };
  const rest = (schedule || []).filter((r) => r.id !== shift.id);
  const pair = shift.pair || (pairOf(schedule, shift).length ? newPairId() : '');
  const next = { date: shift.date, operatorId: taker.id || '', name: taker.name, email: taker.email, location: locOf(shift), station: shift.station || '', template: shift.template || '', start: shift.start, end: shift.end, note: `Swapped from ${shift.name}`, pair, replaces: '', source: 'app' };
  const third = thirdShiftProblem(next, rest);
  if (third) return { problem: third };
  const linked = !shift.pair && pair ? pairOf(schedule, shift).map((r) => ({ ...r, pair })) : [];
  const after = [...rest, { ...next, id: '__swap__' }];
  const warnings = [];
  const load = weeklyLoad(after, mondayOf(parseDay(shift.date))).find((x) => x.email === taker.email);
  if (load?.over) warnings.push(`${taker.name} would be booked ${load.hours.toFixed(1)} hrs that week, over the limit.`);
  if (conflicts(after).some((c) => c.ids.includes('__swap__'))) warnings.push(`${taker.name} already has a shift at that time that day.`);
  return { problem: '', shift, next, linked, warnings };
}
