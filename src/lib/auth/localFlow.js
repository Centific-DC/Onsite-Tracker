// A stand-in for the Lotus Auth flow, used while `authUrl` is empty (demo and
// localhost). It follows the same contract and rules as the real flow (lockout,
// forced password change, admin-only user changes, bootstrap only while there is
// no admin) but keeps the accounts in this browser, so it is for trying the
// screens, not security.

const KEY = 'lotus-local-users-v1';
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const TOKEN_MS = 12 * 60 * 60 * 1000;
const TEMP_MS = 7 * 24 * 60 * 60 * 1000; // temp passwords from an admin (match TEMP_DAYS in email/welcome.js)
const RESET_MS = 24 * 60 * 60 * 1000; // reset links (match RESET_HOURS in crypto.js)
/** What "salt" answers for an unknown username, so the reply doesn't reveal who has an account. */
const FAKE_SALT = 'THf0dXNVbmtub3duU2FsdA==';
export const AUTH_ROLES = ['operator', 'scheduler', 'approver', 'reporting', 'admin'];

const load = () => {
  try { const s = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(s) ? s : []; } catch { return []; }
};
const save = (users) => { try { localStorage.setItem(KEY, JSON.stringify(users)); } catch { /* storage off */ } };

const pick = (u) => ({
  username: u.username, email: u.email, name: u.name, roles: u.roles, operatorId: u.operatorId || '',
  mustChangePassword: !!u.mustChangePassword, ...(u.demoPicker ? { demoPicker: true } : {}),
});
const summary = (u) => ({ ...pick(u), active: u.active, lastSignIn: u.lastSignIn, lockedUntil: u.lockedUntil });

const reply = (status, body) => ({ status, body });
const refuse = (status, message) => reply(status, { ok: false, message });
const newToken = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
const low = (s) => String(s || '').trim().toLowerCase();
const hasAdmin = (users) => users.some((u) => u.active && u.roles.includes('admin'));
const cleanRoles = (roles) => [...new Set((roles || []).filter((r) => AUTH_ROLES.includes(r)))];

/** Adds seed accounts once each, never replacing an account that exists. */
export function seedLocalUsers(seed) {
  const users = load();
  const fresh = seed.filter((s) => !users.some((u) => low(u.username) === low(s.username)));
  for (const s of fresh) {
    users.push({
      username: s.username, email: low(s.email), name: s.name, roles: s.roles, operatorId: s.operatorId || '', demoPicker: !!s.demoPicker,
      active: true, mustChangePassword: false, lastSignIn: null, lockedUntil: null,
      salt: s.salt, hash: s.hash, failedCount: 0, token: null, tokenExpires: null,
    });
  }
  if (fresh.length) save(users);
  return fresh.length;
}

export const localUsernames = () => load().map((u) => low(u.username));

export function localAuth(req) {
  const users = load();
  const now = Date.now();
  // Sign in with the username or the email.
  const find = (id) => users.find((u) => low(u.username) === low(id) || (low(id).includes('@') && u.email === low(id)));
  const taken = (username, email, except) => users.find((u) => u !== except && (low(u.username) === low(username) || (email && u.email === low(email))));

  const caller = (token) => {
    const u = users.find((x) => x.token && x.token === token);
    if (!u || !u.active || !u.tokenExpires || Date.parse(u.tokenExpires) < now) return refuse(401, 'Please sign in again.');
    if (u.mustChangePassword && req.op !== 'change-password' && req.op !== 'signout') return refuse(403, 'Choose your own password first.');
    return u;
  };
  const admin = (token) => {
    const u = caller(token);
    if (u.status) return u;
    return u.roles.includes('admin') ? u : refuse(403, 'Only an admin can do that.');
  };

  switch (req.op) {
    case 'salt': {
      const u = find(req.username);
      return reply(200, { salt: u?.active ? u.salt : FAKE_SALT, empty: !hasAdmin(users) });
    }
    case 'signin': {
      const u = find(req.username);
      const wrong = 'Username or password is wrong, or the account is locked.';
      if (!u || !u.active || (u.lockedUntil && Date.parse(u.lockedUntil) > now)) return refuse(401, wrong);
      if (req.hash !== u.hash) {
        u.failedCount += 1;
        if (u.failedCount >= LOCK_AFTER) { u.lockedUntil = new Date(now + LOCK_MS).toISOString(); u.failedCount = 0; }
        save(users);
        return refuse(401, wrong);
      }
      // A temp password stops working TEMP_MS after an admin set it.
      if (u.mustChangePassword && u.tempExpires && Date.parse(u.tempExpires) < now) return refuse(401, 'This temp password has expired. Ask your admin for a new one.');
      Object.assign(u, { token: newToken(), tokenExpires: new Date(now + TOKEN_MS).toISOString(), failedCount: 0, lockedUntil: null, lastSignIn: new Date(now).toISOString() });
      save(users);
      return reply(200, { ok: true, token: u.token, expiresAt: u.tokenExpires, user: pick(u) });
    }
    case 'change-password': {
      const u = caller(req.token);
      if (u.status) return u;
      if (req.currentHash !== u.hash) return refuse(401, 'Your current password is wrong.');
      Object.assign(u, { salt: req.newSalt, hash: req.newHash, mustChangePassword: false, tempExpires: null, resetHash: null, resetExpires: null });
      save(users);
      return reply(200, { ok: true, user: pick(u) });
    }
    case 'signout': {
      const u = users.find((x) => x.token && x.token === req.token);
      if (u) { u.token = null; u.tokenExpires = null; save(users); }
      return reply(200, { ok: true });
    }
    case 'user.list': {
      const a = admin(req.token);
      if (a.status) return a;
      return reply(200, { ok: true, users: users.map(summary) });
    }
    case 'user.create': {
      const a = admin(req.token);
      if (a.status) return a;
      const n = req.user || {};
      if (!String(n.username || '').trim()) return refuse(400, 'Add a username.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(n.email || '').trim())) return refuse(400, 'Add a valid email.');
      if (taken(n.username, n.email)) return refuse(409, 'That username or email already has a sign-in.');
      const roles = cleanRoles(n.roles);
      if (!roles.length) return refuse(400, 'Pick at least one role.');
      users.push({
        username: String(n.username).trim(), email: low(n.email), name: String(n.name || '').trim(), roles, operatorId: n.operatorId || '',
        active: true, mustChangePassword: true, lastSignIn: null, lockedUntil: null,
        salt: req.salt, hash: req.hash, failedCount: 0, token: null, tokenExpires: null, tempExpires: new Date(now + TEMP_MS).toISOString(),
      });
      save(users);
      return reply(200, { ok: true });
    }
    case 'user.update': {
      const a = admin(req.token);
      if (a.status) return a;
      const u = find(req.username);
      if (!u) return refuse(404, 'No sign-in with that username.');
      const { name, roles, active, username } = req.changes || {};
      if (u === a && (roles !== undefined || active !== undefined)) return refuse(400, 'You can’t change your own roles or turn off your own sign-in.');
      if (username !== undefined) {
        if (!String(username).trim()) return refuse(400, 'Add a username.');
        if (taken(username, null, u)) return refuse(409, 'That username is taken.');
        u.username = String(username).trim();
      }
      if (roles !== undefined) {
        const r = cleanRoles(roles);
        if (!r.length) return refuse(400, 'Pick at least one role.');
        u.roles = r;
      }
      if (name !== undefined) u.name = String(name).trim();
      if (active !== undefined) { u.active = !!active; if (!active) { u.token = null; u.tokenExpires = null; } }
      save(users);
      return reply(200, { ok: true });
    }
    case 'user.reset': {
      const a = admin(req.token);
      if (a.status) return a;
      const u = find(req.username);
      if (!u) return refuse(404, 'No sign-in with that username.');
      Object.assign(u, { salt: req.salt, hash: req.hash, mustChangePassword: true, tempExpires: new Date(now + TEMP_MS).toISOString(), failedCount: 0, lockedUntil: null, token: null, tokenExpires: null, resetHash: null, resetExpires: null });
      save(users);
      return reply(200, { ok: true });
    }
    case 'user.reset_link': {
      const a = admin(req.token);
      if (a.status) return a;
      const u = find(req.username);
      if (!u || !u.active) return refuse(404, 'No active sign-in with that username.');
      if (!/^[0-9a-f]{64}$/.test(String(req.codeHash || ''))) return refuse(400, 'Bad reset request.');
      Object.assign(u, { resetHash: req.codeHash, resetExpires: new Date(now + RESET_MS).toISOString() });
      save(users);
      return reply(200, { ok: true, expiresAt: u.resetExpires });
    }
    case 'reset': {
      const u = find(req.username);
      const stale = 'This reset link has expired or was already used. Ask your Lotus admin for a new one.';
      if (!u || !u.active || !u.resetHash || !u.resetExpires || Date.parse(u.resetExpires) < now) return refuse(400, stale);
      if (u.lockedUntil && Date.parse(u.lockedUntil) > now) return refuse(400, stale);
      if (req.codeHash !== u.resetHash) {
        u.failedCount += 1;
        if (u.failedCount >= LOCK_AFTER) { u.lockedUntil = new Date(now + LOCK_MS).toISOString(); u.failedCount = 0; }
        save(users);
        return refuse(400, stale);
      }
      Object.assign(u, { salt: req.newSalt, hash: req.newHash, mustChangePassword: false, tempExpires: null, resetHash: null, resetExpires: null, failedCount: 0, lockedUntil: null, token: null, tokenExpires: null });
      save(users);
      return reply(200, { ok: true });
    }
    case 'bootstrap': {
      if (hasAdmin(users)) return refuse(403, 'Lotus already has an admin.');
      const n = req.user || {};
      users.push({
        username: String(n.username).trim(), email: low(n.email), name: String(n.name || '').trim(), roles: ['admin', 'scheduler', 'approver', 'reporting'], operatorId: '',
        active: true, mustChangePassword: false, lastSignIn: null, lockedUntil: null,
        salt: req.salt, hash: req.hash, failedCount: 0, token: null, tokenExpires: null,
      });
      save(users);
      return reply(200, { ok: true });
    }
    default:
      return refuse(400, 'Unknown request.');
  }
}
