// Lotus on Render: serves the built app (dist/) and forwards its calls to the
// Power Automate flows, so the flow URLs live only in Render's environment and
// never reach the browser. No dependencies: Node's own http and fetch.
//
//   LOTUS_AUTH_URL, LOTUS_READ_URL, LOTUS_WRITE_URL  the flow trigger URLs (secret)
//   PORT                                             set by Render
//
// The browser only ever sees api/auth, api/read and api/write. A flow that isn't
// set yet stays off: config.js leaves its URL empty, so that part runs in demo mode.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(process.env.PORT) || 10000;
const MAX_BODY = 1024 * 1024; // a week of shifts or a roster import fits easily
const FLOW_TIMEOUT_MS = 35000; // the app gives up at 30s

const httpsUrl = (v) => { try { const u = new URL(String(v || '').trim()); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const FLOWS = {
  auth: httpsUrl(process.env.LOTUS_AUTH_URL),
  read: httpsUrl(process.env.LOTUS_READ_URL),
  write: httpsUrl(process.env.LOTUS_WRITE_URL),
};
for (const [k, v] of Object.entries(FLOWS)) console.log(`flow ${k}: ${v ? 'set' : 'not set'}`);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });

// Sign-in attempts per address per minute. The Auth flow also locks an account
// after five wrong passwords; this just keeps a script from hammering the flow.
const hits = new Map();
function tooMany(ip, limit = 30) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > 60000) { hits.set(ip, { start: now, n: 1 }); return false; }
  h.n += 1;
  return h.n > limit;
}
setInterval(() => { const cut = Date.now() - 60000; for (const [k, v] of hits) if (v.start < cut) hits.delete(k); }, 60000).unref();
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', (c) => {
      if (over) return; // drain the rest so the 413 answer gets through
      size += c.length;
      if (size > MAX_BODY) { over = true; chunks.length = 0; fail(Object.assign(new Error('Too large'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

// Pass the body through untouched (it carries the sign-in token) and hand back the
// flow's status and JSON. Bodies are never logged: they hold tokens and password hashes.
async function forward(req, res, which) {
  const url = FLOWS[which];
  if (!url) return json(res, 503, { error: 'This part of Lotus isn’t connected yet.' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  if (which === 'auth' && tooMany(clientIp(req))) return json(res, 429, { error: 'Too many sign-in attempts. Wait a minute and try again.' });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, e.status || 400, { error: e.status === 413 ? 'That request is too large.' : 'Couldn’t read the request.' }); }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FLOW_TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, signal: ctrl.signal });
    const text = await r.text();
    send(res, r.status, text, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  } catch (e) {
    console.error(`flow ${which}: ${e.name === 'AbortError' ? 'timed out' : 'unreachable'}`);
    json(res, 504, { error: 'Lotus didn’t answer in time. Try again.' });
  } finally {
    clearTimeout(t);
  }
}

// config.js: the site settings from public/config.js, with the flow addresses
// pointed at this server for each flow that's set.
async function configJs(res) {
  let base = '';
  try { base = await readFile(join(DIST, 'config.js'), 'utf8'); } catch { base = 'window.ONSITE_CONFIG = {};'; }
  const urls = { authUrl: FLOWS.auth ? 'api/auth' : '', readUrl: FLOWS.read ? 'api/read' : '', writeUrl: FLOWS.write ? 'api/write' : '' };
  send(res, 200, `${base}\n// Set by the Lotus server on Render.\nwindow.ONSITE_CONFIG = Object.assign(window.ONSITE_CONFIG || {}, ${JSON.stringify(urls)});\n`, {
    'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache',
  });
}

async function serveFile(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' }); }
  const file = normalize(join(DIST, rel === '/' ? 'index.html' : rel));
  if (file !== DIST && !file.startsWith(DIST + sep)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  let path = file;
  try { if (!(await stat(path)).isFile()) path = join(DIST, 'index.html'); } catch { path = join(DIST, 'index.html'); }
  try {
    const data = await readFile(path);
    // Vite's hashed files never change; everything else is checked each load.
    const cache = path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    send(res, 200, req.method === 'HEAD' ? undefined : data, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': cache });
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  const m = pathname.match(/^\/api\/(auth|read|write)$/);
  if (m) return forward(req, res, m[1]);
  if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  if (pathname === '/config.js') return configJs(res);
  return serveFile(req, res, pathname);
});
server.requestTimeout = 60000;
server.listen(PORT, () => console.log(`Lotus listening on ${PORT}`));
