import { describe, expect, it } from 'vitest';
import { welcomeValues } from '../src/lib/email/welcome.js';
import { TEMPLATE_FIELDS } from '../src/lib/email/templates.js';
import { fillSubject } from '../src/lib/email/render.js';

describe('welcome email', () => {
  it('fills the username, temp password, lab and expiry', () => {
    const v = welcomeValues({ name: 'Jamie Rivera', location: 'RED', username: 'jamie.rivera', temp: 'TEST-ONLY', expires: new Date(2026, 10, 12) });
    expect(v).toMatchObject({ operatorFirstName: 'Jamie', labName: 'Redmond Lab', signInUsername: 'jamie.rivera', tempPassword: 'TEST-ONLY', tempExpires: 'Thursday, November 12' });
    for (const id of TEMPLATE_FIELDS['operator-welcome']) expect(v[id]).toBeTruthy();
  });
  it('never puts a password in a subject', () => {
    expect(fillSubject('Your password is {tempPassword}', { tempPassword: 'secret-1234' })).toBe('Your password is ');
  });
});
