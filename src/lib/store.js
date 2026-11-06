import { create } from 'zustand';
import { toast } from 'sonner';
import { api, demo, normNotice, setDemoActor, storage, whenSignedOut } from './api.js';
import { AUTH_URL, DEMO, setDemo } from './config.js';
import * as auth from './auth/api.js';
import { getAuth, setAuth } from './auth/session.js';
import { KINDS, MAX_TRIES, afterFail, isTemp, overlay, ready, refused } from './outbox.js';

let noticeTimer;
let pumpTimer;
const punchChain = new Map();

const cached = storage.get('onsite-cache', null);
const ADMIN_KEY = 'lotus-has-admin';
const hasAdmin = () => !!AUTH_URL && storage.get(ADMIN_KEY, false);
const markAdmin = () => { if (AUTH_URL) storage.set(ADMIN_KEY, true); };
storage.remove('lotus-session'); // the old demo picker's sign-in

// The app's view of a sign-in: { token, expiresAt, username, email, name, roles,
// operatorId, mustChange, demoPicker, picked }.
const sessionOf = (a) => (a ? { token: a.token, expiresAt: a.expiresAt, ...a.user, roles: a.user.roles || [], mustChange: !!a.user.mustChangePassword } : null);
const stageOf = (s) => (!s ? 'signedOut' : s.mustChange ? 'mustChange' : s.demoPicker && !s.picked ? 'pick' : 'signedIn');
const savedSession = sessionOf(getAuth());
setDemoActor(savedSession?.email);

// The save queue (lib/outbox.js) lives in this browser until it's sent, so a
// reload or a dropped connection loses nothing. Only live data is queued here; it
// belongs to whoever queued it and only goes out under their sign-in.
const OUTBOX = 'lotus-outbox-v1';
const loadJobs = (email) => {
  if (DEMO || !email) return [];
  const o = storage.get(OUTBOX, null);
  if (!o || o.owner !== email) return [];
  // A try that was under way when the page closed may have saved.
  return (o.jobs || []).map((j) => (j.state === 'sending' ? { ...j, state: 'waiting', unsure: true, nextAt: 0 } : j));
};
const keepJobs = (email, jobs) => {
  if (DEMO || !email) return;
  if (jobs.length) storage.set(OUTBOX, { owner: email, jobs });
  else storage.remove(OUTBOX);
};

// How each kind of job is sent. New shifts' tmp- ids stay in this browser.
const strip = ({ pending, ...r }) => r;
const SEND = {
  shifts: (b) => api.upsertShifts(b.shifts.map((r) => { const { id, ...rest } = strip(r); return isTemp(id) ? rest : { id, ...rest }; })),
  shiftDelete: (b) => api.removeShift(b.id),
  users: (b) => api.upsertUsers(b.users.map(strip)),
  flag: ({ key, outcome, reason, endTime }) => api.resolveFlag({ key, outcome, reason, endTime }),
  client: (b) => api.clientHours(b.week, b.hours),
};
// Kept a few minutes after they land, so a Read that started before they did
// doesn't briefly undo them.
let recent = [];
const RECENT_MS = 3 * 60 * 1000;
const reSettle = (base) => {
  recent = recent.filter((r) => Date.now() - r.at < RECENT_MS);
  return recent.reduce((d, r) => KINDS[r.job.kind].settle(d, r.job.body, r.result), base);
};

export const useStore = create((set, get) => ({
  // `base` is the last server copy plus what the server confirmed since; `data`
  // (what every view reads) is `base` with the unsent changes in `jobs` on top.
  base: cached?.data || null,
  jobs: loadJobs(savedSession?.email),
  data: overlay(cached?.data || null, loadJobs(savedSession?.email)),
  loadedAt: cached?.at ? new Date(cached.at) : null,
  syncing: false,
  error: '',
  // Demo data on or off in this browser (see config.js). Components read DEMO; this
  // copy is here so they re-render when it flips.
  demo: DEMO,

  // Who is signed in (see sessionOf), and where sign-in stands: checking | setup |
  // signedOut | mustChange | pick (demo operator account) | signedIn.
  session: savedSession,
  // The sign-in form shows at once; the first-admin check runs behind it (see init).
  authStage: savedSession ? stageOf(savedSession) : 'signedOut',

  me: storage.get('onsite-me', null), // { name, email, station }
  device: storage.get('onsite-device', null), // 'personal' | 'shared'
  theme: storage.get('onsite-theme', 'system'), // 'system' | 'light' | 'dark'

  // Signed out: see whether the first admin still has to be set up.
  // Once anyone has signed in on this device, Lotus has an admin: skip the check, which
  // costs a whole flow run.
  // ?setup=1 always checks. Only the real sign-in service counts, not the demo accounts.
  async init() {
    const forced = /[?&]setup=1\b/.test(location.search + location.hash);
    if (get().authStage !== 'signedOut' || (!forced && hasAdmin())) return;
    const empty = await auth.needsSetup().catch(() => false);
    if (empty && get().authStage === 'signedOut') set({ authStage: 'setup' });
    if (!empty) markAdmin();
  },

  async sync({ manual = false } = {}) {
    if (get().syncing) return;
    if (!['signedIn', 'pick'].includes(get().authStage)) return;
    get().pump();
    set({ syncing: true, ...(manual ? { error: '' } : {}) });
    const wasDemo = DEMO;
    try {
      const data = await api.all();
      // The switch flipped while this load ran: drop it, the next load is already on its way.
      if (DEMO !== wasDemo) return;
      const at = new Date();
      if (!DEMO) storage.set('onsite-cache', { data, at: at.toISOString() });
      const base = reSettle(data);
      const patch = { base, data: overlay(base, get().jobs), loadedAt: at, error: '' };
      if (data.me?.email && get().session && !get().session.demoPicker) patch.session = { ...get().session, ...data.me, roles: data.me.roles || get().session.roles };
      set(patch);
    } catch (e) {
      if (DEMO !== wasDemo) return;
      // The first quiet load never shows an error; a manual sync, or a failed
      // refresh over data already on screen, reports it.
      set({ error: e.message || 'Unknown error' });
      if (manual) throw e;
    } finally {
      set({ syncing: false });
      if (DEMO !== wasDemo) get().sync();
    }
  },

  // Demo data on or off: clear what's on screen and load the other source, in place.
  async switchDemo(on) {
    if (setDemo(on) !== !!on) return;
    const cache = !on ? storage.get('onsite-cache', null) : null;
    set({ demo: !!on, base: cache?.data || null, data: overlay(cache?.data || null, get().jobs), loadedAt: cache?.at ? new Date(cache.at) : null, error: '' });
    await get().sync({ manual: true });
  },

  keepAuth(a) {
    setAuth(a);
    const session = sessionOf(a);
    setDemoActor(session?.email);
    const jobs = loadJobs(session?.email);
    set((s) => ({ session, authStage: stageOf(session), jobs, data: overlay(s.base, jobs) }));
    if (session) markAdmin();
    if (jobs.length) setTimeout(() => get().pump(), 0);
    if (session?.roles.includes('operator') && !session.demoPicker) get().setMe({ name: session.name, email: session.email, station: '' });
  },
  async signIn(username, password) {
    get().keepAuth(await auth.signIn(username, password));
    // The roles decide the landing page: staff without the operator role go to admin.
    const s = get().session;
    if (s && !s.roles.includes('operator') && !location.hash.startsWith('#/admin')) location.hash = '/admin';
  },
  async changePassword(current, next) {
    const a = getAuth();
    if (!a) return;
    await auth.changePassword(a.token, a.user.username, current, next);
    get().keepAuth({ ...a, user: { ...a.user, mustChangePassword: false } });
  },
  async setUp(user, password) {
    await auth.bootstrap(user, password);
    get().keepAuth(await auth.signIn(user.username, password));
  },
  // Demo only: the shared Lotus-operator account picks which operator to be.
  pickOperator(o) {
    const a = getAuth();
    if (!a?.user.demoPicker) return;
    get().keepAuth({ ...a, user: { ...a.user, email: o.email, name: o.name, operatorId: o.id, picked: true } });
    get().setMe({ name: o.name, email: o.email, station: '' });
  },
  // everywhere: false only for the lab laptop's sign-out after each clock-in, so
  // the operator's phone stays signed in.
  async signOut({ everywhere = true } = {}) {
    const token = everywhere ? getAuth()?.token : null;
    storage.remove('onsite-cache');
    setAuth(null);
    setDemoActor('');
    // Unsent changes stay saved in this browser for this person's next sign-in.
    clearTimeout(pumpTimer);
    set({ session: null, authStage: 'signedOut', jobs: [], ...(DEMO ? { data: get().base } : { base: null, data: null, loadedAt: null }) });
    // The flow clears its copy too; if it can't be reached the token still runs out.
    if (token) await auth.signOut(token).catch(() => {});
  },

  // A clock-in or out shows at once (marked pending, at the tap time) and the flow
  // records it with the server's time; that time replaces the tap time when it lands.
  // The sign-in is captured now, so the lab laptop can sign out for the next person.
  punch(body) {
    const tmp = { id: `tmp-${crypto.randomUUID().slice(0, 8)}`, ts: new Date().toISOString(), type: body.type, email: body.email, name: body.name, operatorId: body.operatorId, shiftId: body.shiftId || '', station: body.station || '', location: body.location || '', source: body.source, flag: body.flag ? 'Left early' : '', note: body.note || '', grace: 0, pending: true };
    get().commit((d) => (d ? { ...d, punches: [...d.punches, tmp] } : d));
    const token = getAuth()?.token;
    // One person's punches go in order: a clock-out never overtakes its clock-in.
    const prev = punchChain.get(body.email) || Promise.resolve();
    const run = get().background(body.type === 'in' ? `${body.name}’s clock-in` : `${body.name}’s clock-out`, () => prev.catch(() => {}).then(() => api.punch(body, token)));
    punchChain.set(body.email, run.catch(() => {}));
    run.then(
      (p) => get().commit((d) => (d ? { ...d, punches: d.punches.filter((x) => x.id !== tmp.id).concat(p) } : d)),
      () => get().commit((d) => (d ? { ...d, punches: d.punches.filter((x) => x.id !== tmp.id) } : d)),
    );
    return { shown: tmp, saved: run };
  },

  // ---- Background work that can't be queued for later (it needs the flow's answer,
  // like an approval or a new operator's ID) but still shouldn't hold anyone up.
  // The sheet closes, the header counts it under "Saving", and a toast says if it
  // failed. It lives in this tab: closing the tab mid-run asks first (App.jsx).
  tasks: [],
  // Days being approved or reopened right now, by `${email}|${date}`.
  approving: {},
  background(label, fn) {
    const id = crypto.randomUUID();
    set((s) => ({ tasks: [...s.tasks, { id, label, note: '' }] }));
    const note = (text) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, note: text } : t)) }));
    // Busy (429/503) means the flow didn't take it: try again after a pause.
    const attempt = async (n) => {
      try { return await fn(note); } catch (e) {
        if (n < 3 && [429, 503].includes(e.status)) { await new Promise((r) => setTimeout(r, n * 5000)); return attempt(n + 1); }
        throw e;
      }
    };
    const run = attempt(1);
    run.catch(() => {}).finally(() => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })));
    return run;
  },

  // A server-confirmed change: into `base`, and the screen keeps the queue on top.
  commit(fn) {
    set((s) => {
      const base = fn(s.base ?? s.data);
      return { base, data: overlay(base, s.jobs) };
    });
  },

  // ---- The save queue (lib/outbox.js) ----
  setJobs(fn) {
    set((s) => {
      const jobs = fn(s.jobs);
      keepJobs(s.session?.email, jobs);
      return { jobs, data: overlay(s.base, jobs) };
    });
  },
  // Queue a change: it shows at once and goes to the flow in the background.
  enqueue(kind, body, label) {
    const job = { id: crypto.randomUUID(), kind, body, label, tries: 0, state: 'waiting', nextAt: 0, at: new Date().toISOString() };
    get().setJobs((jobs) => [...jobs, job]);
    get().pump();
    return job.id;
  },
  pump() {
    clearTimeout(pumpTimer);
    if (get().authStage !== 'signedIn') return;
    const now = Date.now();
    for (const j of ready(get().jobs, now)) get().send(j);
    const next = get().jobs.filter((j) => j.state === 'waiting' && j.nextAt > now).map((j) => j.nextAt);
    if (next.length) pumpTimer = setTimeout(() => get().pump(), Math.max(500, Math.min(...next) - now));
  },
  async send(job) {
    const owner = get().session?.email;
    const patchJob = (fn) => get().setJobs((jobs) => jobs.map((j) => (j.id === job.id ? fn(j) : j)));
    patchJob((j) => ({ ...j, state: 'sending' }));
    let { body } = job;
    try {
      let result = [];
      // An earlier try may have saved new shifts: look for them before sending again.
      if (job.unsure && KINDS[job.kind].found) {
        const f = KINDS[job.kind].found(await api.all(), body);
        result = f.saved;
        body = f.rest;
      }
      if (body) {
        const out = await SEND[job.kind](body);
        result = Array.isArray(out) ? [...result, ...out] : (out ?? result);
      }
      if (get().session?.email !== owner) return;
      recent.push({ job, result, at: Date.now() });
      set((s) => {
        const jobs = s.jobs.filter((j) => j.id !== job.id);
        keepJobs(owner, jobs);
        const base = s.base ? KINDS[job.kind].settle(s.base, job.body, result) : s.base;
        return { jobs, base, data: overlay(base, jobs) };
      });
    } catch (e) {
      if (get().session?.email !== owner) return;
      if (e.status === 401) { patchJob((j) => ({ ...j, state: 'waiting', nextAt: 0 })); return; }
      if (refused(e)) {
        get().setJobs((jobs) => jobs.filter((j) => j.id !== job.id));
        toast.error(`${job.label} didn’t save`, { description: `${e.message} It’s been put back the way it was.` });
        return;
      }
      const next = afterFail(get().jobs.find((j) => j.id === job.id) || job, e, Date.now());
      patchJob(() => next);
      if (next.state === 'stuck') {
        toast.error(`${job.label} hasn’t saved yet`, {
          description: `Tried ${MAX_TRIES} times: ${next.error} It’s kept in this browser.`,
          action: { label: 'Try again', onClick: () => get().retryJobs() },
        });
      }
    } finally {
      get().pump();
    }
  },
  retryJobs() {
    get().setJobs((jobs) => jobs.map((j) => (j.state === 'stuck' ? { ...j, state: 'waiting', tries: 0, nextAt: 0 } : j)));
    get().pump();
  },
  discardStuck() {
    get().setJobs((jobs) => jobs.filter((j) => j.state !== 'stuck'));
  },

  setClientHours(week, hours) {
    get().enqueue('client', { week, hours }, `Successful hours for the week of ${week}`);
  },

  // Shifts show on the schedule at once (new ones under a tmp- id) and save in the
  // background. A change to a shift that's still waiting to go joins that job.
  upsertShifts(shifts, label = 'The shift') {
    const rows = shifts.map((r) => strip(r.id ? r : { ...r, id: `tmp-${crypto.randomUUID().slice(0, 8)}` }));
    const temps = rows.filter((r) => isTemp(r.id));
    const waiting = get().jobs.filter((j) => j.kind === 'shifts' && j.state === 'waiting');
    if (temps.some((r) => get().jobs.some((j) => j.kind === 'shifts' && j.state !== 'waiting' && j.body.shifts.some((x) => x.id === r.id)))) {
      throw new Error('That shift is still saving. Try again in a moment.');
    }
    // Rows for tmp shifts already queued go into their own job instead.
    const joined = new Set();
    get().setJobs((jobs) => jobs.map((j) => {
      if (!waiting.includes(j)) return j;
      const mine = temps.filter((r) => j.body.shifts.some((x) => x.id === r.id));
      if (!mine.length) return j;
      mine.forEach((r) => joined.add(r.id));
      return { ...j, body: { shifts: j.body.shifts.map((x) => mine.find((r) => r.id === x.id) || x) } };
    }));
    const rest = rows.filter((r) => !joined.has(r.id));
    if (rest.length) get().enqueue('shifts', { shifts: rest }, label);
    return rows;
  },
  // The roster and schedule import: sent now, in batches, with progress (Roster.jsx).
  async importShifts(shifts) {
    const saved = await api.upsertShifts(shifts);
    get().commit((d) => KINDS.shifts.settle(d, { shifts }, saved));
    return saved;
  },
  // An operator fills an open spot: booked into that pair, then clocked in by the caller.
  async fillIn(shiftId) {
    const r = await api.fillIn(shiftId);
    get().commit((d) => ({ ...d, schedule: (d.schedule || []).filter((x) => x.id !== r.id).concat(r), openSpots: (d.openSpots || []).filter((x) => x.shiftId !== shiftId) }));
    // The flow gave the whole pair the pair id; a reload brings the partner's name.
    get().sync().catch(() => {});
    return r;
  },

  removeShift(id, label = 'Removing the shift') {
    if (isTemp(id)) {
      // Not sent yet: just take it out of its job.
      const job = get().jobs.find((j) => j.kind === 'shifts' && j.body.shifts.some((x) => x.id === id));
      if (job && job.state !== 'waiting') throw new Error('That shift is still saving. Try again in a moment.');
      get().setJobs((jobs) => jobs.flatMap((j) => {
        if (j.id !== job?.id) return [j];
        const left = j.body.shifts.filter((x) => x.id !== id);
        return left.length ? [{ ...j, body: { shifts: left } }] : [];
      }));
      return;
    }
    get().enqueue('shiftDelete', { id }, label);
  },

  // Changes to people already on the roster: shown at once, saved in the background.
  updateUsers(users, label) {
    get().enqueue('users', { users }, label);
  },
  // New people and the roster import: sent now, because the flow assigns operator IDs.
  async upsertUsers(users) {
    const saved = await api.upsertUsers(users);
    get().commit((d) => KINDS.users.settle(d, { users }, saved));
    return saved;
  },

  resolveFlag(r) {
    get().enqueue('flag', { ...r, by: get().session?.email || '' }, 'The flag decision');
  },

  // Approvals run in the background but only count once the flow confirms them: the
  // day shows "Approving…" until then, and the approved export holds only confirmed rows.
  async approveOne(a, status = 'approved') {
    const k = `${a.email}|${a.date}`;
    set((s) => ({ approving: { ...s.approving, [k]: status } }));
    try {
      const { name, ...body } = a; // eslint-disable-line no-unused-vars
      const rec = await api.approveDay(body, status);
      get().commit((d) => ({ ...d, approvals: [...(d.approvals || []), rec], ...(DEMO ? { audit: demo.load().audit } : {}) }));
      return rec;
    } finally {
      set((s) => { const x = { ...s.approving }; delete x[k]; return { approving: x }; });
    }
  },
  approveDay(a, status = 'approved') {
    return get().background(`${status === 'approved' ? 'Approving' : 'Reopening'} ${a.name || a.email}`, () => get().approveOne(a, status));
  },
  // Approve all: three at a time, each day marked until its own answer comes back.
  approveMany(list) {
    list.forEach((a) => set((s) => ({ approving: { ...s.approving, [`${a.email}|${a.date}`]: 'approved' } })));
    return get().background(`Approving ${list.length} days`, async (note) => {
      const queue = [...list];
      const errors = [];
      let n = 0;
      const worker = async () => {
        while (queue.length) {
          const a = queue.shift();
          try { await get().approveOne(a); } catch (e) { errors.push(e); }
          n += 1;
          note(`${n} of ${list.length}`);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (errors.length) throw new Error(`${list.length - errors.length} of ${list.length} approved. ${errors[0].message}`);
    });
  },

  async sendEmails(body) {
    let notices = await api.sendEmails(body);
    // Schedule emails: the flow answers 202 { ok: true } before it sends (docs/lotus-flows.md),
    // so there are no notice rows yet. Show them as sent now and let a reload a minute later
    // swap in the flow's own rows.
    if (!notices.length && body.kind === 'schedule' && body.messages?.length) {
      const sentAt = new Date().toISOString();
      const test = get().data?.emailTestMode !== false;
      notices = body.messages.map((m) => ({
        ...normNotice({ email: m.to, operatorId: m.operatorId, weekStart: body.weekStart, kind: m.kind, subject: m.subject, sentAt, test, snapshot: m.snapshot }),
        id: `pending-${crypto.randomUUID().slice(0, 8)}`,
        pending: true,
      }));
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => get().sync(), 60 * 1000);
    }
    get().commit((d) => ({ ...d, notices: [...(d.notices || []), ...notices] }));
    return notices;
  },

  async saveTemplate(t) {
    const rec = await api.saveTemplate(t);
    get().commit((d) => ({ ...d, templates: (d.templates || []).filter((x) => x.id !== t.id).concat([rec]) }));
    return rec;
  },
  setMe(me) { storage.set('onsite-me', me); set({ me }); },
  forgetMe() { storage.remove('onsite-me'); set({ me: null }); },
  setDevice(device) { storage.set('onsite-device', device); set({ device }); },
  // Admin search and the operator profile it opens, reachable from any view.
  searching: false,
  profile: null,
  setSearching(searching) { set({ searching }); },
  openProfile(email) { set({ profile: email, searching: false }); },
  setTheme(theme) { storage.set('onsite-theme', theme); set({ theme }); },
  resetDemo() { demo.reset(); get().sync(); },
}));

// A flow refused the sign-in twice: go back to the sign-in screen and say why,
// rather than leaving a screen that can't load.
whenSignedOut(() => {
  if (!useStore.getState().session) return;
  useStore.getState().signOut({ everywhere: false });
  toast('Signed out', { description: 'Your sign-in ended, maybe because this username signed in on another device. Sign in again to carry on.' });
});
