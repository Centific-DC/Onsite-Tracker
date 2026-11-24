import { CFG } from './config.js';
import { addDays, dayKey } from './time.js';
import { buildSessions } from './hours.js';
import { bookedHours, replacedIds, shiftTimes } from './schedule.js';

// Approaching 40 hours (John Uraya, 2026-11-23): 40 hours a week is where overtime
// starts (California), and the goal is to avoid paying it. The 37-hour scheduling
// flag stays as it is; this looks at the week as it's actually going: the operator's
// own clocked time so far plus the booked shifts still ahead. Over the weekly limit
// (37) they're "near 40"; at 40 or more they'd be in overtime. Nobody is blocked:
// operators see it on their page, staff on Today and Schedule, and the Lotus Hours
// Watch flow emails them once per level per week (docs/lotus-flows.md §6b).
export const OVERTIME_HOURS = () => CFG.overtimeHours ?? 40;

/**
 * One operator's week so far: hours on the clock (their own time, every clock-in
 * including provisional ones and the one running now) plus booked shifts that
 * haven't started yet.
 */
export function weekOutlook(data, email, wk0, now = new Date()) {
  const from = dayKey(wk0), to = dayKey(addDays(wk0, 7));
  const { sessions } = buildSessions((data.punches || []).filter((p) => p.email === email), now);
  const worked = sessions.filter((s) => s.day >= from && s.day < to).reduce((a, s) => a + s.hours, 0);
  const gone = replacedIds(data.schedule);
  const ahead = bookedHours((data.schedule || []).filter((r) => r.email === email && r.date >= from && r.date < to && !gone.has(r.id) && shiftTimes(r).start > now));
  const total = worked + ahead;
  return { email, worked, ahead, total, level: levelOf(total) };
}

export const levelOf = (total, cap = CFG.weeklyHourCap, ot = OVERTIME_HOURS()) => (total >= ot - 1e-9 ? 'over' : total > cap + 1e-9 ? 'near' : '');
export const LEVEL = {
  near: { label: 'Near 40 hrs', tone: 'warn' },
  over: { label: '40 hrs or more', tone: 'bad' },
};

/** Everyone whose week is over the weekly limit, highest first. */
export function hoursWatch(data, wk0, now = new Date()) {
  const from = dayKey(wk0), to = dayKey(addDays(wk0, 7));
  const emails = new Set([
    ...(data.schedule || []).filter((r) => r.date >= from && r.date < to).map((r) => r.email),
    ...(data.punches || []).filter((p) => { const k = dayKey(new Date(p.ts)); return k >= from && k < to; }).map((p) => p.email),
  ]);
  const names = new Map([...(data.operators || []).map((o) => [o.email, o.name]), ...(data.schedule || []).map((r) => [r.email, r.name])]);
  return [...emails]
    .map((e) => ({ ...weekOutlook(data, e, wk0, now), name: names.get(e) || e }))
    .filter((x) => x.level)
    .sort((a, b) => b.total - a.total);
}

/** What adding `hours` more would do to an operator's week (an open spot, a provisional clock-in). */
export const wouldReach = (outlook, hours) => levelOf(outlook.total + hours);
