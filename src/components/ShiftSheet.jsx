import { useEffect, useMemo, useState } from 'react';
import { DatePicker } from './DatePicker.jsx';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { LOCATIONS, locationById, locationOfRobot } from '../lib/config.js';
import { buildSessions } from '../lib/hours.js';
import { checkNewShift, isNew, sharesShift } from '../lib/rules.js';
import { fmtDay, fmtTime, mondayOf, parseDay } from '../lib/time.js';
import { shiftTimes } from '../lib/schedule.js';
import { Group, Select, Sheet } from './ui.jsx';

const CUSTOM = '__custom__';

// Add a shift to the schedule: lab, robot, one of the lab's shift templates (or a
// custom time) and an operator from the roster. Warnings for the weekly limit,
// conflicts and a new-with-new pairing show before it saves; saving again books it
// anyway. With `backfill` set it replaces someone who isn't here.
export function ShiftSheet({ open, onOpenChange, initial, backfill }) {
  const { data, upsertShifts } = useStore();
  const [f, setF] = useState({});
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { const v = typeof e === 'string' ? e : e.target.value; setWarn(null); setF((x) => ({ ...x, [k]: v })); };

  useEffect(() => {
    if (!open) return;
    const loc = initial?.location || locationOfRobot(initial?.station)?.id || LOCATIONS[0].id;
    const L = locationById(loc);
    const t = L.templates.find((x) => x.start === initial?.start && x.end === initial?.end) || (!initial?.start ? L.templates[0] : null);
    setErr('');
    setWarn(null);
    setF({ date: initial?.date || '', location: loc, station: initial?.station || L.robots[0], template: t ? t.id : CUSTOM, start: initial?.start || t?.start || '08:00', end: initial?.end || t?.end || '14:00', who: initial?.who || '', note: initial?.note || '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const L = locationById(f.location) || LOCATIONS[0];
  const tpl = L.templates.find((t) => t.id === f.template);
  const start = tpl ? tpl.start : f.start;
  const end = tpl ? tpl.end : f.end;
  const booked = new Set((data.schedule || []).filter((r) => r.date === f.date).map((r) => r.email));
  const ops = (data.operators || []).filter((o) => o.active !== false && (o.roles || ['operator']).includes('operator') && !booked.has(o.email));
  const choices = [...ops.filter((o) => o.location === f.location), ...ops.filter((o) => o.location !== f.location)];
  const { sessions } = useMemo(() => buildSessions(data.punches), [data.punches]);
  // Who is already on this robot at this time. If they're all new, the next one
  // must be experienced, so experienced operators are listed first.
  const byEmail = new Map((data.operators || []).map((o) => [o.email, o]));
  const partners = (data.schedule || []).filter((r) => r.date === f.date && r.station === f.station && sharesShift(r, { start, end }));
  const needExperienced = partners.length > 0 && partners.every((r) => isNew(byEmail.get(r.email), sessions));
  const sorted = needExperienced ? [...choices.filter((o) => !isNew(o, sessions)), ...choices.filter((o) => isNew(o, sessions))] : choices;

  const changeLocation = (v) => {
    const NL = locationById(v);
    setWarn(null);
    setF((x) => ({ ...x, location: NL.id, station: NL.robots[0], template: NL.templates[0]?.id || CUSTOM }));
  };

  const save = async () => {
    const person = (data.operators || []).find((o) => o.email === f.who);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) return setErr('Pick a date.');
    if (!person) return setErr('Pick an operator. New operators are added on Roster.');
    if (!start || !end) return setErr('Add a start and end time.');
    const shift = { date: f.date, operatorId: person.id, name: person.name, email: person.email, location: L.id, station: f.station, template: tpl?.id || '', start, end, note: f.note.trim() };
    setErr('');
    if (!warn) {
      const w = checkNewShift(shift, data.schedule, data.operators, sessions, mondayOf(parseDay(f.date)));
      if (w.length) return setWarn(w);
    }
    setBusy(true);
    try {
      await upsertShifts([{ ...shift, note: [shift.note, ...(warn || []).map((x) => (x.code === 'pairing' ? 'Pairing risk acknowledged' : x.code === 'over_cap' ? 'Over weekly limit acknowledged' : 'Conflict acknowledged'))].filter(Boolean).join(' · ') }]);
      const t = shiftTimes(shift);
      toast.success(backfill ? `${person.name} is covering ${f.station}` : `Shift added for ${person.name}`, { description: `${fmtDay(parseDay(f.date))} · ${L.name} · ${fmtTime(t.start)}–${fmtTime(t.end)}` });
      onOpenChange(false);
    } catch (e) {
      setErr(`Didn't save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={backfill ? `Backfill ${initial?.station || ''}` : 'Add a shift'}
      description={backfill ? `Covering for ${backfill}. Pick someone who isn't booked that day.` : 'Times are the lab’s local time.'}
      footer={<button type="button" className={warn ? 'btn btn-danger btn-block' : 'btn btn-primary btn-block'} onClick={save} disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : warn ? 'Book anyway' : backfill ? 'Assign backfill' : 'Add shift'}</button>}
    >
      {warn && (
        <Group title="Check before booking" className="group-urgent">
          {warn.map((w) => <p key={w.code + w.text} className="warn-line" role="alert">{w.text}</p>)}
        </Group>
      )}
      <Group footer={err ? <span className="err" role="alert">{err}</span> : undefined}>
        <label className="field-row"><span>Date</span><DatePicker label="Date" value={f.date || ''} onChange={set('date')} disabled={!!backfill} /></label>
        <label className="field-row">
          <span>Lab</span>
          <Select className="sel-field" label="Lab" value={f.location || ''} onChange={changeLocation} disabled={!!backfill} options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))} />
        </label>
        <label className="field-row">
          <span>Robot</span>
          <Select className="sel-field" label="Robot" value={f.station || ''} onChange={set('station')} disabled={!!backfill} options={L.robots.map((r) => ({ value: r, label: r }))} />
        </label>
        <label className="field-row">
          <span>Shift</span>
          <Select
            className="sel-field"
            label="Shift"
            value={f.template || CUSTOM}
            onChange={set('template')}
            options={[
              ...L.templates.map((t) => ({ value: t.id, label: `${t.label} · ${fmtTime(shiftTimes({ date: '2026-01-05', start: t.start, end: t.end }).start)}–${fmtTime(shiftTimes({ date: '2026-01-05', start: t.start, end: t.end }).end)}` })),
              { value: CUSTOM, label: 'Custom time…' },
            ]}
          />
        </label>
        {!tpl && (
          <>
            <label className="field-row"><span>Start</span><input type="time" value={f.start || ''} onChange={set('start')} step="900" /></label>
            <label className="field-row"><span>End</span><input type="time" value={f.end || ''} onChange={set('end')} step="900" /></label>
          </>
        )}
        <label className="field-row">
          <span>Operator</span>
          <Select
            className="sel-field"
            label="Operator"
            value={f.who || ''}
            onChange={set('who')}
            placeholder="Choose…"
            options={sorted.map((p) => ({ value: p.email, label: `${p.name}${isNew(p, sessions) ? ' · New' : ''}${p.location !== f.location ? ` (${locationById(p.location)?.name || 'no home lab'})` : ''}` }))}
          />
        </label>
        {partners.length > 0 && (
          <p className={needExperienced ? 'hint hint-warn field-hint' : 'hint field-hint'}>
            On {f.station} with {partners.map((r) => `${r.name}${isNew(byEmail.get(r.email), sessions) ? ' (new)' : ''}`).join(', ')}.{needExperienced ? ' Pick an experienced operator.' : ''}
          </p>
        )}
        <label className="field-row"><span>Note</span><input value={f.note || ''} onChange={set('note')} placeholder="Optional" /></label>
      </Group>
    </Sheet>
  );
}
