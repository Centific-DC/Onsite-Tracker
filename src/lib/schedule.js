import { dayKey, parseDay } from './time.js';

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
    const elsewhere = mine.length && !mine.some((s) => s.station === r.station) ? mine[0].station : '';
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
  for (const station of new Set(rows.map((r) => r.station))) {
    const mine = rows.filter((r) => r.station === station);
    const missing = mine.filter((r) => r.status === 'late');
    const here = mine.filter((r) => r.status === 'onsite').length;
    const covering = here + mine.filter((r) => r.status === 'upcoming').length;
    if (missing.length && covering < pairSize) out.push({ station, missing, here, planned: mine.length - mine.filter((r) => r.status === 'done' || r.status === 'noshow').length });
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

// Who an operator works with on a shift: the other operators booked on the same
// robot for at least half of it (so the half-hour handover between shifts doesn't count). Live, an operator's Read holds only their own shifts,
// so the flow sends just their partners' names in `partners`; staff (and the demo)
// see every shift, so the names come from the schedule itself. Names only, never
// anyone else's times, hours or clock-ins.
export function partnersOf(data, shift) {
  if (!shift?.id) return [];
  const { start, end } = shiftTimes(shift);
  const loc = shift.location || '';
  const fromSchedule = (data.schedule || [])
    .filter((r) => r.id !== shift.id && r.email !== shift.email && r.station === shift.station && (r.location || '') === loc)
    .filter((r) => { const t = shiftTimes(r); return Math.min(end, t.end) - Math.max(start, t.start) >= (end - start) / 2; })
    .map((r) => r.name);
  const sent = (data.partners || []).filter((p) => p.shiftId === shift.id).map((p) => p.name);
  return [...new Set([...fromSchedule, ...sent].filter(Boolean))];
}
