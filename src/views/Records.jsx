import { useMemo, useState } from 'react';
import { Download, LogIn, LogOut, Search } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { buildSessions } from '../lib/hours.js';
import { dayKey, fmtLongDay, fmtTime, pad, parseDay, fmtHrsU } from '../lib/time.js';
import { Group, Row, Segmented, Tag } from '../components/ui.jsx';
import { ISSUE, issueDetail } from './Today.jsx';
import { STATUS, dayPlan, unscheduledIns } from '../lib/schedule.js';
import { download } from '../lib/csv.js';
import { locOf, locationName } from '../lib/config.js';
import { robotTitle } from '../lib/robots.js';

const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function Records() {
  const { data } = useStore();
  const [mode, setMode] = useState(() => (location.hash.includes('flags') ? 'flags' : 'all'));
  const [q, setQ] = useState('');
  const { sessions, issues } = useMemo(() => buildSessions(data.punches), [data.punches]);
  const offSchedule = useMemo(() => unscheduledIns(data.schedule, data.punches), [data.schedule, data.punches]);
  const offIds = useMemo(() => new Set(offSchedule.map((p) => p.id)), [offSchedule]);
  const flags = useMemo(() => issues.concat(offSchedule.map((p) => ({ kind: 'unscheduled', name: p.name, email: p.email, station: p.station, at: new Date(p.ts) }))), [issues, offSchedule]);
  const ids = useMemo(() => new Map((data.operators || []).map((o) => [o.email, o.id])), [data.operators]);
  const opId = (email) => ids.get(email) || '';
  const match = (x) => `${x.name} ${x.email} ${robotTitle(x.station)}`.toLowerCase().includes(q.toLowerCase());

  const groups = useMemo(() => {
    const items = mode === 'flags'
      ? flags.filter(match).map((i) => ({ kind: 'issue', at: i.at, i }))
      : data.punches.filter(match).map((p) => ({ kind: 'punch', at: new Date(p.ts), p }));
    items.sort((a, b) => b.at - a.at);
    const by = new Map();
    for (const it of items.slice(0, 400)) {
      const k = dayKey(it.at);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(it);
    }
    return [...by];
  }, [data.punches, flags, mode, q]);

  const exportLog = () => {
    const rows = [['Date', 'Time', 'Operator ID', 'Name', 'Email', 'In/Out', 'Location', 'Robot', 'Shift ID', 'Grace minutes', 'Device', 'Note', 'Flag', 'Timestamp (UTC)']];
    for (const p of [...data.punches].sort((a, b) => a.ts.localeCompare(b.ts))) {
      const t = new Date(p.ts);
      rows.push([dayKey(t), hhmm(t), opId(p.email), p.name, p.email, p.type.toUpperCase(), locationName(locOf(p)), p.station, p.shiftId, p.grace || '', p.source, p.note, p.flag ? 'Left early' : offIds.has(p.id) ? 'Not on the schedule' : '', p.ts]);
    }
    download(`lotus-raw-checkins-${dayKey(new Date())}.csv`, rows);
  };
  const exportShifts = () => {
    const rows = [['Date', 'Operator ID', 'Name', 'Email', 'Location', 'Robot', 'In', 'Out', 'Recorded hours', 'Left early', 'Note']];
    for (const s of [...sessions].filter((x) => !x.live).sort((a, b) => a.start - b.start)) {
      rows.push([s.day, opId(s.email), s.name, s.email, locationName(locOf(s)), s.station, hhmm(s.start), hhmm(s.end), s.hours.toFixed(2), s.early ? 'Yes' : '', s.note || '']);
    }
    download(`lotus-raw-sessions-${dayKey(new Date())}.csv`, rows);
  };
  const exportPlan = () => {
    const rows = [['Date', 'Operator ID', 'Name', 'Email', 'Location', 'Robot', 'Scheduled start', 'Scheduled end', 'Status', 'Actual in', 'Actual out', 'Recorded hours', 'Note']];
    const dates = [...new Set((data.schedule || []).map((r) => r.date))].sort();
    for (const k of dates) {
      for (const r of dayPlan(data.schedule, sessions, issues, parseDay(k)).rows) {
        const worked = r.sessions.reduce((a, x) => a + x.hours, 0);
        const first = r.sessions[0];
        const last = r.sessions[r.sessions.length - 1];
        rows.push([r.date, opId(r.email), r.name, r.email, locationName(locOf(r)), r.station, r.start, r.end, STATUS[r.status].label, first ? hhmm(first.start) : '', last && !last.live ? hhmm(last.end) : '', worked ? worked.toFixed(2) : '', r.note]);
      }
    }
    download(`lotus-raw-schedule-vs-actual-${dayKey(new Date())}.csv`, rows);
  };

  return (
    <div className="view view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">Records</h1>
          <p className="lede">Raw clock-ins with server time, for badge reconciliation. These aren't approved hours: those are on Reports.</p>
        </div>
      </header>

      <div className="toolbar">
        <Segmented
          label="Show"
          value={mode}
          onChange={setMode}
          options={[{ value: 'all', label: 'All check-ins' }, { value: 'flags', label: `Flags${flags.length ? ` (${flags.length})` : ''}` }]}
        />
        <label className="search search-inline">
          <Search size={16} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or robot" aria-label="Search records" />
        </label>
      </div>

      <Group tour="records-export" title="Raw exports" className="export-group" footer="Unapproved, straight from the clock-ins. For approved hours use Reports.">
        <Row leading={<span className="row-icon"><Download size={18} /></span>} title="Raw check-in log" subtitle="One row per tap, with location, shift and grace" trailing="CSV" onClick={exportLog} />
        <Row leading={<span className="row-icon"><Download size={18} /></span>} title="Raw sessions" subtitle="In, out and recorded hours per operator, for badge reconciliation" trailing="CSV" onClick={exportShifts} />
        <Row leading={<span className="row-icon"><Download size={18} /></span>} title="Schedule vs actual" subtitle="Every scheduled shift with its status (worked, no-show) and actual in/out" trailing="CSV" onClick={exportPlan} />
      </Group>

      {groups.length === 0 && (
        <Group><div className="empty-row">{q ? `Nothing matches “${q}”.` : mode === 'flags' ? 'No flags. Early or missed check-outs and check-ins with no shift show up here.' : 'No check-ins yet.'}</div></Group>
      )}
      {groups.map(([k, items]) => (
        <Group key={k} title={fmtLongDay(parseDay(k))}>
          {items.map((it) => it.kind === 'punch' ? (
            <Row
              key={it.p.id}
              leading={<span className={`row-icon icon-${it.p.type}`}>{it.p.type === 'in' ? <LogIn size={16} /> : <LogOut size={16} />}</span>}
              title={<>{it.p.name}{it.p.flag && <Tag tone="bad">Left early</Tag>}{offIds.has(it.p.id) && <Tag tone="warn">Not on the schedule</Tag>}</>}
              subtitle={`${it.p.type === 'in' ? 'In' : 'Out'} · ${locationName(locOf(it.p))} · ${robotTitle(it.p.station)}${it.p.note ? ` · “${it.p.note}”` : ''}`}
              trailing={<span className="mono-num">{fmtTime(it.at)}</span>}
            />
          ) : (
            <Row
              key={`${it.i.kind}${it.i.email}${+it.at}`}
              leading={<span className={`row-icon icon-${ISSUE[it.i.kind].tone}`}>{ISSUE[it.i.kind].icon}</span>}
              title={<>{it.i.name} <Tag tone={ISSUE[it.i.kind].tone}>{ISSUE[it.i.kind].label}</Tag></>}
              subtitle={`${robotTitle(it.i.station)} · ${issueDetail(it.i)}`}
              trailing={it.i.hours != null ? <span className="mono-num">{fmtHrsU(it.i.hours)}</span> : null}
            />
          ))}
        </Group>
      ))}
    </div>
  );
}
