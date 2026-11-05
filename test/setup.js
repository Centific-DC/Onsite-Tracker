// The app reads its settings from window.ONSITE_CONFIG (public/config.js), and demo
// mode keeps its data in localStorage.
globalThis.window = globalThis.window || globalThis;
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
await import('../public/config.js');
