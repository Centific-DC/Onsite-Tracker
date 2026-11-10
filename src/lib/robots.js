// Robot names. A robot keeps its id ("Robot 3") everywhere it is saved: shifts,
// clock-ins, exports and the flows, so hours worked still merge per robot. An admin
// can give it a name (its host, say "franka-thor-02") in Settings → Robots, and the
// screens show both. Defaults come from config.js (`robotNames`); names saved in
// Settings come back from the Read flow and win, even when cleared.
import { CFG } from './config.js';

let saved = {};

const clean = (m) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()]).filter(([k]) => k));

export function setRobotNames(fromServer) { saved = clean(fromServer); }

export function robotNames() { return { ...clean(CFG.robotNames), ...saved }; }

/** The robot's name, or '' when it has none. */
export const robotName = (id) => (id ? robotNames()[id] || '' : '');

/** "Robot 3 · franka-thor-02", or just "Robot 3". */
export const robotTitle = (id) => {
  const n = robotName(id);
  return id ? (n ? `${id} · ${n}` : id) : '';
};
