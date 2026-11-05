import { useEffect, useMemo, useState } from 'react';
import { KeyRound, PencilLine, RotateCcwKey, Search, Upload, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { CFG, LOCATIONS, locationName } from '../lib/config.js';
import { buildSessions } from '../lib/hours.js';
import { completedSessions, experience, weeklyLoad } from '../lib/rules.js';
import { ExperienceSelect } from '../components/Experience.jsx';
import { planRosterImport, planScheduleImport } from '../lib/importer.js';
import { claimName, strayNumber } from '../lib/onboarding.js';
import { EditOperatorSheet } from '../components/EditOperator.jsx';
import { dayKey, mondayOf, fmtHrsU } from '../lib/time.js';
import { Avatar, Group, Row, Segmented, Select, Sheet, Tag } from '../components/ui.jsx';
import * as auth from '../lib/auth/api.js';
import { ResetLinkSheet, SignInFields, TempReveal, WelcomeSwitch, newSignIn, signInProblem, suggestUsername, useSignIns, useWelcome } from '../components/SignInSetup.jsx';

// An operator's sign-in, as admins see it on the Roster.
function signInTag(u) {
  if (!u) return null;
  if (!u.active) return <Tag tone="muted">Sign-in off</Tag>;
  if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) return <Tag tone="bad">Locked</Tag>;
  if (u.mustChangePassword) return <Tag tone="warn">Temp password</Tag>;
  return null;
}

// Who can be scheduled: operator IDs, home lab, experience and this week's load.
// Recruiting's Active Roster 2 and scheduling tracker come in through Import.
export function Roster() {
  const { data, openProfile, upsertUsers } = useStore();
  const [q, setQ] = useState('');
  const [lab, setLab] = useState('all');
  const [level, setLevel] = useState('all');
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [settingUp, setSettingUp] = useState(null); // an operator without a sign-in
  const [resetting, setResetting] = useState(null); // { user, op }: emailing a reset link
  const [editing, setEditing] = useState(null);
  const [fixing, setFixing] = useState(false);
  const signIns = useSignIns({ roster: true });
  const signInOf = useMemo(() => new Map((signIns.users || []).map((u) => [u.email, u])), [signIns.users]);
  const now = new Date();
  const { sessions } = useMemo(() => buildSessions(data.punches, now), [data.punches]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useMemo(() => new Map(weeklyLoad(data.schedule, mondayOf(now)).map((x) => [x.email, x])), [data.schedule]); // eslint-disable-line react-hooks/exhaustive-deps
  const ops = (data.operators || [])
    .filter((o) => (o.roles || ['operator']).includes('operator'))
    .filter((o) => lab === 'all' || o.location === lab)
    .filter((o) => `${o.name} ${o.email} ${o.id} ${o.cohort}`.toLowerCase().includes(q.toLowerCase()))
    .filter((o) => level === 'all' || experience(o, sessions).level === level)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Names with a number nobody else needs ("Brian Leong 2"), from the 2026-11-05 import.
  const stray = (data.operators || []).map((o) => ({ o, plain: strayNumber(o, data.operators || []) })).filter((x) => x.plain);
  const fixNames = async () => {
    setFixing(true);
    try {
      const saved = await upsertUsers(stray.map(({ o, plain }) => ({ email: o.email, name: plain })));
      const still = saved.filter((o) => /\s\d+$/.test(o.name)).length;
      if (still) toast.warning(`${still} names still have a number`, { description: 'The server added it again. That needs a backend fix first.' });
      else toast.success(`Fixed ${saved.length} names`);
    } catch (e) {
      toast.error("Names didn't save", { description: e.message });
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="view view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">Roster</h1>
          <p className="lede">{ops.length} operators · operator IDs are permanent and go in every export</p>
        </div>
        <div className="stepper">
          <button type="button" className="btn btn-plain btn-sm" data-tour="roster-import" onClick={() => setImporting(true)}><Upload size={16} /> Import</button>
          <button type="button" className="btn btn-primary btn-sm" data-tour="roster-add" onClick={() => setAdding(true)}><UserPlus size={16} /> Add operator</button>
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
      {stray.length > 0 && (
        <Group footer={`${stray.slice(0, 3).map((x) => `${x.o.name} → ${x.plain}`).join(', ')}${stray.length > 3 ? `, and ${stray.length - 3} more` : ''}`}>
          <Row title={`${stray.length} ${stray.length === 1 ? 'name has' : 'names have'} a number added by mistake`} subtitle="Nobody else on the roster has the plain name." trailing={<button type="button" className="btn btn-plain btn-sm" disabled={fixing} onClick={fixNames}>{fixing ? 'Fixing…' : 'Fix names'}</button>} className="row-wrap" />
        </Group>
      )}
      <Group footer={`Every pair needs at least one experienced operator. Pick Experienced or New for anyone, or leave it on Auto, where fewer than ${CFG.pairingMinSessions} completed sessions means new. Your choice stays when the roster is re-imported. The weekly limit is ${CFG.weeklyHourCap} hrs.`}>
        {ops.map((o) => {
          const done = completedSessions(o, sessions);
          const x = experience(o, sessions);
          const w = load.get(o.email);
          return (
            <Row
              key={o.email}
              leading={<Avatar name={o.name} tone={x.level === 'new' ? 'warn' : undefined} />}
              title={<><button type="button" className="name-link" onClick={() => openProfile(o.email)}>{o.name}</button> {x.level === 'new' && <Tag tone="warn">New</Tag>}{w?.over && <Tag tone="bad">Over {CFG.weeklyHourCap} hrs</Tag>}{o.active === false && <Tag tone="muted">Inactive</Tag>}{signIns.admin && signIns.users && (signInOf.has(o.email) ? signInTag(signInOf.get(o.email)) : o.active !== false && <button type="button" className="tag-btn" onClick={() => setSettingUp(o)}><KeyRound size={12} aria-hidden="true" /> Set up sign-in</button>)}</>}
              subtitle={`${o.id} · ${locationName(o.location) || 'No home lab'}${o.cohort ? ` · ${o.cohort}` : ''} · ${done} sessions completed · ${w ? fmtHrsU(w.hours) : '0 hrs'} this week`}
              trailing={<span className="row-actions"><ExperienceSelect op={o} sessions={sessions} />{signIns.admin && signInOf.get(o.email)?.active && <button type="button" className="icon-btn" aria-label={`Send ${o.name} a password reset link`} title="Send a password reset link" onClick={() => setResetting({ user: signInOf.get(o.email), op: o })}><RotateCcwKey size={16} aria-hidden="true" /></button>}<button type="button" className="icon-btn" aria-label={`Edit ${o.name}`} onClick={() => setEditing(o)}><PencilLine size={16} aria-hidden="true" /></button></span>}
              className="row-wrap"
            />
          );
        })}
        {!ops.length && <div className="empty-row">{q ? `Nothing matches “${q}”.` : 'No operators yet. Import Active Roster 2 to start.'}</div>}
      </Group>
      <ImportSheet open={importing} onOpenChange={setImporting} />
      <AddOperatorSheet open={adding} onOpenChange={setAdding} signIns={signIns} />
      <SetUpSignInSheet op={settingUp} onClose={() => setSettingUp(null)} signIns={signIns} />
      <ResetLinkSheet user={resetting?.user} op={resetting?.op} onClose={() => { setResetting(null); signIns.load(); }} />
      <EditOperatorSheet op={editing} onClose={() => setEditing(null)} />
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

function AddOperatorSheet({ open, onOpenChange, signIns }) {
  const { data, upsertUsers } = useStore();
  const blank = () => ({ name: '', email: '', location: LOCATIONS[0]?.id || '', completed: '0' });
  const [f, setF] = useState(blank);
  const [login, setLogin] = useState(newSignIn);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null); // { user, temp, emailed } once saved with a sign-in
  const [mail, setMail] = useState(true);
  const welcome = useWelcome();
  const admin = signIns.admin;
  useEffect(() => { if (open) { setF(blank()); setLogin(newSignIn()); setNote(''); setErr(''); setMade(null); setMail(true); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => {
    const v = typeof e === 'string' ? e : e.target.value;
    setF((x) => ({ ...x, [k]: v }));
    // The username follows the email until the admin types their own.
    if (k === 'email') setLogin((l) => (!l.username || l.username === suggestUsername(f.email) ? { ...l, username: suggestUsername(v) } : l));
    if (k === 'name') setNote('');
    setErr('');
  };
  const save = async () => {
    if (!f.name.trim()) return setErr('Add a full name.');
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr('Add a valid email.');
    if (admin) { const p = signInProblem(login, signIns.users || []); if (p) return setErr(p.startsWith('Use') || p.startsWith('Don') ? `Temp password: ${p}` : p); }
    const c = claimName(f.name, f.email, data.operators || []);
    if (c.existing) return setErr(`${c.name} already has that email.`);
    if (c.renamed && !note) { setF((x) => ({ ...x, name: c.name })); setErr(''); return setNote(`There's already a ${c.takenBy}, so this operator will show as ${c.name}. Save again to confirm, or change the name.`); }
    setBusy(true);
    try {
      const [o] = await upsertUsers([{ name: c.name, email: c.email, location: f.location, completedSessions: Number(f.completed) || 0, completedAsOf: dayKey(new Date()), roles: ['operator'], active: true }]);
      if (!admin) { toast.success(`Added ${o.name}`, { description: `${o.id} · an admin gives them a sign-in` }); onOpenChange(false); return; }
      const user = { username: login.username.trim(), email: o.email, name: o.name, roles: ['operator'], operatorId: o.id };
      try {
        await auth.createUser(signIns.token, user, login.temp);
      } catch (e) {
        toast.error(`Added ${o.name}, but the sign-in didn’t save`, { description: `${e.message} Use Set up sign-in on their row to try again.` });
        onOpenChange(false);
        return;
      }
      signIns.load();
      toast.success(`Added ${o.name}`, { description: o.id });
      // The sign-in is saved: show it now and let the welcome email finish behind it.
      setMade({ user, temp: login.temp, emailed: mail ? 'sending' : null });
      if (mail) welcome(o, user.username, login.temp).then((r) => setMade((m) => m && { ...m, emailed: r }), (e) => setMade((m) => m && { ...m, emailed: e.message || 'unknown error.' }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (made) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={made.user.name} description="Their sign-in">
        <TempReveal user={made.user} temp={made.temp} emailed={made.emailed} onDone={() => onOpenChange(false)} />
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add an operator" description={admin ? 'The operator ID is assigned on save. They sign in with the username and temp password below, then choose their own password.' : 'The operator ID is assigned on save. An admin gives them a sign-in.'} footer={<button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={save}>{busy ? 'Saving…' : admin ? 'Add operator and sign-in' : 'Add operator'}</button>}>
      <Group footer={!admin ? (err ? <span className="err" role="alert">{err}</span> : note ? <span role="status">{note}</span> : undefined) : undefined}>
        <label className="field-row"><span>Name</span><input value={f.name} onChange={set('name')} placeholder="Full name" autoComplete="off" /></label>
        <label className="field-row"><span>Email</span><input value={f.email} onChange={set('email')} type="email" inputMode="email" placeholder="name@centific.com" autoComplete="off" /></label>
        <label className="field-row"><span>Home lab</span><Select className="sel-field" label="Home lab" value={f.location} onChange={set('location')} options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))} /></label>
        <label className="field-row"><span>Sessions done</span><input className="num-input" type="number" min="0" value={f.completed} onChange={set('completed')} /></label>
      </Group>
      {admin && (
        <Group title="Sign-in" footer={err ? <span className="err" role="alert">{err}</span> : note ? <span role="status">{note}</span> : 'A random temp password is filled in; type your own if you like (at least 10 characters).'}>
          <SignInFields value={login} onChange={(v) => { setLogin(v); setErr(''); }} />
          <WelcomeSwitch on={mail} onChange={setMail} email={f.email.trim()} />
        </Group>
      )}
    </Sheet>
  );
}

// For an operator already on the Roster (say, from the Active Roster 2 import) who can't sign in yet.
function SetUpSignInSheet({ op, onClose, signIns }) {
  const [login, setLogin] = useState(newSignIn);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null);
  const [mail, setMail] = useState(true);
  const welcome = useWelcome();
  useEffect(() => { if (op) { setLogin(newSignIn(op.email)); setErr(''); setMade(null); setMail(true); } }, [op]);
  const save = async () => {
    const p = signInProblem(login, signIns.users || []);
    if (p) return setErr(p.startsWith('Use') || p.startsWith('Don') ? `Temp password: ${p}` : p);
    setBusy(true);
    try {
      const user = { username: login.username.trim(), email: op.email, name: op.name, roles: ['operator'], operatorId: op.id };
      await auth.createUser(signIns.token, user, login.temp);
      signIns.load();
      setMade({ user, temp: login.temp, emailed: mail ? 'sending' : null });
      if (mail) welcome(op, user.username, login.temp).then((r) => setMade((m) => m && { ...m, emailed: r }), (e) => setMade((m) => m && { ...m, emailed: e.message || 'unknown error.' }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!op}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={op ? (made ? op.name : `Set up ${op.name}’s sign-in`) : ''}
      description={made ? 'Their sign-in' : op ? `${op.id} · ${op.email}` : ''}
      footer={made ? undefined : <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Make sign-in'}</button>}
    >
      {made ? <TempReveal user={made.user} temp={made.temp} emailed={made.emailed} onDone={onClose} /> : (
        <Group footer={err ? <span className="err" role="alert">{err}</span> : 'They sign in with these, then choose their own password.'}>
          <SignInFields value={login} onChange={(v) => { setLogin(v); setErr(''); }} />
          <WelcomeSwitch on={mail} onChange={setMail} email={op?.email} />
        </Group>
      )}
    </Sheet>
  );
}
