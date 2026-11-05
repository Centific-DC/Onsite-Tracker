import { useEffect, useMemo, useState } from 'react';
import { DatePicker } from './DatePicker.jsx';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { LOCATIONS, locationById, locationOfRobot } from '../lib/config.js';
import { buildSessions } from '../lib/hours.js';
import { checkNewShift, homeLabProblem, isNew } from '../lib/rules.js';
import { fmtDay, fmtTime, mondayOf, parseDay } from '../lib/time.js';
import { newPairId, pairOf, replacedIds, robotLabel, samePair, shiftTimes } from '../lib/schedule.js';
import { Group, Select, Sheet } from './ui.jsx';

const CUSTOM = '__custom__';

// Add a shift to the schedule: lab, robot (optional), one of the lab's shift templates
// (or a custom time), an operator from the roster and who they pair with. Warnings for
// the weekly limit, conflicts and a new-with-new pairing show before it saves; saving
// again books it anyway. With `backfill` set (and `initial.replaces`) it replaces
// someone who isn't here: the new operator takes their place in the pair.
export function ShiftSheet({ open, onOpenChange, initial, backfill }) {
  const { data, upsertShifts } = useStore();
  const [f, setF] = useState({});
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState(null);
  const set = (k) => (e) => { const v = typeof e === 'string' ? e : e.target.value; setWarn(null); setF((x) => ({ ...x, [k]: v })); };

  useEffect(() => {
    if (!open) return;
    const loc = initial?.location || locationOfRobot(initial?.station)?.id || LOCATIONS[0].id;
    const L = locationById(loc);
    const t = L.templates.find((x) => x.start === initial?.start && x.end === initial?.end) || (!initial?.start ? L.templates[0] : null);
    setErr('');
    setWarn(null);
    setF({ date: initial?.date || '', location: loc, station: initial?.station ?? '', pairWith: initial?.pairWith || '', replaces: initial?.replaces || '', template: t ? t.id : CUSTOM, start: initial?.start || t?.start || '08:00', end: initial?.end || t?.end || '14:00', who: initial?.who || '', note: initial?.note || '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const L = locationById(f.location) || LOCATIONS[0];
  const tpl = L.templates.find((t) => t.id === f.template);
  const start = tpl ? tpl.start : f.start;
  const end = tpl ? tpl.end : f.end;
  const booked = new Set((data.schedule || []).filter((r) => r.date === f.date).map((r) => r.email));
  const ops = (data.operators || []).filter((o) => o.active !== false && (o.roles || ['operator']).includes('operator') && !booked.has(o.email));
  // Only operators whose home lab is this lab (or who have none set yet): nobody works at both labs.
  const choices = [...ops.filter((o) => o.location === f.location), ...ops.filter((o) => !o.location)];
  const { sessions } = useMemo(() => buildSessions(data.punches), [data.punches]);
  // Who they'd work with. A replacement takes the missing operator's place in their
  // pair. Otherwise the scheduler can pair them with someone booked at the same time
  // whose pair isn't full, or leave it to the robot (the same robot at the same time).
  const byEmail = new Map((data.operators || []).map((o) => [o.email, o]));
  const schedule = data.schedule || [];
  const draft = { id: '__new__', date: f.date, location: f.location, station: f.station || '', start, end, email: f.who || '__nobody__' };
  const gone = replacedIds(schedule);
  const replaced = f.replaces ? schedule.find((r) => r.id === f.replaces) : null;
  const sameTime = (r) => { const a = shiftTimes(r), b = shiftTimes(draft); return (Math.min(a.end, b.end) - Math.max(a.start, b.start)) / 6e4 > 60; };
  const pairable = f.date && start && end ? schedule.filter((r) => r.date === f.date && (r.location || '') === f.location && !gone.has(r.id) && r.email !== f.who && sameTime(r) && pairOf(schedule, r).length < 1) : [];
  const target = f.pairWith ? schedule.find((r) => r.id === f.pairWith) : null;
  const partners = replaced ? pairOf(schedule, replaced)
    : target ? [target, ...pairOf(schedule, target)]
    : f.station ? schedule.filter((r) => !gone.has(r.id) && samePair(r, draft)) : [];
  const needExperienced = partners.length > 0 && partners.every((r) => isNew(byEmail.get(r.email), sessions));
  const sorted = needExperienced ? [...choices.filter((o) => !isNew(o, sessions)), ...choices.filter((o) => isNew(o, sessions))] : choices;

  const changeLocation = (v) => {
    const NL = locationById(v);
    setWarn(null);
    setF((x) => ({ ...x, location: NL.id, station: '', pairWith: '', template: NL.templates[0]?.id || CUSTOM, who: homeLabProblem({ email: x.who, location: NL.id }, data.operators) ? '' : x.who }));
  };

  const save = async () => {
    const person = (data.operators || []).find((o) => o.email === f.who);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) return setErr('Pick a date.');
    if (!person) return setErr('Pick an operator. New operators are added on Roster.');
    const away = homeLabProblem({ email: person.email, location: f.location }, data.operators);
    if (away) return setErr(away);
    if (!start || !end) return setErr('Add a start and end time.');
    const shift = { date: f.date, operatorId: person.id, name: person.name, email: person.email, location: L.id, station: f.station || '', template: tpl?.id || '', start, end, note: f.note.trim(), pair: '', replaces: replaced?.id || '' };
    // Partners who don't have a pair id yet get one now, so the pair holds whatever robot they end up on.
    const anchor = replaced || target;
    const linked = [];
    if (anchor) {
      const group = replaced ? [replaced, ...pairOf(schedule, replaced)] : [target, ...pairOf(schedule, target)];
      shift.pair = anchor.pair || newPairId();
      for (const r of group) if (r.pair !== shift.pair) linked.push({ ...r, pair: shift.pair });
    }
    setErr('');
    if (!warn) {
      const w = checkNewShift(shift, [...schedule.filter((r) => !linked.some((x) => x.id === r.id)), ...linked], data.operators, sessions, mondayOf(parseDay(f.date)));
      if (w.length) return setWarn(w);
    }
    // The shift shows on the schedule at once and the sheet closes; the toast follows
    // the save, which can take a while on Power Automate. A failed save takes it off again.
    const t = shiftTimes(shift);
    const where = `${fmtDay(parseDay(f.date))} · ${L.name} · ${fmtTime(t.start)}–${fmtTime(t.end)}`;
    const saving = upsertShifts([...linked, { ...shift, note: [shift.note, ...(warn || []).map((x) => (x.code === 'pairing' ? 'Pairing risk acknowledged' : x.code === 'over_cap' ? 'Over weekly limit acknowledged' : 'Conflict acknowledged'))].filter(Boolean).join(' · ') }], { optimistic: true });
    toast.promise(saving, {
      loading: backfill ? `Saving ${person.name} as ${backfill}’s replacement…` : `Saving ${person.name}’s shift…`,
      success: { message: backfill ? `${person.name} is replacing ${backfill}` : `Shift added for ${person.name}`, description: where },
      error: (e) => ({ message: `${person.name}’s shift didn’t save`, description: `${where}. ${e.message} It’s off the schedule again; add it once more.` }),
    });
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={backfill ? `Replace ${backfill}` : 'Add a shift'}
      description={backfill ? `They take ${backfill}’s place in the pair. Pick someone who isn't booked that day.` : 'Times are the lab’s local time. The robot is optional; the pair is what matters.'}
      footer={<button type="button" className={warn ? 'btn btn-danger btn-block' : 'btn btn-primary btn-block'} onClick={save}>{warn ? 'Book anyway' : backfill ? 'Assign replacement' : 'Add shift'}</button>}
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
          <Select className="sel-field" label="Robot" value={f.station || ''} onChange={set('station')} disabled={!!backfill} options={[{ value: '', label: 'Any robot' }, ...L.robots.map((r) => ({ value: r, label: r }))]} />
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
            options={sorted.map((p) => ({ value: p.email, label: `${p.name}${isNew(p, sessions) ? ' · New' : ''}${!p.location ? ' (no home lab yet)' : ''}` }))}
          />
        </label>
        {!backfill && pairable.length > 0 && (
          <label className="field-row">
            <span>Pair with</span>
            <Select
              className="sel-field"
              label="Pair with"
              value={f.pairWith || ''}
              onChange={set('pairWith')}
              options={[{ value: '', label: f.station ? `Whoever is on ${f.station}` : 'Nobody yet' }, ...pairable.map((r) => ({ value: r.id, label: `${r.name}${isNew(byEmail.get(r.email), sessions) ? ' · New' : ''} · ${robotLabel(r)} · ${fmtTime(shiftTimes(r).start)}–${fmtTime(shiftTimes(r).end)}` }))]}
            />
          </label>
        )}
        {partners.length > 0 ? (
          <p className={needExperienced ? 'hint hint-warn field-hint' : 'hint field-hint'}>
            Paired with {partners.map((r) => `${r.name}${isNew(byEmail.get(r.email), sessions) ? ' (new)' : ''}`).join(', ')}{f.station ? ` on ${f.station}` : ''}.{needExperienced ? ' Pick an experienced operator.' : ''}
          </p>
        ) : !backfill && f.who && (
          <p className="hint field-hint">No partner yet. Pick one under Pair with{f.station ? `, or book someone else on ${f.station}` : ''}, so they know who they work with.</p>
        )}
        <label className="field-row"><span>Note</span><input value={f.note || ''} onChange={set('note')} placeholder="Optional" /></label>
      </Group>
    </Sheet>
  );
}
