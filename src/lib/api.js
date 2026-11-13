import { timed } from './timing.js';
import { CFG, CORRECTIONS_URL, DEMO, LOCATIONS, READ_URL, SYNC_URL, WRITE_URL, locOf, locationName, locationOfRobot } from './config.js';
import { getToken } from './auth/session.js';
import { addDays, dayKey, mondayOf } from './time.js';
import { clockInCheck } from './attendance.js';
import { openSpots, samePair, shiftTimes } from './schedule.js';
import { writeFlowName, writeUrlFor } from './routes.js';
import { mustEmail, normCorrection, normStrike, reasonsFor, standing } from './strikes.js';
import { SHEET_SOURCE, normScheduleSync, planSheetSync, sheetKey, syncIncludesToday, syncSummary } from './sheetSync.js';

export const storage = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

// A flow's own errors are {"error":"text"}. Power Automate's platform errors (flow off,
// a failed action with no Response, a timeout) are {"error":{"code","message"}}.
export function errorText(out, status) {
  const e = out?.error;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object') return [e.message, e.code && `(${e.code})`].filter(Boolean).join(' ') || `The flow answered ${status}.`;
  if (typeof out?.message === 'string' && out.message) return out.message;
  return `The flow answered ${status}.`;
}

// Called when a flow still refuses the sign-in after one retry; the store signs out.
let onSignedOut = () => {};
export const whenSignedOut = (fn) => { onSignedOut = fn; };

// Write calls go to the op's one-job flow when its URL is set, else to Write (routes.js).
async function paPost(url, body) {
  if (url === WRITE_URL) {
    return timed(`${writeFlowName(body, CFG)} · ${body.action || 'call'}`, paPostChecked(writeUrlFor(body, CFG, WRITE_URL), body));
  }
  return timed(`${url === READ_URL ? 'Read' : url === CORRECTIONS_URL ? 'Corrections' : 'Write'} · ${body.action || 'call'}`, paPostChecked(url, body));
}

// A 401 can be a busy moment rather than a real sign-out (the token lookup itself
// was throttled), so ask once more after a pause. The flow refuses before it
// writes anything, so a second try never saves twice. Still 401: the sign-in has
// really ended (most often a sign-in with the same username somewhere else).
async function paPostChecked(url, body) {
  try {
    return await paPostRaw(url, body);
  } catch (e) {
    if (e.status !== 401 || !getToken()) throw e;
    await new Promise((r) => setTimeout(r, 3000));
    try {
      return await paPostRaw(url, body);
    } catch (e2) {
      if (e2.status === 401 && getToken()) onSignedOut(e2);
      throw e2;
    }
  }
}

async function paPostRaw(url, body) {
  const ctrl = new AbortController();
  // A flow can take a while; Power Automate itself gives up on an HTTP response at about two minutes.
  const t = setTimeout(() => ctrl.abort(), 110000);
  try {
    // Every call carries the sign-in token; the flow looks up who it belongs to.
    // text/plain: the HTTP trigger answers no CORS preflight, which application/json would trigger.
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ token: getToken(), ...body }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || out?.error) { const e = new Error(errorText(out, r.status)); e.code = typeof out?.code === 'string' ? out.code : out?.error?.code; e.status = r.status; throw e; }
    return out;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The flow took longer than 110 seconds to answer.');
    if (e instanceof TypeError) throw new Error('Couldn’t reach the flow. It may be off, or not allow calls from this site (CORS).');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Excel and SharePoint rows can come back with odd casing, numbers as text, or dates as serials.
export function normPunch(p) {
  let ts = p.ts ?? p.Timestamp;
  if (typeof ts === 'number' || /^\d+(\.\d+)?$/.test(String(ts))) ts = new Date(Math.round((Number(ts) - 25569) * 864e5)).toISOString();
  const station = String(p.station ?? p.Station ?? p.Robot ?? '');
  return {
    id: String(p.id ?? p.ID ?? ''),
    ts: new Date(ts).toISOString(),
    operatorId: String(p.operatorId ?? p.OperatorID ?? ''),
    name: String(p.name ?? p.Name ?? '').trim(),
    email: String(p.email ?? p.Email ?? '').trim().toLowerCase(),
    type: /out/i.test(String(p.type ?? p.InOut ?? '')) ? 'out' : 'in',
    station,
    location: String(p.location ?? p.Location ?? '') || locationOfRobot(station)?.id || '',
    shiftId: String(p.shiftId ?? p.ShiftID ?? ''),
    grace: Number(p.grace ?? p.GraceMinutes) || 0,
    source: String(p.source ?? p.Device ?? ''),
    note: String(p.note ?? p.Note ?? ''),
    // `Left early` (the operator's own clock-out) or `Auto clock-out` (the flow closed
    // a shift nobody clocked out of, 15 minutes after its end).
    flag: punchFlag(p.flag ?? p.Flag),
  };
}

export function punchFlag(v) {
  const f = String(v ?? '').trim().toLowerCase();
  if (!f) return '';
  return /auto/.test(f) ? 'auto' : 'early';
}

// "8:00", "08:00:00" or an Excel day fraction (0.333…) all become "08:00".
const hhmm = (v) => {
  if (typeof v === 'number' || /^0?\.\d+$/.test(String(v))) { const m = Math.round(Number(v) * 1440); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  const [h, m = '0'] = String(v ?? '').trim().split(':');
  return `${String(Number(h) || 0).padStart(2, '0')}:${String(Number(m) || 0).padStart(2, '0')}`;
};

export function normShift(r) {
  let date = r.date ?? r.Date ?? '';
  if (typeof date === 'number' || /^\d{5}$/.test(String(date))) date = new Date(Math.round((Number(date) - 25569) * 864e5)).toISOString();
  const station = String(r.station ?? r.Station ?? r.Robot ?? '');
  return {
    id: String(r.id ?? r.ID ?? ''),
    date: String(date).slice(0, 10),
    operatorId: String(r.operatorId ?? r.OperatorID ?? ''),
    name: String(r.name ?? r.Name ?? '').trim(),
    email: String(r.email ?? r.Email ?? '').trim().toLowerCase(),
    station,
    location: String(r.location ?? r.Location ?? '') || locationOfRobot(station)?.id || '',
    template: String(r.template ?? r.Template ?? ''),
    start: hhmm(r.start ?? r.Start),
    end: hhmm(r.end ?? r.End),
    note: String(r.note ?? r.Note ?? ''),
    // Partners share a pair id, so the robot can stay open. A replacement names the shift it replaces.
    pair: String(r.pair ?? r.Pair ?? ''),
    replaces: String(r.replaces ?? r.Replaces ?? ''),
    // Where it came from: app, import, fill_in, or sheet (the daily Master List sync,
    // which also sets sheetKey). Sent back unchanged on every save, so a pair change
    // doesn't turn a sheet shift into a hand-made one.
    source: String(r.source ?? r.Source ?? ''),
    sheetKey: String(r.sheetKey ?? r.SheetKey ?? ''),
  };
}

export const normOperator = (o) => ({
  id: String(o.id ?? o.OperatorID ?? ''),
  email: String(o.email ?? o.Title ?? '').trim().toLowerCase(),
  name: String(o.name ?? o.Name ?? '').trim(),
  location: String(o.location ?? o.HomeLocation ?? ''),
  roles: Array.isArray(o.roles) ? o.roles : String(o.roles ?? o.Roles ?? 'operator').split(';').map((r) => r.trim()).filter(Boolean),
  cohort: String(o.cohort ?? o.Cohort ?? ''),
  completedSessions: Number(o.completedSessions ?? o.CompletedSessions) || 0,
  completedAsOf: String(o.completedAsOf ?? o.CompletedAsOf ?? ''),
  training: String(o.training ?? o.TrainingStatus ?? ''),
  // Set by an admin: 'experienced' or 'new'. Empty means decided by completed sessions.
  experience: ['experienced', 'new'].includes(String(o.experience ?? o.Experience ?? '').toLowerCase()) ? String(o.experience ?? o.Experience).toLowerCase() : '',
  active: o.active ?? o.Active ?? true,
});

const normAll = (d) => ({
  me: d.me ? normOperator(d.me) : null,
  operators: (d.operators || []).map(normOperator).filter((o) => o.email),
  punches: (d.punches || []).filter((p) => p.ts ?? p.Timestamp).map(normPunch),
  client: (d.client || []).map((c) => ({ week: String(c.week ?? c.Week ?? '').slice(0, 10), hours: Number(c.hours ?? c.SuccessfulHours) || 0 })),
  schedule: (d.schedule || []).map(normShift).filter((r) => r.date && r.email),
  // Operators only: the names of whoever shares each of their shifts (see partnersOf).
  // Operators only: spots in their lab they could fill now (someone didn't show). No names.
  openSpots: (d.openSpots || []).map((x) => ({ shiftId: String(x.shiftId ?? ''), location: String(x.location ?? ''), station: String(x.station ?? ''), start: hhmm(x.start), end: hhmm(x.end), template: String(x.template ?? ''), date: String(x.date ?? '').slice(0, 10) })).filter((x) => x.shiftId),
  partners: (d.partners || []).map((p) => ({ shiftId: String(p.shiftId ?? p.ShiftId ?? ''), name: String(p.name ?? p.Name ?? '').trim() })).filter((p) => p.shiftId && p.name),
  resolutions: d.resolutions || [],
  approvals: (d.approvals || []).map((a) => ({ ...a, hours: Number(a.hours) || 0, computed: Number(a.computed) || 0 })),
  // Missed clock-in or out requests and the warnings and strikes they led to. An
  // operator's Read holds only their own.
  corrections: (d.corrections || []).map(normCorrection).filter((c) => c.id && c.email),
  strikes: (d.strikes || []).map(normStrike).filter((x) => x.id && x.email),
  audit: d.audit || [],
  // Schedule emails already sent (staff only), the email templates, and whether
  // emails still go to the project alias only (test mode).
  notices: (d.notices || []).map(normNotice).filter((n) => n.email && n.weekStart),
  templates: (d.templates || []).filter((t) => t && t.id),
  emailTestMode: d.emailTestMode !== false,
  // Robot names saved in Settings, { "Robot 3": "franka-thor-02" } (robots.js).
  robotNames: d.robotNames && typeof d.robotNames === 'object' ? d.robotNames : {},
  // Staff only: the last Master List sync (sheetSync.js), or null if it never ran.
  scheduleSync: normScheduleSync(d.scheduleSync),
});

export const normNotice = (n) => {
  let snapshot = n.snapshot ?? n.Snapshot ?? [];
  if (typeof snapshot === 'string') { try { snapshot = JSON.parse(snapshot); } catch { snapshot = []; } }
  return {
    id: n.id ?? n.Title ?? '',
    email: String(n.email ?? n.Email ?? '').trim().toLowerCase(),
    operatorId: n.operatorId ?? n.OperatorId ?? '',
    weekStart: String(n.weekStart ?? n.WeekStart ?? '').slice(0, 10),
    kind: n.kind ?? n.Kind ?? 'schedule',
    subject: n.subject ?? n.Subject ?? '',
    sentAt: n.sentAt ?? n.SentAt ?? '',
    by: n.by ?? n.By ?? '',
    test: n.test === true || n.Test === true || n.test === 'true' || n.Test === 'Yes',
    snapshot: Array.isArray(snapshot) ? snapshot : [],
  };
};

// Every call goes through here, so the live flows and demo mode take the same shapes
// (docs/lotus-flows.md). In live mode the flows check the caller's role; in demo,
// anything goes and the audit trail is kept in this browser.
export const api = {
  async all() {
    if (DEMO) return demo.load();
    return normAll(await paPost(READ_URL, { action: 'all', from: dayKey(addDays(new Date(), -60)) }));
  },
  // `token`: the sign-in it was made under, so it still goes if the lab laptop has
  // signed out for the next person since.
  async punch(body, token) {
    if (DEMO) return demo.punch(body);
    const out = await paPost(WRITE_URL, { action: 'punch', ...body, deviceTs: new Date().toISOString(), ...(token ? { token } : {}) });
    return normPunch(out.punch);
  },
  // Admins only: the whole map of robot names, { "Robot 3": "franka-thor-02" }.
  async robotNames(names) {
    if (DEMO) return demo.robotNames(names);
    const out = await paPost(WRITE_URL, { action: 'robot_names', names });
    return out.robotNames && typeof out.robotNames === 'object' ? out.robotNames : names;
  },
  async clientHours(week, hours) {
    if (DEMO) return demo.clientHours(week, hours);
    await paPost(WRITE_URL, { action: 'client', week, hours });
  },
  async upsertShifts(shifts) {
    if (DEMO) return demo.upsertShifts(shifts);
    const out = await paPost(WRITE_URL, { action: 'shift_upsert', shifts });
    return (out.shifts || []).map(normShift);
  },
  // An operator takes an open spot (someone didn't show): the flow books them into
  // that pair from now until the shift's end and answers with the new shift.
  async fillIn(shiftId) {
    if (DEMO) return demo.fillIn(shiftId);
    return normShift((await paPost(WRITE_URL, { action: 'fill_in', shiftId })).shift || {});
  },
  async removeShift(id) {
    if (DEMO) return demo.removeShift(id);
    await paPost(WRITE_URL, { action: 'shift_delete', id });
  },
  // Schedulers: ask for a Master List sync. Live, the flow queues it (202) and the next
  // check runs it (SYNC_CHECKS), so this answers null; the demo syncs at once.
  async syncSchedule() {
    if (DEMO) return demo.syncSchedule();
    await paPost(SYNC_URL, { action: 'schedule_sync' });
    return null;
  },
  async upsertUsers(users) {
    if (DEMO) return demo.upsertUsers(users);
    const out = await paPost(WRITE_URL, { action: 'users_upsert', users });
    return (out.users || []).map(normOperator);
  },
  // Delete someone added by mistake (admins; only with no records). Lotus Delete User.
  async deleteUser(email, reason) {
    if (DEMO) return demo.deleteUser(email, reason);
    return paPost(WRITE_URL, { action: 'user_delete', email, reason });
  },
  async resolveFlag(r) {
    if (DEMO) return demo.resolveFlag(r);
    return (await paPost(WRITE_URL, { action: 'resolve_flag', ...r })).resolution;
  },
  // One email per operator, already filled in; the flow checks each recipient
  // is a Lotus user, sends from the shared mailbox and records a notice.
  async sendEmails(body) {
    if (DEMO) return demo.sendEmails(body);
    const out = await paPost(WRITE_URL, { action: 'email_send', ...body });
    return (out.notices || []).map(normNotice);
  },
  async saveTemplate(t) {
    if (DEMO) return demo.saveTemplate(t);
    return (await paPost(WRITE_URL, { action: 'template_save', ...t })).template;
  },
  // An operator says they forgot to clock in or out (`missed`: in | out | both) on one
  // of their shifts. The flow emails the admins and copies the operator. Admins also
  // log a request that came by email (`source: 'email'`, with when it arrived).
  async requestCorrection(r) {
    if (DEMO) return demo.requestCorrection(r);
    return normCorrection((await paPost(CORRECTIONS_URL, { action: 'correction_request', ...r })).correction || {});
  },
  // Admins only: approve with the real times, or decline. A counted approval adds
  // the warning or strike rows and emails the operator.
  async resolveCorrection(r) {
    if (DEMO) return demo.resolveCorrection(r);
    const out = await paPost(CORRECTIONS_URL, { action: 'correction_resolve', ...r });
    return { correction: normCorrection(out.correction || {}), strikes: (out.strikes || []).map(normStrike) };
  },
  // Admins only: cancel a warning or strike, with a reason. It stays in the history.
  async voidStrike(id, reason) {
    if (DEMO) return demo.voidStrike(id, reason);
    return normStrike((await paPost(CORRECTIONS_URL, { action: 'strike_void', id, reason })).strike || {});
  },
  async approveDay(a, status) {
    if (DEMO) return demo.approveDay(a, status);
    const out = await paPost(WRITE_URL, { action: status === 'approved' ? 'approve_day' : 'reopen_day', ...a });
    return { ...out.approval, hours: Number(out.approval.hours) || 0 };
  },
};

// Who the demo is signed in as; the audit trail and approvals record it.
let demoActor = 'demo';
export const setDemoActor = (email) => { demoActor = email || 'demo'; };

export const demo = {
  KEY: 'lotus-demo-v6',
  load() {
    let d = storage.get(this.KEY, null);
    if (!d) { d = seed(); storage.set(this.KEY, d); }
    for (const k of ['schedule', 'operators', 'resolutions', 'approvals', 'audit', 'notices', 'templates', 'corrections', 'strikes', 'demoSheet', 'sheetSkips']) d[k] ||= [];
    d.robotNames ||= {};
    // Demo mode never sends email, so it behaves like test mode.
    d.emailTestMode = true;
    return structuredClone(d);
  },
  save(d, action, target, before, after) {
    d.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), by: demoActor, action, target, before: before ?? null, after: after ?? null });
    storage.set(this.KEY, d);
  },
  punch(b) {
    const d = this.load();
    const shift = b.shiftId ? d.schedule.find((r) => r.id === b.shiftId) : null;
    // Same checks the Write flow makes, so demo behaves like live.
    if (b.type === 'in') {
      const me = d.operators.find((o) => o.email === b.email);
      const at = shift ? locOf(shift) : b.location;
      if (me?.location && at && at !== me.location) { const e = new Error(`You can only clock in at ${locationName(me.location)}.`); e.code = 'lab'; throw e; }
      const c = clockInCheck(shift, new Date());
      if (!c.allowed) { const e = new Error(c.reason === 'no_shift' ? 'You have no shift to clock into.' : c.reason === 'early' ? `Clock-in opens at ${c.window.opensAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'That shift has ended'); e.code = c.reason; throw e; }
      b = { ...b, grace: c.grace };
    } else {
      const open = [...d.punches].reverse().find((p) => p.email === b.email);
      if (open?.type === 'in') b = { ...b, shiftId: open.shiftId, location: open.location, station: open.station };
    }
    // The time is always now, whatever the request says: no backdating.
    const p = normPunch({ ...b, id: crypto.randomUUID(), ts: new Date().toISOString() });
    d.punches.push(p);
    this.save(d, 'punch', p.id, null, p);
    return p;
  },
  robotNames(names) {
    const d = this.load();
    const before = d.robotNames || {};
    d.robotNames = { ...names };
    this.save(d, 'robot_names', 'robots', before, d.robotNames);
    return d.robotNames;
  },
  clientHours(week, hours) {
    const d = this.load();
    d.client = d.client.filter((c) => c.week !== week).concat(hours == null ? [] : [{ week, hours }]);
    this.save(d, 'client', week, null, { week, hours });
  },
  upsertShifts(shifts) {
    const d = this.load();
    for (const s of shifts) {
      const op = d.operators.find((o) => o.email === s.email);
      const at = s.location || locOf(s);
      if (op?.location && at && at !== op.location) throw new Error(`${op.name} works at ${locationName(op.location)} only.`);
    }
    const out = shifts.map((s) => {
      const i = s.id ? d.schedule.findIndex((r) => r.id === s.id) : -1;
      const r = normShift({ ...s, id: s.id || `S-${crypto.randomUUID().slice(0, 8)}`, location: s.location || locOf(s), source: s.source || (i >= 0 ? d.schedule[i].source : '') || 'app', sheetKey: s.sheetKey || (i >= 0 ? d.schedule[i].sheetKey : '') });
      if (i >= 0) { const before = d.schedule[i]; d.schedule[i] = r; d.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), by: demoActor, action: 'shift_upsert', target: r.id, before, after: r }); } else { d.schedule.push(r); d.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), by: demoActor, action: 'shift_upsert', target: r.id, before: null, after: r }); }
      return r;
    });
    storage.set(this.KEY, d);
    return out;
  },
  fillIn(shiftId) {
    const d = this.load();
    const me = d.operators.find((o) => o.email === demoActor);
    const spot = openSpots(d, demoActor, me?.location || '').find((x) => x.shiftId === shiftId);
    if (!spot) throw new Error('That spot is already filled, or the shift is nearly over.');
    const gone = d.schedule.find((r) => r.id === shiftId);
    const pair = gone.pair || `P-${crypto.randomUUID().slice(0, 8)}`;
    // Everyone in the pair gets the pair id, so the newcomer's partners see their name.
    for (const r of d.schedule) if (r.id === gone.id || (!r.pair && samePair(r, gone))) r.pair = pair;
    const now = new Date();
    const start = `${String(now.getHours()).padStart(2, '0')}:${String(Math.floor(now.getMinutes() / 5) * 5).padStart(2, '0')}`;
    const r = normShift({ id: `S-${crypto.randomUUID().slice(0, 8)}`, date: gone.date, operatorId: me?.id || '', name: me?.name || demoActor, email: demoActor, location: gone.location, station: gone.station, template: gone.template, start, end: gone.end, note: `Filled in for a no-show`, pair, replaces: gone.id });
    d.schedule.push(r);
    this.save(d, 'fill_in', r.id, null, r);
    return r;
  },
  removeShift(id) {
    const d = this.load();
    const before = d.schedule.find((r) => r.id === id);
    d.schedule = d.schedule.filter((r) => r.id !== id);
    // As Delete Shift does live: a sheet shift removed by hand stays out of later syncs.
    if (before?.sheetKey && before.date >= dayKey(new Date()) && !d.sheetSkips.includes(before.sheetKey)) d.sheetSkips.push(before.sheetKey);
    this.save(d, 'shift_delete', id, before, null);
  },
  // Demo: a made-up Master List (seed's demoSheet), synced with the same rules as the flow.
  syncSchedule() {
    const d = this.load();
    const plan = planSheetSync({ rows: d.demoSheet, shifts: d.schedule.map(normShift), users: d.operators, skips: d.sheetSkips, today: dayKey(new Date()), includeToday: syncIncludesToday(), labs: LOCATIONS });
    const gone = new Set(plan.remove);
    const changed = new Map(plan.update.map((r) => [r.id, r]));
    d.schedule = d.schedule.filter((r) => !gone.has(r.id)).map((r) => changed.get(r.id) || r)
      .concat(plan.add.map((r) => normShift({ ...r, id: `S-${crypto.randomUUID().slice(0, 8)}` })));
    d.scheduleSync = syncSummary(plan);
    this.save(d, 'schedule_sync', 'master-list', null, { added: plan.add.length, changed: plan.update.length, removed: plan.remove.length });
    return normScheduleSync(d.scheduleSync);
  },
  upsertUsers(users) {
    const d = this.load();
    let n = Math.max(0, ...d.operators.map((o) => Number(String(o.id).replace(/\D/g, '')) || 0));
    const out = users.map((u) => {
      const i = d.operators.findIndex((o) => o.email === u.email);
      const before = i >= 0 ? d.operators[i] : null;
      const o = normOperator({ roles: ['operator'], ...before, ...u, id: before?.id || u.id || `OP-${String(++n).padStart(4, '0')}` });
      if (i >= 0) d.operators[i] = o; else d.operators.push(o);
      d.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), by: demoActor, action: 'users_upsert', target: o.id, before, after: o });
      return o;
    });
    storage.set(this.KEY, d);
    return out;
  },
  deleteUser(email, reason) {
    const d = this.load();
    if (!String(reason || '').trim()) throw Object.assign(new Error('Add a reason.'), { status: 400 });
    const o = d.operators.find((x) => x.email === email);
    if (!o) throw Object.assign(new Error('That person isn’t in Lotus.'), { status: 404 });
    const has = (list) => (list || []).some((r) => r.email === email);
    if (has(d.punches) || has(d.approvals) || has(d.corrections) || has(d.strikes)) throw Object.assign(new Error('They already have records. Set them Inactive instead.'), { status: 409, code: 'has_records' });
    const shifts = d.schedule.filter((r) => r.email === email).length;
    d.schedule = d.schedule.filter((r) => r.email !== email);
    d.resolutions = (d.resolutions || []).filter((r) => !String(r.key || '').startsWith(`${email}|`));
    d.operators = d.operators.filter((x) => x.email !== email);
    this.save(d, 'user_delete', o.id, o, { reason, removedShifts: shifts });
    return { ok: true, removedShifts: shifts };
  },
  resolveFlag(r) {
    if (!String(r.reason || '').trim()) throw new Error('Add a reason');
    const d = this.load();
    const res = { key: r.key, outcome: r.outcome, reason: r.reason.trim(), endTime: r.endTime || '', by: demoActor, at: new Date().toISOString() };
    const before = d.resolutions.find((x) => x.key === r.key) || null;
    d.resolutions = d.resolutions.filter((x) => x.key !== r.key).concat(res);
    // A forgotten clock-out counts as a miss, once per operator and day, as the flow does.
    const [email, date, code] = r.key.split('|');
    if (code === 'no_clockout' && !before) { const st = this.addStrike(d, { email, date, reason: 'missed_out', ref: r.key }); if (st) st.emailed = mustEmail(standing(d.strikes, email).count); }
    this.save(d, 'resolve_flag', r.key, before, res);
    return res;
  },
  addStrike(d, { email, date, reason, ref, emailed = false }) {
    if (d.strikes.some((x) => x.email === email && x.date === date && x.reason === reason && !x.voided)) return null;
    const o = d.operators.find((x) => x.email === email);
    const st = normStrike({ id: `K-${crypto.randomUUID().slice(0, 8)}`, email, name: o?.name || email, operatorId: o?.id || '', date, reason, ref, at: new Date().toISOString(), by: demoActor, emailed });
    d.strikes.push(st);
    d.audit.push({ id: crypto.randomUUID(), at: st.at, by: demoActor, action: 'strike_add', target: st.id, before: null, after: st });
    return st;
  },
  requestCorrection(r) {
    if (!String(r.message || '').trim()) throw new Error('Say what happened.');
    const d = this.load();
    const shift = d.schedule.find((x) => x.id === r.shiftId);
    const email = r.source === 'email' ? r.email : demoActor;
    if (!shift || shift.email !== email) throw new Error('That shift isn’t yours.');
    if (shiftTimes(shift).start > new Date()) throw new Error('That shift hasn’t started yet.');
    if (d.corrections.some((c) => c.shiftId === r.shiftId && c.status !== 'declined')) throw new Error('There’s already a request for that shift.');
    const c = normCorrection({ id: `C-${crypto.randomUUID().slice(0, 8)}`, email, name: shift.name, operatorId: shift.operatorId, date: shift.date, shiftId: shift.id, missed: r.missed, message: r.message.trim(), source: r.source === 'email' ? 'email' : 'app', requestedAt: r.source === 'email' && r.requestedAt ? r.requestedAt : new Date().toISOString(), status: 'open' });
    d.corrections.push(c);
    this.save(d, 'correction_request', c.id, null, c);
    return c;
  },
  resolveCorrection(r) {
    const d = this.load();
    const i = d.corrections.findIndex((c) => c.id === r.id);
    if (i < 0) throw new Error('That request is gone.');
    const before = d.corrections[i];
    if (before.status !== 'open') throw new Error('That request was already handled.');
    if (!String(r.note || '').trim()) throw new Error('Add a note.');
    if (r.status === 'approved' && !(r.timeIn && r.timeOut && new Date(r.timeOut) > new Date(r.timeIn))) throw new Error('The clock-out has to be after the clock-in.');
    if (r.status === 'approved' && r.counts === false && !String(r.noCountReason || '').trim()) throw new Error('Say why it doesn’t count.');
    const c = normCorrection({ ...before, status: r.status, timeIn: r.status === 'approved' ? r.timeIn : '', timeOut: r.status === 'approved' ? r.timeOut : '', partnerConfirmed: !!r.partnerConfirmed, note: r.note.trim(), counts: r.status === 'approved' && r.counts !== false, noCountReason: r.counts === false ? String(r.noCountReason || '').trim() : '', resolvedBy: demoActor, resolvedAt: new Date().toISOString() });
    d.corrections[i] = c;
    const strikes = [];
    if (c.status === 'approved' && c.counts) {
      const shift = d.schedule.find((x) => x.id === c.shiftId);
      for (const reason of reasonsFor(c, shift)) {
        const st = this.addStrike(d, { email: c.email, date: c.date, reason, ref: c.id });
        if (!st) continue;
        // The Strike 3 email always goes; earlier ones only if the admin chose to.
        st.emailed = !!r.notify || mustEmail(standing(d.strikes, c.email).count);
        strikes.push(st);
      }
    }
    this.save(d, 'correction_resolve', c.id, before, c);
    return { correction: c, strikes };
  },
  voidStrike(id, reason) {
    if (!String(reason || '').trim()) throw new Error('Say why you’re cancelling it.');
    const d = this.load();
    const i = d.strikes.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('That strike is gone.');
    const before = d.strikes[i];
    const st = { ...before, voided: true, voidReason: reason.trim(), voidedBy: demoActor, voidedAt: new Date().toISOString() };
    d.strikes[i] = st;
    this.save(d, 'strike_void', id, before, st);
    return st;
  },
  approveDay(a, status) {
    const hours = Math.round(Number(a.hours) * 100) / 100;
    if ((status !== 'approved' || Math.abs(hours - a.computed) > 0.005) && !String(a.note || '').trim()) throw new Error(status === 'approved' ? 'Add a note for the adjustment' : 'Add a reason for reopening');
    const d = this.load();
    const rec = { email: a.email, operatorId: a.operatorId, date: a.date, status, hours, computed: Math.round(a.computed * 100) / 100, note: String(a.note || '').trim(), final: false, by: demoActor, at: new Date().toISOString() };
    d.approvals.push(rec);
    this.save(d, status === 'approved' ? 'approve_day' : 'reopen_day', `${a.email}|${a.date}`, null, rec);
    return rec;
  },
  sendEmails(body) {
    const d = this.load();
    const sentAt = new Date().toISOString();
    const out = (body.messages || []).map((m) => {
      if (!d.operators.some((o) => o.email === m.to)) throw new Error(`${m.to} isn't a Lotus user`);
      const n = normNotice({ id: `N-${crypto.randomUUID().slice(0, 8)}`, email: m.to, operatorId: m.operatorId, weekStart: body.weekStart, kind: m.kind, subject: m.subject, sentAt, by: demoActor, test: true, snapshot: m.snapshot });
      d.notices.push(n);
      d.audit.push({ id: crypto.randomUUID(), at: sentAt, by: demoActor, action: 'email_send', target: n.id, before: null, after: { ...n, snapshot: undefined } });
      return n;
    });
    storage.set(this.KEY, d);
    return out;
  },
  saveTemplate(t) {
    const d = this.load();
    const before = d.templates.find((x) => x.id === t.id) || null;
    const rec = { id: t.id, subject: t.subject, html: t.html, ready: t.ready, original: !!t.original, updatedAt: new Date().toISOString(), updatedBy: demoActor };
    d.templates = d.templates.filter((x) => x.id !== t.id).concat([rec]);
    this.save(d, 'template_save', t.id, before && { ...before, html: undefined, ready: undefined }, { ...rec, html: undefined, ready: undefined });
    return rec;
  },
  reset() { storage.remove(this.KEY); },
};

// Two weeks of made-up shifts at both labs, so every view and flag has something to show.
function seed() {
  const R = LOCATIONS.find((l) => l.id === 'RED') || LOCATIONS[0];
  const M = LOCATIONS.find((l) => l.id === 'MTV') || LOCATIONS[LOCATIONS.length - 1];
  const tpl = (loc, i) => loc.templates[i] || loc.templates[0] || { id: '', start: '08:00', end: `${8 + CFG.shiftHours}:00` };
  const today = dayKey(new Date());
  const ops = [
    ['Avery Lin', R, 14], ['Jordan Pike', R, 12], ['Sam Okafor', R, 9], ['Riley Chen', R, 11],
    ['Morgan Diaz', R, 16], ['Casey Novak', R, 7], ['Jamie Ortiz', R, 8], ['Priya Raman', R, 10],
    ['Taylor Brooks', R, 13], ['Quinn Hale', R, 6], ['Drew Sato', R, 1], ['Reese Park', R, 0],
    ['Alex Moreno', M, 9], ['Blair Kim', M, 5], ['Cameron Wu', M, 4], ['Dana Ito', M, 3],
    ['Sky Patel', R, 2], ['Kai Tan', R, 15], ['Noor Aziz', R, 8], ['Lena Ross', R, 6], ['Omar Haddad', R, 5],
  ].map(([name, loc, done], i) => ({
    id: `OP-${String(i + 1).padStart(4, '0')}`, email: `${name.toLowerCase().replace(' ', '.')}@example.com`, name,
    location: loc.id, roles: ['operator'], cohort: done >= 8 ? 'Cohort 1' : done >= 3 ? 'Cohort 2' : 'Cohort 3',
    completedSessions: done, completedAsOf: today, training: done >= 2 ? 'Trained' : 'In training', active: true,
    // An admin's mark: Lena has sessions on record but isn't ready to lead a pair yet.
    experience: name === 'Lena Ross' ? 'new' : '',
  }));
  const op = (n) => ops.find((o) => o.name === n);
  // Robot, template, the pair on it, and the days they work. Redmond runs every day:
  // a pair on Morning, a pair on Afternoon and two pairs (both robots) on Night.
  const WEEKDAYS = [1, 2, 3, 4, 5];
  const WEEKEND = [0, 6];
  const R2 = R.robots[1] || R.robots[0];
  const crews = [
    [R.robots[0], tpl(R, 0), 'Avery Lin', 'Jordan Pike', WEEKDAYS],
    [R.robots[0], tpl(R, 1), 'Morgan Diaz', 'Casey Novak', WEEKDAYS],
    [R.robots[0], tpl(R, 2), 'Taylor Brooks', 'Quinn Hale', WEEKDAYS],
    // Two operators with fewer than 2 completed sessions together: a pairing risk.
    [R2, tpl(R, 2), 'Drew Sato', 'Reese Park', WEEKDAYS],
    [R.robots[0], tpl(R, 0), 'Sam Okafor', 'Riley Chen', WEEKEND],
    [R.robots[0], tpl(R, 1), 'Jamie Ortiz', 'Priya Raman', WEEKEND],
    [R.robots[0], tpl(R, 2), 'Kai Tan', 'Noor Aziz', WEEKEND],
    [R2, tpl(R, 2), 'Lena Ross', 'Omar Haddad', WEEKEND],
    [M.robots[0], tpl(M, 0), 'Alex Moreno', 'Blair Kim', WEEKDAYS],
    [M.robots[0], tpl(M, 1), 'Cameron Wu', 'Dana Ito', WEEKDAYS],
  ];
  const schedule = [];
  const punches = [];
  let seq = 1;
  const book = (k, who, robot, t, note = '') => {
    const o = op(who);
    const loc = locationOfRobot(robot);
    const r = { id: `S-demo${seq++}`, date: k, operatorId: o.id, name: o.name, email: o.email, location: loc?.id || '', station: robot, template: t.id, start: t.start, end: t.end, note };
    schedule.push(r);
    return r;
  };
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const at = (k, hm, mins = 0) => { const [y, mo, da] = k.split('-').map(Number); const [h, m] = hm.split(':').map(Number); return new Date(y, mo - 1, da, h, m + mins, 0, 0); };
  const punch = (t, r, type, extra = {}) => punches.push({ id: `P-demo${seq++}`, ts: t.toISOString(), operatorId: r.operatorId, name: r.name, email: r.email, type, location: r.location, station: r.station, shiftId: r.shiftId ?? r.id, grace: 0, source: 'laptop', note: '', flag: '', ...extra });

  const now = new Date();
  const wk0 = mondayOf(now);
  const start = addDays(wk0, -7);
  const end = addDays(wk0, 13);
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const k = dayKey(d);
    const di = Math.round((d - start) / 864e5);
    for (const [robot, t, a, b, on] of crews) {
      if (!on.includes(d.getDay())) continue;
      for (const who of [a, b]) {
        const r = book(k, who, robot, t);
        const sIn = at(k, t.start);
        const sOut = at(k, t.end);
        if (sIn > now) continue;
        // Arrive a few minutes either side of the start; a tap before it uses grace.
        const early = Math.round(rnd() * 9) - 6;
        const tin = new Date(sIn.getTime() + early * 6e4);
        if (who === 'Casey Novak' && k === today) continue; // a no-show today
        if (tin > now) continue;
        if (who === 'Quinn Hale' && di === 3) continue; // forgot to clock in and out last Thursday
        // Forgot to clock in last Thursday, but clocked out.
        if (!(who === 'Morgan Diaz' && di === 3)) punch(tin, r, 'in', { grace: early < 0 ? -early : 0 });
        if (who === 'Jordan Pike' && di === 2) continue; // forgot to clock out last Wednesday (before auto clock-out)
        // Forgot to clock out last Thursday: the Auto Clock-out flow closed the shift.
        if (who === 'Jordan Pike' && di === 3) { if (+sOut + 15 * 6e4 <= +now) punch(sOut, r, 'out', { flag: 'auto', source: 'system' }); continue; }
        let tout = new Date(sOut.getTime() + (Math.round(rnd() * 4) - 1) * 6e4);
        let extra = {};
        if (who === 'Riley Chen' && di === 5) { tout = at(k, t.start, 195); extra = { flag: 'early', note: 'Felt unwell, told the client lead' }; }
        if (who === 'Priya Raman' && di === 6) tout = at(k, t.end, 18); // stayed late to finish a reset
        if (who === 'Taylor Brooks' && di === 4) tout = at(k, t.end, 12);
        if (tout > now) continue;
        punch(tout, r, 'out', extra);
      }
    }
  }
  // Someone who came in with no shift last Friday.
  const fri = dayKey(addDays(start, 4));
  const sky = op('Sky Patel');
  punch(at(fri, '12:05'), { ...sky, operatorId: sky.id, location: R.id, station: R.robots[0], shiftId: '' }, 'in');
  punch(at(fri, '15:10'), { ...sky, operatorId: sky.id, location: R.id, station: R.robots[0], shiftId: '' }, 'out');
  // Next week: Morgan picks up extra mornings (over 37 hrs). Nobody works at both
  // labs: each operator stays at their home lab.
  for (let i = 0; i < 3; i++) book(dayKey(addDays(wk0, 7 + i)), 'Morgan Diaz', R.robots[0], tpl(R, 0), 'Extra cover');

  punches.sort((x, y) => x.ts.localeCompare(y.ts));

  // Missed clock-in or out requests (demo): Jordan's and Quinn's wait for an admin
  // (Quinn's came two days late), Morgan's was corrected. Quinn already had a soft
  // warning; Kai's older one has run out and a newer one was cancelled.
  const corrections = [];
  const strikes = [];
  const shiftOf = (name, i) => schedule.find((r) => r.name === name && r.date === dayKey(addDays(start, i)));
  const ask = (r, extra) => r && at(r.date, r.end) < now && corrections.push({ id: `C-demo${seq++}`, email: r.email, name: r.name, operatorId: r.operatorId, date: r.date, shiftId: r.id, source: 'app', status: 'open', ...extra });
  const jp = shiftOf('Jordan Pike', 2);
  ask(jp, { missed: 'out', message: 'Demo: I forgot to tap out when I left at the end of the shift. Avery was on the robot with me.', requestedAt: jp && at(jp.date, jp.end, 150).toISOString() });
  const qh = shiftOf('Quinn Hale', 3);
  ask(qh, { missed: 'both', message: 'Demo: my phone died before the shift, so I couldn’t clock in or out. I was there the whole night with Taylor.', requestedAt: qh && at(dayKey(addDays(start, 5)), '09:10').toISOString() });
  const md = shiftOf('Morgan Diaz', 3);
  const mdOut = md && punches.find((p) => p.shiftId === md.id && p.type === 'out');
  if (md && mdOut) {
    const resolvedAt = at(dayKey(addDays(start, 4)), '10:20').toISOString();
    corrections.push({ id: `C-demo${seq++}`, email: md.email, name: md.name, operatorId: md.operatorId, date: md.date, shiftId: md.id, missed: 'in', message: 'Demo: I forgot to clock in, I got there on time.', source: 'app', requestedAt: at(md.date, md.start, 75).toISOString(), status: 'approved', partnerConfirmed: true, timeIn: at(md.date, md.start).toISOString(), timeOut: mdOut.ts, note: 'Demo: Casey confirmed Morgan was there from the start.', counts: true, resolvedBy: 'admin@example.com', resolvedAt });
    strikes.push({ id: `K-demo${seq++}`, email: md.email, name: md.name, operatorId: md.operatorId, date: md.date, reason: 'missed_in', ref: corrections[corrections.length - 1].id, at: resolvedAt, by: 'admin@example.com', voided: false });
  }
  const strikeFor = (name, daysAgo, reason, extra = {}) => { const o = op(name); strikes.push({ id: `K-demo${seq++}`, email: o.email, name: o.name, operatorId: o.id, date: dayKey(addDays(now, -daysAgo)), reason, ref: '', at: addDays(now, -daysAgo).toISOString(), by: 'admin@example.com', voided: false, ...extra }); };
  strikeFor('Quinn Hale', 20, 'missed_out');
  strikeFor('Kai Tan', 45, 'missed_in');
  strikeFor('Kai Tan', 5, 'missed_out', { voided: true, voidReason: 'Demo: the lab Wi-Fi was down, so nobody could clock out.', voidedBy: 'admin@example.com', voidedAt: addDays(now, -4).toISOString() });

  // Last week Monday to Wednesday approved already; the rest waits for review.
  const approvals = [];
  for (let i = 0; i < 3; i++) {
    const k = dayKey(addDays(start, i));
    for (const o of ops) {
      const mine = schedule.filter((r) => r.email === o.email && r.date === k);
      if (!mine.length || (o.name === 'Jordan Pike' && i === 2)) continue;
      const h = mine.reduce((a, r) => a + (at(k, r.end) - at(k, r.start)) / 36e5, 0);
      approvals.push({ email: o.email, operatorId: o.id, date: k, status: 'approved', hours: h, computed: h, note: '', final: false, by: 'manager@example.com', at: at(dayKey(addDays(start, 7)), '09:30', i).toISOString() });
    }
  }
  // Schedule emails: this week went to everyone last Friday. Next week went out
  // yesterday to the weekday crews, and some shifts moved after that; the
  // weekend crews haven't had theirs yet.
  const notices = [];
  const snap = (rows) => rows.map((r) => ({ id: r.id, date: r.date, start: r.start, end: r.end, station: r.station, location: r.location, template: r.template }));
  const sendTo = (o, wk, sentAt, tweak = (x) => x) => {
    const rows = schedule.filter((r) => r.email === o.email && r.date >= dayKey(wk) && r.date < dayKey(addDays(wk, 7)) && r.note === '');
    if (!rows.length) return;
    notices.push({ id: `N-demo${seq++}`, email: o.email, operatorId: o.id, weekStart: dayKey(wk), kind: 'schedule', subject: `Your Lotus schedule for ${dayKey(wk)}`, sentAt: sentAt.toISOString(), by: 'scheduler@example.com', test: true, snapshot: tweak(snap(rows)) });
  };
  const wk1 = addDays(wk0, 7);
  for (const o of ops) sendTo(o, wk0, at(dayKey(addDays(wk0, -3)), '09:14'));
  const weekday = new Set(crews.filter((c) => c[4] === WEEKDAYS).flatMap((c) => [c[2], c[3]]));
  for (const o of ops.filter((x) => weekday.has(x.name) && !['Avery Lin', 'Jordan Pike'].includes(x.name))) {
    sendTo(o, wk1, at(dayKey(addDays(now, -1)), '09:14'), (rows) => {
      // Drew's Wednesday was on Robot 1 when the email went out; Reese also had a Saturday.
      if (o.name === 'Drew Sato') return rows.map((r) => (r.date === dayKey(addDays(wk1, 2)) ? { ...r, station: R.robots[0] } : r));
      if (o.name === 'Reese Park') return [...rows, { id: 'S-demo-gone', date: dayKey(addDays(wk1, 5)), start: tpl(R, 2).start, end: tpl(R, 2).end, station: R2, location: R.id, template: tpl(R, 2).id }];
      return rows;
    });
  }
  // A made-up Master List for the demo's "Sync now": next days' crews as sheet rows,
  // with a few edits the scheduling team might make. The shifts it made are marked as
  // synced from it, so the first sync shows a changed time, a removed row and two rows
  // it can't book.
  const ampm = (hm) => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const label = (r) => locationOfRobot(r.station)?.templates.find((t) => t.id === r.template)?.label || 'Other';
  const sheetRows = schedule.filter((r) => r.date > today && !r.note)
    .map((r) => ({ lab: r.location, date: r.date, shift: label(r), time: `${ampm(r.start)} - ${ampm(r.end)} PT`, name: r.name, email: r.email }));
  const first = planSheetSync({ rows: sheetRows, users: ops, today, labs: LOCATIONS });
  for (const r of schedule) {
    const k = r.date > today && !r.note ? sheetKey(r.location, r.date, label(r), r.email) : '';
    const made = k && first.add.find((x) => x.sheetKey === k);
    if (made) Object.assign(r, { source: SHEET_SOURCE, sheetKey: k, pair: made.pair });
  }
  const demoSheet = sheetRows.map((x) => ({ ...x }));
  const mtv = demoSheet.find((x) => x.lab === M.id && x.date > dayKey(addDays(now, 1)));
  if (mtv) mtv.time = `8:00 AM - ${mtv.time.split(' - ')[1]}`;
  const drop = demoSheet.findIndex((x) => x.lab === R.id && x.shift === 'Night' && x.date > dayKey(addDays(now, 2)));
  if (drop >= 0) demoSheet.splice(drop, 1);
  const k3 = dayKey(addDays(now, 3));
  demoSheet.push({ lab: R.id, date: k3, shift: 'Night', time: '5:00 PM - 11:00 PM PT', name: 'Jesse Lane', email: 'jesse.lane@example.com' });
  demoSheet.push({ lab: M.id, date: k3, shift: 'Morning', time: '7:00 AM - 12:00 PM PT', name: 'Robin Vale', email: '' });
  return { operators: ops, punches, client: [{ week: dayKey(start), hours: 61.5 }], schedule, resolutions: [], approvals, audit: [], notices, templates: [], corrections, strikes, demoSheet, sheetSkips: [], scheduleSync: null };
}
