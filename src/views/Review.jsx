import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, LogIn, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { buildSessions } from '../lib/hours.js';
import { FLAG, reviewDays } from '../lib/review.js';
import { addDays, dayKey, fmtDay, fmtLongDay, fmtTime, mondayOf, parseDay, weekLabel, fmtHrsU } from '../lib/time.js';
import { useHashQuery, useNow } from '../lib/hooks.js';
import { Avatar, Group, Row, Segmented, Sheet, Tag } from '../components/ui.jsx';

export const DAY_STATUS = {
  needs_review: { label: 'Needs review', tone: 'warn' },
  ready: { label: 'Ready to approve', tone: 'muted' },
  approved: { label: 'Approved', tone: 'on' },
  in_progress: { label: 'In progress', tone: 'muted' },
};

// The weekly review queue: every operator-day with its scheduled, recorded and
// suggested hours. Managers resolve each flag with a reason, then approve the day.
// Only approved hours reach the reporting export.
export function Review() {
  const { data, approveMany, approving } = useStore();
  const now = useNow(60000);
  // Monday's review covers last week, so that's where it opens.
  const [wk0, setWk0] = useState(() => addDays(mondayOf(new Date()), -7));
  const [show, setShow] = useState('todo');
  const [open, setOpen] = useState(null);
  // A link from search (?day=…&op=…) opens that week, and that operator's day.
  const hq = useHashQuery();
  useEffect(() => {
    const p = new URLSearchParams(hq);
    const day = p.get('day');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return;
    setWk0(mondayOf(parseDay(day)));
    setShow('all');
    const op = p.get('op');
    if (op) setOpen(`${op.toLowerCase()}|${day}`);
  }, [hq]);
  const days = useMemo(() => reviewDays(data, wk0, addDays(wk0, 7), now), [data, dayKey(wk0), now]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (st) => days.filter((d) => d.status === st).length;
  const shown = days.filter((d) => (show === 'todo' ? d.status === 'needs_review' || d.status === 'ready' : show === 'all' ? true : d.status === show));
  const byDay = [...new Set(shown.map((d) => d.day))].map((k) => [k, shown.filter((d) => d.day === k)]);
  const ready = days.filter((d) => d.status === 'ready' && !approving[d.key]);
  const current = open ? days.find((d) => d.key === open) : null;

  // Runs in the background: each day says "Approving…" until the flow confirms it.
  const approveReady = () => {
    const list = ready.map((d) => ({ email: d.email, name: d.name, operatorId: d.operatorId, date: d.day, hours: d.computed, computed: d.computed, note: '' }));
    const total = fmtHrsU(ready.reduce((a, d) => a + d.computed, 0));
    approveMany(list).then(
      () => toast.success(`Approved ${list.length} ${list.length === 1 ? 'day' : 'days'}`, { description: `${total}, as suggested` }),
      (e) => toast.error("Couldn't approve them all", { description: e.message }),
    );
  };

  // Each week's timesheets are due the Monday after it ends (the proposed cycle:
  // approve by Monday, then the approved hours go to agency reporting).
  const due = addDays(wk0, 7);
  const openN = count('needs_review') + count('ready') + count('in_progress');
  const dueTag = !openN ? (count('approved') ? <Tag tone="on">All approved</Tag> : null)
    : dayKey(due) < dayKey(now) ? <Tag tone="bad">Overdue since {fmtDay(due)}</Tag>
    : dayKey(due) === dayKey(now) ? <Tag tone="warn">Due today</Tag>
    : <Tag tone="muted">Due {fmtDay(due)}</Tag>;

  return (
    <div className="view view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">Review</h1>
          <p className="lede">Week of {weekLabel(wk0)} · {count('needs_review')} need review · {count('ready')} ready · {count('approved')} approved {dueTag}</p>
        </div>
        <div className="stepper" role="group" aria-label="Week">
          <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => setWk0(addDays(wk0, -7))}><ChevronLeft size={18} /></button>
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setWk0(addDays(mondayOf(new Date()), -7))}>Last week</button>
          <button type="button" className="icon-btn" aria-label="Next week" disabled={dayKey(wk0) >= dayKey(mondayOf(now))} onClick={() => setWk0(addDays(wk0, 7))}><ChevronRight size={18} /></button>
        </div>
      </header>

      <div className="toolbar">
        <Segmented
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'todo', label: `To do${count('needs_review') + count('ready') ? ` (${count('needs_review') + count('ready')})` : ''}` },
            { value: 'approved', label: 'Approved' },
            { value: 'all', label: 'All' },
          ]}
        />
        {ready.length > 0 && (
          <button type="button" className="btn btn-primary btn-sm" data-tour="review-approve-all" onClick={approveReady}>
            {`Approve ${ready.length} ready`}
          </button>
        )}
      </div>

      {byDay.length === 0 && <Group><div className="empty-row">{show === 'todo' ? 'Nothing to review this week.' : 'Nothing here.'}</div></Group>}
      {byDay.map(([k, list]) => (
        <Group key={k} title={fmtLongDay(parseDay(k))}>
          {list.map((d) => (
            <Row
              key={d.key}
              onClick={() => setOpen(d.key)}
              leading={<Avatar name={d.name} tone={DAY_STATUS[d.status].tone} />}
              title={<>{d.name} {approving[d.key] ? <Tag tone="muted">{approving[d.key] === 'approved' ? 'Approving…' : 'Reopening…'}</Tag> : <Tag tone={DAY_STATUS[d.status].tone}>{DAY_STATUS[d.status].label}</Tag>}{d.flags.filter((f) => !f.info).map((f) => <Tag key={f.key} tone={f.resolution ? 'muted' : f.tone}>{f.label}{f.resolution ? ' ✓' : ''}</Tag>)}</>}
              subtitle={`${d.operatorId || 'No ID'} · ${d.locationName || 'No lab'} · ${fmtHrsU(d.scheduled)} scheduled · ${fmtHrsU(d.recorded)} recorded`}
              trailing={<span className="mono-num">{d.approved != null ? fmtHrsU(d.approved) : fmtHrsU(d.computed)}</span>}
            />
          ))}
        </Group>
      ))}

      <DaySheet day={current} pending={current && approving[current.key]} onClose={() => setOpen(null)} />
    </div>
  );
}

const OUTCOMES = {
  time: [{ value: 'accept', label: 'Count it' }, { value: 'decline', label: "Don't count" }],
  info: [{ value: 'noted', label: 'Noted' }],
};

function DaySheet({ day, pending, onClose }) {
  const { data, approveDay } = useStore();
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (day) { setHours(String(Math.round((day.approved ?? day.computed) * 100) / 100)); setNote(''); setErr(''); } }, [day?.key, day?.computed, day?.approved]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = useMemo(() => (day ? buildSessions(data.punches.filter((p) => p.email === day.email)).sessions.filter((s) => s.day === day.day) : []), [data.punches, day]);
  const history = day ? (data.approvals || []).filter((a) => a.email === day.email && a.date === day.day).sort((a, b) => String(b.at).localeCompare(String(a.at))) : [];
  if (!day) return <Sheet open={false} onOpenChange={onClose} title="" />;
  const blocked = day.openFlags > 0;
  const h = Number(hours);
  const adjusted = Number.isFinite(h) && Math.abs(h - day.computed) > 0.005;

  // The sheet closes at once; the day says "Approving…" until the flow confirms it.
  const act = (status) => {
    setErr('');
    if (status === 'approved' && (!Number.isFinite(h) || h < 0)) return setErr('Enter the hours to approve.');
    if ((status !== 'approved' || adjusted) && !note.trim()) return setErr(status === 'approved' ? 'Say why the hours differ from the suggestion.' : 'Say why you are reopening this day.');
    const who = day.name;
    const when = fmtDay(parseDay(day.day));
    approveDay({ email: day.email, name: who, operatorId: day.operatorId, date: day.day, hours: status === 'approved' ? h : day.approved ?? 0, computed: day.computed, note: note.trim() }, status).then(
      () => toast.success(status === 'approved' ? `Approved ${fmtHrsU(h)} for ${who}` : `Reopened ${who}'s ${when}`),
      (e) => toast.error(status === 'approved' ? `${who}'s ${when} isn't approved` : `${who}'s ${when} didn't reopen`, { description: e.message }),
    );
    setNote('');
    onClose();
  };

  return (
    <Sheet
      open={!!day}
      onOpenChange={(o) => !o && onClose()}
      title={day.name}
      description={`${fmtLongDay(parseDay(day.day))} · ${day.locationName || 'No lab'} · ${day.operatorId || 'No operator ID'}`}
      footer={day.approval ? (
        <button type="button" className="btn btn-plain btn-block" disabled={!!pending} onClick={() => act('reopened')}>{pending ? 'Saving…' : 'Reopen to correct'}</button>
      ) : (
        <button type="button" className="btn btn-primary btn-block" disabled={!!pending || blocked} onClick={() => act('approved')}>{pending ? 'Approving…' : blocked ? `Resolve ${day.openFlags} ${day.openFlags === 1 ? 'flag' : 'flags'} first` : `Approve ${Number.isFinite(h) ? fmtHrsU(h) : ''}`}</button>
      )}
    >
      <Group>
        <Row title="Scheduled" subtitle={day.shifts.map((r) => `${fmtTime(r.start)}–${fmtTime(r.end)} · ${r.station}`).join(', ') || 'No shift'} trailing={<span className="mono-num">{fmtHrsU(day.scheduled)}</span>} />
        <Row title="Recorded" subtitle="Clock-in to clock-out, as tapped" trailing={<span className="mono-num">{fmtHrsU(day.recorded)}</span>} />
        <Row title="Suggested" subtitle="Inside the shift, plus extra time you counted" trailing={<span className="mono-num">{fmtHrsU(day.computed)}</span>} />
        {day.approval && <Row title="Approved" subtitle={`${day.approval.by} · ${new Date(day.approval.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${day.approval.note ? ` · “${day.approval.note}”` : ''}`} trailing={<span className="mono-num">{fmtHrsU(day.approval.hours)}</span>} />}
      </Group>

      <Group title="Clock-ins">
        {sessions.map((s) => (
          <Row key={+s.start} leading={<span className="row-icon icon-in"><LogIn size={16} /></span>} title={`${fmtTime(s.start)} – ${s.live ? 'now' : fmtTime(s.end)}`} subtitle={`${s.station}${s.source ? ` · ${s.source}` : ''}${s.grace ? ` · ${s.grace} min grace` : ''}${s.note ? ` · “${s.note}”` : ''}`} trailing={<span className="mono-num">{fmtHrsU(s.hours)}</span>} />
        ))}
        {day.flags.filter((f) => f.code === 'no_clockout').map((f) => (
          <Row key={f.key} leading={<span className="row-icon icon-warn"><LogOut size={16} /></span>} title={`${fmtTime(f.start)} – no clock-out`} subtitle={f.suggested ? `Suggested end ${fmtTime(f.suggested)} (system-generated, not a real clock-out)` : 'No shift to suggest an end from'} />
        ))}
        {!sessions.length && !day.flags.some((f) => f.code === 'no_clockout') && <div className="empty-row">No clock-ins this day.</div>}
      </Group>

      {day.flags.length > 0 && (
        <Group title="Flags" footer="Each flag needs a decision and a reason. Grace minutes are logged for information and aren't counted unless you add them to the hours.">
          {day.flags.map((f) => <FlagRow key={f.key} f={f} disabled={!!day.approval} />)}
        </Group>
      )}

      {!day.approval && (
        <Group title="Approve" footer={err ? <span className="err" role="alert">{err}</span> : adjusted ? 'You changed the suggested hours, so add a note.' : 'Approve the suggested hours, or change them with a note.'}>
          <label className="field-row"><span>Hours</span><input className="num-input" type="number" min="0" step="0.25" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
          <label className="field-row"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={adjusted ? 'Required' : 'Optional'} /></label>
        </Group>
      )}
      {day.approval && (
        <Group footer={err ? <span className="err" role="alert">{err}</span> : 'Reopening keeps the approval in the history and takes the day out of the export until it is approved again.'}>
          <label className="field-row"><span>Reason</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why reopen" /></label>
        </Group>
      )}

      {history.length > 0 && (
        <Group title="History">
          {history.map((a) => (
            <Row key={a.at} title={`${a.status === 'approved' ? 'Approved' : 'Reopened'}${a.status === 'approved' ? ` · ${fmtHrsU(a.hours)}` : ''}`} subtitle={`${a.by} · ${new Date(a.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${a.note ? ` · “${a.note}”` : ''}`} />
          ))}
        </Group>
      )}
    </Sheet>
  );
}

function FlagRow({ f, disabled }) {
  const { resolveFlag } = useStore();
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState(f.time ? 'accept' : 'noted');
  const [reason, setReason] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!reason.trim()) return setErr('Add a reason.');
    let endTime = '';
    if (f.code === 'no_clockout' && outcome === 'accept' && end) {
      const d = new Date(f.start);
      const [hh, mm] = end.split(':').map(Number);
      d.setHours(hh, mm, 0, 0);
      if (d <= f.start) return setErr('The end has to be after the clock-in.');
      endTime = d.toISOString();
    }
    if (f.code === 'no_clockout' && outcome === 'accept' && !end && !f.suggested) return setErr('Enter the time they left.');
    setBusy(true);
    try {
      await resolveFlag({ key: f.key, outcome, reason: reason.trim(), endTime });
      setEditing(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const r = f.resolution;
  const resolvedText = r && `${r.outcome === 'accept' ? (f.code === 'no_clockout' ? `Ended ${r.endTime ? fmtTime(new Date(r.endTime)) : `at ${fmtTime(f.suggested)}`}` : 'Counted') : r.outcome === 'decline' ? 'Not counted' : 'Noted'} · “${r.reason}” · ${r.by}`;
  const options = f.time && !f.info ? OUTCOMES.time : OUTCOMES.info;
  return (
    <div className="flag-row">
      <Row
        title={<><Tag tone={r ? 'muted' : f.tone}>{f.label}</Tag> {f.code === 'no_clockout' ? (f.suggested ? `Suggested end ${fmtTime(f.suggested)}` : 'No suggested end') : f.detail}</>}
        subtitle={r ? resolvedText : f.info ? 'For information' : 'Needs a decision'}
        trailing={!disabled && !editing ? <button type="button" className="link" onClick={() => { setEditing(true); setErr(''); setReason(r?.reason || ''); setOutcome(r?.outcome || options[0].value); }}>{r ? 'Change' : 'Resolve'}</button> : null}
      />
      {editing && (
        <div className="flag-edit">
          {options.length > 1 && <Segmented label="Decision" value={outcome} onChange={setOutcome} size="sm" options={f.code === 'no_clockout' ? [{ value: 'accept', label: 'Set the end' }, { value: 'decline', label: "Don't count" }] : options} />}
          {f.code === 'no_clockout' && outcome === 'accept' && (
            <label className="field-row"><span>Left at</span><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} step="300" aria-label="Time they left" placeholder={f.suggested ? fmtTime(f.suggested) : ''} /><span className="row-sub">{end ? '' : f.suggested ? `Blank uses ${fmtTime(f.suggested)}` : ''}</span></label>
          )}
          <textarea className="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, for example: confirmed with the lab lead" aria-label="Reason" />
          {err && <p className="err" role="alert">{err}</p>}
          <div className="flag-actions">
            <button type="button" className="link-quiet" onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
