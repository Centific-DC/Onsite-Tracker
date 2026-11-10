import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { hasRole } from '../lib/auth.js';
import { DEMO, locationName } from '../lib/config.js';
import { partnersOf, robotLabel, shiftTimes } from '../lib/schedule.js';
import { MISSED, REASON, isLateReport, nextSteps, reasonsFor, reportDelayHours, standing } from '../lib/strikes.js';
import { fmtLongDay, fmtTime, parseDay } from '../lib/time.js';
import { Group, Row, Segmented, Sheet, Tag } from './ui.jsx';

const hhmm = (t) => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
const onDay = (day, v) => { const d = parseDay(day); const [h, m] = v.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const when = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ago = (h) => (h < 1 ? 'within the hour' : h < 48 ? `${Math.round(h)} h after the shift` : `${Math.round(h / 24)} days after the shift`);

// A switch row, as in Settings.
export function SwitchRow({ title, subtitle, on, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="row row-btn" disabled={disabled} onClick={() => onChange(!on)}>
      <span className="row-main"><span className="row-title">{title}</span>{subtitle && <span className="row-sub">{subtitle}</span>}</span>
      <span className="row-trail"><span className={clsx('switch', on && 'is-on')} aria-hidden="true"><span /></span></span>
    </button>
  );
}

/**
 * One missed clock-in or out request, for staff. Admins check with the partner, set
 * the real times and approve, or decline; everyone else sees it read-only. With
 * `draft` ({ email, shiftId }) an admin logs a request that came by email first.
 */
export function CorrectionSheet({ request, draft, onClose }) {
  const { data, session, requestCorrection, resolveCorrection } = useStore();
  const admin = hasRole(session, 'admin');
  const c = request || null;
  const shiftId = c?.shiftId || draft?.shiftId;
  const shift = (data?.schedule || []).find((r) => r.id === shiftId) || null;
  const email = c?.email || draft?.email || shift?.email;
  const name = c?.name || shift?.name || email;
  const t = shift ? shiftTimes(shift) : null;
  // What the clock recorded for this shift, so the admin can start from it.
  const rec = useMemo(() => {
    if (!shift) return { ins: [], outs: [] };
    const mine = (data.punches || []).filter((p) => p.email === email && (p.shiftId === shift.id || (new Date(p.ts) >= new Date(+t.start - 36e5) && new Date(p.ts) <= new Date(+t.end + 3 * 36e5))));
    return { ins: mine.filter((p) => p.type === 'in').map((p) => new Date(p.ts)), outs: mine.filter((p) => p.type === 'out').map((p) => new Date(p.ts)) };
  }, [data?.punches, shift, email]); // eslint-disable-line react-hooks/exhaustive-deps

  const [missed, setMissed] = useState('in');
  const [message, setMessage] = useState('');
  const [received, setReceived] = useState('');
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [counts, setCounts] = useState(true);
  const [noCount, setNoCount] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const open = !!(c || draft);
  useEffect(() => {
    if (!open || !t) return;
    setMissed(c?.missed || (rec.ins.length ? 'out' : rec.outs.length ? 'in' : 'both'));
    setMessage('');
    setReceived(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16));
    setTimeIn(hhmm(rec.ins[0] || t.start));
    setTimeOut(hhmm(rec.outs[rec.outs.length - 1] || t.end));
    setConfirmed(false); setCounts(true); setNoCount(''); setNote(''); setErr('');
  }, [open, c?.id, shiftId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !shift) return <Sheet open={false} onOpenChange={onClose} title="" />;

  const requestedAt = c ? c.requestedAt : received ? new Date(received).toISOString() : '';
  const late = isLateReport(shift, requestedAt);
  const reasons = reasonsFor({ missed: c?.missed || missed, requestedAt }, shift);
  const before = standing(data.strikes, email);
  const steps = nextSteps(data.strikes, email, reasons.length);
  const partners = partnersOf(data, shift);
  const handled = c && c.status !== 'open';

  const decide = (status) => {
    setErr('');
    if (!note.trim()) return setErr(status === 'approved' ? 'Add a note, for example who confirmed it.' : 'Say why you are declining it.');
    let tin = '', tout = '';
    if (status === 'approved') {
      if (!timeIn || !timeOut) return setErr('Enter the clock-in and clock-out times.');
      tin = onDay(shift.date, timeIn); tout = onDay(shift.date, timeOut);
      if (tout <= tin) return setErr('The clock-out has to be after the clock-in.');
      if (!counts && !noCount.trim()) return setErr('Say why this miss doesn’t count.');
    }
    if (draft && !message.trim()) return setErr('Summarise the email.');
    const body = { status, timeIn: tin && tin.toISOString(), timeOut: tout && tout.toISOString(), partnerConfirmed: confirmed, note: note.trim(), counts: status === 'approved' && counts, noCountReason: counts ? '' : noCount.trim() };
    const run = async () => {
      const id = c ? c.id : (await requestCorrection({ email, shiftId: shift.id, missed, message: message.trim(), source: 'email', requestedAt })).id;
      return resolveCorrection({ id, ...body }, `${status === 'approved' ? 'Correcting' : 'Declining'} ${name}’s ${fmtLongDay(parseDay(shift.date))}`);
    };
    run().then(
      (out) => toast.success(status === 'approved' ? `Corrected ${name}’s hours` : `Declined ${name}’s request`, {
        description: out.strikes.length ? `${out.strikes.map((s) => REASON[s.reason]).join(' and ')}: now at ${steps[steps.length - 1].text}. ${DEMO ? 'Demo: no email sent.' : `${name.split(' ')[0]} has been emailed.`}` : status === 'approved' ? 'Doesn’t count toward a warning.' : (DEMO ? 'Demo: no email sent.' : `${name.split(' ')[0]} has been emailed.`),
      }),
      (e) => toast.error(`${name}’s request wasn’t saved`, { description: e.message }),
    );
    onClose();
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={draft ? 'Log an emailed request' : MISSED[c.missed].label}
      description={`${name} · ${fmtLongDay(parseDay(shift.date))} · ${locationName(shift.location)}`}
      footer={handled ? null : admin ? (
        <div className="sheet-actions">
          {!draft && <button type="button" className="btn btn-plain" onClick={() => decide('declined')}>Decline</button>}
          <button type="button" className="btn btn-primary btn-block" onClick={() => decide('approved')}>{draft ? 'Log and correct' : 'Correct the hours'}</button>
        </div>
      ) : <p className="row-sub sheet-note">Only admins can correct hours. An admin will pick this up.</p>}
    >
      {draft ? (
        <Group title="The email" footer="Use when the email arrived: a request more than 24 hours after the shift counts as a late report.">
          <div className="pad"><Segmented label="What they missed" value={missed} onChange={setMissed} size="sm" options={[{ value: 'in', label: 'Clock-in' }, { value: 'out', label: 'Clock-out' }, { value: 'both', label: 'Both' }]} /></div>
          <label className="field-row"><span>Received</span><input type="datetime-local" value={received} onChange={(e) => setReceived(e.target.value)} aria-label="When the email arrived" /></label>
          <div className="pad"><textarea className="reason" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What the email says" aria-label="What the email says" /></div>
        </Group>
      ) : (
        <Group title="Request">
          <Row title={`“${c.message}”`} subtitle={`${c.source === 'email' ? 'By email' : 'Sent from Lotus'} · ${when(c.requestedAt)} · ${ago(reportDelayHours(shift, c.requestedAt))}`} trailing={late ? <Tag tone="warn">Late report</Tag> : null} />
        </Group>
      )}

      <Group title="Shift">
        <Row title={`${fmtTime(t.start)}–${fmtTime(t.end)}`} subtitle={robotLabel(shift)} />
        <Row title="Clock record" subtitle={`${rec.ins.length ? `In ${rec.ins.map(fmtTime).join(', ')}` : 'No clock-in'} · ${rec.outs.length ? `Out ${rec.outs.map(fmtTime).join(', ')}` : 'No clock-out'}`} />
      </Group>

      {handled ? (
        <Group title={c.status === 'approved' ? 'Corrected' : 'Declined'}>
          {c.status === 'approved' && <Row title={`${fmtTime(new Date(c.timeIn))}–${fmtTime(new Date(c.timeOut))}`} subtitle={c.partnerConfirmed ? 'Partner confirmed they were there' : 'Partner not confirmed'} />}
          <Row title={`“${c.note}”`} subtitle={`${c.resolvedBy} · ${when(c.resolvedAt)}`} />
          {c.status === 'approved' && <Row title={c.counts ? 'Counted toward a warning' : 'Didn’t count'} subtitle={c.counts ? '' : c.noCountReason} />}
        </Group>
      ) : (
        <>
          <Group title="Check with the partner" footer={partners.length ? 'Ask them whether the operator was there for the whole shift.' : 'Nobody else was booked on this shift. Check another way, such as the lab lead or badge data.'}>
            <Row title={partners.length ? partners.join(', ') : 'No partner booked'} subtitle="Scheduled on the same shift" />
            <SwitchRow title="Partner confirmed they were there" on={confirmed} onChange={setConfirmed} disabled={!admin || !partners.length} />
          </Group>
          {admin && (
            <Group title="Real times" footer="The original clock record stays as it is. These times replace it for this shift's hours, and the change is kept with your name.">
              <label className="field-row"><span>Clock-in</span><input type="time" step="300" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} aria-label="Clock-in time" /></label>
              <label className="field-row"><span>Clock-out</span><input type="time" step="300" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} aria-label="Clock-out time" /></label>
              <label className="field-row"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required, e.g. confirmed with Avery" /></label>
            </Group>
          )}
          <Group title="Warnings and strikes" footer={admin && !counts ? null : 'Each step is emailed to the operator. Lotus never blocks anyone; at Strike 3 the PM decides.'}>
            <Row title={`Now: ${before.text || 'No warnings'}`} subtitle={before.clearsOn ? `Clears ${before.clearsOn.toLocaleDateString([], { month: 'short', day: 'numeric' })} with no new misses` : 'Nothing in the last 30 days'} />
            {counts && reasons.map((r, i) => <Row key={r} title={`${REASON[r]} → ${steps[i].text}`} subtitle={steps[i].step.note} trailing={<Tag tone={steps[i].count >= 4 ? 'bad' : steps[i].count >= 2 ? 'warn' : 'muted'}>{steps[i].text}</Tag>} />)}
            {admin && <SwitchRow title="Doesn’t count" subtitle="An app or flow problem, or a scheduling mistake" on={!counts} onChange={(v) => setCounts(!v)} />}
            {admin && !counts && <label className="field-row"><span>Why</span><input value={noCount} onChange={(e) => setNoCount(e.target.value)} placeholder="Required" /></label>}
          </Group>
          {err && <p className="err" role="alert">{err}</p>}
        </>
      )}
    </Sheet>
  );
}
