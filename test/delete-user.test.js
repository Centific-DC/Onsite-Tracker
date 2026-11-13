// Deleting someone added by mistake (a typo in the email): admins only, only while
// they have no records; booked shifts go with them.
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteCheck } from '../src/lib/onboarding.js';
import { demo } from '../src/lib/api.js';
import { writeUrlFor, writeFlowName } from '../src/lib/routes.js';

const typo = 'jordan.pike@exampel.com';
const base = () => ({ operators: [{ email: typo, name: 'Jordan Pike 2', id: 'OP-0099' }], schedule: [{ id: 'S-1', email: typo, date: '2026-11-16' }], punches: [], approvals: [], corrections: [], strikes: [] });

describe('deleting an operator', () => {
  it('is allowed with no records, and counts the shifts that go too', () => {
    expect(deleteCheck(base(), typo, 'lead@example.com')).toMatchObject({ ok: true, shifts: 1 });
  });
  it('is refused once they have any record, and for yourself', () => {
    for (const k of ['punches', 'approvals', 'corrections', 'strikes']) {
      expect(deleteCheck({ ...base(), [k]: [{ email: typo }] }, typo, 'lead@example.com').ok).toBe(false);
    }
    expect(deleteCheck(base(), typo, typo).ok).toBe(false);
  });
  it('goes to the Delete User flow when it is set up, else Write', () => {
    expect(writeUrlFor({ action: 'user_delete' }, { deleteUserUrl: 'https://flow/del' }, 'https://flow/write')).toBe('https://flow/del');
    expect(writeUrlFor({ action: 'user_delete' }, {}, 'https://flow/write')).toBe('https://flow/write');
    expect(writeFlowName({ action: 'user_delete' }, { deleteUserUrl: 'https://flow/del' })).toBe('Delete User');
  });
});

describe('demo delete', () => {
  beforeEach(() => localStorage.removeItem(demo.KEY));
  it('removes the person and their shifts, needs a reason, and refuses anyone with records', () => {
    const d = demo.load();
    d.operators.push({ email: typo, name: 'Jordan Pike 2', id: 'OP-0099', roles: ['operator'] });
    d.schedule.push({ id: 'S-typo', email: typo, name: 'Jordan Pike 2', date: '2026-11-16', start: '07:00', end: '12:30', location: 'RED', station: '' });
    localStorage.setItem(demo.KEY, JSON.stringify(d));
    expect(() => demo.deleteUser(typo, '')).toThrow(/reason/);
    expect(demo.deleteUser(typo, 'Typo in the email')).toEqual({ ok: true, removedShifts: 1 });
    const after = demo.load();
    expect(after.operators.some((o) => o.email === typo)).toBe(false);
    expect(after.schedule.some((r) => r.email === typo)).toBe(false);
    expect(after.audit.at(-1)).toMatchObject({ action: 'user_delete', target: 'OP-0099' });
    const withRecords = after.punches[0].email;
    expect(() => demo.deleteUser(withRecords, 'test')).toThrow(/Inactive/);
  });
});
