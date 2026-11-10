import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Check, Clock, LogIn, MapPin, Users } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { CFG, DEMO, LOCATIONS, locationName, locOf } from '../lib/config.js';
import { hasRole } from '../lib/auth.js';
import { SignIn } from './SignIn.jsx';
import { statusOf } from '../lib/hours.js';
import { myShiftsToday, nextShift } from '../lib/attendance.js';
import { openSpots, partnersOf, robotLabel, shiftTimes } from '../lib/schedule.js';
import { FLAG, reviewDays } from '../lib/review.js';
import { addDays, dayKey, firstName, fmtDay, fmtLongDay, fmtTime, greeting, initials, mondayOf, fmtHrsU } from '../lib/time.js';
import { useNow } from '../lib/hooks.js';
import { Group, Segmented, Sheet } from '../components/ui.jsx';
import { Bar, BigButton, Card, Detail, Dial, Label, Pill, Well } from '../components/Soft.jsx';
import { robotName, robotTitle } from '../lib/robots.js';
import { MISSED, RESET_DAYS, standing } from '../lib/strikes.js';

// The operator's page. Everyone signs in as themselves, on their phone or on the
// lab laptop; the laptop signs the operator out again after each clock-in or out.
export function CheckIn() {
  const { session, authStage, device, data, signOut } = useStore();
  const [done, setDone] = useState(null);
  const laptop = device === 'shared';

  useEffect(() => {
    if (!done || !laptop) return undefined;
    const id = setTimeout(() => { setDone(null); signOut({ everywhere: false }); }, 6000);
    return () => clearTimeout(id);
  }, [done, laptop, signOut]);

  if (authStage !== 'signedIn') return <SignIn />;
  if (!data) return <div className="view"><div className="skeleton tall" /></div>;
  if (!hasRole(session, 'operator')) return <StaffHere />;

  const person = { name: session.name, email: session.email, operatorId: session.operatorId };
  const primary = done
    ? <Done done={done} onNext={() => { setDone(null); if (laptop) signOut({ everywhere: false }); }} laptop={laptop} />
    : <Person person={person} onDone={setDone} laptop={laptop} />;
  return (
    <div className="checkin-layout">
      <div className="checkin-primary">{primary}</div>
      <aside className="checkin-aside" aria-label="Your time"><MyTime person={person} /></aside>
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
const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
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
  const { data, punch, signOut, fillIn } = useStore();
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
  // A shift with no robot set asks which robot at clock-in, so hours merge per robot.
  const [robotFor, setRobotFor] = useState(null); // { shift } or { spot }
  const home = (data.operators || []).find((o) => o.email === person.email)?.location || data.me?.location || '';

  const shift = open ? (data.schedule || []).find((r) => r.id === open.shiftId) : null;
  const times = shift ? shiftTimes(shift) : null;
  const since = open ? new Date(open.ts) : null;
  const elapsedMs = open ? now - since : 0;
  const elapsed = elapsedMs / 36e5;
  const lengthMs = times ? times.end - times.start : CFG.shiftHours * 36e5;
  const early = open && (times ? now < new Date(times.end.getTime() - CFG.earlyGraceMinutes * 6e4) : elapsed < CFG.shiftHours - CFG.earlyGraceMinutes / 60);
  const past = times && now > times.end;

  // The punch shows at once and the flow records it in the background with the
  // server's time. If the flow turns it down, the screen goes back and says why.
  function doPunch(type, extra = {}) {
    setErr('');
    const who = person.name;
    const { shown, saved } = punch({ type, name: person.name, email: person.email, operatorId: person.operatorId, device: laptop ? 'laptop' : 'phone', source: laptop ? 'laptop' : 'phone', ...extra });
    const t = new Date(shown.ts);
    // On a phone a clock-in goes straight to the running timer; the laptop shows a
    // confirmation and signs out for the next operator.
    if (type === 'out' || laptop) onDone({ type, at: t, since, station: shown.station || open?.station, location: shown.location, name: person.name, hours: type === 'out' ? (t - since) / 36e5 : 0, early: !!extra.flag, grace: 0, week: week.recorded + (type === 'out' ? (t - since) / 36e5 : 0), pending: true });
    setAskReason(false);
    setReason('');
    saved.then((p) => {
      const at = new Date(p.ts);
      toast.success(type === 'in' ? `${laptop ? `${who}: c` : 'C'}locked in at ${fmtTime(at)}` : `${laptop ? `${who}: c` : 'C'}locked out at ${fmtTime(at)}`, {
        description: type === 'out' && extra.flag ? (DEMO ? 'Demo mode: no email was sent to your manager.' : 'Your manager has been told.') : p.grace ? `${p.grace} min before your shift, logged for review.` : 'Saved.',
      });
    }, (e) => {
      const why = e.code === 'early' || e.code === 'over' ? e.message : `${e.message}. Try again, or tell your lead the time.`;
      setErr(`Didn't save: ${why}`);
      toast.error(e.code === 'early' ? `Too early to clock in${laptop ? `, ${firstName(who)}` : ''}` : `${laptop ? `${who}’s ` : 'Your '}${type === 'in' ? 'clock-in' : 'clock-out'} didn't save`, { description: why, duration: 15000 });
    });
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
            <Label className="op-center">{open.pending ? 'Saving your clock-in · ' : ''}On the clock since {fmtTime(since)} · {robotTitle(open.station)}{shift && partnersOf(data, shift).length ? ` · with ${andList(partnersOf(data, shift))}` : ''}</Label>
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
  // Someone in this lab didn't show: an operator without a shift to clock into now can
  // take the spot. Live, the Read flow lists these (no names); the demo works them out.
  const spots = canClock ? [] : DEMO ? openSpots(data, person.email, home, now) : (data.openSpots || []);
  const robotsAt = (loc) => LOCATIONS.find((l) => l.id === loc)?.robots || [];
  const clockInto = (r) => {
    if (!r.station && robotsAt(locOf(r)).length > 1) return setRobotFor({ shift: r });
    doPunch('in', { shiftId: r.id, location: locOf(r), station: r.station || robotsAt(locOf(r))[0] || '' });
  };
  const takeSpot = async (spot, station) => {
    setBusy(true);
    setErr('');
    try {
      const r = await fillIn(spot.shiftId);
      setRobotFor(null);
      doPunch('in', { shiftId: r.id, location: locOf(r), station: station || r.station || robotsAt(locOf(r))[0] || '' });
    } catch (e) {
      setErr(`Didn't save: ${e.message}`);
      toast.error("Couldn't take that spot", { description: e.message });
    } finally {
      setBusy(false);
    }
  };
  const pickSpot = (spot) => (!spot.station && robotsAt(spot.location).length > 1 ? setRobotFor({ spot }) : takeSpot(spot, ''));

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
            <Detail icon={<MapPin size={18} />}>{locationName(locOf(card))} · {robotLabel(card)}</Detail>
            {partnersOf(data, card).length > 0 && <Detail icon={<Users size={18} />}>With {andList(partnersOf(data, card))}</Detail>}
          </div>
        ) : (
          <p className="op-body">Nothing booked for today. If your lead asked you to come in, you can still clock in and your manager will review it.</p>
        )}
      </Card>

      {spots.length > 0 && (
        <Card className="op-shift op-spots">
          <div className="op-row-between op-shift-top">
            <Label>Open {spots.length === 1 ? 'spot' : 'spots'} now</Label>
            <Pill inset tone="yellow">Partner needed</Pill>
          </div>
          <p className="op-body">Someone booked here didn't show. If your lead asked you to cover, take the spot: you're booked with their partner until the shift ends, and clocked in.</p>
          {spots.map((x) => (
            <div key={x.shiftId} className="op-spot">
              <Detail icon={<Clock size={18} />}><strong>{shiftLabel(x)}</strong> · until {fmtTime(shiftTimes(x).end)}</Detail>
              <Detail icon={<MapPin size={18} />}>{locationName(x.location)} · {robotLabel(x)}</Detail>
              <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => pickSpot(x)}>{busy ? 'Saving…' : 'Take this spot and clock in'}</button>
            </div>
          ))}
        </Card>
      )}

      <div className="op-stage">
        {next ? (
          <BigButton
            onClick={() => clockInto(next)}
            disabled={!canClock}
            busy={busy}
            label={canClock ? `Clock in for ${shiftLabel(next)} on ${robotLabel(next)}` : `Clock-in opens at ${fmtTime(w.opensAt)}`}
          >
            <LogIn size={34} strokeWidth={2} aria-hidden="true" />
            <span className="op-big-label">{busy ? 'Saving…' : canClock ? 'Clock in' : 'Not yet'}</span>
            <span className="op-big-sub op-num">{canClock ? `${shiftLabel(next)} shift` : `Opens ${fmtTime(w.opensAt)}`}</span>
          </BigButton>
        ) : (
          // No shift, nothing to clock into (user rule, 2026-11-06). The flows refuse it
          // too. An open spot above books a shift first.
          <BigButton tone="plain" disabled label={card ? 'No shift to clock into now' : 'No shift to clock into today'}>
            <LogIn size={30} strokeWidth={2} aria-hidden="true" />
            <span className="op-big-label">Clock in</span>
            <span className="op-big-sub">{card ? 'No shift now' : 'No shift today'}</span>
          </BigButton>
        )}
        {note && <p className={clsx('op-hint', next && w.state !== 'early' && 'is-warn')} role="status">{note}</p>}
        {!note && <p className="op-hint">{next ? 'The time comes from the server, not your phone.' : spots.length ? 'You can clock in by taking an open spot above.' : 'You can clock in once you’re booked on a shift. Ask your scheduler.'}</p>}
        {err && <p className="op-err" role="alert">{err}</p>}
      </div>

      <WeekWell hours={week.recorded} />
      <div className="op-foot">{signOutLink}</div>
      <RobotSheet
        open={!!robotFor}
        onOpenChange={(o) => !o && setRobotFor(null)}
        busy={busy}
        lab={robotFor ? (robotFor.shift ? locOf(robotFor.shift) : robotFor.spot.location) : ''}
        title={robotFor?.spot ? 'Take this spot' : 'Which robot?'}
        description={robotFor?.spot ? 'Pick the robot you’re working on. You’ll see your partner’s name once you’re in.' : `Your shift isn't tied to a robot. Pick the one you're on${partnersOf(data, robotFor?.shift).length ? ` with ${andList(partnersOf(data, robotFor.shift))}` : ''}.`}
        onConfirm={(station) => (robotFor.spot ? takeSpot(robotFor.spot, station) : doPunch('in', { shiftId: robotFor.shift.id, location: locOf(robotFor.shift), station }).then(() => setRobotFor(null)))}
      />
    </div>
  );
}

// Which robot, for a shift or open spot that doesn't name one.
function RobotSheet({ open, onOpenChange, onConfirm, busy, lab, title, description }) {
  const L = LOCATIONS.find((l) => l.id === lab);
  const [pick, setPick] = useState('');
  useEffect(() => { if (open) setPick(''); }, [open]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={<button type="button" className="btn btn-primary btn-block" disabled={!pick || busy} onClick={() => onConfirm(pick)}>{busy ? 'Saving…' : 'Clock in'}</button>}
    >
      <Group title={L?.name}>
        <div className="robots" role="radiogroup" aria-label="Robot">
          {(L?.robots || []).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={pick === s} className={clsx('robot', pick === s && 'is-on')} onClick={() => setPick(s)}>
              <span className="robot-name">{s}</span>{robotName(s) && <span className="robot-who">{robotName(s)}</span>}
              {pick === s && <span className="robot-check"><Check size={14} strokeWidth={3} /></span>}
            </button>
          ))}
        </div>
      </Group>
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
  const [forgot, setForgot] = useState(false);
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
      <MyStanding email={person.email} now={now} />
      <div className="op-days">
        {list.map((d, i) => {
          const k = dayKey(d);
          const day = byDay.get(k);
          const future = k > dayKey(now);
          const hrs = day ? (day.approved ?? day.recorded) : 0;
          const st = day && !future ? DAY_STATUS[day.status] : null;
          const robots = day ? [...new Set([...day.shifts.map((r) => r.station), ...day.sessions.map((s) => s.station)])].map(robotTitle).join(', ') : '';
          return (
            <Card key={k} className={clsx('op-day', (!day || future) && 'is-off', 'op-rise')} style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
              <div className="op-day-col">
                <span className="op-day-name">{k === dayKey(now) ? 'Today' : d.toLocaleDateString([], { weekday: 'long' })}</span>
                <Label>{d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · {day ? (future ? `Booked · ${robots}` : robots || 'No robot') : 'No shift'}</Label>
                {day && !future && day.flags.filter((f) => !f.info).map((f) => <span key={f.key} className="op-flag">{FLAG[f.code].label}{f.resolution ? ' · resolved' : ''}</span>)}
                {day && day.requests.map((c) => <span key={c.id} className="op-flag">{MISSED[c.missed].label} · sent to admins</span>)}
                {day && day.fixes.map((c) => <span key={c.id} className="op-flag is-muted">Corrected by an admin</span>)}
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
      <MyRequests email={person.email} now={now} />
      <div className="op-foot op-forgot">
        <button type="button" className="op-link" onClick={() => setForgot(true)}>Forgot to clock in or out?</button>
      </div>
      <ForgotSheet open={forgot} onOpenChange={setForgot} person={person} now={now} />
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
                    <Label>{fmtDay(t.start).split(', ').slice(1).join(', ')} · {locationName(locOf(r))} · {robotLabel(r)}</Label>
                    {partnersOf(data, r).length > 0 && <span className="op-day-with">With {andList(partnersOf(data, r))}</span>}
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
      <p className="op-body op-center">{fmtLongDay(done.at)} · {locationName(done.location)} · {robotTitle(done.station)}</p>
      {done.pending && <p className="op-body op-small-body op-center" role="status">Saving in the background. Lotus records the exact time as it arrives.</p>}
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

// The operator's own warnings and strikes, only when there's something to show.
// Partners never see each other's.
function MyStanding({ email, now }) {
  const { data } = useStore();
  const st = standing(data.strikes, email, now);
  if (!st.count) return null;
  const tone = st.count >= 4 ? 'red' : st.count >= 2 ? 'yellow' : null;
  return (
    <Card className="op-standing">
      <div className="op-row-between">
        <span className="op-day-name">Missed clock-ins</span>
        <Pill inset tone={tone}>{st.text}</Pill>
      </div>
      <p className="op-small op-left">Clears on {st.clearsOn.toLocaleDateString([], { month: 'short', day: 'numeric' })} if you don't miss a clock-in or out before then. {st.count >= 4 ? 'Your PM will talk with you about this.' : st.count >= 3 ? 'Your lead will talk with you about this.' : 'Each miss is a step toward a strike.'}</p>
    </Card>
  );
}

// "I forgot to clock in or out": pick the shift, say what happened. Lotus emails the
// admins and copies the operator. They can't enter a time: an admin checks with the
// partner and sets it.
function ForgotSheet({ open, onOpenChange, person, now }) {
  const { data, requestCorrection } = useStore();
  const [pick, setPick] = useState('');
  const [missed, setMissed] = useState('in');
  const [message, setMessage] = useState('');
  const [err, setErr] = useState('');
  const asked = new Set((data.corrections || []).filter((c) => c.status !== 'declined').map((c) => c.shiftId));
  const shifts = (data.schedule || [])
    .filter((r) => r.email === person.email && r.date >= dayKey(addDays(now, -7)) && shiftTimes(r).start <= now && !asked.has(r.id))
    .sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
  useEffect(() => { if (open) { setPick(shifts[0]?.id || ''); setMissed('in'); setMessage(''); setErr(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => {
    setErr('');
    if (!pick) return setErr('Pick the shift.');
    if (!message.trim()) return setErr('Say what happened.');
    requestCorrection({ shiftId: pick, missed, message: message.trim() }).then(
      () => toast.success('Request sent', { description: DEMO ? 'Demo: no email was sent. Live, the admins get it and you get a copy.' : 'The admins have it, and a copy is in your email.' }),
      (e) => toast.error('Your request wasn’t sent', { description: e.message }),
    );
    onOpenChange(false);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Forgot to clock in or out?"
      description="Send this to the admins. They'll check with your partner and fix your hours."
      footer={<button type="button" className="btn btn-primary btn-block" disabled={!shifts.length} onClick={send}>Send to the admins</button>}
    >
      <Group title="Which shift">
        {shifts.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={pick === r.id} className="row row-btn" onClick={() => setPick(r.id)}>
            <span className="row-main"><span className="row-title">{r.date === dayKey(now) ? 'Today' : fmtDay(shiftTimes(r).start)}</span><span className="row-sub">{fmtTime(shiftTimes(r).start)}–{fmtTime(shiftTimes(r).end)} · {robotLabel(r)}</span></span>
            <span className="row-trail">{pick === r.id && <Check size={18} strokeWidth={2.5} aria-hidden="true" />}</span>
          </button>
        ))}
        {!shifts.length && <div className="empty-row">No shifts in the last 7 days that still need this.</div>}
      </Group>
      <Group title="What did you miss">
        <div className="pad"><Segmented label="What you missed" value={missed} onChange={setMissed} options={[{ value: 'in', label: 'Clock-in' }, { value: 'out', label: 'Clock-out' }, { value: 'both', label: 'Both' }]} /></div>
      </Group>
      <Group title="What happened" footer={`Each missed clock-in or out counts toward a warning, and a request more than a day late counts too. The count clears after ${RESET_DAYS} days with no misses.`}>
        <div className="pad"><textarea className="reason" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="For example: my phone died, I was there the whole shift with Avery" aria-label="What happened" /></div>
      </Group>
      {err && <p className="err" role="alert">{err}</p>}
    </Sheet>
  );
}

// The operator's own missed clock-in or out requests from the last two weeks.
function MyRequests({ email, now }) {
  const { data } = useStore();
  const list = (data.corrections || []).filter((c) => c.email === email && c.date >= dayKey(addDays(now, -14))).sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) return null;
  const label = { open: ['Sent to admins', 'yellow'], approved: ['Corrected', 'green'], declined: ['Declined', 'red'] };
  return (
    <>
      <Label className="op-section">Your requests</Label>
      <div className="op-days">
        {list.map((c) => (
          <Card key={c.id} className="op-day">
            <div className="op-day-col">
              <span className="op-day-name">{fmtDay(new Date(`${c.date}T12:00`))}</span>
              <Label>{MISSED[c.missed].label}</Label>
              {c.status !== 'open' && c.note && <span className="op-day-with">“{c.note}”</span>}
            </div>
            <div className="op-day-right"><Pill inset tone={label[c.status][1]} className="op-pill-sm">{label[c.status][0]}</Pill></div>
          </Card>
        ))}
      </div>
    </>
  );
}
