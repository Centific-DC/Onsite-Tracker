import { dayKey, hoursBetween } from './time.js';

// A clock-in stays open (the person is on the clock) for up to this long, whatever the
// date: a night shift runs past midnight (2026-11-17: an operator clocked in on an
// evening shift and after midnight the page forgot it and offered Clock in again).
// Auto clock-out closes a forgotten shift 30 minutes after its end, long before this.
export const OPEN_MAX_HOURS = 18;
const stillOpen = (p, now) => +now - Date.parse(p.ts) < OPEN_MAX_HOURS * 36e5;

// Pair each person's IN with their next OUT. An IN followed by another IN, or one
// open longer than OPEN_MAX_HOURS, is a missing check-out and counts no hours. Open
// INs are people on site now; they count up to `now`, on the day they clocked in.
export function buildSessions(punches, now = new Date()) {
  const byEmail = new Map();
  for (const p of [...punches].sort((a, b) => a.ts.localeCompare(b.ts))) {
    if (!byEmail.has(p.email)) byEmail.set(p.email, []);
    byEmail.get(p.email).push(p);
  }
  const sessions = [];
  const issues = [];
  // A provisional clock-in (no shift booked, 2026-11-23) keeps its reason and the lab
  // shift it falls in, for the approver.
  const prov = (p) => (p.flag === 'provisional' ? { provisional: true, reason: p.note || '', template: p.template || '', until: p.until || '' } : {});
  const noout = (p) => ({ kind: 'noout', at: new Date(p.ts), name: p.name, email: p.email, station: p.station, location: p.location || '', shiftId: p.shiftId || '', ...prov(p) });
  const make = (inP, end, extra) => {
    const start = new Date(inP.ts);
    return { name: inP.name, email: inP.email, station: inP.station, location: inP.location || '', shiftId: inP.shiftId || '', grace: inP.grace || 0, source: inP.source || '', start, end, day: dayKey(start), hours: hoursBetween(start, end), ...prov(inP), ...extra };
  };
  for (const list of byEmail.values()) {
    let cur = null;
    for (const p of list) {
      if (p.type === 'in') {
        if (cur) issues.push(noout(cur));
        cur = p;
      } else if (cur) {
        const s = make(cur, new Date(p.ts), { early: p.flag === 'early', auto: p.flag === 'auto', note: p.note, live: false });
        sessions.push(s);
        if (s.early) issues.push({ kind: 'early', at: s.end, name: s.name, email: s.email, station: s.station, hours: s.hours, note: s.note });
        cur = null;
      } else {
        issues.push({ kind: 'noin', at: new Date(p.ts), name: p.name, email: p.email, station: p.station });
      }
    }
    if (cur) {
      // A check-in stamped by the server a moment ahead of this device's clock is still zero-length, never negative.
      if (stillOpen(cur, now)) sessions.push(make(cur, new Date(Math.max(+now, Date.parse(cur.ts))), { live: true }));
      else issues.push(noout(cur));
    }
  }
  return { sessions, issues: issues.sort((a, b) => b.at - a.at) };
}

// Merge overlapping [start, end] spans. Returns merged spans in ms.
export function union(spans) {
  const iv = spans.map((s) => [s.start.getTime(), s.end.getTime()]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of iv) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

// Delivered hours: per robot per day, everyone's time merged, so a pair counts once.
export function delivered(sessions) {
  const groups = new Map();
  for (const s of sessions) {
    const k = `${s.day}|${s.station}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const out = [];
  for (const [k, list] of groups) {
    const [day, station] = k.split('|');
    const hours = union(list).reduce((a, [s, e]) => a + (e - s) / 36e5, 0);
    out.push({ day, station, hours });
  }
  return out;
}

export function summarize(data, wk0, wk1, now = new Date()) {
  const { sessions, issues } = buildSessions(data.punches, now);
  const del = delivered(sessions);
  const inRange = (k) => k >= dayKey(wk0) && k < dayKey(wk1);
  const weekSessions = sessions.filter((s) => inRange(s.day));
  const weekDel = del.filter((d) => inRange(d.day));
  return {
    sessions,
    issues,
    delivered: del,
    weekSessions,
    weekIssues: issues.filter((i) => inRange(dayKey(i.at))),
    deliveredWeek: weekDel.reduce((a, d) => a + d.hours, 0),
    deliveredAll: del.reduce((a, d) => a + d.hours, 0),
    personWeek: weekSessions.reduce((a, s) => a + s.hours, 0),
    personAll: sessions.reduce((a, s) => a + s.hours, 0),
    live: sessions.filter((s) => s.live),
  };
}

// The people the app has seen, most recent first (for the shared-device picker).
export function roster(punches) {
  const seen = new Map();
  for (const p of [...punches].sort((a, b) => b.ts.localeCompare(a.ts))) if (!seen.has(p.email)) seen.set(p.email, { name: p.name, email: p.email });
  return [...seen.values()];
}

// A person's current state from the punches.
export function statusOf(punches, email, now = new Date()) {
  const mine = punches.filter((p) => p.email === email).sort((a, b) => a.ts.localeCompare(b.ts));
  const last = mine[mine.length - 1] || null;
  const open = last && last.type === 'in' && stillOpen(last, now) ? last : null;
  return { last, open };
}
