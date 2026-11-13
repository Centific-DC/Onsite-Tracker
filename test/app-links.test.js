import { describe, expect, it } from 'vitest';
import { APP_URL } from '../src/lib/config.js';
import { currentAppLinks, hasOldAppLinks } from '../src/lib/email/links.js';
import { DEFAULT_CONTENT } from '../src/lib/email/templates.js';

describe('links to the app in emails', () => {
  it('point at the Centific-DC site by default', () => {
    expect(APP_URL).toBe('https://centific-dc.github.io/Onsite-Tracker/');
    for (const t of Object.values(DEFAULT_CONTENT)) expect(hasOldAppLinks(t.html)).toBe(false);
  });
  it('rewrites templates saved with the old DK-Centific address', () => {
    const saved = '<a href="https://dk-centific.github.io/Onsite-Tracker/#/admin/review">Open Review</a><img src="https://DK-Centific.github.io/Onsite-Tracker/email-logo.png">';
    expect(hasOldAppLinks(saved)).toBe(true);
    const fixed = currentAppLinks(saved);
    expect(fixed).toBe('<a href="https://centific-dc.github.io/Onsite-Tracker/#/admin/review">Open Review</a><img src="https://centific-dc.github.io/Onsite-Tracker/email-logo.png">');
    expect(hasOldAppLinks(fixed)).toBe(false);
  });
  it('leaves other links alone', () => {
    const html = '<a href="https://example.com/x">x</a>';
    expect(currentAppLinks(html)).toBe(html);
  });
});
