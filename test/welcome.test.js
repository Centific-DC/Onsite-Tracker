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

import { resetLinkFor, withLink } from '../src/lib/email/reset.js';
import { DEFAULT_CONTENT } from '../src/lib/email/templates.js';

describe('password reset email', () => {
  const link = resetLinkFor('avery.lin', 'CODE_123-x', 'https://centific-dc.github.io/Onsite-Tracker/');
  it('links to the reset page with the username and one-time code', () => {
    expect(link).toBe('https://centific-dc.github.io/Onsite-Tracker/#/reset?u=avery.lin&c=CODE_123-x');
  });
  it('puts the person’s link on the template’s button, and adds one if the button was removed', () => {
    const html = withLink(DEFAULT_CONTENT['operator-reset'].html, link);
    expect(html).toContain('href="https://centific-dc.github.io/Onsite-Tracker/#/reset?u=avery.lin&amp;c=CODE_123-x"');
    expect(withLink('<p>Hi</p>', link)).toContain('c=CODE_123-x');
  });
  it('never puts the link in a subject', () => {
    expect(fillSubject('Reset {resetLink}', { resetLink: link })).toBe('Reset ');
    expect(DEFAULT_CONTENT['operator-reset'].subject).not.toMatch(/resetLink/);
  });
});
