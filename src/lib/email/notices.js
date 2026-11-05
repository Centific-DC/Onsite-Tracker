import { locOf, locationById, locationName } from '../config.js';
import { shiftHours } from '../schedule.js';
import { addDays, dayKey, fmtHrsU, parseDay, weekLabel } from '../time.js';
import { firstName } from '../time.js';
import { bulletList, shiftTable } from './blocks.js';

// Schedule emails: who has been sent which week, and what changed since. Every
// send leaves a notice (Lotus_Notices) holding a snapshot of the shifts it
// listed, so the Schedule tab can tell "not sent", "changed since" and "up to
// date" apart, and the change email can say exactly what moved.

const SIG_KEYS = ['date', 'start', 'end', 'station', 'location', 'template'];

export const snapshotOf = (shifts) =>
  shifts.map((r) => Object.fromEntries([['id', r.id], ...SIG_KEYS.map((k) => [k, k === 'location' ? locOf(r) : r[k] || ''])]));

const sig = (r) => SIG_KEYS.map((k) => (k === 'location' ? locOf(r) : r[k] || '')).join('|');

/** One operator's shifts in the week starting wk0, in day and time order. */
export function weekShifts(schedule, email, wk0) {
  const a = dayKey(wk0);
  const b = dayKey(addDays(wk0, 7));
  return (schedule || [])
    .filter((r) => r.email === email && r.date >= a && r.date < b)
    .sort((x, y) => x.date.localeCompare(y.date) || x.start.localeCompare(y.start));
}

// Sign-in emails are notices too (dated the day they went out), but say nothing about the schedule.
const NOT_SCHEDULE = new Set(['operator-welcome', 'operator-reset']);

/** The latest schedule notice for an operator and week. Test sends only count while test mode is on. */
export function latestNotice(notices, email, wk0, testMode) {
  const wk = dayKey(wk0);
  return (notices || [])
    .filter((n) => n.email === email && n.weekStart === wk && Boolean(n.test) === Boolean(testMode) && !NOT_SCHEDULE.has(n.kind))
    .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0] || null;
}

/** What moved between the last email and now. */
export function diffShifts(before, now) {
  const was = new Map((before || []).map((r) => [r.id, r]));
  const is = new Map(now.map((r) => [r.id, r]));
  const added = now.filter((r) => !was.has(r.id));
  const removed = (before || []).filter((r) => !is.has(r.id));
  const changed = now.filter((r) => was.has(r.id) && sig(was.get(r.id)) !== sig(r)).map((r) => ({ now: r, was: was.get(r.id) }));
  return { added, removed, changed, any: added.length + removed.length + changed.length > 0 };
}

/**
 * Where each operator stands for a week: 'unsent' (has shifts, never emailed),
 * 'changed' (emailed, shifts moved since), 'current' (emailed, nothing moved).
 * Operators with no shifts and no earlier email are left out.
 */
export function noticeStatus(data, wk0, testMode) {
  const out = [];
  for (const op of (data?.operators || []).filter((o) => o.active !== false && (o.roles || ['operator']).includes('operator'))) {
    const shifts = weekShifts(data.schedule, op.email, wk0);
    const last = latestNotice(data.notices, op.email, wk0, testMode);
    if (!shifts.length && !last?.snapshot?.length) continue;
    const diff = last ? diffShifts(last.snapshot, shifts) : null;
    const status = !last ? 'unsent' : diff.any ? 'changed' : 'current';
    out.push({ op, shifts, last, diff, status, hours: shifts.reduce((a, r) => a + shiftHours(r), 0) });
  }
  return out.sort((a, b) => a.op.name.localeCompare(b.op.name));
}

const tplName = (r) => locationById(locOf(r))?.templates?.find((t) => t.id === r.template)?.label || 'Shift';
const clock = (hm) => {
  const [h, m] = String(hm).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const dayLabel = (k) => parseDay(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const timeOf = (r) => `${clock(r.start)} – ${clock(r.end)}`;
const robotOf = (r) => r.station || '';

/** "Wed, Nov 11 Night: Robot 2 → Robot 1", "Added Sat, Nov 14 Night" ... */
export function changeLines(diff) {
  if (!diff) return [];
  const lines = [];
  for (const { now, was } of diff.changed) {
    const bits = [];
    if (was.date !== now.date) bits.push(`moved to ${dayLabel(now.date)}`);
    if (was.start !== now.start || was.end !== now.end) bits.push(`now ${timeOf(now)} (was ${timeOf(was)})`);
    if (was.station !== now.station) bits.push(`now on ${robotOf(now)} (was ${robotOf(was)})`);
    if (!bits.length) bits.push('details updated');
    lines.push(`${dayLabel(was.date)} ${tplName(was)}: ${bits.join(', ')}`);
  }
  for (const r of diff.added) lines.push(`Added ${dayLabel(r.date)} ${tplName(r)}, ${timeOf(r)} on ${robotOf(r)}`);
  for (const r of diff.removed) lines.push(`Removed ${dayLabel(r.date)} ${tplName(r)}, ${timeOf(r)} on ${robotOf(r)}`);
  return lines;
}

/** The template values for one operator's week. */
export function scheduleValues(entry, wk0) {
  const { op, shifts, diff } = entry;
  const changed = new Map((diff?.changed || []).map((c) => [c.now.id, c.was]));
  const added = new Set((diff?.added || []).map((r) => r.id));
  const rows = shifts.map((r) => {
    const was = changed.get(r.id);
    return {
      key: r.date + r.start, day: dayLabel(r.date), shift: tplName(r), time: timeOf(r), robot: robotOf(r),
      change: added.has(r.id) ? 'added' : was ? 'changed' : undefined,
      // What it was before, under the column that changed.
      was: was ? { day: was.date !== r.date ? dayLabel(was.date) : '', time: was.start !== r.start || was.end !== r.end ? timeOf(was) : '', robot: was.station !== r.station ? robotOf(was) : '' } : undefined,
    };
  });
  for (const r of diff?.removed || []) rows.push({ key: r.date + r.start, day: dayLabel(r.date), shift: tplName(r), time: timeOf(r), robot: robotOf(r), change: 'removed' });
  rows.sort((a, b) => a.key.localeCompare(b.key));
  const labs = [...new Set(shifts.map((r) => locationName(locOf(r))).filter(Boolean))];
  const n = shifts.length;
  return {
    operatorName: op.name,
    operatorFirstName: firstName(op.name),
    weekRange: weekLabel(wk0),
    labName: labs.join(' and ') || locationName(op.location),
    shiftCount: `${n} ${n === 1 ? 'shift' : 'shifts'}`,
    scheduledHours: fmtHrsU(entry.hours),
    shiftTable: n || rows.length ? shiftTable(rows, { label: `${n} ${n === 1 ? 'shift' : 'shifts'}`, hours: fmtHrsU(entry.hours) }) : '',
    changeList: diff?.any ? bulletList(changeLines(diff)) : '',
  };
}

/** Which template an operator's email uses. */
export const templateFor = (entry) => (entry.status === 'changed' ? 'operator-schedule-update' : 'operator-schedule');

/** One-line summary for the send list. */
export function summaryLine(entry) {
  const lines = entry.status === 'changed' ? changeLines(entry.diff) : [];
  const n = entry.shifts.length;
  const base = `${n} ${n === 1 ? 'shift' : 'shifts'} · ${fmtHrsU(entry.hours)}`;
  if (!lines.length) return base;
  return `${lines[0]}${lines.length > 1 ? ` (+${lines.length - 1} more)` : ''} · ${base}`;
}
