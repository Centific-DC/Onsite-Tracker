import { dayKey, parseDay } from './time.js';
import { robotTitle } from './robots.js';

// Minutes after a shift's start before a missing person counts as "not here yet".
export const GRACE_MIN = 15;

const at = (date, hm) => {
  const [h, m] = hm.split(':').map(Number);
  const d = parseDay(date);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};

// A shift's start and end as Dates. An end at or before the start runs past midnight.
// Review's day rows already carry them as Dates.
export function shiftTimes(r) {
  if (r.start instanceof Date) return { start: r.start, end: r.end };
  const start = at(r.date, r.start);
  let end = at(r.date, r.end);
  if (end <= start) end = new Date(end.getTime() + 864e5);
  return { start, end };
}

export const shiftHours = (r) => { const { start, end } = shiftTimes(r); return (end - start) / 36e5; };

// Booked hours for a set of shifts, each operator's overlapping shifts merged: a
// back-to-back double on the overlapping Redmond templates (Morning 7:00–12:30, then
// Afternoon 12:00–17:30) is 10.5 hrs, not 11.
export function bookedHours(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const { start, end } = shiftTimes(r);
    if (!by.has(r.email)) by.set(r.email, []);
    by.get(r.email).push([+start, +end]);
  }
  let total = 0;
  for (const iv of by.values()) {
    iv.sort((a, b) => a[0] - b[0]);
    let cur = null;
    for (const [s, e] of iv) {
      if (cur && s <= cur[1]) cur[1] = Math.max(cur[1], e);
      else { if (cur) total += cur[1] - cur[0]; cur = [s, e]; }
    }
    if (cur) total += cur[1] - cur[0];
  }
  return total / 36e5;
}

// Back-to-back doubles (Kate Young and David, 2026-11-13). Doubles happen when the
// scheduling team approves them. Each shift stays its own record so billing is
// itemized by shift: the operator clocks out of the first shift and straight into
// the next, and that handover is never flagged as leaving early or arriving late.
// A shift is back to back with the operator's next one when that one starts no
// more than SWITCH_GAP_MIN after this one ends (or overlaps it, as the Redmond
// templates do by 30 minutes).
export const SWITCH_GAP_MIN = 5;
const isBackToBack = (a, b) => {
  const x = shiftTimes(a), y = shiftTimes(b);
  return y.start > x.start && y.start <= new Date(+x.end + SWITCH_GAP_MIN * 6e4);
};
/** The same operator's next shift, when it follows `shift` back to back. */
export function nextBackToBack(schedule, shift) {
  if (!shift?.id) return null;
  const gone = replacedIds(schedule);
  return (schedule || [])
    .filter((r) => r.email === shift.email && r.id !== shift.id && !gone.has(r.id) && isBackToBack(shift, r))
    .sort((a, b) => shiftTimes(a).start - shiftTimes(b).start)[0] || null;
}
/** The same operator's shift that `shift` follows back to back. */
export function prevBackToBack(schedule, shift) {
  if (!shift?.id) return null;
  const gone = replacedIds(schedule);
  return (schedule || [])
    .filter((r) => r.email === shift.email && r.id !== shift.id && !gone.has(r.id) && isBackToBack(r, shift))
    .sort((a, b) => shiftTimes(b).start - shiftTimes(a).start)[0] || null;
}

export const STATUS = {
  onsite: { label: 'On site', tone: 'on' },
  done: { label: 'Worked', tone: 'muted' },
  upcoming: { label: 'Due', tone: 'muted' },
  late: { label: 'Not here yet', tone: 'warn' },
  noshow: { label: 'No-show', tone: 'bad' },
};

// One day's plan against what happened: every scheduled shift with a status, plus
// check-ins that nobody scheduled.
export function dayPlan(schedule, sessions, issues, day, now = new Date()) {
  const k = dayKey(day);
  const shifts = (schedule || []).filter((r) => r.date === k);
  const daySessions = sessions.filter((s) => s.day === k);
  const noouts = issues.filter((i) => i.kind === 'noout' && dayKey(i.at) === k);
  // Each shift has its own status, so an operator on a double who works the first
  // shift and skips the second shows as missing for the second. A clock-in names
  // its shift; one from before shift ids (no shiftId) counts for the whole day.
  const forShift = (x, r) => x.email === r.email && (x.shiftId ? x.shiftId === r.id : true);
  const rows = shifts.map((r) => {
    const { start, end } = shiftTimes(r);
    const mine = daySessions.filter((s) => forShift(s, r));
    // Someone who checked in and forgot to check out still arrived.
    const arrived = mine.length > 0 || noouts.some((i) => forShift(i, r));
    let status;
    if (arrived) status = mine.some((s) => s.live) ? 'onsite' : 'done';
    else if (now < new Date(start.getTime() + GRACE_MIN * 6e4)) status = 'upcoming';
    else if (now < end) status = 'late';
    else status = 'noshow';
    const elsewhere = r.station && mine.length && !mine.some((s) => s.station === r.station) ? mine[0].station : '';
    return { ...r, startAt: start, endAt: end, status, sessions: mine, elsewhere };
  }).sort((a, b) => a.station.localeCompare(b.station) || a.startAt - b.startAt || a.name.localeCompare(b.name));
  const planned = new Set(shifts.map((r) => r.email));
  // Only a day with a schedule can have someone off it; an unplanned day would flag everyone.
  const unscheduled = shifts.length ? [...new Map(daySessions.filter((s) => !planned.has(s.email)).map((s) => [s.email, s])).values()] : [];
  return { rows, unscheduled };
}

// Robots that need someone right now: a scheduled person whose shift is underway
// hasn't arrived, and the people on site or still due (a backfill counts) don't make
// a full pair.
export function backfills(rows, pairSize = 2) {
  const out = [];
  const gone = replacedIds(rows);
  const live = rows.filter((r) => !gone.has(r.id));
  const seen = new Set();
  for (const r of live) {
    if (seen.has(r.id)) continue;
    const mine = [r, ...live.filter((x) => samePair(x, r))];
    mine.forEach((x) => seen.add(x.id));
    const missing = mine.filter((x) => x.status === 'late');
    const here = mine.filter((x) => x.status === 'onsite').length;
    const covering = here + mine.filter((x) => x.status === 'upcoming').length;
    if (missing.length && covering < pairSize) out.push({ station: r.station, location: r.location, missing, here, planned: mine.length - mine.filter((x) => x.status === 'done' || x.status === 'noshow').length });
  }
  return out;
}

// How many people each robot has booked on a day. A robot with some shifts but fewer
// than a full pair is understaffed; a robot with none isn't running that day.
export function coverage(schedule, k, station, pairSize = 2) {
  const rows = (schedule || []).filter((r) => r.date === k && r.station === station);
  return { rows, count: new Set(rows.map((r) => r.email)).size, short: rows.length > 0 && new Set(rows.map((r) => r.email)).size < pairSize };
}

// Start time for a backfill added now: the next quarter hour, or the shift's own
// start if that's still ahead.
export function backfillStart(row, now = new Date()) {
  if (row.startAt > now) return row.start;
  const m = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Check-ins (IN taps) by someone with no shift that day, on days that have a schedule.
export function unscheduledIns(schedule, punches) {
  const rows = schedule || [];
  const days = new Set(rows.map((r) => r.date));
  const booked = new Set(rows.map((r) => `${r.date}|${r.email}`));
  return punches.filter((p) => {
    const k = dayKey(new Date(p.ts));
    return p.type === 'in' && days.has(k) && !booked.has(`${k}|${p.email}`);
  });
}

// Pairs. A shift can name its pair (`pair`, shared by both partners) so the robot is
// optional: operators still know who they work with. A shift without a pair id pairs
// the old way, with whoever is booked on the same robot for more than the hour-long
// handover. A shift that someone else's shift `replaces` (a no-show who was swapped
// out) drops out of its pair.
const HANDOVER_MIN = 60;
export const newPairId = () => `P-${Math.random().toString(36).slice(2, 10)}`;
export const replacedIds = (schedule) => new Set((schedule || []).map((r) => r.replaces).filter(Boolean));
const overlapMin = (a, b) => { const x = shiftTimes(a), y = shiftTimes(b); return (Math.min(x.end, y.end) - Math.max(x.start, y.start)) / 6e4; };
export function samePair(a, b) {
  if (!a || !b || a.id === b.id || a.email === b.email || a.date !== b.date) return false;
  if (a.pair || b.pair) return !!a.pair && a.pair === b.pair;
  return !!a.station && a.station === b.station && (a.location || '') === (b.location || '') && overlapMin(a, b) > HANDOVER_MIN;
}
/** The other shifts in `shift`'s pair, leaving out anyone who was replaced. */
export function pairOf(schedule, shift) {
  const gone = replacedIds(schedule);
  return (schedule || []).filter((r) => !gone.has(r.id) && samePair(r, shift));
}
/** Which robot a shift is on, for people to read. */
export const robotLabel = (r) => (r?.station ? robotTitle(r.station) : 'Any robot');

// Who an operator works with on a shift. Live, an operator's Read holds only their
// own shifts, so the flow sends just their partners' names in `partners`; staff (and
// the demo) see every shift, so the names come from the schedule itself. Names only,
// never anyone else's times, hours or clock-ins.
export function partnersOf(data, shift) {
  if (!shift?.id) return [];
  const fromSchedule = pairOf(data.schedule, shift).map((r) => r.name);
  const sent = (data.partners || []).filter((p) => p.shiftId === shift.id).map((p) => p.name);
  return [...new Set([...fromSchedule, ...sent].filter(Boolean))];
}

// Open spots an operator could fill right now, in their home lab: a booked operator
// hasn't clocked in to that shift by the end of the grace period, nobody has replaced them yet, and
// there's still more than half an hour of the shift left. Live, the Read flow sends
// these as `openSpots` (no names: only the lab, robot and times). The demo works them
// out from its full schedule.
export function openSpots(data, email, home, now = new Date(), graceMin = GRACE_MIN) {
  const k = dayKey(now);
  const gone = replacedIds(data.schedule);
  const insToday = (data.punches || []).filter((p) => p.type === 'in' && dayKey(new Date(p.ts)) === k);
  if (insToday.some((p) => p.email === email)) return [];
  // Per shift: someone on a double who worked the first shift and skipped the second
  // leaves the second open.
  const cameFor = (r) => insToday.some((p) => p.email === r.email && (p.shiftId ? p.shiftId === r.id : true));
  return (data.schedule || [])
    .filter((r) => r.date === k && r.email !== email && !gone.has(r.id) && !cameFor(r) && (!home || (r.location || '') === home))
    .filter((r) => { const t = shiftTimes(r); return now >= new Date(t.start.getTime() + graceMin * 6e4) && now < new Date(t.end.getTime() - 30 * 6e4); })
    .map((r) => ({ shiftId: r.id, location: r.location, station: r.station, start: r.start, end: r.end, template: r.template, date: r.date }));
}
