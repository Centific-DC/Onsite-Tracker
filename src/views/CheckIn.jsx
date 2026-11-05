import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { CalendarClock, Check, ChevronRight, LogIn, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { CFG, DEMO, LOCATIONS, locationName, locOf } from '../lib/config.js';
import { MS_AUTH, hasRole } from '../lib/auth.js';
import { DEMO_STAFF } from '../lib/api.js';
import { statusOf } from '../lib/hours.js';
import { myShiftsToday, nextShift } from '../lib/attendance.js';
import { shiftTimes } from '../lib/schedule.js';
import { FLAG, reviewDays } from '../lib/review.js';
import { addDays, dayKey, firstName, fmtDay, fmtLongDay, fmtTime, greeting, hoursBetween, mondayOf, fmtHrsU, parseDay } from '../lib/time.js';
import { useNow } from '../lib/hooks.js';
import { Avatar, Group, Row, Sheet, Tag } from '../components/ui.jsx';
import { ShiftRing } from '../components/ShiftRing.jsx';

// The operator's page. Everyone signs in as themselves, on their phone or on the
// lab laptop; the laptop signs the operator out again after each clock-in or out.
export function CheckIn() {
  const { session, device, data, signOut } = useStore();
  const [done, setDone] = useState(null);
  const laptop = device === 'shared';

  useEffect(() => {
    if (!done || !laptop) return undefined;
    const id = setTimeout(() => { setDone(null); signOut(); }, 6000);
    return () => clearTimeout(id);
  }, [done, laptop, signOut]);

  if (!session) return <SignIn />;
  if (!data) return <div className="view"><div className="skeleton tall" /></div>;
  if (!hasRole(session, 'operator')) return <StaffHere />;

  const person = { name: session.name, email: session.email, operatorId: session.operatorId };
  const primary = done
    ? <Done done={done} onNext={() => { setDone(null); if (laptop) signOut(); }} laptop={laptop} />
    : <Person person={person} onDone={setDone} laptop={laptop} />;
  return (
    <div className="checkin-layout">
      <div className="checkin-primary">{primary}</div>
      <aside className="checkin-aside" aria-label="Your time"><MyTime person={person} /></aside>
    </div>
  );
}

function SignIn() {
  const { signIn } = useStore();
  if (MS_AUTH) {
    return (
      <div className="view view-narrow view-enter center-col">
        <span className="done-mark"><ShieldCheck size={40} /></span>
        <h1 className="large-title">Lotus on-site</h1>
        <p className="lede">Sign in with your Centific Microsoft account to clock in and see your shifts.</p>
        <div className="dock"><button type="button" className="btn btn-primary btn-block btn-lg" onClick={signIn}>Sign in with Microsoft</button></div>
      </div>
    );
  }
  return <DemoSignIn />;
}

// Demo stand-in for each person's own sign-in: pick who you are.
function DemoSignIn() {
  const { data, signInDemo } = useStore();
  const [q, setQ] = useState('');
  const ops = (data?.operators || []).filter((o) => o.active !== false && `${o.name} ${o.email} ${o.id}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="view view-narrow view-enter">
      <h1 className="large-title">Sign in</h1>
      <p className="lede">Demo mode: pick who you are. In the live app everyone signs in with their own Microsoft account.</p>
      <label className="search">
        <Search size={18} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find your name" aria-label="Find your name" />
      </label>
      <Group title="Operators">
        {ops.slice(0, 40).map((o, i) => (
          <Row key={o.email} className="row-in" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }} leading={<Avatar name={o.name} />} title={o.name} subtitle={`${o.id} · ${locationName(o.location)}`} trailing={<ChevronRight size={18} />} onClick={() => signInDemo(o)} />
        ))}
        {!ops.length && <div className="empty-row">{q ? `No one called “${q}”.` : 'No operators yet.'}</div>}
      </Group>
      <Group title="Staff" footer="Staff accounts open the admin views.">
        {DEMO_STAFF.map((s) => (
          <Row key={s.email} title={s.name} subtitle={s.roles.join(', ')} trailing={<ChevronRight size={18} />} onClick={() => { signInDemo(s); location.hash = '/admin'; }} />
        ))}
      </Group>
    </div>
  );
}

function StaffHere() {
  const { session, signOut } = useStore();
  return (
    <div className="view view-narrow view-enter center-col">
      <h1 className="large-title">Hi, {firstName(session.name)}</h1>
      <p className="lede">Your account has staff roles only, so there's nothing to clock in to here.</p>
      <div className="dock">
        <a className="btn btn-primary btn-block" href="#/admin">Open admin</a>
        <button type="button" className="link-quiet" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

function Person({ person, onDone, laptop }) {
  const { data, punch, signOut } = useStore();
  const now = useNow(1000);
  const st = statusOf(data.punches, person.email, now);
  const open = st.open;
  const today = useMemo(() => myShiftsToday(data.schedule, data.punches, person.email, now), [data.schedule, data.punches, person.email, now]);
  const next = nextShift(data.schedule, data.punches, person.email, now);
  const [busy, setBusy] = useState(false);
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [offShift, setOffShift] = useState(false);

  const shift = open ? (data.schedule || []).find((r) => r.id === open.shiftId) : null;
  const times = shift ? shiftTimes(shift) : null;
  const elapsed = open ? hoursBetween(new Date(open.ts), now) : 0;
  const length = times ? (times.end - times.start) / 36e5 : CFG.shiftHours;
  const early = open && (times ? now < new Date(times.end.getTime() - CFG.earlyGraceMinutes * 6e4) : elapsed < CFG.shiftHours - CFG.earlyGraceMinutes / 60);
  const past = times && now > times.end;

  async function doPunch(type, extra = {}) {
    setBusy(true);
    setErr('');
    try {
      const p = await punch({ type, name: person.name, email: person.email, operatorId: person.operatorId, device: laptop ? 'laptop' : 'phone', source: laptop ? 'laptop' : 'phone', ...extra });
      const t = new Date(p.ts);
      toast.success(type === 'in' ? `Clocked in at ${fmtTime(t)}` : `Clocked out at ${fmtTime(t)}`, {
        description: type === 'out' && extra.flag ? (DEMO ? 'Demo mode: no email was sent to your manager.' : 'Your manager has been told.') : p.grace ? `${p.grace} min before your shift, logged for review.` : undefined,
      });
      onDone({ type, at: t, station: p.station, location: p.location, name: person.name, hours: type === 'out' ? elapsed : 0, early: !!extra.flag, grace: p.grace });
      setAskReason(false);
      setReason('');
      setOffShift(false);
    } catch (e) {
      setErr(e.code === 'early' || e.code === 'over' ? e.message : `Didn't save: ${e.message}. Try again, or tell your lead the time.`);
      toast.error(e.code === 'early' ? 'Too early to clock in' : "That didn't save", { description: e.message });
    } finally {
      setBusy(false);
    }
  }

  const title = <h1 className="large-title">{laptop ? person.name : `${greeting(now)}, ${firstName(person.name)}`}</h1>;
  const signOutLink = <button type="button" className="link-quiet" onClick={signOut}>{laptop ? `Not ${firstName(person.name)}? Sign out` : 'Sign out'}</button>;

  if (open) {
    return (
      <div className="view view-narrow view-enter center-col">
        {title}
        <p className="lede">Clocked in at {fmtTime(new Date(open.ts))} · {locationName(locOf(open))}</p>
        <ShiftRing hours={elapsed} shiftHours={length}><span className="ring-station">{open.station}</span></ShiftRing>
        <p className="partner">{shift ? `Your shift ends at ${fmtTime(times.end)}` : 'Not on the schedule · your manager reviews this time'}</p>
        {past && <p className="hint-warn" role="status"><TriangleAlert size={14} /> Time after {fmtTime(times.end)} goes to your manager for review.</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <div className="dock">
          <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => (early ? setAskReason(true) : doPunch('out'))} disabled={busy} aria-busy={busy}>
            {busy ? 'Saving…' : 'Clock out'}
          </button>
          {signOutLink}
        </div>
        <Sheet
          open={askReason}
          onOpenChange={setAskReason}
          title="Leaving early?"
          description={`${times ? `Your shift runs until ${fmtTime(times.end)}.` : `You've been on site ${fmtHrsU(elapsed)}.`} ${DEMO ? 'In the live app your manager gets an email with your reason. This is demo mode, so none is sent.' : 'Your manager will be told, so let them know why.'}`}
          footer={<button type="button" className="btn btn-danger btn-block" disabled={busy || !reason.trim()} onClick={() => doPunch('out', { flag: 'early', note: reason.trim() })}>{busy ? 'Saving…' : 'Clock out early'}</button>}
        >
          <textarea className="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: unwell, told Kate at 1:10 PM" aria-label="Reason for leaving early" autoFocus />
        </Sheet>
      </div>
    );
  }

  const w = next?.window;
  let button;
  let note = null;
  if (next && w.state === 'early') {
    button = <button type="button" className="btn btn-primary btn-block btn-lg" disabled>Clock-in opens at {fmtTime(w.opensAt)}</button>;
    note = `Clock-in opens ${w.grace} min before your shift starts.`;
  } else if (next) {
    button = <button type="button" className="btn btn-primary btn-block btn-lg" disabled={busy} aria-busy={busy} onClick={() => doPunch('in', { shiftId: next.id, location: locOf(next), station: next.station })}>{busy ? 'Saving…' : 'Clock in'}</button>;
    if (w.state === 'grace') note = `You're ${w.graceUsed} min early. The minutes before ${fmtTime(w.start)} are logged and reviewed by your manager.`;
    if (w.state === 'open' && w.lateMin >= 5) note = `Your shift started at ${fmtTime(w.start)}. Clocking in now is flagged as a late arrival.`;
  } else {
    button = <button type="button" className="btn btn-plain btn-block btn-lg" onClick={() => setOffShift(true)}>Clock in without a shift</button>;
    note = 'You have no shift right now. Clocking in anyway is flagged for your manager to review.';
  }

  return (
    <div className="view view-narrow view-enter">
      {title}
      <p className="lede">{fmtLongDay(now)} · {fmtTime(now)}</p>
      <Group title="Today's shifts">
        {today.length ? today.map((r) => (
          <Row
            key={r.id}
            className={clsx('shift-card', next?.id === r.id && 'is-next')}
            leading={<span className="row-icon"><CalendarClock size={18} /></span>}
            title={<>{fmtTime(r.window.start)}–{fmtTime(r.window.end)} {r.clocked && <Tag tone={r.window.state === 'over' ? 'muted' : 'on'}>{r.window.state === 'over' ? 'Worked' : 'Clocked in'}</Tag>}{!r.clocked && r.window.state === 'over' && <Tag tone="bad">Missed</Tag>}</>}
            subtitle={`${locationName(locOf(r))} · ${r.station}`}
          />
        )) : <div className="empty-row">No shifts today.</div>}
      </Group>
      {note && <p className={clsx(next && w.state !== 'early' ? 'hint-warn' : 'hint')} role="status">{note}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <div className="dock">
        {button}
        {signOutLink}
      </div>
      <OffShiftSheet open={offShift} onOpenChange={setOffShift} busy={busy} onConfirm={(loc, station) => doPunch('in', { location: loc, station })} />
    </div>
  );
}

function OffShiftSheet({ open, onOpenChange, onConfirm, busy }) {
  const [pick, setPick] = useState('');
  useEffect(() => { if (open) setPick(''); }, [open]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Clock in without a shift"
      description="Pick where you are. Your manager reviews time with no shift before it counts."
      footer={<button type="button" className="btn btn-primary btn-block" disabled={!pick || busy} onClick={() => { const [l, s] = pick.split('|'); onConfirm(l, s); }}>{busy ? 'Saving…' : 'Clock in'}</button>}
    >
      {LOCATIONS.map((l) => (
        <Group key={l.id} title={l.name}>
          <div className="robots" role="radiogroup" aria-label={`${l.name} robot`}>
            {l.robots.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={pick === `${l.id}|${s}`} className={clsx('robot', pick === `${l.id}|${s}` && 'is-on')} onClick={() => setPick(`${l.id}|${s}`)}>
                <span className="robot-name">{s}</span>
                {pick === `${l.id}|${s}` && <span className="robot-check"><Check size={14} strokeWidth={3} /></span>}
              </button>
            ))}
          </div>
        </Group>
      ))}
    </Sheet>
  );
}

const DAY_STATUS = {
  approved: { label: 'Approved', tone: 'on' },
  ready: { label: 'Waiting for approval', tone: 'muted' },
  needs_review: { label: 'Under review', tone: 'warn' },
  in_progress: { label: 'Today', tone: 'muted' },
};

// The operator's own week: what was scheduled, what they recorded, any flags
// their manager is reviewing, and what was approved.
function MyTime({ person }) {
  const { data } = useStore();
  const now = useNow(60000);
  const wk0 = mondayOf(now);
  const days = useMemo(() => reviewDays({ ...data, punches: data.punches.filter((p) => p.email === person.email), schedule: (data.schedule || []).filter((r) => r.email === person.email) }, wk0, addDays(wk0, 7), now), [data, person.email, now]);
  const upcoming = (data.schedule || []).filter((r) => r.email === person.email && r.date > dayKey(now) && r.date < dayKey(addDays(now, 8))).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const total = days.reduce((a, d) => a + (d.approved ?? 0), 0);
  return (
    <>
      <Group title="Your week" action={<span className="group-aside">{fmtHrsU(total)} approved</span>} footer="Approved hours are what your manager confirmed. Flags explain anything still under review.">
        {days.filter((d) => d.day <= dayKey(now)).map((d) => (
          <Row
            key={d.day}
            title={<>{d.day === dayKey(now) ? 'Today' : fmtDay(parseDay(d.day))} {DAY_STATUS[d.status] && <Tag tone={DAY_STATUS[d.status].tone}>{DAY_STATUS[d.status].label}</Tag>}</>}
            subtitle={[d.shifts.map((r) => `${fmtTime(r.start)}–${fmtTime(r.end)}`).join(', ') || 'No shift', ...d.flags.map((f) => `${FLAG[f.code].label}${f.resolution ? ' · resolved' : ''}`)].join(' · ')}
            trailing={<span className="mono-num">{d.approved != null ? fmtHrsU(d.approved) : d.recorded ? fmtHrsU(d.recorded) : '–'}</span>}
          />
        ))}
        {!days.some((d) => d.day <= dayKey(now)) && <div className="empty-row">Nothing yet this week.</div>}
      </Group>
      <Group title="Coming up">
        {upcoming.length ? upcoming.map((r) => {
          const t = shiftTimes(r);
          return <Row key={r.id} leading={<span className="row-icon"><LogIn size={16} /></span>} title={`${fmtDay(t.start)} · ${fmtTime(t.start)}–${fmtTime(t.end)}`} subtitle={`${locationName(locOf(r))} · ${r.station}`} />;
        }) : <div className="empty-row">No shifts booked in the next week.</div>}
      </Group>
    </>
  );
}

function Done({ done, onNext, laptop }) {
  return (
    <div className="view view-narrow view-enter center-col done">
      <span className={clsx('done-mark', done.early && 'is-early')}><Check size={44} strokeWidth={2.5} /></span>
      <h1 className="large-title">{done.type === 'in' ? 'Clocked in' : 'Clocked out'}</h1>
      <p className="done-time">{fmtTime(done.at)}</p>
      <p className="lede">
        {done.name} · {locationName(done.location)} · {done.station}
        {done.type === 'out' && done.hours > 0 ? ` · ${fmtHrsU(done.hours)}` : ''}
      </p>
      {done.early && <Tag tone="bad">{DEMO ? 'Left early · demo, manager not emailed' : 'Left early · manager notified'}</Tag>}
      {done.grace > 0 && <Tag tone="muted">{done.grace} min early · logged</Tag>}
      <div className="dock">
        <button type="button" className="btn btn-plain btn-block" onClick={onNext}>{laptop ? 'Sign out for the next operator' : 'Done'}</button>
      </div>
    </div>
  );
}
