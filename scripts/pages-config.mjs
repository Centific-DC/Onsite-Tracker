// Fills in the flow addresses for the GitHub Pages build. The deploy workflow runs this
// after `vite build`, with the URLs from the repo's Actions secrets: LOTUS_AUTH_URL,
// LOTUS_READ_URL, LOTUS_WRITE_URL, plus the one-job flows (see SPLIT below and
// src/lib/routes.js). They go only into the built
// dist/config.js that Pages serves, never into the repo. A secret left unset keeps that
// flow in demo mode; an unset one-job flow sends its ops to Write (or Auth). Never
// prints a URL.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../dist/config.js', import.meta.url);

const https = (name) => {
  const v = String(process.env[name] || '').trim();
  if (!v) return '';
  try {
    if (new URL(v).protocol === 'https:') return v;
  } catch { /* fall through */ }
  console.error(`${name} is not an https URL; leaving that flow unset.`);
  return '';
};

// One-job flows: secret name -> config key. Fill In has no secret yet, so fill_in and
// punch stay on Write.
const SPLIT = {
  LOTUS_SAVE_USER_URL: 'saveUserUrl',
  LOTUS_SAVE_USERS_URL: 'saveUsersUrl',
  LOTUS_SAVE_SHIFT_URL: 'saveShiftUrl',
  LOTUS_DELETE_SHIFT_URL: 'deleteShiftUrl',
  LOTUS_SEND_EMAIL_URL: 'sendEmailUrl',
  LOTUS_RESET_PASSWORD_URL: 'resetPasswordUrl',
};

const urls = { authUrl: https('LOTUS_AUTH_URL'), readUrl: https('LOTUS_READ_URL'), writeUrl: https('LOTUS_WRITE_URL') };
for (const [secret, key] of Object.entries(SPLIT)) urls[key] = https(secret);
const set = Object.fromEntries(Object.entries(urls).filter(([, v]) => v));
const base = await readFile(FILE, 'utf8');
await writeFile(FILE, `${base}\n// Set by the GitHub Pages deploy from the repo's Actions secrets.\nwindow.ONSITE_CONFIG = Object.assign(window.ONSITE_CONFIG || {}, ${JSON.stringify(set)});\n`);
console.log(`Flows set: ${Object.keys(set).map((k) => k.replace('Url', '')).join(', ') || 'none (demo mode)'}`);
