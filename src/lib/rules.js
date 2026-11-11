import { CFG, LOCATIONS, locOf, locationById } from './config.js';
import { addDays, dayKey } from './time.js';
import { replacedIds, samePair, shiftTimes, shiftHours } from './schedule.js';

const PAIR = 2;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
// Two shifts on one robot are a pair when they share more than an hour: the
// 30-minute handover between Afternoon and Night isn't a pairing.
const HANDOVER_MIN = 60;
const mins = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
export const sharesShift = (a, b) => Math.min(mins(a.end), mins(b.end)) - Math.max(mins(a.start), mins(b.start)) > HANDOVER_MIN;

// Completed sessions per operator: the count imported from the roster, plus days
// the app has seen them finish a session since that import.
export function completedSessions(op, sessions) {
  if (!op) return 0;
  const since = op.completedAsOf || '';
  const days = new Set(sessions.filter((s) => s.email === op.email && !s.live && s.day > since).map((s) => s.day));
  return (Number(op.completedSessions) || 0) + days.size;
}

// Experienced or new. An admin can mark an operator either way on Roster, and
// that mark wins. Without one, admins are experienced, and otherwise fewer than
// `pairingMinSessions` completed sessions means new.
export const EXPERIENCE = {
  experienced: { label: 'Experienced', tone: 'on' },
  new: { label: 'New', tone: 'warn' },
};
export function experience(op, sessions, min = CFG.pairingMinSessions) {
  const done = completedSessions(op, sessions);
  const mark = op?.experience === 'experienced' || op?.experience === 'new' ? op.experience : '';
  const admin = (op?.roles || []).includes('admin');
  return { level: mark || (admin || done >= min ? 'experienced' : 'new'), marked: !!mark, done, admin };
}
export const isNew = (op, sessions, min) => !!op && experience(op, sessions, min).level === 'new';

// Slots on one robot where everyone booked at the same time is new. Every pair
// needs at least one experienced operator, so two new ones together are flagged.
export function pairingRisks(schedule, operators, sessions, min = CFG.pairingMinSessions) {
  const byEmail = new Map((operators || []).map((o) => [o.email, o]));
  const gone = replacedIds(schedule);
  const byDay = new Map();
  for (const r of schedule || []) {
    if (gone.has(r.id)) continue;
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  const out = [];
  for (const rows of byDay.values()) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        if (!samePair(a, b)) continue;
        const oa = byEmail.get(a.email), ob = byEmail.get(b.email);
        if (isNew(oa, sessions, min) && isNew(ob, sessions, min)) out.push({ date: a.date, station: a.station, ids: [a.id, b.id], names: [a.name, b.name], counts: [completedSessions(oa, sessions), completedSessions(ob, sessions)] });
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
        // A double shift overlaps by the handover; that's fine, unless it's on two robots.
        const shared = (Math.min(a.end, b.end) - Math.max(a.start, b.start)) / 6e4;
        if (shared > HANDOVER_MIN || (overlaps(a, b) && a.station && b.station && a.station !== b.station)) out.push({ kind: 'overlap', date: a.date, name: a.name, email: a.email, ids: [a.id, b.id] });
        else if (locOf(a) !== locOf(b)) out.push({ kind: 'two_labs', date: a.date, name: a.name, email: a.email, ids: [a.id, b.id] });
      }
    }
  }
  return out;
}

// Each operator works at their home lab only: the labs are far apart, so nobody
// is booked at the other one (user rule, 2026-11-05). An operator with no home lab
// set yet can go anywhere until one is set on Roster.
export function homeLabProblem(shift, operators) {
  const op = (operators || []).find((o) => o.email === shift.email);
  if (!op?.location || !locOf(shift) || locOf(shift) === op.location) return '';
  return `${op.name} works at ${locationById(op.location)?.name || op.location} only. Each operator works at their home lab.`;
}

/** Booked shifts at a lab other than the operator's home lab. */
export function wrongLab(schedule, operators) {
  return (schedule || []).filter((r) => homeLabProblem(r, operators)).map((r) => ({ kind: 'wrong_lab', date: r.date, name: r.name, email: r.email, ids: [r.id] }));
}

// Warnings for a shift about to be saved, so the scheduler sees them before booking.
export function checkNewShift(shift, schedule, operators, sessions, wk0) {
  const id = shift.id || '__new__';
  const next = [...(schedule || []).filter((r) => r.id !== id), { ...shift, id }];
  const out = [];
  const load = weeklyLoad(next, wk0).find((x) => x.email === shift.email);
  if (load?.over) out.push({ code: 'over_cap', text: `${shift.name} would be booked ${load.hours.toFixed(1)} hrs this week, over the ${CFG.weeklyHourCap} hrs limit.` });
  for (const c of conflicts(next).filter((c) => c.ids.includes(id))) {
    out.push({ code: c.kind, text: c.kind === 'overlap' ? `${shift.name} already has an overlapping shift that day.` : `${shift.name} is already booked at another lab that day.` });
  }
  for (const p of pairingRisks(next, operators, sessions).filter((p) => p.ids.includes(id))) {
    out.push({ code: 'pairing', text: `${p.names[0]} and ${p.names[1]} are both new operators. Every pair needs at least one experienced operator.` });
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
