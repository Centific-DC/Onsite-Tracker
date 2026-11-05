import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Mail, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { CFG, LOCATIONS } from '../lib/config.js';
import { conflicts, isNew as isNewOp, pairingRisks, weeklyLoad, wrongLab } from '../lib/rules.js';
import { buildSessions } from '../lib/hours.js';
import { addDays, dayKey, fmtDay, fmtLongDay, fmtTime, mondayOf, parseDay, weekLabel, fmtHrsU, shortName } from '../lib/time.js';
import { useHashQuery, useMedia, useNow } from '../lib/hooks.js';
import { Avatar, Group, Row, Segmented, Sheet, Tag } from '../components/ui.jsx';
import { ShiftSheet } from '../components/ShiftSheet.jsx';
import { SendSchedules } from '../components/SendSchedules.jsx';
import { noticeStatus } from '../lib/email/notices.js';
import { STATUS, backfillStart, dayPlan, shiftHours, shiftTimes } from '../lib/schedule.js';

const PAIR = 2;
// "Robot 2" -> "R2", the tag on each person in a shift that spans robots.
const shortRobot = (r) => r.replace(/^robot\s*/i, 'R');
// Fill a robot's pair before starting the next: the robot with an odd count first,
// then the emptiest.
const nextRobot = (loc, rows) => {
  const n = new Map(loc.robots.map((r) => [r, rows.filter((x) => x.station === r).length]));
  const odd = loc.robots.find((r) => n.get(r) % 2 === 1);
  return odd || [...loc.robots].sort((a, b) => n.get(a) - n.get(b))[0];
};
const wd = (k) => parseDay(k).toLocaleDateString([], { weekday: 'short' });
// "Avery Lin" -> "Avery L.", so two names fit in a narrow cell.
const stub = (name) => {
  const p = name.trim().split(/\s+/);
  const num = /^\d+$/.test(p[p.length - 1]) ? ` ${p.pop()}` : '';
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.${num}` : `${p[0]}${num}`;
};
const hm = (t) => fmtTime(shiftTimes({ date: '2026-01-05', start: t.start, end: t.end }).start);
const hmEnd = (t) => fmtTime(shiftTimes({ date: '2026-01-05', start: t.start, end: t.end }).end);

// The week as a grid of shift slots: one row per shift (Morning, Afternoon, Night),
// one column per day, as many places in each as the shift needs (config `seats`).
// An empty place is a button that books it. Problems are listed once at the top.
export function Schedule() {
  const { data, session } = useStore();
  const canSend = !!session?.roles?.includes('scheduler');
  const testMode = data.emailTestMode !== false;
  const [mailing, setMailing] = useState(false);
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
  // Days a shown lab runs, plus any other day with something booked on it.
  const runs = (loc, d) => loc.days.includes(d.getDay());
  const days = [...Array(7)].map((_, i) => addDays(wk0, i))
    .filter((d) => labs.some((l) => runs(l, d)) || dayKey(d) === focusDay || schedule.some((r) => r.date === dayKey(d) && robots.includes(r.station)));
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
  const clashes = [...conflicts(weekSched), ...wrongLab(weekSched, data.operators)];
  const watch = new Set([...over.map((x) => x.email), ...clashes.flatMap((c) => c.ids)]);
  const isNew = (email) => isNewOp(ops.get(email), sessions);

  // Which template a shift belongs to; anything else goes in the "Other times" row.
  const inTemplate = (r, loc) => (r.template ? loc.templates.find((t) => t.id === r.template) : loc.templates.find((t) => t.start === r.start && t.end === r.end));
  const rowsFor = (loc) => {
    const list = loc.templates.map((t) => ({ key: t.id, template: t }));
    if (weekSched.some((r) => loc.robots.includes(r.station) && !inTemplate(r, loc))) list.push({ key: 'other', template: null });
    return list;
  };
  const cellRows = (loc, row, k) => weekSched
    .filter((r) => r.date === k && loc.robots.includes(r.station) && (row.template ? inTemplate(r, loc)?.id === row.template.id : !inTemplate(r, loc)))
    .sort((a, b) => a.station.localeCompare(b.station) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  const free = (loc, row, d, rows) => (row.template && runs(loc, d) ? Math.max(0, row.template.seats - rows.length) : 0);

  const futureDays = days.filter((d) => dayKey(d) >= dayKey(now));
  const openCount = labs.reduce((a, l) => a + l.templates.reduce((c, t) => c + futureDays.reduce((e, d) => e + free(l, { template: t }, d, cellRows(l, { template: t }, dayKey(d))), 0), 0), 0);
  const missing = [...status.values()].filter((r) => robots.includes(r.station) && (r.status === 'late' || r.status === 'noshow'));
  const booked = weekSched.reduce((a, r) => a + shiftHours(r), 0);
  const attention = [
    risks.length && { tone: 'bad', label: 'Pairing risk', text: [...new Map(risks.map((x) => [x.names.join('+'), `${x.names.map(stub).join(' + ')} (${[...new Set(risks.filter((y) => y.names.join('+') === x.names.join('+')).map((y) => wd(y.date)))].join(', ')})`])).values()].join(' · ') },
    over.length && { tone: 'bad', label: `Over ${CFG.weeklyHourCap} hrs`, text: over.map((x) => `${x.name} ${fmtHrsU(x.hours)}`).join(' · ') },
    clashes.length && { tone: 'warn', label: 'Conflict', text: clashes.map((c) => `${c.name} ${c.kind === 'overlap' ? 'double-booked' : c.kind === 'wrong_lab' ? 'away from home lab' : 'at two labs'} ${wd(c.date)}`).join(' · ') },
    missing.length && { tone: 'warn', label: 'Missing', text: missing.map((r) => `${stub(r.name)} ${STATUS[r.status].label.toLowerCase()} ${wd(r.date)}`).join(' · ') },
  ].filter(Boolean);

  // Schedule emails for the week on screen (never for a week already over).
  const weekOver = dayKey(addDays(wk0, 7)) <= dayKey(now);
  const mail = useMemo(() => (canSend && !weekOver ? noticeStatus(data, wk0, testMode) : []), [canSend, weekOver, data, dayKey(wk0), testMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const unsent = mail.filter((e) => e.status === 'unsent').length;
  const changedN = mail.filter((e) => e.status === 'changed').length;
  const whichWeek = thisWeek ? 'This week’s' : dayKey(wk0) === dayKey(addDays(mondayOf(now), 7)) ? 'Next week’s' : `The ${weekLabel(wk0)}`;

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
          {canSend && !weekOver && (
            <button type="button" className="btn btn-primary btn-sm" data-tour="sched-mail" aria-label={phone ? 'Email schedules' : undefined} onClick={() => setMailing(true)}>
              <Mail size={16} />{!phone && ' Email schedules'}{unsent + changedN > 0 && <span className="mail-count" aria-label={`${unsent + changedN} to send`}>{unsent + changedN}</span>}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" data-tour="sched-add" onClick={() => setAdding({ date: dayKey(thisWeek ? now : wk0) })}><Plus size={16} /> Add shift</button>
        </div>
      </header>

      {canSend && unsent + changedN > 0 && (
        <div className="mail-banner" role="status">
          <span className="mail-banner-icon" aria-hidden="true"><Mail size={18} /></span>
          <span className="mail-banner-text">
            <strong>
              {unsent
                ? `${whichWeek} schedule hasn’t gone out to ${unsent} ${unsent === 1 ? 'operator' : 'operators'}`
                : `${changedN} ${changedN === 1 ? 'operator’s' : 'operators’'} shifts changed after their email`}
            </strong>
            <span>
              {unsent && changedN ? `${changedN} more had shifts change after their last email. ` : ''}
              {mail.length - unsent - changedN > 0 ? 'Everyone else is up to date.' : ''}
            </span>
          </span>
          <button type="button" className="btn btn-primary" onClick={() => setMailing(true)}>Review and send</button>
        </div>
      )}

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
        <Group title="Needs a look" className="group-urgent" tour="sched-attention">
          {attention.map((a) => <Row key={a.label} title={<Tag tone={a.tone}>{a.label}</Tag>} subtitle={a.text} />)}
        </Group>
      )}

      {labs.map((loc) => {
        // Each lab shows the days it runs (and any day with a booking there).
        const cols = phone ? shown : shown.filter((d) => runs(loc, d) || dayKey(d) === focusDay || weekSched.some((r) => r.date === dayKey(d) && loc.robots.includes(r.station)));
        return (
        <Group key={loc.id} title={loc.name} className="sched-group">
          <div className="sched" style={{ '--days': cols.length }} role="table" aria-label={`${loc.name} schedule`}>
            <div className="sched-row sched-head" role="row">
              <span role="columnheader" className="sched-label" />
              {cols.map((d) => (
                <span key={+d} role="columnheader" className={clsx('sched-day', dayKey(d) === dayKey(now) && 'is-today', dayKey(d) === focusDay && 'is-focus')}>
                  {d.toLocaleDateString([], { weekday: 'short' })} <strong>{d.getDate()}</strong>
                </span>
              ))}
            </div>
            {rowsFor(loc).map((row) => (
              <div key={row.key} className="sched-row" role="row">
                <span role="rowheader" className="sched-label">
                  <span className="sched-tpl">{row.template ? <>{row.template.label} <span>{hm(row.template)}–{hmEnd(row.template)}</span></> : 'Other times'}</span>
                  {row.template && <span className="sched-seats">{row.template.seats} operators{loc.robots.length > 1 ? ` · ${Math.ceil(row.template.seats / PAIR)} ${Math.ceil(row.template.seats / PAIR) === 1 ? 'robot' : 'robots'}` : ''}</span>}
                </span>
                {cols.map((d) => {
                  const k = dayKey(d);
                  const rows = cellRows(loc, row, k);
                  const past = k < dayKey(now);
                  const empty = free(loc, row, d, rows);
                  const extra = row.template && rows.length > row.template.seats ? rows.length - row.template.seats : 0;
                  return (
                    <div key={k} role="cell" className={clsx('sched-cell', past && 'is-past', k === focusDay && 'is-focus', !runs(loc, d) && 'is-closed')}>
                      {rows.map((r) => {
                        const st = status.get(r.id)?.status;
                        return (
                          <button key={r.id} type="button" className={clsx('slot', (watch.has(r.email) || watch.has(r.id)) && 'is-warn', riskIds.has(r.id) && 'is-risk')} data-status={st} onClick={() => setSlot({ k, loc, template: row.template, rows })} title={`${r.name} · ${r.station} · ${r.start}–${r.end}${st ? ` · ${STATUS[st].label}` : ''}`}>
                            <span className="slot-dot" aria-hidden="true" />
                            <span className="slot-name">{stub(r.name)}</span>
                            {loc.robots.length > 1
                              ? <span className={clsx('slot-robot', isNew(r.email) && 'is-new')} title={isNew(r.email) ? 'New operator' : undefined}>{shortRobot(r.station)}</span>
                              : isNew(r.email) && <span className="chip-new">new</span>}
                            {!row.template && <span className="slot-time">{r.start}</span>}
                          </button>
                        );
                      })}
                      {!past && [...Array(empty)].map((_, i) => (
                        <button key={`o${i}`} type="button" className="slot slot-open" aria-label={`Book ${row.template.label} at ${loc.name} on ${fmtDay(d)}`} onClick={() => setAdding({ date: k, location: loc.id, station: nextRobot(loc, rows), start: row.template.start, end: row.template.end })}>
                          <Plus size={13} aria-hidden="true" /> Open
                        </button>
                      ))}
                      {past && empty > 0 && <span className="cell-note">{empty} unfilled</span>}
                      {extra > 0 && <span className="cell-note is-warn">{extra} more than needed</span>}
                      {!runs(loc, d) && !rows.length && <span className="cell-note">Closed</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Group>
        );
      })}
      <p className="sched-legend">
        <span data-status="onsite"><i /> On site</span>
        <span data-status="done"><i /> Worked</span>
        <span data-status="upcoming"><i /> Booked</span>
        <span data-status="late"><i /> Not here yet</span>
        <span data-status="noshow"><i /> No-show</span>
        {robots.length > 1 && <span><span className="slot-robot">R1</span> robot</span>}
        <span>{robots.length > 1 && <span className="slot-robot is-new">R2</span>}{LOCATIONS.some((l) => l.robots.length === 1 && labs.includes(l)) && <span className="chip-new">new</span>} new operator (set on Roster)</span>
        <span className="legend-risk">Red outline: two new operators paired on one robot</span>
      </p>

      <SlotSheet value={slot} onClose={() => setSlot(null)} status={status} isNew={isNew} onAdd={(init) => { setSlot(null); setAdding(init); }} now={now} />
      <SendSchedules open={mailing} onOpenChange={setMailing} wk0={wk0} entries={mail} testMode={testMode} />
      <ShiftSheet open={!!adding} onOpenChange={(o) => !o && setAdding(null)} initial={adding} backfill={adding?.backfill} />
    </div>
  );
}

// One shift on one day: who's in it, their status, and remove, backfill or add.
function SlotSheet({ value, onClose, status, isNew, onAdd, now }) {
  const { data, removeShift } = useStore();
  const rows = value ? (data.schedule || []).filter((r) => value.rows.some((x) => x.id === r.id)) : [];
  const live = rows.map((r) => ({ ...r, ...(status.get(r.id) || {}) }));
  const late = live.find((r) => r.status === 'late');
  const past = value && value.k < dayKey(now);
  const remove = async (r) => {
    try {
      await removeShift(r.id);
      toast(`Removed ${r.name}'s shift`, { description: `${r.station} · ${fmtDay(parseDay(value.k))}` });
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
      title={value ? `${t ? t.label : 'Other times'} · ${value.loc.name}` : ''}
      description={value ? `${fmtLongDay(parseDay(value.k))}${t ? ` · ${hm(t)}–${hmEnd(t)} · ${rows.length} of ${t.seats} booked` : ''}` : ''}
      footer={value && !past && (late
        ? <button type="button" className="btn btn-primary btn-block" onClick={() => onAdd({ date: late.date, location: value.loc.id, station: late.station, start: backfillStart(late, now), end: late.end, note: `Backfill for ${late.name}`, backfill: late.name })}>Backfill for {shortName(late.name)}</button>
        : <button type="button" className="btn btn-plain btn-block" onClick={() => onAdd({ date: value.k, location: value.loc.id, station: nextRobot(value.loc, rows), start: t?.start, end: t?.end })}>Add an operator</button>)}
    >
      <Group>
        {live.map((r) => (
          <Row
            key={r.id}
            leading={<Avatar name={r.name} tone={r.status ? STATUS[r.status].tone : undefined} />}
            title={<>{r.name} {r.status && r.status !== 'upcoming' && <Tag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Tag>}{isNew(r.email) && <Tag tone="warn">New</Tag>}</>}
            subtitle={`${r.station} · ${fmtTime(shiftTimes(r).start)}–${fmtTime(shiftTimes(r).end)}${r.note ? ` · ${r.note}` : ''}${r.elsewhere ? ` · clocked in on ${r.elsewhere}` : ''}`}
            trailing={!past ? <button type="button" className="link" onClick={() => remove(r)}>Remove</button> : null}
          />
        ))}
        {!live.length && <div className="empty-row">No one booked.</div>}
      </Group>
    </Sheet>
  );
}
