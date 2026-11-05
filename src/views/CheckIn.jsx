import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Check, ChevronRight, Clock, LogIn, MapPin, Search, ShieldCheck } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { CFG, DEMO, LOCATIONS, locationName, locOf } from '../lib/config.js';
import { MS_AUTH, hasRole } from '../lib/auth.js';
import { DEMO_STAFF } from '../lib/api.js';
import { statusOf } from '../lib/hours.js';
import { myShiftsToday, nextShift } from '../lib/attendance.js';
import { shiftTimes } from '../lib/schedule.js';
import { FLAG, reviewDays } from '../lib/review.js';
import { addDays, dayKey, firstName, fmtDay, fmtLongDay, fmtTime, greeting, initials, mondayOf, fmtHrsU } from '../lib/time.js';
import { useNow } from '../lib/hooks.js';
import { Avatar, Group, Row, Sheet } from '../components/ui.jsx';
import { Bar, BigButton, Card, Detail, Dial, Label, Pill, Well } from '../components/Soft.jsx';

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

// Time on the clock as "1:26" plus ":08", counted from the server's clock-in time.
const clockParts = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return [`${h}:${String(m).padStart(2, '0')}`, `:${String(sec).padStart(2, '0')}`];
};
const hm = (ms) => { const m = Math.max(0, Math.round(ms / 6e4)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const shiftLabel = (r) => LOCATIONS.find((l) => l.id === locOf(r))?.templates.find((t) => t.id === r.template || (t.start === r.start && t.end === r.end))?.label || 'Shift';

// The operator's hours this week (their own time, recorded so far, plus the
// session running now) against the weekly limit.
function useMyWeek(email, now) {
  const { data } = useStore();
  return useMemo(() => {
    const wk0 = mondayOf(now);
    const mine = { ...data, punches: data.punches.filter((p) => p.email === email), schedule: (data.schedule || []).filter((r) => r.email === email) };
    const days = reviewDays(mine, wk0, addDays(wk0, 7), now);
    return { wk0, days, recorded: days.reduce((a, d) => a + d.recorded, 0) };
  }, [data, email, dayKey(now), Math.floor(now / 6e4)]); // eslint-disable-line react-hooks/exhaustive-deps
}

function WeekWell({ hours }) {
  const cap = CFG.weeklyHourCap;
  return (
    <Well className="op-week">
      <div className="op-row-between">
        <Label>Your hours this week</Label>
        <Label className="is-coral op-num">{(Math.round(hours * 10) / 10).toFixed(1)} / {cap}h</Label>
      </div>
      <Bar value={hours / cap} tone={hours > cap ? 'red' : 'coral'} label="Your hours this week" />
    </Well>
  );
}

function Person({ person, onDone, laptop }) {
  const { data, punch, signOut } = useStore();
  const now = useNow(1000);
  const st = statusOf(data.punches, person.email, now);
  const open = st.open;
  const today = useMemo(() => myShiftsToday(data.schedule, data.punches, person.email, now), [data.schedule, data.punches, person.email, now]);
  const next = nextShift(data.schedule, data.punches, person.email, now);
  const week = useMyWeek(person.email, now);
  const [busy, setBusy] = useState(false);
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [offShift, setOffShift] = useState(false);

  const shift = open ? (data.schedule || []).find((r) => r.id === open.shiftId) : null;
  const times = shift ? shiftTimes(shift) : null;
  const since = open ? new Date(open.ts) : null;
  const elapsedMs = open ? now - since : 0;
  const elapsed = elapsedMs / 36e5;
  const lengthMs = times ? times.end - times.start : CFG.shiftHours * 36e5;
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
      // On a phone a clock-in goes straight to the running timer; the laptop shows a
      // confirmation and signs out for the next operator.
      if (type === 'out' || laptop) onDone({ type, at: t, since, station: p.station, location: p.location, name: person.name, hours: type === 'out' ? (t - since) / 36e5 : 0, early: !!extra.flag, grace: p.grace, week: week.recorded + (type === 'out' ? (t - since) / 36e5 : 0) });
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

  const signOutLink = <button type="button" className="op-link" onClick={signOut}>{laptop ? `Not ${firstName(person.name)}? Sign out` : 'Sign out'}</button>;

  if (open) {
    const [main, sec] = clockParts(past ? now - times.end : elapsedMs);
    const clockOut = () => (early ? setAskReason(true) : doPunch('out'));
    return (
      <div className="op op-screen op-enter" key="on">
        {past ? (
          <>
            <Pill tone="red" className="op-badge"><span className="op-dot is-red op-pulse" />Past your shift</Pill>
            <Label className="op-center">Shift ended at {fmtTime(times.end)}</Label>
            <Dial value={1} tone="red" className="is-over" onClick={() => doPunch('out')} busy={busy} label={`Clock out. ${main} past the end of your shift`}>
              <Label className="is-red">Extra time</Label>
              <div className="op-timer is-red op-num">+{main}<span className="op-timer-sec">{sec}</span></div>
              <Pill inset tone="red" className="op-plate-action">{busy ? 'Saving…' : 'Clock out'}</Pill>
            </Dial>
            <Card className="op-note is-red">
              <p>Time after {fmtTime(times.end)} isn't counted unless your manager approves it. Clock out now, or tell your lead why you're staying.</p>
            </Card>
          </>
        ) : (
          <>
            <Pill tone="green" className="op-badge"><span className="op-dot is-green op-pulse" />Clocked in</Pill>
            <Label className="op-center">On the clock since {fmtTime(since)} · {open.station}</Label>
            <Dial value={shift ? elapsedMs / lengthMs : 0} tone="green" onClick={clockOut} busy={busy} label={`Clock out. ${main} on the clock`}>
              <div className="op-timer op-num" aria-live="off">{main}<span className="op-timer-sec">{sec}</span></div>
              <Label>{shift ? `of ${clockParts(lengthMs)[0]} shift` : 'Not on the schedule'}</Label>
              <Pill inset tone="coral" className="op-plate-action">{busy ? 'Saving…' : 'Clock out'}</Pill>
            </Dial>
            {shift ? (
              <div className="op-stats">
                <Card className="op-stat"><Label>Time left</Label><div className="op-stat-val op-num">{hm(times.end - now)}</div></Card>
                <Card className="op-stat"><Label>Shift ends</Label><div className="op-stat-val op-num">{fmtTime(times.end)}</div></Card>
              </div>
            ) : (
              <Card className="op-note"><p>You clocked in without a shift. Your manager reviews this time before it counts.</p></Card>
            )}
            {open.grace > 0 && (
              <Well className="op-row-between">
                <Label>Grace period used</Label>
                <Pill className="op-pill-sm">{open.grace} min</Pill>
              </Well>
            )}
          </>
        )}
        {err && <p className="op-err" role="alert">{err}</p>}
        <div className="op-foot">{signOutLink}</div>
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
  const card = next || today[today.length - 1] || null;
  let pill = null;
  let note = null;
  if (next && w.state === 'early') {
    pill = <Pill inset tone="coral"><Clock size={12} aria-hidden="true" />Opens {fmtTime(w.opensAt)}</Pill>;
    note = `Clock-in opens ${w.grace} min before your shift starts.`;
  } else if (next && w.state === 'grace') {
    pill = <Pill inset tone="yellow">Starts {fmtTime(w.start)}</Pill>;
    note = `You're ${w.graceUsed} min early. The minutes before ${fmtTime(w.start)} are logged and reviewed by your manager.`;
  } else if (next) {
    pill = <Pill inset tone={w.lateMin >= 5 ? 'red' : 'green'}>{w.lateMin >= 5 ? `Started ${fmtTime(w.start)}` : 'Open now'}</Pill>;
    if (w.lateMin >= 5) note = `Your shift started at ${fmtTime(w.start)}. Clocking in now is flagged as a late arrival.`;
  } else if (card) {
    pill = <Pill inset>{card.clocked ? 'Worked' : 'Missed'}</Pill>;
  }
  const canClock = next && w.state !== 'early';

  return (
    <div className="op op-screen op-enter" key="off">
      <header className="op-head">
        <div>
          <Label>{laptop ? 'Lab laptop' : greeting(now)}</Label>
          <h1 className="op-h1">{laptop ? person.name : `Hi, ${firstName(person.name)}`}</h1>
        </div>
        <span className="op-avatar" aria-hidden="true">{initials(person.name)}</span>
      </header>

      <Card className="op-shift">
        <div className="op-row-between op-shift-top">
          <Label>{next ? (w.state === 'early' ? 'Upcoming shift' : 'Your shift') : card ? "Today's shift" : 'No shift today'}</Label>
          {pill}
        </div>
        {card ? (
          <div className="op-details">
            <Detail icon={<Clock size={18} />}><strong>{shiftLabel(card)}</strong> · {fmtTime(card.window.start)}–{fmtTime(card.window.end)}</Detail>
            <Detail icon={<MapPin size={18} />}>{locationName(locOf(card))} · {card.station}</Detail>
          </div>
        ) : (
          <p className="op-body">Nothing booked for today. If your lead asked you to come in, you can still clock in and your manager will review it.</p>
        )}
      </Card>

      <div className="op-stage">
        {next ? (
          <BigButton
            onClick={() => doPunch('in', { shiftId: next.id, location: locOf(next), station: next.station })}
            disabled={!canClock}
            busy={busy}
            label={canClock ? `Clock in for ${shiftLabel(next)} on ${next.station}` : `Clock-in opens at ${fmtTime(w.opensAt)}`}
          >
            <LogIn size={34} strokeWidth={2} aria-hidden="true" />
            <span className="op-big-label">{busy ? 'Saving…' : canClock ? 'Clock in' : 'Not yet'}</span>
            <span className="op-big-sub op-num">{canClock ? `${shiftLabel(next)} shift` : `Opens ${fmtTime(w.opensAt)}`}</span>
          </BigButton>
        ) : (
          <BigButton tone="plain" onClick={() => setOffShift(true)} busy={busy} label="Clock in without a shift">
            <LogIn size={30} strokeWidth={2} aria-hidden="true" />
            <span className="op-big-label">Clock in</span>
            <span className="op-big-sub">No shift</span>
          </BigButton>
        )}
        {note && <p className={clsx('op-hint', next && w.state !== 'early' && 'is-warn')} role="status">{note}</p>}
        {!note && <p className="op-hint">The time comes from the server, not your phone.</p>}
        {err && <p className="op-err" role="alert">{err}</p>}
      </div>

      <WeekWell hours={week.recorded} />
      <div className="op-foot">{signOutLink}</div>
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
  approved: { label: 'Approved', tone: 'green' },
  ready: { label: 'Pending', tone: null },
  needs_review: { label: 'Under review', tone: 'yellow' },
  in_progress: { label: 'Today', tone: 'coral' },
};

// The operator's own week as a timesheet: each day's shift, robot and hours (the
// approved hours once a manager confirms them), and anything still under review.
function MyTime({ person }) {
  const { data } = useStore();
  const now = useNow(60000);
  const { wk0, days } = useMyWeek(person.email, now);
  const upcoming = (data.schedule || []).filter((r) => r.email === person.email && r.date > dayKey(now) && r.date < dayKey(addDays(now, 8))).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const byDay = new Map(days.map((d) => [d.day, d]));
  const list = [...Array(7)].map((_, i) => addDays(wk0, i)).filter((d) => dayKey(d) <= dayKey(now) || byDay.has(dayKey(d)));
  const shown = days.filter((d) => d.day <= dayKey(now));
  const total = shown.reduce((a, d) => a + (d.approved ?? d.recorded), 0);
  const allApproved = shown.length > 0 && shown.every((d) => d.status === 'approved');
  const review = shown.some((d) => d.status === 'needs_review');
  return (
    <div className="op op-sheet">
      <header className="op-head">
        <div>
          <Label>Week of {wk0.toLocaleDateString([], { month: 'short', day: 'numeric' })}</Label>
          <h2 className="op-h1">Timesheet</h2>
        </div>
        <Pill inset tone={allApproved ? 'green' : review ? 'yellow' : null}>{allApproved ? 'Approved' : review ? 'Under review' : 'In progress'}</Pill>
      </header>
      <div className="op-days">
        {list.map((d, i) => {
          const k = dayKey(d);
          const day = byDay.get(k);
          const future = k > dayKey(now);
          const hrs = day ? (day.approved ?? day.recorded) : 0;
          const st = day && !future ? DAY_STATUS[day.status] : null;
          const robots = day ? [...new Set([...day.shifts.map((r) => r.station), ...day.sessions.map((s) => s.station)])].join(', ') : '';
          return (
            <Card key={k} className={clsx('op-day', (!day || future) && 'is-off', 'op-rise')} style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
              <div className="op-day-col">
                <span className="op-day-name">{k === dayKey(now) ? 'Today' : d.toLocaleDateString([], { weekday: 'long' })}</span>
                <Label>{d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · {day ? (future ? `Booked · ${robots}` : robots || 'No robot') : 'No shift'}</Label>
                {day && !future && day.flags.filter((f) => !f.info).map((f) => <span key={f.key} className="op-flag">{FLAG[f.code].label}{f.resolution ? ' · resolved' : ''}</span>)}
              </div>
              <div className="op-day-right">
                {st && <Pill inset tone={st.tone} className="op-pill-sm">{st.label}</Pill>}
                <div className={clsx('op-day-hrs op-num', (!day || future) && 'is-dim')}>{day && !future && (hrs > 0 || day.status !== 'in_progress') ? <>{hrs.toFixed(1)}<span>h</span></> : '—'}</div>
              </div>
            </Card>
          );
        })}
      </div>
      <Well className="op-total">
        <div className="op-row-between op-total-top">
          <Label>Week so far</Label>
          <div className="op-total-num op-num">{(Math.round(total * 10) / 10).toFixed(1)}<span>h</span></div>
        </div>
        <Bar value={total / CFG.weeklyHourCap} tone="ink" label="Week so far" />
        <p className="op-small">Your manager approves each week by Monday. Approved hours replace what you clocked once they're confirmed. Limit {CFG.weeklyHourCap}h a week.</p>
      </Well>
      {upcoming.length > 0 && (
        <>
          <Label className="op-section">Coming up</Label>
          <div className="op-days">
            {upcoming.map((r) => {
              const t = shiftTimes(r);
              return (
                <Card key={r.id} className="op-day">
                  <div className="op-day-col">
                    <span className="op-day-name">{t.start.toLocaleDateString([], { weekday: 'long' })}</span>
                    <Label>{fmtDay(t.start).split(', ').slice(1).join(', ')} · {locationName(locOf(r))} · {r.station}</Label>
                  </div>
                  <div className="op-day-right"><span className="op-upcoming-time op-num">{shiftLabel(r)} · {fmtTime(t.start)}</span></div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Done({ done, onNext, laptop }) {
  const out = done.type === 'out';
  return (
    <div className="op op-screen op-enter op-done">
      <span className={clsx('op-medal', done.early && 'is-red')}><Check size={36} strokeWidth={2.5} aria-hidden="true" /></span>
      <h1 className="op-h1 op-center">{out ? 'Shift logged' : 'Clocked in'}</h1>
      <p className="op-body op-center">{fmtLongDay(done.at)} · {locationName(done.location)} · {done.station}</p>
      {out ? (
        <Well className="op-total-well">
          <Label>Time on the clock</Label>
          <div className="op-big-num op-num">{(Math.round(done.hours * 10) / 10).toFixed(1)}<span>h</span></div>
          <p className="op-body op-small-body op-num">{done.since ? `${fmtTime(done.since)} – ${fmtTime(done.at)}` : fmtTime(done.at)}</p>
        </Well>
      ) : (
        <Well className="op-total-well">
          <Label>Clocked in at</Label>
          <div className="op-big-num op-num">{fmtTime(done.at).replace(/\s?[AP]M$/i, '')}<span>{/PM$/i.test(fmtTime(done.at)) ? 'pm' : 'am'}</span></div>
        </Well>
      )}
      {(done.early || done.grace > 0) && (
        <div className="op-tags">
          {done.early && <Pill inset tone="red">{DEMO ? 'Left early · demo, manager not emailed' : 'Left early · manager notified'}</Pill>}
          {done.grace > 0 && <Pill inset>{done.grace} min early · logged</Pill>}
        </div>
      )}
      {out && (
        <Card>
          <div className="op-row-between op-shift-top">
            <Label>Your hours this week</Label>
            <Label className="is-green op-num">{(Math.round(done.week * 10) / 10).toFixed(1)} / {CFG.weeklyHourCap}h</Label>
          </div>
          <Bar value={done.week / CFG.weeklyHourCap} tone="green" label="Your hours this week" />
        </Card>
      )}
      <div className="op-foot">
        <button type="button" className="op-btn" onClick={onNext}>{laptop ? 'Sign out for the next operator' : 'Done'}</button>
      </div>
    </div>
  );
}
