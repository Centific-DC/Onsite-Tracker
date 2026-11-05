// Lotus service worker: makes the app installable and lets the app shell open
// without a connection. It only ever caches the app's own files. Live data
// (api/*, the Power Automate flows, every POST) and version.json always go to the
// network, so nothing anyone clocked or approved is ever served stale. config.js
// (which flows are connected, no secrets) is fetched fresh and kept only as an
// offline fallback, so an offline start never drops into demo data.
const SHELL = 'lotus-shell-v1';
const ASSETS = 'lotus-assets-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './config.js', './manifest.webmanifest', './icons/icon-192.png'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== ASSETS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (/\/api\//.test(path) || path.endsWith('/version.json') || path.endsWith('/sw.js')) return;

  // config.js: the network first; the last copy offline.
  if (path.endsWith('/config.js')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok) (await caches.open(SHELL)).put('./config.js', res.clone());
        return res;
      } catch {
        return (await caches.match('./config.js')) || Response.error();
      }
    })());
    return;
  }

  // Pages: the network first, so a new release shows at once; the last copy offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put('./', res.clone());
        return res;
      } catch {
        return (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Vite's hashed files never change, so the cached copy is always right.
  if (/\/assets\//.test(path) || /\/icons\//.test(path)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(ASSETS)).put(req, res.clone());
      return res;
    })());
  }
});
