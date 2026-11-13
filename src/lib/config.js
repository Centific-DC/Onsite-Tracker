// public/config.js sets window.ONSITE_CONFIG, so the site can be reconfigured
// on GitHub Pages without rebuilding.
export const CFG = Object.assign(
  { readUrl: '', writeUrl: '', authUrl: '', appUrl: 'https://centific-dc.github.io/Onsite-Tracker/', project: '', locations: [], stations: [], shiftHours: 6, earlyGraceMinutes: 15, weeklyHourCap: 37, pairingMinSessions: 2 },
  typeof window !== 'undefined' ? window.ONSITE_CONFIG : {},
);
export const READ_URL = String(CFG.readUrl || '').trim();
export const WRITE_URL = String(CFG.writeUrl || '').trim();
// Lotus Corrections: missed clock-in or out requests and strikes, a flow of its own
// because Write is near Power Automate's 500-step limit. Unset, they go to Write.
export const CORRECTIONS_URL = String(CFG.correctionsUrl || '').trim() || WRITE_URL;
// Lotus Schedule Sync: "Sync now" from the Master List workbook. The flow also runs by
// itself every day; unset, the Schedule page shows the last sync but no button.
export const SYNC_URL = String(CFG.syncUrl || '').trim();
// Live once both data flow URLs are set. Until then the app always shows demo data.
export const LIVE_READY = !!(READ_URL && WRITE_URL);
// Operator preview tab (public/preview.js): demo data and demo sign-in, this tab only.
export const PREVIEW = !!CFG.preview;
// Demo data on a live site (Settings > Data, per browser, as in Project Atlas): sample
// operators and shifts kept in this browser; nothing is saved to SharePoint or emailed.
// Sign-in stays real. These are live bindings: setDemo() flips them in place and the
// store reloads the data, with no page reload.
const DEMO_KEY = 'lotus-demo-on';
const readDemo = () => { try { return localStorage.getItem(DEMO_KEY) === 'on'; } catch { return false; } };
export let DEMO_CHOSEN = LIVE_READY && typeof window !== 'undefined' && readDemo();
export let DEMO = !LIVE_READY || DEMO_CHOSEN;
export function setDemo(on) {
  if (!LIVE_READY) return DEMO;
  try { if (on) localStorage.setItem(DEMO_KEY, 'on'); else localStorage.removeItem(DEMO_KEY); } catch { /* storage off: this tab only */ }
  DEMO_CHOSEN = !!on;
  DEMO = DEMO_CHOSEN;
  return DEMO;
}
// The Lotus Auth flow (usernames and passwords). Empty = accounts kept in this browser.
export const AUTH_URL = String(CFG.authUrl || '').trim();
// Where emails send people: the operator page and the admin Review view. The repo
// moved from DK-Centific to the Centific-DC org on 2026-11-10, and GitHub Pages
// doesn't redirect the old github.io address, so links saved before the move are
// rewritten to this one (src/lib/email/links.js).
export const APP_URL = String(CFG.appUrl || '').trim().replace(/#.*$/, '');

// Older configs list bare `stations`; they become one unnamed lab.
export const LOCATIONS = (CFG.locations?.length ? CFG.locations : [{ id: 'SITE', name: 'Site', robots: CFG.stations?.length ? CFG.stations : ['Robot 1'], templates: [], graceMinutes: 10 }])
  .map((l) => ({ graceMinutes: 10, templates: [], days: [0, 1, 2, 3, 4, 5, 6], ...l }))
  // A template without `seats` needs a pair on every robot.
  .map((l) => ({ ...l, templates: l.templates.map((t) => ({ seats: 2 * l.robots.length, ...t })) }));
export const ROBOTS = LOCATIONS.flatMap((l) => l.robots);
CFG.stations = ROBOTS;

export const locationById = (id) => LOCATIONS.find((l) => l.id === id) || null;
export const locationOfRobot = (robot) => LOCATIONS.find((l) => l.robots.includes(robot)) || null;
export const locationName = (id) => locationById(id)?.name || id || '';
// A shift's or punch's lab: its own field, or the lab its robot belongs to.
export const locOf = (x) => x?.location || locationOfRobot(x?.station)?.id || '';
