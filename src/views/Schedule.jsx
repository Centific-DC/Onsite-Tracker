import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { CFG, LOCATIONS, locationName, locationOfRobot } from '../lib/config.js';
import { completedSessions, conflicts, pairingRisks, slots, weeklyLoad } from '../lib/rules.js';
import { buildSessions } from '../lib/hours.js';
import { addDays, dayKey, fmtLongDay, fmtTime, mondayOf, weekLabel, fmtHrsU, shortName } from '../lib/time.js';
import { useNow } from '../lib/hooks.js';
import { Avatar, Group, Row, Segmented, Sheet, Tag } from '../components/ui.jsx';
import { ShiftSheet } from '../components/ShiftSheet.jsx';
import { STATUS, backfillStart, backfills, coverage, dayPlan, shiftHours } from '../lib/schedule.js';

const PAIR = 2;

export function Schedule() {
  const { data } = useStore();
  const now = useNow(60000);
  const [wk0, setWk0] = useState(() => mondayOf(new Date()));
  const thisWeek = dayKey(mondayOf(now)) === dayKey(wk0);
  const schedule = data.schedule || [];
  const [lab, setLab] = useState('all');
  const stations = LOCATIONS.filter((l) => lab === 'all' || l.id === lab).flatMap((l) => l.robots);
  const { sessions, issues } = useMemo(() => buildSessions(data.punches, now), [data.punches, now]);
  const [adding, setAdding] = useState(null); // initial values for the add sheet
  const [sheet, setSheet] = useState(null); // { k, station } for the robot-day sheet

  // Weekdays always; a weekend day only when something is booked on it.
  const days = [...Array(7)].map((_, i) => addDays(wk0, i))
    .filter((d) => (d.getDay() !== 0 && d.getDay() !== 6) || schedule.some((r) => r.date === dayKey(d)));
  const plans = useMemo(() => new Map(days.map((d) => [dayKey(d), dayPlan(schedule, sessions, issues, d, now)])), [schedule, sessions, issues, dayKey(wk0), now]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekRows = days.flatMap((d) => plans.get(dayKey(d)).rows);
  const booked = weekRows.filter((r) => stations.includes(r.station)).reduce((a, r) => a + shiftHours(r), 0);
  const short = days.flatMap((d) => stations.filter((s) => coverage(schedule, dayKey(d), s, PAIR).short).map((s) => `${s} ${d.toLocaleDateString([], { weekday: 'short' })}`));
  const missing = weekRows.filter((r) => r.status === 'late' || r.status === 'noshow').length;
  const ops = useMemo(() => new Map((data.operators || []).map((o) => [o.email, o])), [data.operators]);
  const weekSched = schedule.filter((r) => r.date >= dayKey(wk0) && r.date < dayKey(addDays(wk0, 7)) && stations.includes(r.station));
  const risks = useMemo(() => pairingRisks(weekSched, data.operators, sessions), [weekSched, data.operators, sessions]);
  const riskIds = new Set(risks.flatMap((x) => x.ids));
  const over = weeklyLoad(schedule, wk0).filter((x) => x.over);
  const clashes = conflicts(weekSched);
  const open = days.reduce((a, d) => a + slots(schedule, dayKey(d)).filter((x) => stations.includes(x.robot)).reduce((b, x) => b + x.open, 0), 0);

  return (
    <div className="view view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">Schedule</h1>
          <p className="lede">Week of {weekLabel(wk0)}</p>
        </div>
        <div className="stepper" role="group" aria-label="Week">
          <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => setWk0(addDays(wk0, -7))}><ChevronLeft size={18} /></button>
          <button type="button" className="btn btn-plain btn-sm" disabled={thisWeek} onClick={() => setWk0(mondayOf(new Date()))}>This week</button>
          <button type="button" className="icon-btn" aria-label="Next week" onClick={() => setWk0(addDays(wk0, 7))}><ChevronRight size={18} /></button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding({ date: dayKey(thisWeek ? now : wk0) })}><Plus size={16} /> Add shift</button>
        </div>
      </header>

      <div className="toolbar">
        <Segmented label="Lab" value={lab} onChange={setLab} options={[{ value: 'all', label: 'All labs' }, ...LOCATIONS.map((l) => ({ value: l.id, label: l.name }))]} />
      </div>

      <Group footer={`Recruiting's Excel tracker stays the master for now: import it on Roster. Open slots count each shift template that has fewer than ${PAIR} operators. Times are each lab's local time.`}>
        <div className="week-sum">
          <span><strong>{weekRows.filter((r) => stations.includes(r.station)).length}</strong> shifts</span>
          <span><strong>{fmtHrsU(booked)}</strong> booked</span>
          <span><strong>{open}</strong> open slots</span>
          <span>{short.length ? <><strong>{short.length}</strong> understaffed: {short.join(', ')}</> : 'Every running robot has a full pair'}</span>
          {missing > 0 && <span><strong>{missing}</strong> missing</span>}
        </div>
        {risks.length > 0 && <Row title={<><Tag tone="bad">Pairing risk</Tag> {risks.length} {risks.length === 1 ? 'slot pairs' : 'slots pair'} two operators with fewer than {CFG.pairingMinSessions} completed sessions</>} subtitle={[...new Set(risks.map((x) => `${x.names.join(' + ')}`))].join(' · ')} />}
        {over.length > 0 && <Row title={<><Tag tone="bad">Over {CFG.weeklyHourCap} hrs</Tag> {over.map((x) => `${x.name} (${fmtHrsU(x.hours)})`).join(', ')}</>} />}
        {clashes.length > 0 && <Row title={<><Tag tone="warn">Conflict</Tag> {clashes.map((c) => `${c.name} ${c.kind === 'overlap' ? 'double-booked' : 'at two labs'} on ${new Date(`${c.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}`).join(', ')}</>} />}
      </Group>

      {days.map((d) => {
        const k = dayKey(d);
        const plan = plans.get(k);
        const isToday = k === dayKey(now);
        const running = stations;
        return (
          <Group
            key={k}
            className="day-group"
            title={`${isToday ? 'Today · ' : ''}${fmtLongDay(d)}`}
            action={<button type="button" className="link" onClick={() => setAdding({ date: k })}>Add</button>}
          >
            {running.map((s) => {
              const rows = plan.rows.filter((r) => r.station === s);
              const cov = coverage(schedule, k, s, PAIR);
              const late = backfills(rows, PAIR).length;
              return (
                <Row
                  key={s}
                  className="robot-row"
                  onClick={() => setSheet({ k, station: s })}
                  title={<>
                    {lab === 'all' ? `${locationName(locationOfRobot(s)?.id)} · ${s}` : s}
                    {rows.some((r) => riskIds.has(r.id)) && <Tag tone="bad">Pairing risk</Tag>}
                    {slots(schedule, k).filter((x) => x.robot === s && x.rows.length > 0 && x.open > 0).map((x) => <Tag key={x.template.id} tone="muted">{x.template.label}: {x.open} open</Tag>)}
                    {late > 0 && <Tag tone="warn">Needs a backfill</Tag>}
                    {cov.short && <Tag tone="warn">{cov.count} of {PAIR} booked</Tag>}
                    {rows.length === 0 && <Tag tone="muted">Not booked</Tag>}
                  </>}
                  subtitle={
                    <span className="chips">
                      {rows.map((r) => (
                        <span key={r.id} className="chip-person" data-status={r.status}>
                          <Avatar name={r.name} />
                          {shortName(r.name)}
                          {ops.get(r.email) && completedSessions(ops.get(r.email), sessions) < CFG.pairingMinSessions && <span className="chip-new">new</span>}
                          <span className="chip-time">{fmtTime(r.startAt)}–{fmtTime(r.endAt)}</span>
                          {(r.status === 'late' || r.status === 'noshow') && <span className="sr-only">{STATUS[r.status].label}</span>}
                        </span>
                      ))}
                    </span>
                  }
                />
              );
            })}
            {plan.unscheduled.length > 0 && (
              <Row
                title={<span className="row-sub">Checked in without a shift</span>}
                subtitle={<span className="chips">{plan.unscheduled.map((u) => (
                  <span key={u.email} className="chip-person"><Avatar name={u.name} />{shortName(u.name)}<span className="chip-time">{u.station} · {fmtTime(u.start)}</span></span>
                ))}</span>}
              />
            )}
          </Group>
        );
      })}

      <RobotDaySheet
        value={sheet}
        onClose={() => setSheet(null)}
        plan={sheet ? plans.get(sheet.k) : null}
        onAdd={(init) => { setSheet(null); setAdding(init); }}
        now={now}
      />
      <ShiftSheet
        open={!!adding}
        onOpenChange={(o) => !o && setAdding(null)}
        initial={adding}
        backfill={adding?.backfill}
      />
    </div>
  );
}

// One robot on one day: its shifts with their status, remove, and add or backfill.
function RobotDaySheet({ value, onClose, plan, onAdd, now }) {
  const { removeShift } = useStore();
  const rows = value && plan ? plan.rows.filter((r) => r.station === value.station) : [];
  const late = backfills(rows, PAIR)[0]?.missing[0];
  const remove = async (r) => {
    try {
      await removeShift(r.id);
      toast(`Removed ${r.name}'s shift`, { description: `${value.station} · ${fmtTime(r.startAt)}–${fmtTime(r.endAt)}` });
    } catch (e) {
      toast.error("Couldn't remove the shift", { description: e.message });
    }
  };
  return (
    <Sheet
      open={!!value}
      onOpenChange={(o) => !o && onClose()}
      title={value?.station || ''}
      description={value ? fmtLongDay(new Date(`${value.k}T12:00:00`)) : ''}
      footer={
        late
          ? <button type="button" className="btn btn-primary btn-block" onClick={() => onAdd({ date: late.date, station: late.station, start: backfillStart(late, now), end: late.end, note: `Backfill for ${late.name}`, backfill: late.name })}>Backfill for {shortName(late.name)}</button>
          : <button type="button" className="btn btn-plain btn-block" onClick={() => onAdd({ date: value?.k, station: value?.station })}>Add someone</button>
      }
    >
      <Group>
        {rows.map((r) => (
          <Row
            key={r.id}
            className="shift-row"
            leading={<Avatar name={r.name} tone={STATUS[r.status].tone} />}
            title={<>{r.name} {r.status !== 'upcoming' && <Tag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Tag>}</>}
            subtitle={`${fmtTime(r.startAt)}–${fmtTime(r.endAt)}${r.note ? ` · ${r.note}` : ''}${r.elsewhere ? ` · checked in on ${r.elsewhere}` : ''}`}
            trailing={<button type="button" className="link" onClick={() => remove(r)}>Remove</button>}
          />
        ))}
        {rows.length === 0 && <div className="empty-row">No shifts left on this robot.</div>}
      </Group>
    </Sheet>
  );
}
