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
export function shiftTimes(r) {
  const start = at(r.date, r.start);
  let end = at(r.date, r.end);
  if (end <= start) end = new Date(end.getTime() + 864e5);
  return { start, end };
}

export const shiftHours = (r) => { const { start, end } = shiftTimes(r); return (end - start) / 36e5; };

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
  // Someone who checked in and forgot to check out still arrived.
  const arrived = new Set([
    ...daySessions.map((s) => s.email),
    ...issues.filter((i) => i.kind === 'noout' && dayKey(i.at) === k).map((i) => i.email),
  ]);
  const rows = shifts.map((r) => {
    const { start, end } = shiftTimes(r);
    const mine = daySessions.filter((s) => s.email === r.email);
    let status;
    if (arrived.has(r.email)) status = mine.some((s) => s.live) ? 'onsite' : 'done';
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
// hasn't clocked in by the end of the grace period, nobody has replaced them yet, and
// there's still more than half an hour of the shift left. Live, the Read flow sends
// these as `openSpots` (no names: only the lab, robot and times). The demo works them
// out from its full schedule.
export function openSpots(data, email, home, now = new Date(), graceMin = GRACE_MIN) {
  const k = dayKey(now);
  const gone = replacedIds(data.schedule);
  const inToday = new Set((data.punches || []).filter((p) => p.type === 'in' && dayKey(new Date(p.ts)) === k).map((p) => p.email));
  if (inToday.has(email)) return [];
  return (data.schedule || [])
    .filter((r) => r.date === k && r.email !== email && !gone.has(r.id) && !inToday.has(r.email) && (!home || (r.location || '') === home))
    .filter((r) => { const t = shiftTimes(r); return now >= new Date(t.start.getTime() + graceMin * 6e4) && now < new Date(t.end.getTime() - 30 * 6e4); })
    .map((r) => ({ shiftId: r.id, location: r.location, station: r.station, start: r.start, end: r.end, template: r.template, date: r.date }));
}
