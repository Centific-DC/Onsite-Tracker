import { LOCATIONS, locationOfRobot } from './config.js';

// Recruiting's sheets (Active Roster 2, the scheduling tracker) come in as CSV,
// pasted or uploaded. Columns are matched by header name, so their order and
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
  email: ['email', 'emailaddress', 'workemail', 'mail'],
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
  if (/^\d{5}$/.test(s)) return new Date(Math.round((Number(s) - 25569) * 864e5)).toISOString().slice(0, 10);
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

// Schedule import: a row matches an existing shift by date, operator and start, so
// re-importing the same week updates rather than duplicates.
export function planScheduleImport(text, operators, schedule) {
  const [header = [], ...rows] = parseCsv(text);
  const map = mapHeaders(header);
  const ops = operators || [];
  const plan = { add: [], update: [], skip: [], columns: map };
  const existing = new Map((schedule || []).map((r) => [`${r.date}|${r.email}|${r.start}`, r]));
  for (const [i, r] of rows.entries()) {
    const date = toDateKey(pick(r, map, 'date'));
    const email = pick(r, map, 'email').toLowerCase();
    const name = pick(r, map, 'name');
    const op = ops.find((o) => (email && o.email === email) || (!email && name && o.name.toLowerCase() === name.toLowerCase()));
    let start = toHHMM(pick(r, map, 'start'));
    let end = toHHMM(pick(r, map, 'end'));
    const robot = pick(r, map, 'robot');
    const loc = matchLocation(pick(r, map, 'location')) || locationOfRobot(robot)?.id || op?.location || '';
    const shiftText = pick(r, map, 'shift');
    if ((!start || !end) && shiftText) {
      // "7:00 AM - 12:30 PM PDT", or "Night 5:00 PM - 11:00 PM", or just "Night".
      const times = shiftText.replace(/^[^\d]*(?=\d)/, '');
      const [a, b] = times.split(/\s*(?:-|–|\bto\b)\s*/i);
      start ||= toHHMM(a); end ||= toHHMM(b);
      const byLabel = (LOCATIONS.find((l) => l.id === loc)?.templates || []).find((t) => shiftText.toLowerCase().startsWith(t.label.toLowerCase()));
      if ((!start || !end) && byLabel) { start = byLabel.start; end = byLabel.end; }
    }
    const station = robot && locationOfRobot(robot) ? robot : LOCATIONS.find((l) => l.id === loc)?.robots[0] || '';
    const why = !date ? 'No date' : !op ? `Unknown operator ${email || name}` : !start || !end ? 'No start or end time' : !loc ? 'No location' : '';
    if (why) { plan.skip.push({ line: i + 2, name: name || email, reason: why }); continue; }
    const template = LOCATIONS.find((l) => l.id === loc)?.templates.find((t) => t.start === start && t.end === end)?.id || '';
    const shift = { date, name: op.name, email: op.email, operatorId: op.id, location: loc, station, start, end, template, note: 'Imported' };
    const cur = existing.get(`${date}|${op.email}|${start}`);
    if (cur) {
      if (cur.end !== end || cur.station !== station || (cur.location || '') !== loc) plan.update.push({ ...cur, ...shift, id: cur.id, note: cur.note });
      else plan.skip.push({ line: i + 2, name: op.name, reason: 'Already scheduled' });
    } else plan.add.push(shift);
  }
  return plan;
}
