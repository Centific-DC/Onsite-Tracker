import { dayKey } from './time.js';
import { shiftTimes } from './schedule.js';
import { graceFor } from './rules.js';

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
// and record grace inside it, or go ahead. With no shift it goes through, flagged.
export function clockInCheck(shift, now = new Date()) {
  if (!shift) return { allowed: true, unscheduled: true, grace: 0 };
  const w = clockWindow(shift, now);
  if (w.state === 'early') return { allowed: false, reason: 'early', window: w };
  if (w.state === 'over') return { allowed: false, reason: 'over', window: w };
  return { allowed: true, grace: w.state === 'grace' ? w.graceUsed : 0, late: w.state === 'open' && w.lateMin >= LATE_AFTER_MIN, window: w };
}
