import { create } from 'zustand';
import { api, demo, setDemoActor, storage } from './api.js';
import { AUTH_URL, DEMO, setDemo } from './config.js';
import * as auth from './auth/api.js';
import { getAuth, setAuth } from './auth/session.js';

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

export const useStore = create((set, get) => ({
  data: cached?.data || null,
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
    set({ syncing: true, ...(manual ? { error: '' } : {}) });
    const wasDemo = DEMO;
    try {
      const data = await api.all();
      // The switch flipped while this load ran: drop it, the next load is already on its way.
      if (DEMO !== wasDemo) return;
      const at = new Date();
      if (!DEMO) storage.set('onsite-cache', { data, at: at.toISOString() });
      const patch = { data, loadedAt: at, error: '' };
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
    set({ demo: !!on, data: cache?.data || null, loadedAt: cache?.at ? new Date(cache.at) : null, error: '' });
    await get().sync({ manual: true });
  },

  keepAuth(a) {
    setAuth(a);
    const session = sessionOf(a);
    setDemoActor(session?.email);
    set({ session, authStage: stageOf(session) });
    if (session) markAdmin();
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
  async signOut() {
    const token = getAuth()?.token;
    storage.remove('onsite-cache');
    setAuth(null);
    setDemoActor('');
    set({ session: null, authStage: 'signedOut', ...(DEMO ? {} : { data: null, loadedAt: null }) });
    // The flow clears its copy too; if it can't be reached the token still runs out.
    if (token) await auth.signOut(token).catch(() => {});
  },

  async punch(body) {
    const p = await api.punch(body);
    set((s) => ({ data: s.data ? { ...s.data, punches: [...s.data.punches, p] } : s.data }));
    return p;
  },

  async setClientHours(week, hours) {
    await api.clientHours(week, hours);
    set((s) => ({
      data: { ...s.data, client: s.data.client.filter((c) => c.week !== week).concat(hours == null ? [] : [{ week, hours }]) },
    }));
  },

  // `optimistic`: the shifts show at once (new ones under a temporary id) while the
  // flow saves them, and leave again if the save fails. The flow's answer replaces them.
  async upsertShifts(shifts, { optimistic = false } = {}) {
    if (shifts.some((r) => String(r.id || '').startsWith('tmp-'))) throw new Error('That shift is still saving. Try again in a moment.');
    const temp = [];
    const shown = shifts.map((r) => {
      if (r.id) return r;
      const id = `tmp-${crypto.randomUUID().slice(0, 8)}`;
      temp.push(id);
      return { ...r, id, pending: true };
    });
    const touched = new Set(shown.map((r) => r.id));
    const prev = (get().data?.schedule || []).filter((r) => touched.has(r.id));
    if (optimistic) set((s) => ({ data: { ...s.data, schedule: (s.data.schedule || []).filter((r) => !touched.has(r.id)).concat(shown.map((r) => ({ ...r, pending: true }))) } }));
    let saved;
    try {
      saved = await api.upsertShifts(shifts);
    } catch (e) {
      if (optimistic) set((s) => ({ data: { ...s.data, schedule: (s.data.schedule || []).filter((r) => !touched.has(r.id)).concat(prev) } }));
      throw e;
    }
    set((s) => {
      const ids = new Set([...saved.map((r) => r.id), ...touched]);
      return { data: { ...s.data, schedule: (s.data.schedule || []).filter((r) => !ids.has(r.id)).concat(saved) } };
    });
    return saved;
  },
  // An operator fills an open spot: booked into that pair, then clocked in by the caller.
  async fillIn(shiftId) {
    const r = await api.fillIn(shiftId);
    set((s) => ({ data: { ...s.data, schedule: (s.data.schedule || []).filter((x) => x.id !== r.id).concat(r), openSpots: (s.data.openSpots || []).filter((x) => x.shiftId !== shiftId) } }));
    // The flow gave the whole pair the pair id; a reload brings the partner's name.
    get().sync().catch(() => {});
    return r;
  },
  addShift(shift) { return get().upsertShifts([shift]).then((r) => r[0]); },

  async removeShift(id) {
    if (String(id).startsWith('tmp-')) throw new Error('That shift is still saving. Try again in a moment.');
    const before = get().data;
    // Optimistic: the row leaves at once; it comes back if the write fails.
    set((s) => ({ data: { ...s.data, schedule: (s.data.schedule || []).filter((r) => r.id !== id) } }));
    try { await api.removeShift(id); } catch (e) { set({ data: before }); throw e; }
  },

  // `optimistic`: for changes to people already on the roster, the new values show
  // at once and go back if the save fails.
  async upsertUsers(users, { optimistic = false } = {}) {
    const emails = new Set(users.map((u) => u.email));
    const prev = (get().data?.operators || []).filter((o) => emails.has(o.email));
    if (optimistic) {
      set((s) => ({ data: { ...s.data, operators: (s.data.operators || []).map((o) => { const u = users.find((x) => x.email === o.email); return u ? { ...o, ...u } : o; }) } }));
    }
    let saved;
    try {
      saved = await api.upsertUsers(users);
    } catch (e) {
      if (optimistic) set((s) => ({ data: { ...s.data, operators: (s.data.operators || []).map((o) => prev.find((p) => p.email === o.email) || o) } }));
      throw e;
    }
    set((s) => {
      const by = new Map((s.data.operators || []).map((o) => [o.email, o]));
      for (const o of saved) by.set(o.email, o);
      return { data: { ...s.data, operators: [...by.values()] } };
    });
    return saved;
  },

  async resolveFlag(r) {
    const res = await api.resolveFlag(r);
    set((s) => ({ data: { ...s.data, resolutions: (s.data.resolutions || []).filter((x) => x.key !== r.key).concat(res) } }));
    return res;
  },

  async approveDay(a, status = 'approved') {
    const rec = await api.approveDay(a, status);
    set((s) => ({ data: { ...s.data, approvals: [...(s.data.approvals || []), rec] } }));
    if (DEMO) set((s) => ({ data: { ...s.data, audit: demo.load().audit } }));
    return rec;
  },

  async sendEmails(body) {
    const notices = await api.sendEmails(body);
    set((s) => ({ data: { ...s.data, notices: [...(s.data.notices || []), ...notices] } }));
    return notices;
  },

  async saveTemplate(t) {
    const rec = await api.saveTemplate(t);
    set((s) => ({ data: { ...s.data, templates: (s.data.templates || []).filter((x) => x.id !== t.id).concat([rec]) } }));
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
