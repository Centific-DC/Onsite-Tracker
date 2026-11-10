import { shiftTimes } from './schedule.js';

// Missed clock-ins and clock-outs (the project owner's rule, 2026-11-10).
//
// An operator who forgets to clock in or out sends a request from the check-in
// page, which emails the admins and copies them: that email is the paper trail. An
// admin checks with the scheduled partner, then corrects the times. Only admins can
// change hours away from what the clock recorded; the flows enforce it.
//
// Each counted miss moves the operator one step up the ladder: a soft warning, then
// strikes 1 to 3. Lotus records and emails each step but never blocks anyone; at
// strike 3 people decide (a talk with the PM and a removal review). After 30 days
// with no new counted miss the count goes back to zero. An admin can cancel a step,
// with a reason, and it stays in the history as cancelled.

export const RESET_DAYS = 30;
// A request sent more than this long after the shift ended also counts as a late report.
export const LATE_REPORT_HOURS = 24;

export const STEPS = [
  { label: 'Soft warning', note: 'Logged and emailed' },
  { label: 'Strike 1', note: 'Noted' },
  { label: 'Strike 2', note: 'Talk with the lead' },
  { label: 'Strike 3', note: 'Talk with the PM and a removal review' },
];
// The Strike 3 email always goes; for earlier steps the admin decides.
export const FINAL_COUNT = 4;
export const mustEmail = (count) => count >= FINAL_COUNT;
export const stepOf = (count) => (count > 0 ? STEPS[Math.min(count, STEPS.length) - 1] : null);
// "Soft warning", or "Strike 2 of 3".
export const stepText = (count) => (count <= 0 ? '' : count === 1 ? 'Soft warning' : `Strike ${Math.min(count - 1, 3)} of 3`);

export const MISSED = {
  in: { label: 'Missed clock-in', reason: 'missed_in' },
  out: { label: 'Missed clock-out', reason: 'missed_out' },
  both: { label: 'Missed clock-in and out', reason: 'missed_both' },
};
export const REASON = {
  missed_in: 'Missed clock-in',
  missed_out: 'Missed clock-out',
  missed_both: 'Missed clock-in and out',
  late_report: 'Reported late',
};

const DAY = 864e5;

/**
 * Where an operator stands: the active count, its step, when it clears, and every
 * step in their history (newest first) with the count it reached. Cancelled steps
 * are kept in the list but never count.
 */
export function standing(strikes, email, now = new Date()) {
  const mine = (strikes || []).filter((s) => s.email === email).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let count = 0;
  let last = null;
  const list = [];
  for (const s of mine) {
    if (s.voided) { list.push({ ...s, count: 0, step: null }); continue; }
    if (last && new Date(s.at) - new Date(last.at) > RESET_DAYS * DAY) count = 0;
    count += 1;
    list.push({ ...s, count, step: stepOf(count) });
    last = s;
  }
  const live = last && now - new Date(last.at) <= RESET_DAYS * DAY;
  const active = live ? count : 0;
  return {
    count: active,
    step: stepOf(active),
    text: stepText(active),
    clearsOn: live ? new Date(+new Date(last.at) + RESET_DAYS * DAY) : null,
    list: list.reverse(),
  };
}

/** What the next `n` counted misses would bring an operator to, for the admin's preview. */
export function nextSteps(strikes, email, n = 1, now = new Date()) {
  const { count } = standing(strikes, email, now);
  return Array.from({ length: n }, (_, i) => ({ count: count + i + 1, step: stepOf(count + i + 1), text: stepText(count + i + 1) }));
}

/** Hours between the shift's end and the request. */
export function reportDelayHours(shift, requestedAt) {
  if (!shift || !requestedAt) return 0;
  return Math.max(0, (new Date(requestedAt) - shiftTimes(shift).end) / 36e5);
}
export const isLateReport = (shift, requestedAt) => reportDelayHours(shift, requestedAt) > LATE_REPORT_HOURS;

/** The strike reasons a request adds when it counts: the miss, plus a late report. */
export function reasonsFor(c, shift) {
  const out = [MISSED[c.missed]?.reason || 'missed_in'];
  if (isLateReport(shift, c.requestedAt)) out.push('late_report');
  return out;
}

// Excel and SharePoint rows can come back with odd casing or booleans as text.
const yes = (v) => v === true || v === 'true' || v === 'Yes' || v === 1;
export const normCorrection = (c) => ({
  id: String(c.id ?? c.Title ?? ''),
  email: String(c.email ?? c.Email ?? '').trim().toLowerCase(),
  name: String(c.name ?? c.Name ?? '').trim(),
  operatorId: String(c.operatorId ?? c.OperatorID ?? ''),
  date: String(c.date ?? c.Date ?? '').slice(0, 10),
  shiftId: String(c.shiftId ?? c.ShiftID ?? ''),
  missed: ['in', 'out', 'both'].includes(String(c.missed ?? c.Missed)) ? String(c.missed ?? c.Missed) : 'in',
  message: String(c.message ?? c.Message ?? ''),
  source: String(c.source ?? c.Source ?? 'app') === 'email' ? 'email' : 'app',
  requestedAt: String(c.requestedAt ?? c.RequestedAt ?? ''),
  status: ['open', 'approved', 'declined'].includes(String(c.status ?? c.Status)) ? String(c.status ?? c.Status) : 'open',
  partnerConfirmed: yes(c.partnerConfirmed ?? c.PartnerConfirmed),
  timeIn: String(c.timeIn ?? c.TimeIn ?? ''),
  timeOut: String(c.timeOut ?? c.TimeOut ?? ''),
  note: String(c.note ?? c.Note ?? ''),
  counts: !(c.counts === false || c.Counts === false || c.Counts === 'No'),
  noCountReason: String(c.noCountReason ?? c.NoCountReason ?? ''),
  resolvedBy: String(c.resolvedBy ?? c.ResolvedBy ?? ''),
  resolvedAt: String(c.resolvedAt ?? c.ResolvedAt ?? ''),
});

export const normStrike = (s) => ({
  id: String(s.id ?? s.Title ?? ''),
  email: String(s.email ?? s.Email ?? '').trim().toLowerCase(),
  name: String(s.name ?? s.Name ?? '').trim(),
  operatorId: String(s.operatorId ?? s.OperatorID ?? ''),
  date: String(s.date ?? s.Date ?? '').slice(0, 10),
  reason: String(s.reason ?? s.Reason ?? 'missed_in'),
  ref: String(s.ref ?? s.Ref ?? ''),
  at: String(s.at ?? s.At ?? ''),
  by: String(s.by ?? s.By ?? ''),
  emailed: yes(s.emailed ?? s.Emailed),
  voided: yes(s.voided ?? s.Voided),
  voidReason: String(s.voidReason ?? s.VoidReason ?? ''),
  voidedBy: String(s.voidedBy ?? s.VoidedBy ?? ''),
  voidedAt: String(s.voidedAt ?? s.VoidedAt ?? ''),
});

/** Open requests first (oldest first), then the rest newest first. */
export function sortRequests(list) {
  const open = list.filter((c) => c.status === 'open').sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const rest = list.filter((c) => c.status !== 'open').sort((a, b) => (b.resolvedAt || b.requestedAt).localeCompare(a.resolvedAt || a.requestedAt));
  return [...open, ...rest];
}
