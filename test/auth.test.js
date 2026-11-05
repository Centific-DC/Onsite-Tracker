import { beforeEach, describe, expect, it } from 'vitest';
import { localAuth, seedLocalUsers } from '../src/lib/auth/localFlow.js';
import { hashPassword, passwordProblem, saltedHash } from '../src/lib/auth/crypto.js';

// The browser-kept stand-in follows the Lotus Auth flow's rules (docs/lotus-flows.md).
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const signIn = async (username, password) => {
  const { body } = localAuth({ op: 'salt', username });
  return localAuth({ op: 'signin', username, hash: await hashPassword(password, body.salt) });
};

describe('sign-in', () => {
  beforeEach(async () => {
    mem.clear();
    seedLocalUsers([{ username: 'Lotus-admin', email: 'lead@example.com', name: 'Lead', roles: ['admin', 'scheduler'], ...(await saltedHash('Testing12345')) }]);
  });

  it('signs in by username, any case, and refuses a wrong password', async () => {
    expect((await signIn('lotus-admin', 'Testing12345')).status).toBe(200);
    expect((await signIn('Lotus-admin', 'nope-nope-nope')).status).toBe(401);
    // Unknown usernames get a salt too, so the reply doesn't show who has an account.
    expect(localAuth({ op: 'salt', username: 'nobody' }).body.salt).toBeTruthy();
  });

  it('locks the account after five wrong passwords', async () => {
    for (let i = 0; i < 5; i++) await signIn('Lotus-admin', 'wrong-password');
    expect((await signIn('Lotus-admin', 'Testing12345')).status).toBe(401);
  });

  it('only admins manage sign-ins, and a temp password must be changed first', async () => {
    const { body: { token } } = await signIn('Lotus-admin', 'Testing12345');
    const temp = await saltedHash('Temp-pass-1234');
    expect(localAuth({ op: 'user.create', token, user: { username: 'avery', email: 'avery@example.com', name: 'Avery', roles: ['operator'] }, ...temp }).status).toBe(200);
    expect(localAuth({ op: 'user.create', token, user: { username: 'AVERY', email: 'x@example.com', name: 'X', roles: ['operator'] }, ...temp }).status).toBe(409);
    const a = await signIn('avery', 'Temp-pass-1234');
    expect(a.body.user.mustChangePassword).toBe(true);
    expect(localAuth({ op: 'user.list', token: a.body.token }).status).toBe(403);
    expect(localAuth({ op: 'user.update', token, username: 'Lotus-admin', changes: { active: false } }).status).toBe(400);
  });

  it('a temp password stops working after 7 days', async () => {
    const { body: { token } } = await signIn('Lotus-admin', 'Testing12345');
    localAuth({ op: 'user.create', token, user: { username: 'blair', email: 'blair@example.com', name: 'Blair', roles: ['operator'] }, ...(await saltedHash('Temp-pass-5678')) });
    expect((await signIn('blair', 'Temp-pass-5678')).status).toBe(200);
    const real = Date.now;
    Date.now = () => real() + 8 * 864e5;
    try {
      const late = await signIn('blair', 'Temp-pass-5678');
      expect(late.status).toBe(401);
      expect(late.body.message || late.body.error).toMatch(/expired/);
    } finally { Date.now = real; }
  });

  it('wants passwords of at least 10 characters', () => {
    expect(passwordProblem('short', 'avery')).toMatch(/10/);
    expect(passwordProblem('a long enough sentence', 'avery')).toBeNull();
  });
});
