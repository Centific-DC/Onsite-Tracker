// Which flow each save goes to. Lotus Write and Lotus Auth do everything; the one-job
// flows do one op each, faster. Each one-job flow takes the same body and answers the
// same way as Write (or Auth) for its op, so only the URL changes. A one-job flow
// whose URL isn't set (its GitHub secret is missing) falls back to Write or Auth.
// URLs come only from config.js, filled in at deploy time; never log or show one.

// Config key → the flow it names (scripts/pages-config.mjs maps each secret to a key).
export const SPLIT_KEYS = ['saveUserUrl', 'saveUsersUrl', 'saveShiftUrl', 'deleteShiftUrl', 'punchUrl', 'sendEmailUrl', 'resetPasswordUrl', 'deleteUserUrl'];

// Write actions → the one-job flow's config key. fill_in stays on Write (no Fill In
// flow yet); undo_punch is test-only and never sent by the app.
const WRITE_ROUTES = {
  users_upsert: (body) => ((body.users || []).length === 1 ? 'saveUserUrl' : 'saveUsersUrl'),
  shift_upsert: () => 'saveShiftUrl',
  shift_delete: () => 'deleteShiftUrl',
  punch: () => 'punchUrl',
  email_send: () => 'sendEmailUrl',
  user_delete: () => 'deleteUserUrl',
};

// Auth ops → the one-job flow's config key.
const AUTH_ROUTES = {
  'change-password': 'resetPasswordUrl',
  'user.reset': 'resetPasswordUrl',
  'user.reset_link': 'resetPasswordUrl',
  reset: 'resetPasswordUrl',
};

const url = (cfg, key) => String((key && cfg[key]) || '').trim();

// Names for the speed list in Settings (never the URL).
const NAMES = { saveUserUrl: 'Save User', saveUsersUrl: 'Save Users', saveShiftUrl: 'Save Shift', deleteShiftUrl: 'Delete Shift', punchUrl: 'Punch', sendEmailUrl: 'Send Email', resetPasswordUrl: 'Reset Password', deleteUserUrl: 'Delete User' };

/** Which flow a Write body goes to, by name: a one-job flow's, or 'Write'. */
export function writeFlowName(body, cfg) {
  const pick = WRITE_ROUTES[body?.action];
  const key = pick && pick(body);
  return url(cfg, key) ? NAMES[key] : 'Write';
}

/** The URL for a Write body ({ action, ... }): its one-job flow, else Write. */
export function writeUrlFor(body, cfg, writeUrl) {
  const pick = WRITE_ROUTES[body?.action];
  return url(cfg, pick && pick(body)) || writeUrl;
}

/** The URL for an Auth request ({ op, ... }): its one-job flow, else Auth. */
export function authUrlFor(req, cfg, authUrl) {
  return url(cfg, AUTH_ROUTES[req?.op]) || authUrl;
}
