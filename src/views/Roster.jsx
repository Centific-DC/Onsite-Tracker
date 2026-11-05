import { useEffect, useMemo, useState } from 'react';
import { Search, Upload, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { CFG, LOCATIONS, locationName } from '../lib/config.js';
import { buildSessions } from '../lib/hours.js';
import { completedSessions, experience, weeklyLoad } from '../lib/rules.js';
import { ExperienceSelect } from '../components/Experience.jsx';
import { planRosterImport, planScheduleImport } from '../lib/importer.js';
import { claimName } from '../lib/onboarding.js';
import { dayKey, mondayOf, fmtHrsU } from '../lib/time.js';
import { Avatar, Group, Row, Segmented, Select, Sheet, Tag } from '../components/ui.jsx';

// Who can be scheduled: operator IDs, home lab, experience and this week's load.
// Recruiting's Active Roster 2 and scheduling tracker come in through Import.
export function Roster() {
  const { data, openProfile } = useStore();
  const [q, setQ] = useState('');
  const [lab, setLab] = useState('all');
  const [level, setLevel] = useState('all');
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const now = new Date();
  const { sessions } = useMemo(() => buildSessions(data.punches, now), [data.punches]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useMemo(() => new Map(weeklyLoad(data.schedule, mondayOf(now)).map((x) => [x.email, x])), [data.schedule]); // eslint-disable-line react-hooks/exhaustive-deps
  const ops = (data.operators || [])
    .filter((o) => (o.roles || ['operator']).includes('operator'))
    .filter((o) => lab === 'all' || o.location === lab)
    .filter((o) => `${o.name} ${o.email} ${o.id} ${o.cohort}`.toLowerCase().includes(q.toLowerCase()))
    .filter((o) => level === 'all' || experience(o, sessions).level === level)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="view view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">Roster</h1>
          <p className="lede">{ops.length} operators · operator IDs are permanent and go in every export</p>
        </div>
        <div className="stepper">
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setImporting(true)}><Upload size={16} /> Import</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><UserPlus size={16} /> Add operator</button>
        </div>
      </header>
      <div className="toolbar">
        <Segmented label="Lab" value={lab} onChange={setLab} options={[{ value: 'all', label: 'All labs' }, ...LOCATIONS.map((l) => ({ value: l.id, label: l.name }))]} />
        <Segmented label="Experience" value={level} onChange={setLevel} options={[{ value: 'all', label: 'Everyone' }, { value: 'experienced', label: 'Experienced' }, { value: 'new', label: 'New' }]} />
        <label className="search search-inline">
          <Search size={16} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, ID or cohort" aria-label="Search roster" />
        </label>
      </div>
      <Group footer={`Every pair needs at least one experienced operator. Pick Experienced or New for anyone, or leave it on Auto, where fewer than ${CFG.pairingMinSessions} completed sessions means new. Your choice stays when the roster is re-imported. The weekly limit is ${CFG.weeklyHourCap} hrs.`}>
        {ops.map((o) => {
          const done = completedSessions(o, sessions);
          const x = experience(o, sessions);
          const w = load.get(o.email);
          return (
            <Row
              key={o.email}
              leading={<Avatar name={o.name} tone={x.level === 'new' ? 'warn' : undefined} />}
              title={<><button type="button" className="name-link" onClick={() => openProfile(o.email)}>{o.name}</button> {x.level === 'new' && <Tag tone="warn">New</Tag>}{w?.over && <Tag tone="bad">Over {CFG.weeklyHourCap} hrs</Tag>}{o.active === false && <Tag tone="muted">Inactive</Tag>}</>}
              subtitle={`${o.id} · ${locationName(o.location) || 'No home lab'}${o.cohort ? ` · ${o.cohort}` : ''} · ${done} sessions completed · ${w ? fmtHrsU(w.hours) : '0 hrs'} this week`}
              trailing={<ExperienceSelect op={o} sessions={sessions} />}
            />
          );
        })}
        {!ops.length && <div className="empty-row">{q ? `Nothing matches “${q}”.` : 'No operators yet. Import Active Roster 2 to start.'}</div>}
      </Group>
      <ImportSheet open={importing} onOpenChange={setImporting} />
      <AddOperatorSheet open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function ImportSheet({ open, onOpenChange }) {
  const { data, upsertUsers, upsertShifts } = useStore();
  const [kind, setKind] = useState('roster');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setText(''); }, [open]);
  const plan = useMemo(() => {
    if (!text.trim()) return null;
    return kind === 'roster' ? planRosterImport(text, data.operators, dayKey(new Date())) : planScheduleImport(text, data.operators, data.schedule);
  }, [text, kind, data.operators, data.schedule]);
  const file = async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); };
  const save = async () => {
    setBusy(true);
    try {
      if (kind === 'roster') await upsertUsers([...plan.add, ...plan.update].map(({ changed, ...o }) => o)); // eslint-disable-line no-unused-vars
      else await upsertShifts([...plan.add, ...plan.update]);
      toast.success(`Imported ${plan.add.length} new, ${plan.update.length} updated`, { description: plan.skip.length ? `${plan.skip.length} rows skipped` : undefined });
      onOpenChange(false);
    } catch (e) {
      toast.error("Import didn't save", { description: e.message });
    } finally {
      setBusy(false);
    }
  };
  const label = (x) => (kind === 'roster' ? `${x.name} · ${x.email}${x.changed ? ` · ${x.changed.join(', ')}` : ''}` : `${x.date} · ${x.name} · ${locationName(x.location)} ${x.station} · ${x.start}–${x.end}`);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Import from recruiting"
      description="Export the sheet as CSV, then upload or paste it. Columns are matched by their headers. Nothing is saved until you confirm."
      footer={<button type="button" className="btn btn-primary btn-block" disabled={busy || !plan || plan.add.length + plan.update.length === 0} onClick={save}>{busy ? 'Saving…' : plan ? `Import ${plan.add.length + plan.update.length} rows` : 'Import'}</button>}
    >
      <div className="pad">
        <Segmented label="What to import" value={kind} onChange={setKind} options={[{ value: 'roster', label: 'Active Roster 2' }, { value: 'schedule', label: 'Schedule' }]} />
      </div>
      <Group footer={kind === 'roster' ? 'Uses Name, Email, Cohort, Sessions completed, Training status and Location. New operators get the next ID.' : 'Uses Date, Name or Email, Location, Robot, and Start and End (or one Shift column like "7:00 AM - 12:30 PM"). Re-importing a week updates it.'}>
        <label className="field-row"><span>File</span><input type="file" accept=".csv,text/csv,text/plain" onChange={file} /></label>
        <textarea className="reason mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or paste CSV here" aria-label="CSV to import" />
      </Group>
      {plan && (
        <>
          <Group title={`New (${plan.add.length})`}>{plan.add.slice(0, 50).map((x, i) => <Row key={i} title={label(x)} subtitle={kind === 'roster' ? `${x.id} · ${locationName(x.location) || 'No lab'}` : x.template || 'Custom time'} />)}{!plan.add.length && <div className="empty-row">None</div>}</Group>
          <Group title={`Updated (${plan.update.length})`}>{plan.update.slice(0, 50).map((x, i) => <Row key={i} title={label(x)} />)}{!plan.update.length && <div className="empty-row">None</div>}</Group>
          <Group title={`Skipped (${plan.skip.length})`}>{plan.skip.slice(0, 50).map((x, i) => <Row key={i} title={`Line ${x.line} · ${x.name || 'blank'}`} subtitle={x.reason} />)}{!plan.skip.length && <div className="empty-row">None</div>}</Group>
        </>
      )}
    </Sheet>
  );
}

function AddOperatorSheet({ open, onOpenChange }) {
  const { data, upsertUsers } = useStore();
  const [f, setF] = useState({ name: '', email: '', location: LOCATIONS[0]?.id || '', completed: '0' });
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ name: '', email: '', location: LOCATIONS[0]?.id || '', completed: '0' }); setNote(''); setErr(''); } }, [open]);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: typeof e === 'string' ? e : e.target.value })); if (k === 'name') setNote(''); };
  const save = async () => {
    if (!f.name.trim()) return setErr('Add a full name.');
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr('Add a valid email.');
    const c = claimName(f.name, f.email, data.operators || []);
    if (c.existing) return setErr(`${c.name} already has that email.`);
    if (c.renamed && !note) { setF((x) => ({ ...x, name: c.name })); setErr(''); return setNote(`There's already a ${c.takenBy}, so this operator will show as ${c.name}. Save again to confirm, or change the name.`); }
    setBusy(true);
    try {
      const [o] = await upsertUsers([{ name: c.name, email: c.email, location: f.location, completedSessions: Number(f.completed) || 0, completedAsOf: dayKey(new Date()), roles: ['operator'], active: true }]);
      toast.success(`Added ${o.name}`, { description: o.id });
      onOpenChange(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add an operator" description="They sign in with this work email. The operator ID is assigned on save." footer={<button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add operator'}</button>}>
      <Group footer={err ? <span className="err" role="alert">{err}</span> : note ? <span role="status">{note}</span> : undefined}>
        <label className="field-row"><span>Name</span><input value={f.name} onChange={set('name')} placeholder="Full name" autoComplete="off" /></label>
        <label className="field-row"><span>Email</span><input value={f.email} onChange={set('email')} type="email" inputMode="email" placeholder="name@centific.com" autoComplete="off" /></label>
        <label className="field-row"><span>Home lab</span><Select className="sel-field" label="Home lab" value={f.location} onChange={set('location')} options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))} /></label>
        <label className="field-row"><span>Sessions done</span><input className="num-input" type="number" min="0" value={f.completed} onChange={set('completed')} /></label>
      </Group>
    </Sheet>
  );
}
