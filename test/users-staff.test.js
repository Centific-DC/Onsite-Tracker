import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, staffSignIns } from '../src/lib/auth.js';

describe('Users lists staff only', () => {
  const users = [
    { username: 'op', roles: ['operator'] },
    { username: 'lead', roles: ['operator', 'scheduler'] },
    { username: 'boss', roles: ['admin'] },
    { username: 'none', roles: [] },
    { username: 'old' },
  ];
  it('hides operator-only sign-ins and keeps anyone with a staff role', () => {
    expect(staffSignIns(users).map((u) => u.username)).toEqual(['lead', 'boss']);
  });
  it('staff roles never include operator', () => {
    expect(STAFF_ROLES).not.toContain('operator');
  });
});
