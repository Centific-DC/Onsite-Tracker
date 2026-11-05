// public/config.js sets window.ONSITE_CONFIG, so the site can be reconfigured
// on GitHub Pages without rebuilding.
export const CFG = Object.assign(
  { readUrl: '', writeUrl: '', project: '', locations: [], stations: [], shiftHours: 6, earlyGraceMinutes: 15, weeklyHourCap: 37, pairingMinSessions: 2 },
  typeof window !== 'undefined' ? window.ONSITE_CONFIG : {},
);
export const READ_URL = String(CFG.readUrl || '').trim();
export const WRITE_URL = String(CFG.writeUrl || '').trim();
export const DEMO = !READ_URL || !WRITE_URL;

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
