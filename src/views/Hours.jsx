import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { summarize } from '../lib/hours.js';
import { addDays, dayKey, fmtDay, fmtHrs, fmtTime, mondayOf, weekLabel, fmtHrsU } from '../lib/time.js';
import { useNow } from '../lib/hooks.js';
import { shiftHours } from '../lib/schedule.js';
import { Avatar, Group, Num, Row, Sheet, Tag } from '../components/ui.jsx';

export function Hours() {
  const { data, setClientHours } = useStore();
  const now = useNow(60000);
  const [wk0, setWk0] = useState(() => mondayOf(new Date()));
  const wk1 = addDays(wk0, 7);
  const wkKey = dayKey(wk0);
  const thisWeek = dayKey(mondayOf(now)) === wkKey;
  const sum = useMemo(() => summarize(data, wk0, wk1, now), [data, wkKey, now]);
  const days = [...Array(7)].map((_, i) => addDays(wk0, i));
  const [person, setPerson] = useState(null);

  const succ = data.client.find((c) => c.week === wkKey)?.hours;
  const [draft, setDraft] = useState(succ ?? '');
  const [saved, setSaved] = useState('');
  useEffect(() => { setDraft(succ ?? ''); setSaved(''); }, [wkKey, succ]);
  const saveSucc = async () => {
    const v = draft === '' ? null : Number(draft);
    if (v === (succ ?? null)) return;
    try {
      await setClientHours(wkKey, v);
      setSaved(v == null ? 'Cleared' : `Saved: ${fmtHrsU(v)}`);
    } catch (e) {
      toast.error("Couldn't save successful hours", { description: e.message });
    }
  };

  const people = useMemo(() => {
    const m = new Map();
    for (const s of sum.weekSessions) {
      if (!m.has(s.email)) m.set(s.email, { name: s.name, email: s.email, byDay: {}, total: 0, sessions: [] });
      const r = m.get(s.email);
      r.byDay[s.day] = (r.byDay[s.day] || 0) + s.hours;
      r.total += s.hours;
      r.sessions.push(s);
    }
    for (const i of sum.weekIssues) if (m.has(i.email)) (m.get(i.email).issues ||= []).push(i);
    // Scheduled hours too, so someone booked who never came still shows, at 0.
    for (const r of (data.schedule || []).filter((x) => x.date >= dayKey(wk0) && x.date < dayKey(wk1))) {
      if (!m.has(r.email)) m.set(r.email, { name: r.name, email: r.email, byDay: {}, total: 0, sessions: [] });
      const p = m.get(r.email);
      p.planned = (p.planned || 0) + shiftHours(r);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [sum, data.schedule, wkKey]);
  const max = Math.max(sum.deliveredWeek, succ || 0, 1);

  return (
    <div className="view view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">Hours</h1>
          <p className="lede">Week of {weekLabel(wk0)}</p>
        </div>
        <div className="stepper" role="group" aria-label="Week">
          <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => setWk0(addDays(wk0, -7))}><ChevronLeft size={18} /></button>
          <button type="button" className="btn btn-plain btn-sm" disabled={thisWeek} onClick={() => setWk0(mondayOf(new Date()))}>This week</button>
          <button type="button" className="icon-btn" aria-label="Next week" disabled={thisWeek} onClick={() => setWk0(addDays(wk0, 7))}><ChevronRight size={18} /></button>
        </div>
      </header>

      <div className="split">
        <Group tour="hours-week" title="This week" footer="Hours worked count robot time, so a pair working together counts once. Operator hours add up each operator's own time.">
          <div className="compare">
            <div className="compare-row">
              <span className="compare-label">Hours worked</span>
              <span className="compare-track"><span className="compare-bar bar-blue reveal-x" style={{ width: `${(sum.deliveredWeek / max) * 100}%` }} /></span>
              <Num className="compare-val" value={sum.deliveredWeek} format={(v) => `${fmtHrsU(v)}`} />
            </div>
            {succ != null && (
              <div className="compare-row">
                <span className="compare-label">Successful</span>
                <span className="compare-track"><span className="compare-bar bar-green reveal-x" style={{ width: `${(succ / max) * 100}%` }} /></span>
                <span className="compare-val">{`${fmtHrsU(succ)}`}</span>
              </div>
            )}
          </div>
          <Row title="Operator hours" trailing={<Num value={sum.personWeek} format={(v) => `${fmtHrsU(v)}`} />} />
          <label className="field-row">
            <span>Client successful hours</span>
            <input
              type="number" min="0" step="0.25" inputMode="decimal" placeholder="Enter"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveSucc}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="num-input"
            />
          </label>
          {(saved || (succ != null && sum.deliveredWeek > 0)) && (
            <div className="field-note">
              {saved && <span className="saved fade-in" key={saved}>{saved}</span>}
              {succ != null && sum.deliveredWeek > 0 && <span>{Math.round((succ / sum.deliveredWeek) * 100)}% of hours worked</span>}
            </div>
          )}
        </Group>

        <Group title="To date">
          <Row title="Hours worked" trailing={<Num value={sum.deliveredAll} format={(v) => `${fmtHrsU(v)}`} />} />
          <Row title="Operator hours" trailing={<Num value={sum.personAll} format={(v) => `${fmtHrsU(v)}`} />} />
          <Row title="Successful (reported)" trailing={`${fmtHrsU(data.client.reduce((a, c) => a + c.hours, 0))}`} />
        </Group>
      </div>

      <Group tour="hours-ops" title="Operators" footer="Tap an operator to see their shifts.">
        <div className="week-head" aria-hidden="true">
          <span />
          {days.map((d) => <span key={+d} className={dayKey(d) === dayKey(now) ? 'is-today' : ''}>{d.toLocaleDateString([], { weekday: 'narrow' })}</span>)}
          <span>Week</span>
        </div>
        {people.length ? people.map((p, i) => (
          <button key={p.email} type="button" className="week-row row-btn row-in" style={{ animationDelay: `${i * 30}ms` }} onClick={() => setPerson(p)}>
            <span className="week-who">
              <Avatar name={p.name} />
              <span className="row-main">
                <span className="row-title">{p.name}{p.issues?.length ? <span className="dot-warn" aria-label={`${p.issues.length} flags`} /> : null}</span>
                <span className="row-sub">{Object.keys(p.byDay).length} days{p.planned ? ` · ${fmtHrsU(p.planned)} scheduled` : ''}</span>
              </span>
            </span>
            {days.map((d) => {
              const h = p.byDay[dayKey(d)];
              return <span key={+d} className={h ? 'cell' : 'cell zero'}>{h ? fmtHrs(h) : '–'}</span>;
            })}
            <span className="cell total">{fmtHrs(p.total)}</span>
          </button>
        )) : <div className="empty-row">No check-ins this week.</div>}
      </Group>

      <Sheet
        open={!!person}
        onOpenChange={(o) => !o && setPerson(null)}
        title={person?.name || ''}
        description={person ? `${person.email} · ${fmtHrsU(person.total)} this week` : ''}
      >
        {person && (
          <Group>
            {person.sessions.sort((a, b) => a.start - b.start).map((s) => (
              <Row
                key={+s.start}
                title={`${fmtDay(s.start)} · ${s.station}`}
                subtitle={`${fmtTime(s.start)} – ${s.live ? 'now' : fmtTime(s.end)}${s.note ? ` · “${s.note}”` : ''}`}
                trailing={<>{s.early && <Tag tone="bad">Left early</Tag>}<span className="mono-num">{fmtHrsU(s.hours)}</span></>}
              />
            ))}
            {(person.issues || []).filter((i) => i.kind !== 'early').map((i) => (
              <Row key={`${i.kind}${+i.at}`} title={`${fmtDay(i.at)} · ${i.station}`} subtitle={i.kind === 'noout' ? `In at ${fmtTime(i.at)}, no check-out` : `Out at ${fmtTime(i.at)}, no check-in`} trailing={<Tag tone="warn">{i.kind === 'noout' ? 'No check-out' : 'No check-in'}</Tag>} />
            ))}
          </Group>
        )}
      </Sheet>
    </div>
  );
}
