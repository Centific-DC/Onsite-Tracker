import { describe, expect, it } from 'vitest';
import { authUrlFor, writeFlowName, writeUrlFor } from '../src/lib/routes.js';

// Stand-in addresses: the tests only check which one is picked.
const WRITE = 'https://flows.test/write';
const AUTH = 'https://flows.test/auth';
const ALL = {
  saveUserUrl: 'https://flows.test/save-user',
  saveUsersUrl: 'https://flows.test/save-users',
  saveShiftUrl: 'https://flows.test/save-shift',
  deleteShiftUrl: 'https://flows.test/delete-shift',
  punchUrl: 'https://flows.test/punch',
  sendEmailUrl: 'https://flows.test/send-email',
  resetPasswordUrl: 'https://flows.test/reset-password',
};

describe('which flow each save goes to', () => {
  it('routes each Write op to its one-job flow', () => {
    expect(writeUrlFor({ action: 'users_upsert', users: [{ email: 'a@x.com' }] }, ALL, WRITE)).toBe(ALL.saveUserUrl);
    expect(writeUrlFor({ action: 'users_upsert', users: [{ email: 'a@x.com' }, { email: 'b@x.com' }] }, ALL, WRITE)).toBe(ALL.saveUsersUrl);
    expect(writeUrlFor({ action: 'shift_upsert', shifts: [{}] }, ALL, WRITE)).toBe(ALL.saveShiftUrl);
    expect(writeUrlFor({ action: 'shift_delete', id: 'S-1' }, ALL, WRITE)).toBe(ALL.deleteShiftUrl);
    expect(writeUrlFor({ action: 'punch', type: 'in' }, ALL, WRITE)).toBe(ALL.punchUrl);
    expect(writeUrlFor({ action: 'punch', type: 'out' }, ALL, WRITE)).toBe(ALL.punchUrl);
    expect(writeUrlFor({ action: 'email_send', kind: 'schedule' }, ALL, WRITE)).toBe(ALL.sendEmailUrl);
  });

  it('keeps the other Write ops on Write', () => {
    for (const action of ['fill_in', 'undo_punch', 'resolve_flag', 'approve_day', 'reopen_day', 'template_save', 'client', 'something_new']) {
      expect(writeUrlFor({ action }, ALL, WRITE)).toBe(WRITE);
    }
  });

  it('falls back to Write for an op whose flow has no URL', () => {
    const some = { ...ALL, saveShiftUrl: '', punchUrl: '   ' };
    expect(writeUrlFor({ action: 'shift_upsert', shifts: [] }, some, WRITE)).toBe(WRITE);
    expect(writeUrlFor({ action: 'punch', type: 'in' }, some, WRITE)).toBe(WRITE);
    expect(writeUrlFor({ action: 'punch', type: 'out' }, {}, WRITE)).toBe(WRITE);
    expect(writeUrlFor({ action: 'shift_delete' }, some, WRITE)).toBe(ALL.deleteShiftUrl);
    expect(writeUrlFor({ action: 'users_upsert', users: [{}] }, {}, WRITE)).toBe(WRITE);
    expect(writeUrlFor({ action: 'users_upsert', users: [{}, {}] }, { saveUserUrl: ALL.saveUserUrl }, WRITE)).toBe(WRITE);
  });

  it('routes the password ops to Reset Password, and keeps sign-in and accounts on Auth', () => {
    for (const op of ['change-password', 'user.reset', 'user.reset_link', 'reset']) expect(authUrlFor({ op }, ALL, AUTH)).toBe(ALL.resetPasswordUrl);
    for (const op of ['salt', 'signin', 'signout', 'bootstrap', 'user.list', 'user.create', 'user.update']) expect(authUrlFor({ op }, ALL, AUTH)).toBe(AUTH);
    expect(authUrlFor({ op: 'reset' }, {}, AUTH)).toBe(AUTH);
  });

  it('names the flow for the speed list, never the address', () => {
    expect(writeFlowName({ action: 'punch' }, ALL)).toBe('Punch');
    expect(writeFlowName({ action: 'punch' }, {}, WRITE)).toBe('Write');
    expect(writeFlowName({ action: 'approve_day' }, ALL)).toBe('Write');
  });
});
