// The save queue (the Atlas pattern). A change shows on screen at once and waits
// here; the queue sends it to the Write flow in the background, a few at a time,
// and tries again on its own when Power Automate is slow or busy. Nobody waits on
// a flow run. Nothing here is approvals or clock-ins: those stay server-confirmed.
//
// A job is { id, kind, body, label, owner, tries, state, nextAt, error, unsure }.
//   state: waiting | sending | stuck
//   unsure: an earlier try may have saved (timeout, 502, 504), so new shifts are
//           looked for in a fresh Read before they go again.
// Everything below is pure: the store runs it.

const byId = (rows, ids) => (rows || []).filter((r) => !ids.has(r.id));
const shiftKey = (r) => [r.email, r.date, r.start, r.location].join('|');

export const KINDS = {
  // Body { shifts }: new shifts carry a tmp- id on screen, which isn't sent.
  shifts: {
    keys: (b) => b.shifts.map((r) => `shift:${r.id}`),
    apply(d, b) {
      const ids = new Set(b.shifts.map((r) => r.id));
      return { ...d, schedule: byId(d.schedule, ids).concat(b.shifts.map((r) => ({ ...r, pending: true }))) };
    },
    settle(d, b, saved) {
      const ids = new Set([...b.shifts.map((r) => r.id), ...saved.map((r) => r.id)]);
      return { ...d, schedule: byId(d.schedule, ids).concat(saved) };
    },
    // After a try that may have saved: new shifts already on the server count as saved.
    found(fresh, b) {
      const have = new Map((fresh.schedule || []).map((r) => [shiftKey(r), r]));
      const saved = [];
      const rest = [];
      for (const r of b.shifts) {
        const hit = isTemp(r.id) && have.get(shiftKey(r));
        if (hit) saved.push(hit); else rest.push(r);
      }
      return { saved, rest: rest.length ? { ...b, shifts: rest } : null };
    },
  },
  // Body { id }.
  shiftDelete: {
    keys: (b) => [`shift:${b.id}`],
    apply: (d, b) => ({ ...d, schedule: byId(d.schedule, new Set([b.id])) }),
    settle: (d, b) => ({ ...d, schedule: byId(d.schedule, new Set([b.id])) }),
  },
  // Body { users: [{ email, ...changed fields }] }: people already on the roster.
  users: {
    keys: (b) => b.users.map((u) => `user:${u.email}`),
    apply(d, b) {
      const by = new Map(b.users.map((u) => [u.email, u]));
      return { ...d, operators: (d.operators || []).map((o) => (by.has(o.email) ? { ...o, ...by.get(o.email), pending: true } : o)) };
    },
    settle(d, b, saved) {
      const by = new Map((d.operators || []).map((o) => [o.email, o]));
      for (const o of saved) by.set(o.email, o);
      return { ...d, operators: [...by.values()] };
    },
  },
  // Body { key, outcome, reason, endTime, by }.
  flag: {
    keys: (b) => [`flag:${b.key}`],
    apply: (d, b) => ({ ...d, resolutions: (d.resolutions || []).filter((x) => x.key !== b.key).concat({ ...b, at: b.at || new Date().toISOString(), pending: true }) }),
    settle: (d, b, res) => ({ ...d, resolutions: (d.resolutions || []).filter((x) => x.key !== b.key).concat(res) }),
  },
  // Body { week, hours }: the client's successful hours for a week (null clears).
  client: {
    keys: (b) => [`client:${b.week}`],
    apply: (d, b) => ({ ...d, client: (d.client || []).filter((c) => c.week !== b.week).concat(b.hours == null ? [] : [{ week: b.week, hours: b.hours }]) }),
    settle: (d, b) => KINDS.client.apply(d, b),
  },
};

export const isTemp = (id) => String(id || '').startsWith('tmp-');
export const keysOf = (j) => KINDS[j.kind].keys(j.body);

// What's on screen: the last server copy with every unsent change on top.
export function overlay(base, jobs) {
  if (!base) return base;
  return jobs.reduce((d, j) => KINDS[j.kind].apply(d, j.body), base);
}

// Jobs that may start now, oldest first. A job waits while an earlier unfinished job
// touches the same shift, person, flag or week, so changes land in the order made.
export function ready(jobs, now, limit = 3) {
  const taken = new Set();
  let sending = jobs.filter((j) => j.state === 'sending').length;
  const out = [];
  for (const j of jobs) {
    const keys = keysOf(j);
    const blocked = keys.some((k) => taken.has(k));
    keys.forEach((k) => taken.add(k));
    if (sending >= limit) break;
    if (blocked || j.state !== 'waiting' || (j.nextAt || 0) > now) continue;
    out.push(j);
    sending += 1;
  }
  return out;
}

// After a failed try: wait longer each time. 4xx (other than 401, 408, 429) means
// the flow refused it, and sending it again won't help.
const WAITS = [5, 15, 30, 60, 120];
export const MAX_TRIES = 6;
export const refused = (e) => !!e.status && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status);
// No answer, or a gateway error: the flow may have saved before it failed.
export const unsure = (e) => !e.status || [500, 502, 504].includes(e.status);
export function afterFail(j, e, now) {
  const tries = (j.tries || 0) + 1;
  const base = { ...j, tries, error: e.message || 'No answer', unsure: j.unsure || unsure(e) };
  if (tries >= MAX_TRIES) return { ...base, state: 'stuck' };
  return { ...base, state: 'waiting', nextAt: now + WAITS[Math.min(tries - 1, WAITS.length - 1)] * 1000 };
}
