import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { CFG, LOCATIONS } from '../lib/config.js';
import { completedSessions, conflicts, pairingRisks, weeklyLoad } from '../lib/rules.js';
import { buildSessions } from '../lib/hours.js';
import { addDays, dayKey, fmtDay, fmtLongDay, fmtTime, mondayOf, parseDay, weekLabel, fmtHrsU, shortName } from '../lib/time.js';
import { useHashQuery, useMedia, useNow } from '../lib/hooks.js';
import { Avatar, Group, Row, Segmented, Sheet, Tag } from '../components/ui.jsx';
import { ShiftSheet } from '../components/ShiftSheet.jsx';
import { STATUS, backfillStart, dayPlan, shiftHours, shiftTimes } from '../lib/schedule.js';

const PAIR = 2;
const wd = (k) => parseDay(k).toLocaleDateString([], { weekday: 'short' });
// "Avery Lin" -> "Avery L.", so two names fit in a narrow cell.
const stub = (name) => {
  const p = name.trim().split(/\s+/);
  const num = /^\d+$/.test(p[p.length - 1]) ? ` ${p.pop()}` : '';
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.${num}` : `${p[0]}${num}`;
};
const hm = (t) => fmtTime(shiftTimes({ date: '2026-01-05', start: t.start, end: t.end }).start);
const hmEnd = (t) => fmtTime(shiftTimes({ date: '2026-01-05', start: t.start, end: t.end }).end);

// The week as a grid of shift slots: one row per robot and shift template, one
// column per day. Each slot holds a pair; an empty place is a button that books it.
// Problems are listed once at the top instead of on every row.
export function Schedule() {
  const { data } = useStore();
  const now = useNow(60000);
  const phone = useMedia('(max-width: 767px)');
  const [wk0, setWk0] = useState(() => mondayOf(new Date()));
  const thisWeek = dayKey(mondayOf(now)) === dayKey(wk0);
  const schedule = data.schedule || [];
  const [lab, setLab] = useState('all');
  const labs = LOCATIONS.filter((l) => lab === 'all' || l.id === lab);
  const robots = labs.flatMap((l) => l.robots);
  const { sessions, issues } = useMemo(() => buildSessions(data.punches, now), [data.punches, now]);
  const [adding, setAdding] = useState(null);
  const [slot, setSlot] = useState(null); // { k, robot, template, rows }

  const [focusDay, setFocusDay] = useState(null);
  // Weekdays always; a weekend day only when something is booked on it.
  const days = [...Array(7)].map((_, i) => addDays(wk0, i))
    .filter((d) => (d.getDay() !== 0 && d.getDay() !== 6) || dayKey(d) === focusDay || schedule.some((r) => r.date === dayKey(d)));
  const [pick, setPick] = useState(() => dayKey(now));
  useEffect(() => { if (!days.some((d) => dayKey(d) === pick)) setPick(dayKey(days.find((d) => dayKey(d) === dayKey(now)) || days[0])); }, [dayKey(wk0)]); // eslint-disable-line react-hooks/exhaustive-deps
  // A link from search (?day=…) opens that week, on that day on phones.
  const hq = useHashQuery();
  useEffect(() => {
    const day = new URLSearchParams(hq).get('day');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return;
    setWk0(mondayOf(parseDay(day)));
    setPick(day);
    setFocusDay(day);
  }, [hq]);
  const shown = phone ? days.filter((d) => dayKey(d) === pick) : days;

  const plans = useMemo(() => new Map(days.map((d) => [dayKey(d), dayPlan(schedule, sessions, issues, d, now)])), [schedule, sessions, issues, dayKey(wk0), now]); // eslint-disable-line react-hooks/exhaustive-deps
  const status = useMemo(() => new Map([...plans.values()].flatMap((p) => p.rows.map((r) => [r.id, r]))), [plans]);
  const ops = useMemo(() => new Map((data.operators || []).map((o) => [o.email, o])), [data.operators]);
  const weekSched = schedule.filter((r) => r.date >= dayKey(wk0) && r.date < dayKey(addDays(wk0, 7)) && robots.includes(r.station));
  const risks = useMemo(() => pairingRisks(weekSched, data.operators, sessions), [weekSched, data.operators, sessions]);
  const riskIds = new Set(risks.flatMap((x) => x.ids));
  const over = weeklyLoad(schedule, wk0).filter((x) => x.over);
  const clashes = conflicts(weekSched);
  const watch = new Set([...over.map((x) => x.email), ...clashes.flatMap((c) => c.ids)]);
  const isNew = (email) => { const o = ops.get(email); return o && completedSessions(o, sessions) < CFG.pairingMinSessions; };

  // Which template a shift belongs to; anything else goes in its robot's "Other times" row.
  const inTemplate = (r, loc) => (r.template ? loc.templates.find((t) => t.id === r.template) : loc.templates.find((t) => t.start === r.start && t.end === r.end));
  const rowsFor = (loc, robot) => {
    const list = loc.templates.map((t) => ({ key: `${robot}|${t.id}`, robot, template: t }));
    if (weekSched.some((r) => r.station === robot && !inTemplate(r, loc))) list.push({ key: `${robot}|other`, robot, template: null });
    return list;
  };
  const cellRows = (loc, row, k) => weekSched.filter((r) => r.date === k && r.station === row.robot && (row.template ? inTemplate(r, loc)?.id === row.template.id : !inTemplate(r, loc)));

  const futureDays = days.filter((d) => dayKey(d) >= dayKey(now));
  const openCount = labs.reduce((a, l) => a + l.robots.reduce((b, robot) => b + l.templates.reduce((c, t) => c + futureDays.reduce((e, d) => e + Math.max(0, PAIR - cellRows(l, { robot, template: t }, dayKey(d)).length), 0), 0), 0), 0);
  const missing = [...status.values()].filter((r) => robots.includes(r.station) && (r.status === 'late' || r.status === 'noshow'));
  const booked = weekSched.reduce((a, r) => a + shiftHours(r), 0);
  const attention = [
    risks.length && { tone: 'bad', label: 'Pairing risk', text: [...new Map(risks.map((x) => [x.names.join('+'), `${x.names.map(stub).join(' + ')} (${[...new Set(risks.filter((y) => y.names.join('+') === x.names.join('+')).map((y) => wd(y.date)))].join(', ')})`])).values()].join(' · ') },
    over.length && { tone: 'bad', label: `Over ${CFG.weeklyHourCap} hrs`, text: over.map((x) => `${x.name} ${fmtHrsU(x.hours)}`).join(' · ') },
    clashes.length && { tone: 'warn', label: 'Conflict', text: clashes.map((c) => `${c.name} ${c.kind === 'overlap' ? 'double-booked' : 'at two labs'} ${wd(c.date)}`).join(' · ') },
    missing.length && { tone: 'warn', label: 'Missing', text: missing.map((r) => `${stub(r.name)} ${STATUS[r.status].label.toLowerCase()} ${wd(r.date)}`).join(' · ') },
  ].filter(Boolean);

  return (
    <div className="view view-enter view-wide">
      <header className="page-head">
        <div>
          <h1 className="large-title">Schedule</h1>
          <p className="lede">{weekLabel(wk0)} · {fmtHrsU(booked)} booked · {openCount ? `${openCount} open ${openCount === 1 ? 'slot' : 'slots'} ahead` : 'every slot ahead is filled'}</p>
        </div>
        <div className="stepper" role="group" aria-label="Week">
          <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => setWk0(addDays(wk0, -7))}><ChevronLeft size={18} /></button>
          <button type="button" className="btn btn-plain btn-sm" disabled={thisWeek} onClick={() => setWk0(mondayOf(new Date()))}>This week</button>
          <button type="button" className="icon-btn" aria-label="Next week" onClick={() => setWk0(addDays(wk0, 7))}><ChevronRight size={18} /></button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding({ date: dayKey(thisWeek ? now : wk0) })}><Plus size={16} /> Add shift</button>
        </div>
      </header>

      <div className="toolbar">
        {LOCATIONS.length > 1 && <Segmented label="Lab" value={lab} onChange={setLab} options={[{ value: 'all', label: 'All labs' }, ...LOCATIONS.map((l) => ({ value: l.id, label: l.name }))]} />}
        {phone && (
          <div className="day-pick" role="group" aria-label="Day">
            {days.map((d) => (
              <button key={+d} type="button" aria-pressed={dayKey(d) === pick} className={clsx(dayKey(d) === dayKey(now) && 'is-today')} onClick={() => setPick(dayKey(d))}>
                <span>{d.toLocaleDateString([], { weekday: 'short' })}</span>
                <strong>{d.getDate()}</strong>
              </button>
            ))}
          </div>
        )}
      </div>

      {attention.length > 0 && (
        <Group title="Needs a look" className="group-urgent">
          {attention.map((a) => <Row key={a.label} title={<Tag tone={a.tone}>{a.label}</Tag>} subtitle={a.text} />)}
        </Group>
      )}

      {labs.map((loc) => (
        <Group key={loc.id} title={loc.name} className="sched-group">
          <div className="sched" style={{ '--days': shown.length }} role="table" aria-label={`${loc.name} schedule`}>
            <div className="sched-row sched-head" role="row">
              <span role="columnheader" className="sched-label" />
              {shown.map((d) => (
                <span key={+d} role="columnheader" className={clsx('sched-day', dayKey(d) === dayKey(now) && 'is-today', dayKey(d) === focusDay && 'is-focus')}>
                  {d.toLocaleDateString([], { weekday: 'short' })} <strong>{d.getDate()}</strong>
                </span>
              ))}
            </div>
            {loc.robots.map((robot) => rowsFor(loc, robot).map((row, ri) => (
              <div key={row.key} className={clsx('sched-row', ri === 0 && 'is-first')} role="row">
                <span role="rowheader" className="sched-label">
                  {ri === 0 && <span className="sched-robot">{robot}</span>}
                  <span className="sched-tpl">{row.template ? <>{row.template.label} <span>{hm(row.template)}–{hmEnd(row.template)}</span></> : 'Other times'}</span>
                </span>
                {shown.map((d) => {
                  const k = dayKey(d);
                  const rows = cellRows(loc, row, k);
                  const past = k < dayKey(now);
                  const empty = row.template ? Math.max(0, PAIR - rows.length) : 0;
                  return (
                    <div key={k} role="cell" className={clsx('sched-cell', past && 'is-past', k === focusDay && 'is-focus', rows.some((r) => riskIds.has(r.id)) && 'is-risk')}>
                      {rows.map((r) => {
                        const st = status.get(r.id)?.status;
                        return (
                          <button key={r.id} type="button" className={clsx('slot', (watch.has(r.email) || watch.has(r.id)) && 'is-warn')} data-status={st} onClick={() => setSlot({ k, loc, robot, template: row.template, rows })} title={`${r.name} · ${r.start}–${r.end}${st ? ` · ${STATUS[st].label}` : ''}`}>
                            <span className="slot-dot" aria-hidden="true" />
                            <span className="slot-name">{stub(r.name)}</span>
                            {isNew(r.email) && <span className="chip-new">new</span>}
                            {!row.template && <span className="slot-time">{r.start}</span>}
                          </button>
                        );
                      })}
                      {!past && [...Array(empty)].map((_, i) => (
                        <button key={`o${i}`} type="button" className="slot slot-open" aria-label={`Book ${robot} ${row.template.label} on ${fmtDay(d)}`} onClick={() => setAdding({ date: k, location: loc.id, station: robot, start: row.template.start, end: row.template.end })}>
                          <Plus size={13} aria-hidden="true" /> Open
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )))}
          </div>
        </Group>
      ))}
      <p className="sched-legend">
        <span data-status="onsite"><i /> On site</span>
        <span data-status="done"><i /> Worked</span>
        <span data-status="upcoming"><i /> Booked</span>
        <span data-status="late"><i /> Not here yet</span>
        <span data-status="noshow"><i /> No-show</span>
        <span><span className="chip-new">new</span> fewer than {CFG.pairingMinSessions} sessions</span>
        <span className="legend-risk">Red outline: two new operators together</span>
      </p>

      <SlotSheet value={slot} onClose={() => setSlot(null)} status={status} isNew={isNew} onAdd={(init) => { setSlot(null); setAdding(init); }} now={now} />
      <ShiftSheet open={!!adding} onOpenChange={(o) => !o && setAdding(null)} initial={adding} backfill={adding?.backfill} />
    </div>
  );
}

// One slot on one day: who's in it, their status, and remove, backfill or add.
function SlotSheet({ value, onClose, status, isNew, onAdd, now }) {
  const { data, removeShift } = useStore();
  const rows = value ? (data.schedule || []).filter((r) => value.rows.some((x) => x.id === r.id)) : [];
  const live = rows.map((r) => ({ ...r, ...(status.get(r.id) || {}) }));
  const late = live.find((r) => r.status === 'late');
  const past = value && value.k < dayKey(now);
  const remove = async (r) => {
    try {
      await removeShift(r.id);
      toast(`Removed ${r.name}'s shift`, { description: `${value.robot} · ${fmtDay(parseDay(value.k))}` });
      if (rows.length === 1) onClose();
    } catch (e) {
      toast.error("Couldn't remove the shift", { description: e.message });
    }
  };
  const t = value?.template;
  return (
    <Sheet
      open={!!value}
      onOpenChange={(o) => !o && onClose()}
      title={value ? `${value.robot} · ${t ? t.label : 'Other times'}` : ''}
      description={value ? `${fmtLongDay(parseDay(value.k))} · ${value.loc.name}${t ? ` · ${hm(t)}–${hmEnd(t)}` : ''}` : ''}
      footer={value && !past && (late
        ? <button type="button" className="btn btn-primary btn-block" onClick={() => onAdd({ date: late.date, location: value.loc.id, station: late.station, start: backfillStart(late, now), end: late.end, note: `Backfill for ${late.name}`, backfill: late.name })}>Backfill for {shortName(late.name)}</button>
        : <button type="button" className="btn btn-plain btn-block" onClick={() => onAdd({ date: value.k, location: value.loc.id, station: value.robot, start: t?.start, end: t?.end })}>Add an operator</button>)}
    >
      <Group>
        {live.map((r) => (
          <Row
            key={r.id}
            leading={<Avatar name={r.name} tone={r.status ? STATUS[r.status].tone : undefined} />}
            title={<>{r.name} {r.status && r.status !== 'upcoming' && <Tag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Tag>}{isNew(r.email) && <Tag tone="warn">New</Tag>}</>}
            subtitle={`${fmtTime(shiftTimes(r).start)}–${fmtTime(shiftTimes(r).end)}${r.note ? ` · ${r.note}` : ''}${r.elsewhere ? ` · clocked in on ${r.elsewhere}` : ''}`}
            trailing={!past ? <button type="button" className="link" onClick={() => remove(r)}>Remove</button> : null}
          />
        ))}
        {!live.length && <div className="empty-row">No one booked.</div>}
      </Group>
    </Sheet>
  );
}
