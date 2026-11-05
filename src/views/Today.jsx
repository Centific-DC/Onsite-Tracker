import { useMemo, useState } from 'react';
import { Bot, CalendarX, ChevronLeft, ChevronRight, ClockAlert, LogOut, TriangleAlert, UserX } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { CFG, LOCATIONS, locationName, locationOfRobot } from '../lib/config.js';
import { buildSessions, union } from '../lib/hours.js';
import { addDays, dayKey, fmtDay, fmtLongDay, fmtTime, hoursBetween, fmtHrsU } from '../lib/time.js';
import { go, useNow } from '../lib/hooks.js';
import { Avatar, Group, Num, Row, Tag } from '../components/ui.jsx';
import { RobotLanes } from '../components/RobotLanes.jsx';
import { ShiftSheet } from '../components/ShiftSheet.jsx';
import { backfillStart, backfills, dayPlan } from '../lib/schedule.js';

export const ISSUE = {
  early: { label: 'Left early', tone: 'bad', icon: <LogOut size={12} /> },
  noout: { label: 'No check-out', tone: 'warn', icon: <ClockAlert size={12} /> },
  noin: { label: 'No check-in', tone: 'warn', icon: <TriangleAlert size={12} /> },
  late: { label: 'Not here yet', tone: 'warn', icon: <UserX size={12} /> },
  noshow: { label: 'No-show', tone: 'bad', icon: <UserX size={12} /> },
  unscheduled: { label: 'Not on the schedule', tone: 'warn', icon: <CalendarX size={12} /> },
};

export function issueDetail(i) {
  if (i.kind === 'early') return `Out at ${fmtTime(i.at)} after ${fmtHrsU(i.hours)}${i.note ? ` · “${i.note}”` : ''}`;
  if (i.kind === 'noout') return `In at ${fmtTime(i.at)}, never checked out · hours not counted`;
  if (i.kind === 'unscheduled') return `In at ${fmtTime(i.at)} with no shift booked that day`;
  return `Out at ${fmtTime(i.at)} with no check-in`;
}

export function Today() {
  const { data } = useStore();
  const now = useNow(30000);
  const [offset, setOffset] = useState(0);
  const day = addDays(now, offset);
  const k = dayKey(day);
  const isToday = offset === 0;

  const { sessions, issues } = useMemo(() => buildSessions(data.punches, now), [data.punches, now]);
  const daySessions = sessions.filter((s) => s.day === k);
  const live = sessions.filter((s) => s.live);
  const stations = CFG.stations.length ? CFG.stations : [...new Set(sessions.map((s) => s.station))];
  const running = new Set(live.map((s) => s.station)).size;
  const schedule = data.schedule || [];
  const plan = useMemo(() => dayPlan(schedule, sessions, issues, day, now), [schedule, sessions, issues, k, now]);
  const needFill = isToday ? backfills(plan.rows) : [];
  const [fill, setFill] = useState(null); // the missing shift being backfilled

  // Needs attention: check-in problems, people missing from the plan, and check-ins
  // nobody scheduled. Today looks back a week; another day shows only that day.
  const attention = useMemo(() => {
    const out = issues
      .filter((i) => (isToday ? now - i.at < 7 * 864e5 : dayKey(i.at) === k))
      .map((i) => ({ key: `${i.kind}-${i.email}-${+i.at}`, kind: i.kind, name: i.name, at: i.at, sub: `${fmtDay(i.at)} · ${i.station} · ${issueDetail(i)}` }));
    const days = isToday ? [...Array(7)].map((_, n) => addDays(now, -n)) : [day];
    for (const d of days) {
      const p = dayKey(d) === k ? plan : dayPlan(schedule, sessions, issues, d, now);
      for (const r of p.rows) {
        if (r.status !== 'late' && r.status !== 'noshow') continue;
        out.push({ key: `${r.status}-${r.id}`, kind: r.status, name: r.name, at: r.startAt, sub: `${fmtDay(r.startAt)} · ${r.station} · due ${fmtTime(r.startAt)}–${fmtTime(r.endAt)}${r.status === 'late' ? ', no check-in yet' : ', never checked in'}` });
      }
      for (const u of p.unscheduled) {
        if (!schedule.length) break;
        out.push({ key: `unsch-${u.email}-${dayKey(d)}`, kind: 'unscheduled', name: u.name, at: u.start, sub: `${fmtDay(u.start)} · ${u.station} · in at ${fmtTime(u.start)}` });
      }
    }
    const rank = { late: 0, noshow: 1, early: 2, noout: 3, noin: 4, unscheduled: 5 };
    // People missing right now first, then the rest newest first.
    return out.sort((a, b) => (a.kind === 'late' ? 0 : 1) - (b.kind === 'late' ? 0 : 1) || b.at - a.at || rank[a.kind] - rank[b.kind]);
  }, [issues, plan, schedule, sessions, isToday, k, now]);
  const missingNow = plan.rows.filter((r) => r.status === 'late').length;

  return (
    <div className="view view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">{isToday ? 'Today' : fmtDay(day)}</h1>
          <p className="lede">
            {isToday
              ? live.length
                ? `${live.length} on site · ${running} of ${stations.length} robots running${missingNow ? ` · ${missingNow} not here yet` : ''}`
                : 'No one is on site right now'
              : fmtLongDay(day)}
          </p>
        </div>
        <div className="stepper" role="group" aria-label="Day">
          <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => setOffset((o) => o - 1)}><ChevronLeft size={18} /></button>
          <button type="button" className="btn btn-plain btn-sm" disabled={isToday} onClick={() => setOffset(0)}>Today</button>
          <button type="button" className="icon-btn" aria-label="Next day" disabled={isToday} onClick={() => setOffset((o) => o + 1)}><ChevronRight size={18} /></button>
        </div>
      </header>

      {needFill.length > 0 && (
        <Group title="Needs a backfill" className="group-urgent" tour="today-backfill">
          {needFill.flatMap((b) => b.missing.map((r) => (
            <Row
              key={r.id}
              className="row-in"
              leading={<span className="row-icon icon-warn"><Bot size={18} /></span>}
              title={<>{locationName(locationOfRobot(b.station)?.id)} · {b.station} <Tag tone="warn">{b.here} of {b.planned} on site</Tag></>}
              subtitle={`${r.name} isn't here · due ${fmtTime(r.startAt)}–${fmtTime(r.endAt)}`}
              trailing={<button type="button" className="btn btn-primary btn-sm" onClick={() => setFill(r)}>Backfill</button>}
            />
          )))}
        </Group>
      )}

      {LOCATIONS.map((l, i) => {
        const mine = daySessions.filter((x) => l.robots.includes(x.station));
        let worked = 0;
        for (const r of l.robots) for (const [a, b] of union(mine.filter((x) => x.station === r))) worked += (b - a) / 36e5;
        return (
          <Group
            key={l.id}
            title={l.name}
            action={<span className="group-aside"><Num value={worked} format={(v) => `${fmtHrsU(v)}`} /> worked · {live.filter((x) => l.robots.includes(x.station)).length} on site</span>}
            footer={i === LOCATIONS.length - 1 ? "Thin lines are each operator's time. The bar beneath is the robot's hours worked, so two operators working together count once. Overlapping handovers are expected." : undefined}
          >
            <RobotLanes day={day} sessions={mine} planned={plan.rows.filter((r) => l.robots.includes(r.station) && (r.status === 'late' || r.status === 'noshow' || r.status === 'upcoming'))} stations={l.robots} now={now} pairSize={2} />
          </Group>
        );
      })}

      <div className="split">
        <Group
          title="Needs attention"
          action={attention.length > 0 && <button type="button" className="link" onClick={() => go('admin/records?flags')}>See all</button>}
        >
          {attention.length ? attention.slice(0, 8).map((i, n) => (
            <Row
              key={i.key}
              className="row-in"
              style={{ animationDelay: `${n * 30}ms` }}
              leading={<Avatar name={i.name} tone={ISSUE[i.kind].tone} />}
              title={<>{i.name} <Tag tone={ISSUE[i.kind].tone} icon={ISSUE[i.kind].icon}>{ISSUE[i.kind].label}</Tag></>}
              subtitle={i.sub}
            />
          )) : <div className="empty-row">{isToday ? 'Nothing in the last 7 days. Missing operators, early check-outs and missed check-outs land here.' : 'Nothing on this day.'}</div>}
        </Group>
        {isToday && (
          <Group title="On site" tour="today-onsite">
            {live.length ? live.sort((a, b) => a.start - b.start).map((s, i) => (
              <Row
                key={s.email}
                className="row-in"
                style={{ animationDelay: `${i * 30}ms` }}
                leading={<Avatar name={s.name} tone="on" />}
                title={s.name}
                subtitle={`${locationName(locationOfRobot(s.station)?.id)} · ${s.station} · since ${fmtTime(s.start)}`}
                trailing={<span className="mono-num">{fmtHrsU(hoursBetween(s.start, now))}</span>}
              />
            )) : <div className="empty-row">Check-ins show up here as operators arrive.</div>}
          </Group>
        )}
      </div>

      <ShiftSheet
        open={!!fill}
        onOpenChange={(o) => !o && setFill(null)}
        backfill={fill?.name}
        initial={fill && { date: fill.date, station: fill.station, start: backfillStart(fill, now), end: fill.end, note: `Backfill for ${fill.name}` }}
      />
    </div>
  );
}
