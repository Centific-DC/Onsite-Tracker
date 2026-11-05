import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CalendarDays, ClipboardCheck, Search as SearchIcon } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { CFG, locationName } from '../lib/config.js';
import { hasRole } from '../lib/auth.js';
import { buildSessions } from '../lib/hours.js';
import { completedSessions, weeklyLoad } from '../lib/rules.js';
import { describe, search } from '../lib/search.js';
import { reviewDays } from '../lib/review.js';
import { addDays, dayKey, fmtDay, fmtHrsU, fmtLongDay, fmtTime, mondayOf, parseDay } from '../lib/time.js';
import { go } from '../lib/hooks.js';
import { shiftTimes } from '../lib/schedule.js';
const span = (r) => { const t = shiftTimes(r); return `${fmtTime(t.start)}–${fmtTime(t.end)}`; };
import { Avatar, Group, Row, Sheet, Tag } from './ui.jsx';
import { ShiftSheet } from './ShiftSheet.jsx';
import { DAY_STATUS } from '../views/Review.jsx';

const EXAMPLES = ['Jordan', 'OP-0004', 'no-show last week', 'robot 2 tomorrow', 'needs review', 'Mountain View next week', 'new operators', 'Nov 3'];
const MAX = 8;

export const openReview = (email, day) => go(`admin/review?day=${day}${email ? `&op=${encodeURIComponent(email)}` : ''}`);
export const openSchedule = (day) => go(`admin/schedule?day=${day}`);

// One box for everything an admin looks up: people, dates, labs, robots, flags,
// review states. Arrow keys move, Enter opens.
export function SearchSheet() {
  const { data, session, searching, setSearching, openProfile } = useStore();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const listRef = useRef(null);
  const now = useMemo(() => new Date(), [searching]); // eslint-disable-line react-hooks/exhaustive-deps
  const { sessions } = useMemo(() => buildSessions(data?.punches || [], now), [data?.punches, now]);
  const canReview = hasRole(session, 'approver');
  const res = useMemo(() => (data ? search(data, q, { now, completed: (o) => completedSessions(o, sessions), minSessions: CFG.pairingMinSessions }) : null), [data, q, now, sessions]);
  useEffect(() => { if (searching) { setQ(''); setActive(0); } }, [searching]);
  useEffect(() => setActive(0), [q]);

  const close = () => setSearching(false);
  const items = [];
  if (res) {
    for (const k of res.dayLinks) {
      items.push({ key: `s${k}`, group: 'Go to', icon: <CalendarDays size={18} />, title: `Schedule for ${fmtLongDay(parseDay(k))}`, run: () => { close(); openSchedule(k); } });
      if (canReview && k <= dayKey(now)) items.push({ key: `r${k}`, group: 'Go to', icon: <ClipboardCheck size={18} />, title: `Review ${fmtLongDay(parseDay(k))}`, run: () => { close(); openReview('', k); } });
    }
    for (const o of res.operators.slice(0, MAX)) {
      const done = completedSessions(o, sessions);
      items.push({ key: `o${o.email}`, group: 'Operators', avatar: o.name, title: <>{o.name} {done < CFG.pairingMinSessions && <Tag tone="warn">New</Tag>}{o.active === false && <Tag tone="muted">Inactive</Tag>}</>, sub: `${o.id} · ${locationName(o.location) || 'No home lab'}${o.cohort ? ` · ${o.cohort}` : ''} · ${o.email}`, run: () => openProfile(o.email) });
    }
    if (canReview) {
      for (const d of res.days.slice(0, MAX)) {
        const flags = d.flags.filter((f) => !f.info);
        items.push({ key: `d${d.key}`, group: 'Days', avatar: d.name, tone: DAY_STATUS[d.status].tone, title: <>{d.name} <Tag tone={DAY_STATUS[d.status].tone}>{DAY_STATUS[d.status].label}</Tag>{flags.map((f) => <Tag key={f.key} tone={f.resolution ? 'muted' : f.tone}>{f.label}{f.resolution ? ' ✓' : ''}</Tag>)}</>, sub: `${fmtDay(parseDay(d.day))} · ${d.locationName || 'No lab'} · ${fmtHrsU(d.recorded)} recorded${d.approved != null ? ` · ${fmtHrsU(d.approved)} approved` : ''}`, run: () => { close(); openReview(d.email, d.day); } });
      }
    }
    for (const r of res.shifts.slice(0, MAX)) {
      items.push({ key: `h${r.id}`, group: 'Shifts', avatar: r.name, title: r.name, sub: `${fmtDay(parseDay(r.date))} · ${span(r)} · ${locationName(r.location)} · ${r.station}`, run: () => { close(); openSchedule(r.date); } });
    }
  }
  const counts = res ? { Operators: res.operators.length, Days: canReview ? res.days.length : 0, Shifts: res.shifts.length } : {};
  const groups = [...new Set(items.map((i) => i.group))];

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); items[active].run(); }
  };
  useEffect(() => { listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const understood = res && q.trim() ? describe(res.query) : '';

  return (
    <Sheet open={searching} onOpenChange={setSearching} title="Search" className="sheet-search" initialFocus={input}>
      <label className="search search-big">
        <SearchIcon size={18} aria-hidden="true" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Name, ID, date, lab, robot or flag"
          aria-label="Search"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="search-results"
          aria-activedescendant={items[active] ? `sr-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {understood && <p className="search-understood">Looking for {understood}</p>}
      <div id="search-results" role="listbox" aria-label="Results" ref={listRef}>
        {!q.trim() && (
          <Group title="Try">
            <div className="search-examples">
              {EXAMPLES.map((x) => <button key={x} type="button" className="chip-btn" onClick={() => { setQ(x); input.current?.focus(); }}>{x}</button>)}
            </div>
          </Group>
        )}
        {q.trim() && !items.length && <Group><div className="empty-row">Nothing matches “{q.trim()}”. Try a first name, an ID like OP-0004, or a date like Nov 3.</div></Group>}
        {groups.map((g) => (
          <Group key={g} title={g} action={counts[g] > MAX ? <span className="group-note">Top {MAX} of {counts[g]}</span> : null}>
            {items.map((it, i) => it.group === g && (
              <div key={it.key} id={`sr-${i}`} role="option" aria-selected={i === active} data-active={i === active} onMouseMove={() => active !== i && setActive(i)}>
                <Row
                  className={clsx('search-row', i === active && 'is-active')}
                  onClick={it.run}
                  leading={it.icon ? <span className="row-icon">{it.icon}</span> : <Avatar name={it.avatar} tone={it.tone} />}
                  title={it.title}
                  subtitle={it.sub}
                />
              </div>
            ))}
          </Group>
        ))}
      </div>
    </Sheet>
  );
}

// Everything about one operator on one sheet: who they are, this week's load,
// what's coming up and how their recent days went.
export function OperatorSheet() {
  const { data, session, profile, openProfile } = useStore();
  const [booking, setBooking] = useState(null);
  const now = useMemo(() => new Date(), [profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const o = profile ? (data?.operators || []).find((x) => x.email === profile) : null;
  const { sessions } = useMemo(() => buildSessions(data?.punches || [], now), [data?.punches, now]);
  const canReview = hasRole(session, 'approver');
  const canBook = hasRole(session, 'scheduler');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const wk0 = mondayOf(today);
  const days = useMemo(() => (o ? reviewDays(data, addDays(wk0, -21), addDays(today, 1), now).filter((d) => d.email === o.email && d.day < dayKey(addDays(today, 1))).reverse() : []), [o, data, now]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return <Sheet open={false} onOpenChange={() => openProfile(null)} title="" />;
  const done = completedSessions(o, sessions);
  const load = weeklyLoad(data.schedule || [], wk0).find((x) => x.email === o.email);
  const next = weeklyLoad(data.schedule || [], addDays(wk0, 7)).find((x) => x.email === o.email);
  const upcoming = (data.schedule || []).filter((r) => r.email === o.email && r.date >= dayKey(today)).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)).slice(0, 6);
  const open = days.reduce((a, d) => a + d.openFlags, 0);
  const leave = (fn) => { openProfile(null); fn(); };

  return (
    <>
      <Sheet
        open={!!o}
        onOpenChange={(v) => !v && openProfile(null)}
        title={o.name}
        description={`${o.id} · ${o.email}`}
        footer={canBook && <button type="button" className="btn btn-primary btn-block" onClick={() => setBooking({ date: dayKey(today), location: o.location || undefined, who: o.email })}>Book a shift for {o.name.split(' ')[0]}</button>}
      >
        <div className="profile-stats">
          <div><strong>{done}</strong><span>sessions done</span></div>
          <div className={clsx(load?.over && 'is-bad')}><strong>{fmtHrsU(load?.hours || 0)}</strong><span>booked this week</span></div>
          <div className={clsx(next?.over && 'is-bad')}><strong>{fmtHrsU(next?.hours || 0)}</strong><span>next week</span></div>
          {canReview && <div className={clsx(open && 'is-warn')}><strong>{open}</strong><span>open {open === 1 ? 'flag' : 'flags'}</span></div>}
        </div>
        <Group>
          <Row title="Home lab" trailing={locationName(o.location) || 'None'} />
          {o.cohort && <Row title="Cohort" trailing={o.cohort} />}
          {o.training && <Row title="Training" trailing={o.training} />}
          <Row title="Experience" trailing={done < CFG.pairingMinSessions ? <Tag tone="warn">New · don’t pair with another new operator</Tag> : 'Experienced'} />
          {(load?.over || next?.over) && <Row title={<Tag tone="bad">Over {CFG.weeklyHourCap} hrs</Tag>} subtitle={load?.over ? 'This week' : 'Next week'} />}
        </Group>
        <Group title="Coming up">
          {upcoming.map((r) => (
            <Row key={r.id} onClick={() => leave(() => openSchedule(r.date))} title={fmtLongDay(parseDay(r.date))} subtitle={`${span(r)} · ${locationName(r.location)} · ${r.station}`} />
          ))}
          {!upcoming.length && <div className="empty-row">Nothing booked.</div>}
        </Group>
        <Group title="Last 3 weeks">
          {days.map((d) => (
            <Row
              key={d.key}
              onClick={canReview ? () => leave(() => openReview(d.email, d.day)) : undefined}
              title={<>{fmtDay(parseDay(d.day))} <Tag tone={DAY_STATUS[d.status].tone}>{DAY_STATUS[d.status].label}</Tag>{d.flags.filter((f) => !f.info).map((f) => <Tag key={f.key} tone={f.resolution ? 'muted' : f.tone}>{f.label}{f.resolution ? ' ✓' : ''}</Tag>)}</>}
              subtitle={`${d.locationName || 'No lab'} · ${fmtHrsU(d.scheduled)} scheduled · ${fmtHrsU(d.recorded)} recorded`}
              trailing={<span className="mono-num">{d.approved != null ? fmtHrsU(d.approved) : '–'}</span>}
            />
          ))}
          {!days.length && <div className="empty-row">No shifts or clock-ins yet.</div>}
        </Group>
      </Sheet>
      <ShiftSheet open={!!booking} onOpenChange={(v) => !v && setBooking(null)} initial={booking} />
    </>
  );
}
