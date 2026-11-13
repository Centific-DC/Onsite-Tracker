import { APP_URL } from '../config.js';

// Addresses Lotus used to live at. Templates saved in Lotus_Templates before the repo
// moved still carry them in their buttons and logo, so they're swapped for APP_URL
// wherever a saved template is read or saved.
export const OLD_APP_URLS = ['https://dk-centific.github.io/Onsite-Tracker/'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OLD = new RegExp(OLD_APP_URLS.map(escape).join('|'), 'gi');

/** True when the text still links to an old Lotus address. */
export const hasOldAppLinks = (text) => typeof text === 'string' && new RegExp(OLD.source, 'i').test(text);

/** The text with every old Lotus address pointed at the current one. */
export function currentAppLinks(text, base = APP_URL) {
  if (typeof text !== 'string' || !base) return text;
  const to = base.endsWith('/') ? base : `${base}/`;
  return text.replace(OLD, () => to);
}
