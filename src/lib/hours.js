import { dayKey, hoursBetween } from './time.js';

// Pair each person's IN with their next OUT. An IN followed by another IN, or still
// open from an earlier day, is a missing check-out and counts no hours. Today's open
// INs are people on site now; they count up to `now`.
export function buildSessions(punches, now = new Date()) {
  const byEmail = new Map();
  for (const p of [...punches].sort((a, b) => a.ts.localeCompare(b.ts))) {
    if (!byEmail.has(p.email)) byEmail.set(p.email, []);
    byEmail.get(p.email).push(p);
  }
  const sessions = [];
  const issues = [];
  const todayK = dayKey(now);
  const noout = (p) => ({ kind: 'noout', at: new Date(p.ts), name: p.name, email: p.email, station: p.station, location: p.location || '', shiftId: p.shiftId || '' });
  const make = (inP, end, extra) => {
    const start = new Date(inP.ts);
    return { name: inP.name, email: inP.email, station: inP.station, location: inP.location || '', shiftId: inP.shiftId || '', grace: inP.grace || 0, source: inP.source || '', start, end, day: dayKey(start), hours: hoursBetween(start, end), ...extra };
  };
  for (const list of byEmail.values()) {
    let cur = null;
    for (const p of list) {
      if (p.type === 'in') {
        if (cur) issues.push(noout(cur));
        cur = p;
      } else if (cur) {
        const s = make(cur, new Date(p.ts), { early: p.flag === 'early', note: p.note, live: false });
        sessions.push(s);
        if (s.early) issues.push({ kind: 'early', at: s.end, name: s.name, email: s.email, station: s.station, hours: s.hours, note: s.note });
        cur = null;
      } else {
        issues.push({ kind: 'noin', at: new Date(p.ts), name: p.name, email: p.email, station: p.station });
      }
    }
    if (cur) {
      // A check-in stamped by the server a moment ahead of this device's clock is still zero-length, never negative.
      if (dayKey(new Date(cur.ts)) === todayK) sessions.push(make(cur, new Date(Math.max(+now, Date.parse(cur.ts))), { live: true }));
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
  const open = last && last.type === 'in' && dayKey(new Date(last.ts)) === dayKey(now) ? last : null;
  return { last, open };
}
