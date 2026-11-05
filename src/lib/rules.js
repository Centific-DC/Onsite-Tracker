import { CFG, LOCATIONS, locOf, locationById } from './config.js';
import { addDays, dayKey } from './time.js';
import { shiftTimes, shiftHours } from './schedule.js';

const PAIR = 2;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// Completed sessions per operator: the count imported from the roster, plus days
// the app has seen them finish a session since that import.
export function completedSessions(op, sessions) {
  if (!op) return 0;
  const since = op.completedAsOf || '';
  const days = new Set(sessions.filter((s) => s.email === op.email && !s.live && s.day > since).map((s) => s.day));
  return (Number(op.completedSessions) || 0) + days.size;
}

// Slots on one robot where everyone booked at the same time is still new: fewer
// than `pairingMinSessions` completed sessions each. Two new operators should
// never be paired without someone noticing.
export function pairingRisks(schedule, operators, sessions, min = CFG.pairingMinSessions) {
  const byEmail = new Map((operators || []).map((o) => [o.email, o]));
  const groups = new Map();
  for (const r of schedule || []) {
    const k = `${r.date}|${r.station}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ ...r, ...shiftTimes(r) });
  }
  const out = [];
  for (const rows of groups.values()) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        if (a.email === b.email || !overlaps(a, b)) continue;
        const ca = completedSessions(byEmail.get(a.email), sessions);
        const cb = completedSessions(byEmail.get(b.email), sessions);
        if (ca < min && cb < min) out.push({ date: a.date, station: a.station, ids: [a.id, b.id], names: [a.name, b.name], counts: [ca, cb] });
      }
    }
  }
  return out;
}

// Scheduled hours per operator for the week starting `wk0`, and who is over the cap.
export function weeklyLoad(schedule, wk0, cap = CFG.weeklyHourCap) {
  const from = dayKey(wk0), to = dayKey(addDays(wk0, 7));
  const m = new Map();
  for (const r of schedule || []) {
    if (r.date < from || r.date >= to) continue;
    const x = m.get(r.email) || { email: r.email, name: r.name, hours: 0 };
    x.hours += shiftHours(r);
    m.set(r.email, x);
  }
  return [...m.values()].map((x) => ({ ...x, over: x.hours > cap + 1e-9 }));
}

// The same operator booked twice at once on different robots, or at two labs on one day.
export function conflicts(schedule) {
  const by = new Map();
  for (const r of schedule || []) {
    const k = `${r.date}|${r.email}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ ...r, ...shiftTimes(r) });
  }
  const out = [];
  for (const rows of by.values()) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        // A double shift on the same robot overlaps by the handover; that's fine.
        if (overlaps(a, b) && a.station !== b.station) out.push({ kind: 'overlap', date: a.date, name: a.name, email: a.email, ids: [a.id, b.id] });
        else if (locOf(a) !== locOf(b)) out.push({ kind: 'two_labs', date: a.date, name: a.name, email: a.email, ids: [a.id, b.id] });
      }
    }
  }
  return out;
}

// Warnings for a shift about to be saved, so the scheduler sees them before booking.
export function checkNewShift(shift, schedule, operators, sessions, wk0) {
  const id = shift.id || '__new__';
  const next = [...(schedule || []).filter((r) => r.id !== id), { ...shift, id }];
  const out = [];
  const load = weeklyLoad(next, wk0).find((x) => x.email === shift.email);
  if (load?.over) out.push({ code: 'over_cap', text: `${shift.name} would be booked ${load.hours.toFixed(1)} hrs this week, over the ${CFG.weeklyHourCap} hrs limit.` });
  for (const c of conflicts(next).filter((c) => c.ids.includes(id))) {
    out.push({ code: c.kind, text: c.kind === 'overlap' ? `${shift.name} already has an overlapping shift on another robot that day.` : `${shift.name} is already booked at another lab that day.` });
  }
  for (const p of pairingRisks(next, operators, sessions).filter((p) => p.ids.includes(id))) {
    out.push({ code: 'pairing', text: `${p.names[0]} (${p.counts[0]}) and ${p.names[1]} (${p.counts[1]}) both have fewer than ${CFG.pairingMinSessions} completed sessions.` });
  }
  return out;
}

// Each lab's template slots on a day and who fills them, so open slots show.
export function slots(schedule, k, pairSize = PAIR) {
  const out = [];
  for (const loc of LOCATIONS) {
    for (const robot of loc.robots) {
      for (const t of loc.templates) {
        const rows = (schedule || []).filter((r) => r.date === k && r.station === robot && (r.template ? r.template === t.id : r.start === t.start && r.end === t.end));
        out.push({ location: loc.id, robot, template: t, rows, open: Math.max(0, pairSize - rows.length) });
      }
    }
  }
  return out;
}

export const graceFor = (shift) => locationById(locOf(shift))?.graceMinutes ?? 10;
