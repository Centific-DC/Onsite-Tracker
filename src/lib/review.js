import { CFG, locOf, locationName } from './config.js';
import { addDays, dayKey, parseDay } from './time.js';
import { buildSessions } from './hours.js';
import { SWITCH_GAP_MIN, bookedHours, nextBackToBack, prevBackToBack, shiftTimes } from './schedule.js';
import { graceFor } from './rules.js';
import { LATE_AFTER_MIN } from './attendance.js';

// Raw check-ins are never treated as payable. Each operator-day is reviewed: its
// flags resolved with a reason, then its hours approved. Approved hours are the
// time inside the scheduled shift, plus any extra time a manager accepts.

export const FLAG = {
  no_show: { label: 'No-show', tone: 'bad', time: false },
  late: { label: 'Late arrival', tone: 'warn', time: false },
  // Informational: logged, not paid unless the approver adds it, and never blocks approval.
  grace_used: { label: 'Grace used', tone: 'muted', time: true, info: true },
  left_early: { label: 'Left early', tone: 'bad', time: false },
  outside_shift: { label: 'Outside shift', tone: 'warn', time: true },
  no_clockout: { label: 'No clock-out', tone: 'warn', time: true },
  // The Auto Clock-out flow closed the shift 15 minutes after its end: the operator
  // forgot. Kept for performance reviews; the approver checks the end is right.
  auto_clockout: { label: 'Auto clock-out', tone: 'warn', time: false },
  no_clockin: { label: 'No clock-in', tone: 'warn', time: false },
  unscheduled: { label: 'Not on the schedule', tone: 'warn', time: true },
  // An admin corrected the times for a shift after a missed clock-in or out request.
  corrected: { label: 'Corrected', tone: 'muted', time: false, info: true },
};

const MIN = 1 / 60;
const clip = (s, e, a, b) => Math.max(0, (Math.min(e, b) - Math.max(s, a)) / 36e5);
export const dayKeyOf = (email, day) => `${email}|${day}`;

// The latest record per key wins, so a reopen after an approval undoes it, and a
// second resolution of a flag replaces the first. Every record stays in the audit trail.
const latest = (list, key) => {
  const m = new Map();
  for (const r of [...(list || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))) m.set(key(r), r);
  return m;
};

export function reviewDays(data, from, to, now = new Date()) {
  const { sessions, issues } = buildSessions(data.punches, now);
  const fromK = dayKey(from), toK = dayKey(to);
  const inRange = (k) => k >= fromK && k < toK;
  const ops = new Map((data.operators || []).map((o) => [o.email, o]));
  const res = latest(data.resolutions, (r) => r.key);
  const appr = latest(data.approvals, (r) => dayKeyOf(r.email, r.date));
  // Missed clock-in or out requests. An approved one replaces the clock record for its
  // shift with the times an admin set; the raw punches stay as they are.
  const fixes = new Map();
  const asks = new Map();
  for (const c of data.corrections || []) {
    if (c.status === 'approved' && c.shiftId && c.timeIn && c.timeOut) fixes.set(c.shiftId, c);
    if (c.status === 'open') { const k = dayKeyOf(c.email, c.date); asks.set(k, [...(asks.get(k) || []), c]); }
  }

  const days = new Map();
  const get = (email, day, name) => {
    const k = dayKeyOf(email, day);
    if (!days.has(k)) days.set(k, { key: k, email, day, name, shifts: [], sessions: [], noouts: [], noins: [] });
    return days.get(k);
  };
  for (const r of data.schedule || []) if (inRange(r.date)) get(r.email, r.date, r.name).shifts.push({ ...r, startHM: r.start, endHM: r.end, ...shiftTimes(r) });
  for (const s of sessions) if (inRange(s.day)) get(s.email, s.day, s.name).sessions.push(s);
  for (const i of issues) {
    const k = dayKey(i.at);
    if (!inRange(k)) continue;
    if (i.kind === 'noout') get(i.email, k, i.name).noouts.push(i);
    if (i.kind === 'noin') get(i.email, k, i.name).noins.push(i);
  }

  const out = [];
  for (const d of days.values()) {
    const op = ops.get(d.email);
    d.operatorId = op?.id || '';
    d.name = op?.name || d.name;
    d.shifts.sort((a, b) => a.start - b.start);
    const flags = [];
    const flag = (code, detail, extra = {}) => {
      const key = `${d.key}|${code}|${extra.ref || ''}`;
      flags.push({ key, code, detail, ...FLAG[code], ...extra, resolution: res.get(key) || null });
    };
    const live = d.sessions.some((s) => s.live);
    const shiftOf = (s) => d.shifts.find((r) => r.id === s.shiftId) || d.shifts.find((r) => s.start < r.end && r.start < s.end) || null;
    const fixedShifts = d.shifts.filter((r) => fixes.has(r.id));
    const fixedAt = (t) => fixedShifts.some((r) => +t >= +r.start - 36e5 && +t <= +r.end + 3 * 36e5);

    // A back-to-back double: the operator clocked out of one shift and into the next
    // within a few minutes. That handover is neither leaving early nor arriving late.
    const gapOk = (out, inAt) => Math.abs(+inAt - +out) <= SWITCH_GAP_MIN * 6e4;
    const switchedOut = (s, r) => {
      const n = r && nextBackToBack(data.schedule, r);
      return !!n && +s.end >= +shiftTimes(n).start - graceFor(n) * 6e4 && d.sessions.some((x) => x.shiftId === n.id && gapOk(s.end, x.start));
    };
    const switchedIn = (s, r) => {
      const p = r && prevBackToBack(data.schedule, r);
      return !!p && d.sessions.some((x) => x !== s && x.shiftId === p.id && !x.live && gapOk(x.end, s.start));
    };

    let inShift = 0;
    for (const s of d.sessions) {
      const r = shiftOf(s);
      if (r && fixes.has(r.id)) continue;
      const st = +s.start, en = +s.end;
      if (!r) {
        if (!s.live) flag('unscheduled', 'Clocked in with no shift booked', { ref: +s.start, minutes: Math.round(s.hours * 60), start: s.start, end: s.end });
        continue;
      }
      inShift += clip(st, en, +r.start, +r.end);
      const before = clip(st, en, -Infinity, +r.start);
      const after = s.live ? 0 : clip(st, en, +r.end, Infinity);
      if (before >= MIN) flag('grace_used', `Clocked in ${Math.round(before * 60)} min before the shift`, { ref: +s.start, minutes: Math.round(before * 60) });
      if ((st - r.start) / 6e4 >= LATE_AFTER_MIN && s === d.sessions.find((x) => shiftOf(x) === r) && !switchedIn(s, r)) flag('late', `Clocked in ${Math.round((st - r.start) / 6e4)} min after the start`, { ref: r.id });
      // A few minutes to walk out aren't worth a review; they're still not counted.
      if (after * 60 >= (CFG.outsideToleranceMinutes ?? 5)) flag('outside_shift', `${Math.round(after * 60)} min after the scheduled end`, { ref: +s.start, minutes: Math.round(after * 60) });
      if (s.auto) flag('auto_clockout', 'Didn’t clock out. The system closed the shift', { ref: +s.start });
      if (!s.live && !s.auto && !switchedOut(s, r) && (s.early || (r.end - en) / 6e4 > CFG.earlyGraceMinutes)) flag('left_early', `Left ${Math.round((r.end - en) / 6e4)} min before the end${s.note ? ` · “${s.note}”` : ''}`, { ref: +s.start });
    }
    for (const i of d.noouts) {
      const r = d.shifts.find((x) => x.id === i.shiftId) || d.shifts.find((x) => +i.at < +x.end) || null;
      if (r ? fixes.has(r.id) : fixedAt(i.at)) continue;
      // Never invent a departure. The scheduled end is offered as a suggestion,
      // marked system-generated, and only counts once someone accepts it.
      const suggested = r ? r.end : null;
      // Time before the shift's start isn't counted here; grace is reviewed on its own.
      const from = r ? new Date(Math.max(+i.at, +r.start)) : i.at;
      flag('no_clockout', 'Clocked in, never clocked out', { ref: +i.at, start: i.at, from, suggested, minutes: suggested ? Math.round(clip(+from, +suggested, -Infinity, Infinity) * 60) : 0 });
    }
    for (const i of d.noins) if (!fixedAt(i.at)) flag('no_clockin', 'Clocked out with no clock-in', { ref: +i.at });
    for (const r of fixedShifts) {
      const c = fixes.get(r.id);
      inShift += clip(+new Date(c.timeIn), +new Date(c.timeOut), +r.start, +r.end);
      flag('corrected', `${hm(new Date(c.timeIn))}–${hm(new Date(c.timeOut))} set by ${c.resolvedBy || 'an admin'}${c.partnerConfirmed ? ', partner confirmed' : ''}${c.note ? ` · “${c.note}”` : ''}`, { ref: c.id, correction: c });
    }
    for (const r of d.shifts) {
      if (fixes.has(r.id)) continue;
      const came = d.sessions.some((s) => shiftOf(s) === r) || d.noouts.some((i) => +i.at < +r.end && +i.at >= +r.start - 36e5);
      if (!came && now >= r.end) flag('no_show', `Booked ${r.startHM}–${r.endHM} on ${r.station}, never clocked in`, { ref: r.id });
    }

    // Time the manager accepted on top of the in-shift time.
    let extra = 0;
    for (const f of flags) {
      if (!f.time || f.resolution?.outcome !== 'accept') continue;
      if (f.code === 'no_clockout') {
        const end = f.resolution.endTime ? new Date(f.resolution.endTime) : f.suggested;
        if (end) extra += clip(+f.from, +end, -Infinity, Infinity);
      } else extra += (f.minutes || 0) / 60;
    }
    const recorded = d.sessions.filter((s) => !s.live).reduce((a, s) => a + s.hours, 0);
    const requests = asks.get(d.key) || [];
    // A back-to-back double's handover overlap counts once.
    const scheduled = bookedHours(d.shifts);
    const computed = inShift + extra;
    const a = appr.get(d.key);
    const approval = a && a.status === 'approved' ? a : null;
    const open = flags.filter((f) => !f.resolution && !f.info);
    const status = approval ? 'approved' : live || d.day >= dayKey(now) && !d.shifts.every((r) => now >= r.end) ? 'in_progress' : open.length || requests.length ? 'needs_review' : 'ready';
    const locs = [...new Set([...d.shifts.map(locOf), ...d.sessions.map(locOf)].filter(Boolean))];
    out.push({
      ...d,
      location: locs.join(';'),
      locationName: locs.map(locationName).join(', '),
      flags,
      openFlags: open.length,
      requests,
      fixes: fixedShifts.map((r) => fixes.get(r.id)),
      scheduled,
      recorded,
      inShift,
      computed,
      approved: approval ? approval.hours : null,
      approval,
      lastApproval: a || null,
      status,
    });
  }
  return out.sort((x, y) => x.day.localeCompare(y.day) || x.name.localeCompare(y.name));
}

// Approval records for the reporting export: one row per operator per day,
// approved only. Field names are a contract with the agency-reporting sheet.
export const APPROVED_COLUMNS = ['operator_id', 'operator_name', 'operator_email', 'work_date', 'time_in', 'time_out', 'iso_week', 'location_id', 'location_name', 'shift_ids', 'scheduled_hours', 'recorded_hours', 'approved_hours', 'adjustment_hours', 'approval_status', 'approved_by', 'approved_at', 'flags_resolved', 'note'];

export function isoWeek(k) {
  const d = parseDay(k);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const n = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - n);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

export function approvedRows(data, from, to, now = new Date()) {
  return reviewDays(data, from, to, now)
    .filter((d) => d.status === 'approved')
    .map((d) => ({
      operator_id: d.operatorId,
      operator_name: d.name,
      operator_email: d.email,
      work_date: d.day,
      ...clockSpan(d),
      iso_week: isoWeek(d.day),
      location_id: d.location,
      location_name: d.locationName,
      shift_ids: d.shifts.map((r) => r.id).join(';'),
      scheduled_hours: d.scheduled.toFixed(2),
      recorded_hours: d.recorded.toFixed(2),
      approved_hours: Number(d.approved).toFixed(2),
      adjustment_hours: (Number(d.approved) - d.recorded).toFixed(2),
      approval_status: d.approval.final ? 'final' : 'approved',
      approved_by: d.approval.by,
      approved_at: d.approval.at,
      flags_resolved: d.flags.map((f) => f.code).join(';'),
      note: d.approval.note || '',
    }));
}

export const weekRange = (wk0) => [wk0, addDays(wk0, 7)];

const hm = (t) => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;

// First clock-in and last clock-out of an approved day, site-local HH:MM. A
// missed clock-out counts only with the end time the manager accepted.
export function clockSpan(d) {
  const fixed = new Set((d.fixes || []).map((c) => c.shiftId));
  const own = d.sessions.filter((s) => !fixed.has(s.shiftId));
  const ins = own.map((s) => +s.start);
  const outs = own.filter((s) => !s.live).map((s) => +s.end);
  for (const c of d.fixes || []) { ins.push(+new Date(c.timeIn)); outs.push(+new Date(c.timeOut)); }
  for (const f of d.flags) {
    if (f.code !== 'no_clockout') continue;
    ins.push(+f.start);
    if (f.resolution?.outcome === 'accept') {
      const end = f.resolution.endTime ? new Date(f.resolution.endTime) : f.suggested;
      if (end) outs.push(+end);
    }
  }
  return {
    time_in: ins.length ? hm(new Date(Math.min(...ins))) : '',
    time_out: outs.length ? hm(new Date(Math.max(...outs))) : '',
  };
}
