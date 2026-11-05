import { LOCATIONS } from './config.js';
import { FLAG, reviewDays } from './review.js';
import { addDays, dayKey, mondayOf } from './time.js';

// Admin search. One box takes names, emails, operator IDs, cohorts, dates, labs,
// robots, flags and review states in any mix ("jordan last week", "no-show nov 3",
// "robot 2 tomorrow"), and returns grouped results. Pure, so it's tested directly.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const day = (d) => [d, addDays(d, 1)];

// Words that name a flag or a review state. Longer phrases first, so "no clock-out"
// isn't read as "no-show".
const FLAG_WORDS = [
  [/\bno[\s-]?clock[\s-]?outs?\b|\bforgot\w* (?:to )?clock[\s-]?out\b|\bmissing clock[\s-]?outs?\b/, { flag: 'no_clockout' }],
  [/\bno[\s-]?clock[\s-]?ins?\b/, { flag: 'no_clockin' }],
  [/\bno[\s-]?shows?\b|\bmissed\b|\babsent\b/, { flag: 'no_show' }],
  [/\blate (?:clock[\s-]?outs?|finish(?:es)?|out)\b|\bovertime\b|\boutside(?: shift)?\b|\bextra time\b/, { flag: 'outside_shift' }],
  [/\bleft early\b|\bleaving early\b|\bearly (?:out|leave)\b/, { flag: 'left_early' }],
  [/\blate\b|\btardy\b/, { flag: 'late' }],
  [/\bgrace\b/, { flag: 'grace_used' }],
  [/\bunscheduled\b|\bnot (?:on the )?schedule[d]?\b|\boff[\s-]?shift\b/, { flag: 'unscheduled' }],
  [/\bflag(?:s|ged)?\b|\banomal(?:y|ies)\b|\bissues?\b/, { flag: '*' }],
  [/\bneeds? review\b|\bto review\b|\bto do\b|\bunresolved\b|\bopen flags?\b/, { status: 'needs_review' }],
  [/\bready\b/, { status: 'ready' }],
  [/\bnot approved\b|\bunapproved\b|\bpending\b/, { status: 'pending' }],
  [/\bapproved\b/, { status: 'approved' }],
  [/\bnew operators?\b|\bnew\b|\btrainees?\b/, { newOnly: true }],
];

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// Years are optional; a date without one is the nearest such date to today.
function nearest(m, d, now) {
  const opts = [-1, 0, 1].map((dy) => new Date(now.getFullYear() + dy, m, d));
  return opts.sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
}

export function parseQuery(q, now = new Date()) {
  let s = ` ${String(q || '').toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const out = { range: null, dateLabel: '', labs: [], robots: [], flags: [], status: null, newOnly: false, words: [] };
  const take = (re, fn) => { s = s.replace(re, (...m) => { fn(m); return ' '; }); };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const wk = mondayOf(today);
  const setRange = (r, label) => { if (!out.range) { out.range = r; out.dateLabel = label; } };

  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, ([, y, m, d]) => setRange(day(new Date(+y, m - 1, +d)), 'date'));
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, ([, m, d, y]) => setRange(day(y ? new Date(y.length === 2 ? 2000 + +y : +y, m - 1, +d) : nearest(m - 1, +d, today)), 'date'));
  take(new RegExp(`\\b${MONTH_RE}\\.? (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?\\b`), ([, mo, d, y]) => setRange(day(y ? new Date(+y, MONTHS.indexOf(mo.slice(0, 3)), +d) : nearest(MONTHS.indexOf(mo.slice(0, 3)), +d, today)), 'date'));
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? ${MONTH_RE}\\b`), ([, d, mo]) => setRange(day(nearest(MONTHS.indexOf(mo.slice(0, 3)), +d, today)), 'date'));
  take(/\btoday\b/, () => setRange(day(today), 'today'));
  take(/\byesterday\b/, () => setRange(day(addDays(today, -1)), 'yesterday'));
  take(/\btomorrow\b/, () => setRange(day(addDays(today, 1)), 'tomorrow'));
  take(/\blast week\b/, () => setRange([addDays(wk, -7), wk], 'last week'));
  take(/\bthis week\b/, () => setRange([wk, addDays(wk, 7)], 'this week'));
  take(/\bnext week\b/, () => setRange([addDays(wk, 7), addDays(wk, 14)], 'next week'));
  take(/\blast month\b/, () => setRange([new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 1)], 'last month'));
  take(/\bthis month\b/, () => setRange([new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 1)], 'this month'));
  // "last tue" is last week's; a bare weekday is this week's.
  take(/\b(last )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|weds?|thu(?:rs?)?|fri|sat)\b/, ([, last, w]) => {
    const i = (WEEKDAYS.indexOf(w.slice(0, 3)) + 6) % 7;
    setRange(day(addDays(wk, i - (last ? 7 : 0))), 'date');
  });
  take(new RegExp(`\\b${MONTH_RE}\\b(?: (\\d{4}))?`), ([, mo, y]) => {
    const m = MONTHS.indexOf(mo.slice(0, 3));
    const yr = y ? +y : m > today.getMonth() + 1 ? today.getFullYear() - 1 : today.getFullYear();
    setRange([new Date(yr, m, 1), new Date(yr, m + 1, 1)], 'month');
  });

  for (const r of LOCATIONS.flatMap((l) => l.robots)) {
    const re = new RegExp(`\\b${r.toLowerCase().replace(/\s+/g, '\\s*')}\\b`);
    take(re, () => out.robots.push(r));
  }
  take(/\brobot\s*(\d+)\b/, ([, n]) => out.robots.push(`Robot ${n}`));
  for (const l of LOCATIONS) {
    const n = l.name.toLowerCase();
    const alts = [n, n.replace(/ lab$/, ''), n.split(' ')[0], l.id.toLowerCase()];
    take(new RegExp(`\\b(?:${alts.join('|')})(?: lab)?\\b`), () => out.labs.push(l.id));
  }
  take(/\b(?:mtv|bay area)\b/, () => { const l = LOCATIONS.find((x) => x.id === 'MTV'); if (l) out.labs.push(l.id); });

  for (const [re, v] of FLAG_WORDS) {
    take(new RegExp(re.source, 'g'), () => {
      if (v.flag) out.flags.push(v.flag);
      if (v.status) out.status = out.status || v.status;
      if (v.newOnly) out.newOnly = true;
    });
  }
  out.labs = [...new Set(out.labs)];
  out.robots = [...new Set(out.robots)];
  out.flags = [...new Set(out.flags)];
  out.words = s.split(' ').map((w) => w.replace(/^[^\w@.-]+|[^\w@.-]+$/g, '')).filter((w) => w && !['on', 'at', 'in', 'for', 'the', 'and', 'with', 'who', 'was', 'were', 'shift', 'shifts', 'lab', 'day', 'days', 'show', 'me', 'all', 'of'].includes(w));
  return out;
}

const fields = (o) => [o.name, o.email, o.id, o.cohort, o.training, o.location].join(' ').toLowerCase();
const matchesWords = (o, words) => words.every((w) => fields(o).split(/[\s@.]+/).some((f) => f.startsWith(w)) || fields(o).includes(w));

// The window searched for review days when no date is given.
const DEFAULT_BACK_DAYS = 42;
const DEFAULT_AHEAD_DAYS = 21;

export function search(data, q, { now = new Date(), completed = () => Infinity, minSessions = 2 } = {}) {
  const p = parseQuery(q, now);
  const empty = { query: p, operators: [], days: [], shifts: [], dayLinks: [] };
  if (!String(q || '').trim()) return empty;
  const ops = (data.operators || []).filter((o) => (o.roles || ['operator']).includes('operator'));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [from, to] = p.range || [addDays(today, -DEFAULT_BACK_DAYS), addDays(today, DEFAULT_AHEAD_DAYS)];
  const fromK = dayKey(from), toK = dayKey(to);
  const hasWords = p.words.length > 0;

  let people = hasWords ? ops.filter((o) => matchesWords(o, p.words)) : ops;
  if (p.newOnly) people = people.filter((o) => completed(o) < minSessions);
  if (p.labs.length) people = people.filter((o) => !o.location || p.labs.includes(o.location));
  const emails = new Set(people.map((o) => o.email));
  // Words that match nobody can't narrow anything, so there's nothing to show.
  if (hasWords && !people.length) return empty;

  const personFilter = hasWords || p.newOnly;
  const atLab = (x) => !p.labs.length || x.location.split(';').some((l) => p.labs.includes(l));
  const onRobot = (x) => !p.robots.length || p.robots.includes(x.station);

  const shifts = (data.schedule || [])
    .filter((r) => r.date >= fromK && r.date < toK && (!personFilter || emails.has(r.email)) && atLab(r) && onRobot(r))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.station.localeCompare(b.station));

  const wantDays = p.flags.length || p.status || p.range || personFilter;
  let days = wantDays ? reviewDays(data, from, to, now) : [];
  // Days still to come are shifts, not days to review.
  const tomorrowK = dayKey(addDays(today, 1));
  days = days.filter((d) => d.day < tomorrowK && (!personFilter || emails.has(d.email)) && atLab(d)
    && (!p.robots.length || d.shifts.some(onRobot) || d.sessions.some(onRobot)));
  if (p.flags.length) days = days.filter((d) => d.flags.some((f) => (p.flags.includes('*') ? !f.info : p.flags.includes(f.code))));
  if (p.status === 'pending') days = days.filter((d) => d.status === 'needs_review' || d.status === 'ready');
  else if (p.status) days = days.filter((d) => d.status === p.status);
  days.sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));

  // Operators are listed when the words name people, or nothing else narrows the search.
  const listPeople = hasWords || p.newOnly || (!p.range && !p.flags.length && !p.status && !p.robots.length);
  const dayLinks = p.range && dayKey(addDays(from, 1)) === toK ? [fromK] : [];
  return { query: p, operators: listPeople ? people : [], days, shifts: p.flags.length || p.status ? [] : shifts, dayLinks };
}

// Short description of what the parser understood, shown under the box.
export function describe(p) {
  const bits = [];
  if (p.words.length) bits.push(`“${p.words.join(' ')}”`);
  if (p.range) {
    const [a, b] = p.range;
    const oneDay = dayKey(addDays(a, 1)) === dayKey(b);
    bits.push(oneDay ? a.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : `${a.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(b, -1).toLocaleDateString([], { month: 'short', day: 'numeric' })}`);
  }
  for (const l of p.labs) bits.push(LOCATIONS.find((x) => x.id === l)?.name || l);
  bits.push(...p.robots);
  for (const f of p.flags) bits.push(f === '*' ? 'any flag' : FLAG[f]?.label || f);
  if (p.status) bits.push({ needs_review: 'needs review', ready: 'ready to approve', approved: 'approved', pending: 'not approved yet' }[p.status]);
  if (p.newOnly) bits.push('new operators');
  return bits.join(' · ');
}
