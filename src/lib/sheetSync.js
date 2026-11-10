// The daily sync from the scheduling team's Master List workbook (SharePoint Excel,
// tables tblRedmondSchedule and tblMVSchedule) into Lotus_Shifts. The live sync runs
// in the Lotus Schedule Sync flow (docs/lotus-flows.md §8); this is the same plan in
// JavaScript, so the rules have tests and demo mode can show a sync. Keep both in step.
//
// The rules (David, 2026-11-10):
// - Past days are never touched. Today is synced only by a run that starts before the
//   workday (before 6:00 AM site-local, as the daily 5:30 AM run does); a run later in
//   the day starts from tomorrow, because same-day changes are made by hand in Lotus.
// - The sheet is the source of truth for the shifts it made: a changed time updates
//   the shift, a row that's gone removes it, a new name adds one.
// - Shifts added in Lotus (Source app, import or fill_in) are never changed or removed.
// - A sheet shift someone removed in Lotus stays removed while that row is unchanged
//   (Lotus_SheetSkips holds its key).
// - Blank Team Member rows are open slots, not shifts.

export const SHEET_SOURCE = 'sheet';
// Pair ids the sync owns (it may change or clear them). Any other pair was set by a scheduler.
export const SHEET_PAIR = 'P-sheet-';

const LAB_OF_TABLE = { tblRedmondSchedule: 'RED', tblMVSchedule: 'MTV' };
export const labOfTable = (name) => LAB_OF_TABLE[name] || '';

// "7:00 AM - 12:30 PM PT" -> { start: '07:00', end: '12:30' }. null if it can't be read.
export function parseSheetTime(text) {
  const m = String(text || '').match(/(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?/i);
  if (!m) return null;
  const hm = (h, mi, ap) => {
    let x = Number(h) % 12;
    if (ap.toUpperCase() === 'P') x += 12;
    return `${String(x).padStart(2, '0')}:${mi || '00'}`;
  };
  return { start: hm(m[1], m[2], m[3]), end: hm(m[4], m[5], m[6]) };
}

// A sheet row's identity: the same person on the same lab, day and shift. Stable when
// the row's time changes; a different person is a different row.
export const sheetKey = (lab, date, shift, email) => [lab, date, String(shift || '').trim().toLowerCase(), String(email || '').trim().toLowerCase()].join('|');

// Excel dates: an ISO string, a JS Date, or a serial day number (1900 system).
export function sheetDate(v) {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Math.round((Math.floor(Number(s)) - 25569) * 864e5)).toISOString().slice(0, 10);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  return '';
}

const minutes = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const span = (r) => { const a = minutes(r.start); let b = minutes(r.end); if (b <= a) b += 1440; return [a, b]; };
const overlaps = (x, y) => { const [a1, b1] = span(x); const [a2, b2] = span(y); return Math.min(b1, b2) > Math.max(a1, a2); };

// Before this site-local time a run includes today (no shift has started, nobody has
// clocked in). David, 2026-11-10.
export const SYNC_TODAY_BEFORE = '06:00';
export const syncIncludesToday = (now = new Date()) => `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` < SYNC_TODAY_BEFORE;

const nextDay = (k) => { const [y, m, d] = k.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + 1)); return t.toISOString().slice(0, 10); };

// The pair id the sync gives a shift: from the sheet's optional Pair column (A, B…),
// or, when exactly two people share a lab, day and shift, one pair for both. With 3
// or more and no Pair column the sync leaves the pair to the scheduler.
const pairId = (lab, date, shift, letter) => `${SHEET_PAIR}${lab}-${date.replace(/-/g, '')}-${String(shift).trim().toLowerCase()}${letter ? `-${String(letter).trim().toLowerCase()}` : ''}`;

/**
 * Work out what a sync would do. Pure: nothing is saved.
 * @param rows    sheet rows: { table | lab, date, shift, time, name, email, pair?, robot? }
 * @param shifts  Lotus_Shifts rows (normShift shape, with source and sheetKey)
 * @param users   Lotus_Users (normOperator shape)
 * @param skips   keys removed in Lotus (Lotus_SheetSkips titles)
 * @param today   site-local yyyy-MM-dd; only later days are synced, unless includeToday
 * @param includeToday the run started before the workday (syncIncludesToday)
 * @param labs    [{ id, templates: [{ id, start, end }] }] to name each shift's template
 * @param labsRead lab ids whose table was read (a lab missing here is never pruned)
 */
export function planSheetSync({ rows = [], shifts = [], users = [], skips = [], today, includeToday = false, labs = [], labsRead }) {
  const first = includeToday ? today : nextDay(today);
  const byEmail = new Map(users.filter((u) => u.active !== false).map((u) => [String(u.email).toLowerCase(), u]));
  const skipSet = new Set(skips);
  const skipped = [];
  const valid = [];
  const seen = new Set();
  const present = new Set();
  const read = new Set(labsRead || rows.map((r) => r.lab || labOfTable(r.table)));

  for (const raw of rows) {
    const lab = raw.lab || labOfTable(raw.table);
    const date = sheetDate(raw.date);
    const name = String(raw.name || '').trim();
    if (!lab || !date || date < first || !name) continue; // past, today (later in the day), or an open slot
    const email = String(raw.email || '').trim().toLowerCase();
    const shift = String(raw.shift || '').trim();
    const info = { lab, date, shift, name };
    const key = sheetKey(lab, date, shift, email || name);
    present.add(key);
    if (!email) { skipped.push({ ...info, reason: 'no_email' }); continue; }
    const t = parseSheetTime(raw.time);
    if (!t) { skipped.push({ ...info, reason: 'bad_time' }); continue; }
    const user = byEmail.get(email);
    if (!user) { skipped.push({ ...info, reason: 'not_in_lotus' }); continue; }
    if (user.location && user.location !== lab) { skipped.push({ ...info, name: user.name || name, reason: 'other_lab' }); continue; }
    if (seen.has(key)) { skipped.push({ ...info, reason: 'duplicate' }); continue; }
    seen.add(key);
    const L = labs.find((l) => l.id === lab);
    const template = L?.templates.find((x) => x.start === t.start && x.end === t.end)?.id || '';
    valid.push({ key, lab, date, shift, ...t, template, user, letter: String(raw.pair || '').trim(), robot: String(raw.robot || '').trim() });
  }

  // Pairs: the Pair column when there is one, else exactly two on a shift share one.
  const group = new Map();
  for (const v of valid) { const g = `${v.lab}|${v.date}|${v.shift.toLowerCase()}`; group.set(g, (group.get(g) || 0) + 1); }
  for (const v of valid) v.pair = v.letter ? pairId(v.lab, v.date, v.shift, v.letter) : group.get(`${v.lab}|${v.date}|${v.shift.toLowerCase()}`) === 2 ? pairId(v.lab, v.date, v.shift) : '';

  const future = shifts.filter((r) => r.date >= first);
  const bySheetKey = new Map(future.filter((r) => r.sheetKey).map((r) => [r.sheetKey, r]));
  const add = [];
  const update = [];
  const kept = [];
  const want = (v) => ({ date: v.date, operatorId: v.user.id, name: v.user.name, email: v.user.email, location: v.lab, template: v.template, start: v.start, end: v.end, source: SHEET_SOURCE, sheetKey: v.key });

  for (const v of valid) {
    const info = { lab: v.lab, date: v.date, shift: v.shift, name: v.user.name };
    if (skipSet.has(v.key)) { kept.push({ ...info, reason: 'removed_in_lotus' }); continue; }
    const have = bySheetKey.get(v.key);
    if (have && have.source !== SHEET_SOURCE) { kept.push({ ...info, reason: 'changed_in_lotus' }); continue; }
    if (have) {
      const next = { ...have, ...want(v) };
      // The sync owns its own pair ids; a pair a scheduler set stays. Robot: only from the sheet's optional Robot column.
      if (!have.pair || have.pair.startsWith(SHEET_PAIR)) next.pair = v.pair;
      if (v.robot) next.station = v.robot;
      const changed = ['operatorId', 'name', 'template', 'start', 'end', 'pair', 'station', 'location'].some((k) => (next[k] || '') !== (have[k] || ''));
      if (changed) update.push(next);
      continue;
    }
    // Someone already booked by hand at that time (a shift added in Lotus) keeps theirs.
    const clash = future.find((r) => r.email === v.user.email && r.date === v.date && r.source !== SHEET_SOURCE && overlaps(r, v));
    if (clash) { kept.push({ ...info, reason: 'booked_in_lotus' }); continue; }
    add.push({ ...want(v), station: v.robot, pair: v.pair, replaces: '', note: '' });
  }

  // Sheet shifts whose row is gone. Only for labs whose table was read, and never a
  // shift someone replaced (it's the record of a no-show).
  const replaced = new Set(shifts.map((r) => r.replaces).filter(Boolean));
  let remove = future.filter((r) => r.source === SHEET_SOURCE && r.sheetKey && !present.has(r.sheetKey) && read.has(r.location) && !replaced.has(r.id));
  // Safety: a sync that would remove more than half of the sheet's shifts (and more
  // than 10) stops short of removing anything. A renamed column or an emptied table
  // looks exactly like that.
  const ours = future.filter((r) => r.source === SHEET_SOURCE).length;
  let held = 0;
  if (remove.length > 10 && remove.length > ours / 2) { held = remove.length; remove = []; }

  return {
    from: first,
    add,
    update,
    remove: remove.map((r) => r.id),
    removed: remove.map((r) => ({ lab: r.location, date: r.date, name: r.name, start: r.start, end: r.end })),
    kept,
    skipped,
    held,
  };
}

// What the app shows (Read `scheduleSync`, from Lotus_Settings.ScheduleSync).
export const syncSummary = (plan, at = new Date().toISOString()) => ({
  at,
  from: plan.from,
  added: plan.add.length,
  changed: plan.update.length,
  removed: plan.remove.length,
  held: plan.held || 0,
  kept: plan.kept,
  skipped: plan.skipped,
  error: '',
});

export const SYNC_REASONS = {
  no_email: 'No email in the sheet',
  not_in_lotus: 'Not a Lotus user yet (add them on Roster)',
  other_lab: 'Home lab is the other lab',
  bad_time: 'The Time cell couldn’t be read',
  duplicate: 'Listed twice for the same shift',
  removed_in_lotus: 'Removed in Lotus, so the sync leaves it out',
  changed_in_lotus: 'Changed in Lotus, so Lotus’s version stays',
  booked_in_lotus: 'Already booked by hand in Lotus at that time',
};

export function normScheduleSync(s) {
  let x = s;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { x = null; } }
  if (!x || typeof x !== 'object' || !x.at) return null;
  const list = (a) => (Array.isArray(a) ? a : []).map((r) => ({ lab: String(r.lab ?? ''), date: String(r.date ?? '').slice(0, 10), shift: String(r.shift ?? ''), name: String(r.name ?? ''), reason: String(r.reason ?? '') }));
  return {
    at: String(x.at),
    from: String(x.from ?? ''),
    added: Number(x.added) || 0,
    changed: Number(x.changed) || 0,
    removed: Number(x.removed) || 0,
    held: Number(x.held) || 0,
    kept: list(x.kept),
    skipped: list(x.skipped),
    error: String(x.error ?? ''),
  };
}
