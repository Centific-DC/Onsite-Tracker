// Talks to the Lotus Auth flow (`authUrl` in public/config.js). Without it, the
// browser-kept stand-in answers instead, with the same contract. Mirrors the
// Project Atlas sign-in: usernames and passwords that an admin hands out.

import { AUTH_URL } from '../config.js';
import { codeHash, hashPassword, resetCode, saltedHash } from './crypto.js';
import { timed } from '../timing.js';
import { errorText } from '../api.js';
import { localAuth, localUsernames, seedLocalUsers } from './localFlow.js';

// The Auth flow can be slow on a cold start; Power Automate itself gives up at about two minutes.
const TIMEOUT_MS = 110000;

/** True while sign-in runs on the browser-kept stand-in (no Auth flow set). */
export const LOCAL_AUTH = !AUTH_URL;

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Demo sign-ins, only for the browser-kept stand-in. Synthetic and labelled demo.
// Lotus-operator is a shared demo account: after signing in you pick which
// operator to be. The live Auth flow has no such account.
export const DEMO_PASSWORD = 'Testing12345';
export const DEMO_ACCOUNTS = [
  { username: 'Lotus-admin', email: 'lead@example.com', name: 'Project lead (demo)', roles: ['admin', 'scheduler', 'approver', 'reporting'] },
  { username: 'Lotus-operator', email: 'operator@example.com', name: 'Demo operator', roles: ['operator'], demoPicker: true },
];

let seeding = null;
function ensureSeed() {
  seeding ??= (async () => {
    const have = new Set(localUsernames());
    const missing = DEMO_ACCOUNTS.filter((a) => !have.has(a.username.toLowerCase()));
    if (!missing.length) return;
    seedLocalUsers(await Promise.all(missing.map(async (a) => ({ ...a, ...(await saltedHash(DEMO_PASSWORD)) }))));
  })().catch(() => { /* storage off: no demo accounts this time */ });
  return seeding;
}

async function call(req) {
  if (!AUTH_URL) {
    // A short wait so the screens behave as they will against the real flow.
    await Promise.all([new Promise((r) => setTimeout(r, 200)), ensureSeed()]);
    const { status, body } = localAuth(req);
    if (status >= 300) throw new AuthError(status, body.message || 'That didn’t work.');
    return body;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // text/plain: the flow's HTTP trigger answers no CORS preflight, which application/json would trigger.
    const res = await timed(`Sign-in · ${req.op}`, fetch(AUTH_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ schemaVersion: 1, ...req }), signal: ctrl.signal, cache: 'no-store' }));
    let body = {};
    try { body = await res.json(); } catch { /* no body: go by the status */ }
    if (!res.ok) throw new AuthError(res.status, errorText(body, res.status));
    return body;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err?.name === 'AbortError') throw new AuthError(0, 'The sign-in service took longer than 110 seconds to answer. Try again in a minute.');
    throw new AuthError(0, 'Couldn’t reach the sign-in service. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}

const clean = (s) => String(s || '').trim().toLowerCase();

// Sign-in needs the salt before it can hash, and each flow call takes a few
// seconds. So the sign-in screen asks for the salt while the password is still
// being typed (prefetchSalt). Salts aren't secret (unknown usernames get a fake one).
const salts = new Map();

export function prefetchSalt(username) {
  const u = clean(username);
  if (u.length < 3 || salts.has(u)) return;
  const p = call({ op: 'salt', username: u }).then(({ salt }) => {
    if (!salt) throw new AuthError(500, 'The sign-in service gave no salt.');
    return salt;
  });
  p.catch(() => salts.delete(u));
  salts.set(u, p);
}

function saltFor(username) {
  const u = clean(username);
  if (!salts.has(u)) {
    const p = call({ op: 'salt', username: u }).then(({ salt }) => {
      if (!salt) throw new AuthError(500, 'The sign-in service gave no salt.');
      return salt;
    });
    p.catch(() => salts.delete(u));
    salts.set(u, p);
  }
  return salts.get(u);
}

// The flow sends roles as "scheduler;approver" or as a list.
const withRoles = (u) => ({ ...u, roles: Array.isArray(u.roles) ? u.roles : String(u.roles || '').split(';').map((r) => r.trim()).filter(Boolean) });

/**
 * Whether to show first-run setup. The stand-in knows when there's no admin; the
 * real flow never says, so there the screen is opened by hand with ?setup=1 (the
 * flow refuses bootstrap once an admin exists).
 */
export async function needsSetup() {
  if (!LOCAL_AUTH) return new URLSearchParams(location.search).has('setup');
  return Boolean((await call({ op: 'salt', username: '' })).empty);
}

export async function signIn(username, password) {
  const salt = await saltFor(username);
  let r;
  try {
    r = await call({ op: 'signin', username: clean(username), hash: await timed('Sign-in · password hash (this device)', hashPassword(password, salt)) });
  } catch (err) {
    // The salt may be stale (an admin reset the password since): ask afresh next time.
    salts.delete(clean(username));
    throw err;
  }
  if (!r.token || !r.expiresAt || !r.user) throw new AuthError(500, 'The sign-in service gave an incomplete answer.');
  return { token: r.token, expiresAt: r.expiresAt, user: withRoles(r.user) };
}

export async function changePassword(token, username, current, next) {
  const salt = await saltFor(username);
  const fresh = await saltedHash(next);
  await call({ op: 'change-password', token, currentHash: await hashPassword(current, salt), newSalt: fresh.salt, newHash: fresh.hash });
  salts.set(clean(username), Promise.resolve(fresh.salt));
}

export const signOut = (token) => call({ op: 'signout', token });

export async function bootstrap(user, password) {
  const { salt, hash } = await saltedHash(password);
  await call({ op: 'bootstrap', user: { ...user, email: clean(user.email) }, salt, hash });
}

export async function listUsers(token) {
  return ((await call({ op: 'user.list', token })).users || []).map(withRoles);
}

/** Gives a person a sign-in with a temp password; the caller shows it to the admin once. */
export async function createUser(token, user, temp) {
  const { salt, hash } = await saltedHash(temp);
  await call({ op: 'user.create', token, user: { ...user, email: clean(user.email) }, salt, hash });
}

export const updateUser = (token, username, changes) => call({ op: 'user.update', token, username, changes });

export async function resetUser(token, username, temp) {
  const { salt, hash } = await saltedHash(temp);
  await call({ op: 'user.reset', token, username, salt, hash });
  salts.delete(clean(username));
}

/**
 * Starts a password reset for someone (admin only): makes a one-time code and has
 * the flow keep its hash. Their current password keeps working until they use the
 * link. Resolves to { code, expiresAt }; the code goes only in the reset email.
 */
export async function startReset(token, username) {
  const code = resetCode();
  const r = await call({ op: 'user.reset_link', token, username, codeHash: await codeHash(code) });
  return { code, expiresAt: r.expiresAt };
}

/** Sets a new password from a reset link. Anyone with the link can call it, once. */
export async function finishReset(username, code, password) {
  const fresh = await saltedHash(password);
  await call({ op: 'reset', username: clean(username), codeHash: await codeHash(code), newSalt: fresh.salt, newHash: fresh.hash });
  salts.set(clean(username), Promise.resolve(fresh.salt));
}
