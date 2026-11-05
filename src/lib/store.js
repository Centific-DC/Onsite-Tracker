import { create } from 'zustand';
import { api, demo, setDemoActor, storage } from './api.js';
import { DEMO } from './config.js';
import { MS_AUTH, msAccount, msSignIn, msSignOut } from './auth.js';

const cached = storage.get('onsite-cache', null);
const savedSession = MS_AUTH ? null : storage.get('lotus-session', null);
setDemoActor(savedSession?.email);

export const useStore = create((set, get) => ({
  data: cached?.data || null,
  loadedAt: cached?.at ? new Date(cached.at) : null,
  syncing: false,
  error: '',

  // Who is signed in: { email, name, roles, operatorId, demo }. With Microsoft
  // sign-in it comes from the account plus the role list the Read flow returns.
  session: savedSession,
  authReady: !MS_AUTH,

  me: storage.get('onsite-me', null), // { name, email, station }
  device: storage.get('onsite-device', null), // 'personal' | 'shared'
  theme: storage.get('onsite-theme', 'system'), // 'system' | 'light' | 'dark'

  async init() {
    if (!MS_AUTH) return;
    try {
      const a = await msAccount();
      set({ session: a ? { ...a, roles: [], demo: false } : null, authReady: true });
    } catch (e) {
      set({ authReady: true, error: e.message });
    }
  },

  async sync({ manual = false } = {}) {
    if (get().syncing) return;
    if (MS_AUTH && !get().session) return;
    set({ syncing: true, ...(manual ? { error: '' } : {}) });
    try {
      const data = await api.all();
      const at = new Date();
      if (!DEMO) storage.set('onsite-cache', { data, at: at.toISOString() });
      const patch = { data, loadedAt: at, error: '' };
      if (data.me && get().session && !get().session.demo) patch.session = { ...get().session, ...data.me, roles: data.me.roles };
      set(patch);
    } catch (e) {
      // The first quiet load never shows an error; a manual sync, or a failed
      // refresh over data already on screen, reports it.
      if (manual || get().data || e.status === 403) set({ error: e.message || 'Unknown error' });
      if (manual) throw e;
    } finally {
      set({ syncing: false });
    }
  },

  signInDemo(person) {
    const session = { email: person.email, name: person.name, roles: person.roles || ['operator'], operatorId: person.id || '', demo: true };
    storage.set('lotus-session', session);
    setDemoActor(session.email);
    set({ session });
    if (session.roles.includes('operator')) get().setMe({ name: person.name, email: person.email, station: '' });
  },
  async signIn() { await msSignIn(); },
  async signOut() {
    storage.remove('lotus-session');
    storage.remove('onsite-cache');
    setDemoActor('');
    set({ session: null });
    if (MS_AUTH) await msSignOut();
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

  async upsertShifts(shifts) {
    const saved = await api.upsertShifts(shifts);
    set((s) => {
      const ids = new Set(saved.map((r) => r.id));
      return { data: { ...s.data, schedule: (s.data.schedule || []).filter((r) => !ids.has(r.id)).concat(saved) } };
    });
    return saved;
  },
  addShift(shift) { return get().upsertShifts([shift]).then((r) => r[0]); },

  async removeShift(id) {
    const before = get().data;
    // Optimistic: the row leaves at once; it comes back if the write fails.
    set((s) => ({ data: { ...s.data, schedule: (s.data.schedule || []).filter((r) => r.id !== id) } }));
    try { await api.removeShift(id); } catch (e) { set({ data: before }); throw e; }
  },

  async upsertUsers(users) {
    const saved = await api.upsertUsers(users);
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
