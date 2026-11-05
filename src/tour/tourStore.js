import { create } from 'zustand';
import { stepsFor } from './steps.js';

// Which tour is running, and which tours this person has seen. Seen tours are
// remembered per browser, by username, so a new person gets the tours again.
const KEY = 'lotus-tour-v1';

const readSeen = (who) => {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '{}')[who] || []); } catch { return new Set(); }
};
const writeSeen = (who, seen) => {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[who] = [...seen];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* not remembered: the tour may show again next time */ }
};

export const useTour = create((set, get) => ({
  who: '',
  roles: [],
  seen: new Set(),
  // { id, steps, then } or null; `then` is the tour to chain after this one.
  run: null,

  setWho(who, roles) {
    if (who === get().who && roles.join() === get().roles.join()) return;
    set({ who, roles, seen: readSeen(who), run: null });
  },
  has: (id) => stepsFor(id, get().roles).length > 0,
  start(id, then = null) {
    const { has, roles } = get();
    if (!has(id)) { if (then && has(then)) set({ run: { id: then, steps: stepsFor(then, roles), then: null } }); return; }
    set({ run: { id, steps: stepsFor(id, roles), then: then && has(then) ? then : null } });
  },
  markSeen(ids) {
    const seen = new Set(get().seen);
    ids.forEach((id) => seen.add(id));
    writeSeen(get().who, seen);
    set({ seen });
  },
  // Done: on to the chained tour, if any. Skip: stop, and count the chained one as seen too.
  finish() {
    const r = get().run;
    if (!r) return;
    get().markSeen([r.id]);
    set({ run: r.then ? { id: r.then, steps: stepsFor(r.then, get().roles), then: null } : null });
  },
  skip() {
    const r = get().run;
    if (r) get().markSeen([r.id, ...(r.then ? [r.then] : [])]);
    set({ run: null });
  },
  stop() { set({ run: null }); },
}));
