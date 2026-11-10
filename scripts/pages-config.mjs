// Fills in the flow addresses for the GitHub Pages build. The deploy workflow runs this
// after `vite build`, with the three URLs from the repo's Actions secrets
// (LOTUS_AUTH_URL, LOTUS_READ_URL, LOTUS_WRITE_URL, LOTUS_CORRECTIONS_URL, LOTUS_SCHEDULE_SYNC_URL). They go only into the built
// dist/config.js that Pages serves, never into the repo. A secret left unset keeps that
// flow in demo mode. Never prints a URL.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../dist/config.js', import.meta.url);

const https = (name) => {
  const v = String(process.env[name] || '').trim();
  if (!v) return '';
  try {
    if (new URL(v).protocol === 'https:') return v;
  } catch { /* fall through */ }
  console.error(`${name} is not an https URL; leaving that flow in demo mode.`);
  return '';
};

const urls = { authUrl: https('LOTUS_AUTH_URL'), readUrl: https('LOTUS_READ_URL'), writeUrl: https('LOTUS_WRITE_URL'), correctionsUrl: https('LOTUS_CORRECTIONS_URL'), syncUrl: https('LOTUS_SCHEDULE_SYNC_URL') };
const set = Object.fromEntries(Object.entries(urls).filter(([, v]) => v));
const base = await readFile(FILE, 'utf8');
await writeFile(FILE, `${base}\n// Set by the GitHub Pages deploy from the repo's Actions secrets.\nwindow.ONSITE_CONFIG = Object.assign(window.ONSITE_CONFIG || {}, ${JSON.stringify(set)});\n`);
console.log(`Flows set: ${Object.keys(set).map((k) => k.replace('Url', '')).join(', ') || 'none (demo mode)'}`);
