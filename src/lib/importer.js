import { LOCATIONS, ROBOTS, locationOfRobot } from './config.js';
import { robotName } from './robots.js';
import { newPairId } from './schedule.js';

// Recruiting's sheets (Active Roster 2, the scheduling tracker) come in as CSV,
// pasted or uploaded, or (the schedule) as the Schedulers' Excel template. Columns are matched by header name, so their order and
// exact spelling don't matter. Nothing is saved until the preview is confirmed.

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
const FIELDS = {
  name: ['name', 'fullname', 'operator', 'operatorname', 'moderator', 'moderatorname'],
  email: ['email', 'emailaddress', 'workemail', 'mail', 'operatoremail'],
  operatorId: ['operatorid', 'id', 'empid', 'employeeid'],
  cohort: ['cohort', 'batch', 'wave'],
  location: ['location', 'lab', 'site', 'locationid'],
  completed: ['completed', 'sessionscompleted', 'completedsessions', 'sessionsdone', 'noofsessionscompleted'],
  scheduledCount: ['sessionsscheduled', 'scheduled', 'scheduledsessions'],
  training: ['training', 'trainingstatus', 'status', 'onboardingstatus'],
  date: ['date', 'shiftdate', 'day', 'workdate'],
  start: ['start', 'starttime', 'shiftstart', 'from'],
  end: ['end', 'endtime', 'shiftend', 'to'],
  shift: ['shift', 'shifttime', 'slot', 'time'],
  robot: ['robot', 'station', 'robotid'],
  pair: ['pair', 'pairs', 'pairwith', 'team'],
  note: ['note', 'notes', 'comment', 'comments'],
};

export function mapHeaders(header) {
  const map = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [f, names] of Object.entries(FIELDS)) if (map[f] == null && names.includes(n)) map[f] = i;
  });
  return map;
}

const pick = (row, map, f) => (map[f] == null ? '' : String(row[map[f]] ?? '').trim());

const matchLocation = (v) => {
  const n = norm(v);
  if (!n) return '';
  return (LOCATIONS.find((l) => norm(l.id) === n || norm(l.name) === n || norm(l.name).startsWith(n) || n.includes(norm(l.name).replace('lab', ''))) || {}).id || '';
};

// "7:00 AM", "07:00", "17:30", "5 PM" all become 24h "HH:mm".
export function toHHMM(v) {
  // An Excel time cell: a fraction of a day (0.5 = 12:00).
  if (/^0?\.\d+$/.test(String(v || '').trim())) {
    const mins = Math.round(Number(v) * 1440) % 1440;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  // Time zone suffixes (PDT, PST, PT) are dropped: times are the lab's local time.
  const m = String(v || '').trim().replace(/\s*\(?\b(?:[A-Z]{1,2}[SD]?T|UTC|GMT)\)?$/i, '').match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3]) { const pm = m[3].toLowerCase() === 'p'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function toDateKey(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  // An Excel date cell: days since 1899-12-30 (a time of day after the point is dropped).
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date((Math.floor(Number(s)) - 25569) * 864e5).toISOString().slice(0, 10);
  return '';
}

export function nextOperatorId(operators) {
  const n = Math.max(0, ...(operators || []).map((o) => Number(String(o.id).replace(/\D/g, '')) || 0));
  return (k) => `OP-${String(n + k).padStart(4, '0')}`;
}

// Roster import: new emails get the next operator ID, known ones keep theirs and
// update only the fields the sheet has.
export function planRosterImport(text, operators, today) {
  const [header = [], ...rows] = parseCsv(text);
  const map = mapHeaders(header);
  const byEmail = new Map((operators || []).map((o) => [o.email, o]));
  const id = nextOperatorId(operators);
  const plan = { add: [], update: [], skip: [], columns: map };
  let k = 1;
  for (const [i, r] of rows.entries()) {
    const email = pick(r, map, 'email').toLowerCase();
    const name = pick(r, map, 'name');
    if (!/^\S+@\S+\.\S+$/.test(email)) { plan.skip.push({ line: i + 2, name, reason: 'No valid email' }); continue; }
    const fields = {
      name: name || undefined,
      cohort: pick(r, map, 'cohort') || undefined,
      location: matchLocation(pick(r, map, 'location')) || undefined,
      completedSessions: map.completed != null && pick(r, map, 'completed') !== '' ? Number(pick(r, map, 'completed')) || 0 : undefined,
      training: pick(r, map, 'training') || undefined,
    };
    Object.keys(fields).forEach((f) => fields[f] === undefined && delete fields[f]);
    if (fields.completedSessions != null) fields.completedAsOf = today;
    const cur = byEmail.get(email);
    if (cur) {
      const changed = Object.entries(fields).filter(([f, v]) => f !== 'completedAsOf' && String(cur[f] ?? '') !== String(v));
      if (changed.length) plan.update.push({ ...cur, ...fields, changed: changed.map(([f]) => f) });
      else plan.skip.push({ line: i + 2, name: cur.name, reason: 'No changes' });
    } else {
      if (!fields.name) { plan.skip.push({ line: i + 2, name: email, reason: 'No name' }); continue; }
      const op = { id: pick(r, map, 'operatorId') && /^OP-\d+$/i.test(pick(r, map, 'operatorId')) ? pick(r, map, 'operatorId').toUpperCase() : id(k++), email, active: true, completedSessions: 0, ...fields };
      byEmail.set(email, op);
      plan.add.push(op);
    }
  }
  return plan;
}

// "Robot 2", "2", "R2", "Robot 2 · Mobile" or just "Mobile". Blank or "Any" is ''.
export function matchRobot(v) {
  const s = String(v || '').trim();
  if (!s || /^any(\s*robot)?$/i.test(s)) return '';
  const n = norm(s.split('·')[0]);
  return ROBOTS.find((r) => norm(r) === n || norm(r).replace('robot', '') === n.replace(/^r(obot)?/, '')) || ROBOTS.find((r) => robotName(r) && norm(robotName(r)) === norm(s)) || null;
}

// The table to read: a sheet's rows, or CSV text. The header is the first row that
// names a Date column, so a title row above it is fine.
function table(input) {
  const rows = Array.isArray(input) ? input.map((r) => r.map((c) => String(c ?? ''))) : parseCsv(input);
  const at = Math.max(0, rows.slice(0, 10).findIndex((r) => mapHeaders(r).date != null));
  return { header: rows[at] || [], rows: rows.slice(at + 1), first: at + 2 };
}

// Schedule import: a row matches an existing shift by date, operator and start, so
// re-importing the same week updates rather than duplicates. Rows that share a date,
// lab, start and Pair label (A, B…) are booked as one pair; a blank Pair leaves it to
// the robot, as Add shift does. A blank Robot is Any robot.
export function planScheduleImport(input, operators, schedule, today = '') {
  const { header, rows, first } = table(input);
  const map = mapHeaders(header);
  const ops = operators || [];
  const plan = { add: [], update: [], skip: [], warn: [], columns: map };
  const existing = new Map((schedule || []).map((r) => [`${r.date}|${r.email}|${r.start}`, r]));
  const seen = new Set();
  const pairs = new Map(); // date|lab|start|label -> { id, members }
  for (const [i, r] of rows.entries()) {
    const line = first + i;
    const rawDate = pick(r, map, 'date');
    const email = pick(r, map, 'email').toLowerCase();
    const name = pick(r, map, 'name');
    // A row the template only formatted, with nobody on it yet.
    if (!rawDate && !email && !name) continue;
    const date = toDateKey(rawDate);
    const op = ops.find((o) => email && o.email === email) || ops.find((o) => name && o.name.toLowerCase() === name.toLowerCase());
    let start = toHHMM(pick(r, map, 'start'));
    let end = toHHMM(pick(r, map, 'end'));
    const robotText = pick(r, map, 'robot');
    const robot = matchRobot(robotText);
    const loc = matchLocation(pick(r, map, 'location')) || (robot && locationOfRobot(robot)?.id) || op?.location || '';
    const L = LOCATIONS.find((l) => l.id === loc);
    const shiftText = pick(r, map, 'shift');
    let noShift = '';
    if ((!start || !end) && shiftText) {
      // "7:00 AM - 12:30 PM PDT", or "Night 5:00 PM - 11:00 PM", or just "Night".
      const times = shiftText.replace(/^[^\d]*(?=\d)/, '');
      const [a, b] = times.split(/\s*(?:-|–|\bto\b)\s*/i);
      start ||= toHHMM(a); end ||= toHHMM(b);
      const byLabel = (L?.templates || []).find((t) => shiftText.toLowerCase().startsWith(t.label.toLowerCase()));
      if ((!start || !end) && byLabel) { start = byLabel.start; end = byLabel.end; }
      if ((!start || !end) && L && /^[a-z]/i.test(shiftText) && !/^custom/i.test(shiftText)) noShift = `${L.name} has no ${shiftText} shift`;
    }
    const away = op?.location && loc && loc !== op.location ? `${op.name} works at ${LOCATIONS.find((l) => l.id === op.location)?.name || op.location} only` : '';
    const why = !date ? (rawDate ? `Can't read the date “${rawDate}”` : 'No date')
      : !op ? `Unknown operator ${email || name}`
      : !loc ? 'No lab'
      : robot === null ? `Unknown robot “${robotText}”`
      : robot && locationOfRobot(robot)?.id !== loc ? `${robot} isn't at ${L?.name || loc}`
      : noShift || (!start || !end ? 'No shift or start and end time' : '') || away;
    if (why) { plan.skip.push({ line, name: op?.name || name || email, reason: why }); continue; }
    const key = `${date}|${op.email}|${start}`;
    if (seen.has(key)) { plan.skip.push({ line, name: op.name, reason: 'Repeated in the file' }); continue; }
    seen.add(key);
    const template = L.templates.find((t) => t.start === start && t.end === end)?.id || '';
    const cur = existing.get(key);
    const label = pick(r, map, 'pair');
    let pair = cur?.pair || '';
    if (label) {
      const pk = `${date}|${loc}|${start}|${label.toLowerCase()}`;
      const g = pairs.get(pk) || { id: '', members: 0 };
      if (g.members >= 2) { plan.skip.push({ line, name: op.name, reason: `Pair ${label} already has two operators` }); continue; }
      g.id ||= cur?.pair || newPairId();
      g.members += 1;
      pairs.set(pk, g);
      pair = g.id;
    }
    if (!L.days.includes(new Date(`${date}T12:00:00`).getDay())) plan.warn.push({ line, name: op.name, reason: `${L.name} is usually closed on ${new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}s` });
    if (today && date < today) plan.warn.push({ line, name: op.name, reason: `${date} is in the past` });
    const note = pick(r, map, 'note');
    const shift = { date, name: op.name, email: op.email, operatorId: op.id, location: loc, station: robot, start, end, template, pair, note: note || 'Imported' };
    if (cur) {
      if (cur.end !== end || (cur.station || '') !== robot || (cur.location || '') !== loc || (cur.pair || '') !== pair || (note && note !== cur.note)) plan.update.push({ ...cur, ...shift, id: cur.id, note: note || cur.note });
      else plan.skip.push({ line, name: op.name, reason: 'Already scheduled' });
    } else plan.add.push(shift);
  }
  return plan;
}
