import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { LOCATIONS } from '../lib/config.js';
import { claimName, strayNumber } from '../lib/onboarding.js';
import { Group, Segmented, Select, Sheet } from './ui.jsx';

// Fix an operator's details after import: name, home lab, cohort, training and
// sessions done, or take them off the roster. The email is the key, so it stays.
export function EditOperatorSheet({ op, onClose }) {
  const { data, upsertUsers } = useStore();
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (op) setF({ name: op.name, location: op.location || '', cohort: op.cohort || '', training: op.training || '', completed: String(op.completedSessions ?? 0), active: op.active === false ? 'no' : 'yes' });
    setErr('');
  }, [op]);
  if (!op || !f) return <Sheet open={false} onOpenChange={onClose} title="" />;
  const others = (data.operators || []).filter((o) => o.email !== op.email);
  const plain = strayNumber({ ...op, name: f.name }, data.operators || []);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: typeof e === 'string' ? e : e.target.value })); setErr(''); };
  const save = async () => {
    const name = f.name.trim().replace(/\s+/g, ' ');
    if (!name) return setErr('Add a full name.');
    if (name.toLowerCase() !== op.name.toLowerCase()) {
      const c = claimName(name, op.email, others);
      if (c.renamed) return setErr(`${c.takenBy} is already on the roster. Pick a different name.`);
    }
    const n = Number(f.completed);
    if (!Number.isFinite(n) || n < 0) return setErr('Sessions done must be 0 or more.');
    // Only what changed goes to the flow, so nothing else on their row is touched.
    const next = { name, location: f.location, cohort: f.cohort.trim(), training: f.training.trim(), completedSessions: Math.round(n), active: f.active === 'yes' };
    const prev = { name: op.name, location: op.location || '', cohort: op.cohort || '', training: op.training || '', completedSessions: op.completedSessions ?? 0, active: op.active !== false };
    const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => String(v) !== String(prev[k])));
    if (!Object.keys(changed).length) return onClose();
    if ('completedSessions' in changed) changed.completedAsOf = new Date().toISOString().slice(0, 10);
    setBusy(true);
    try {
      const [o] = await upsertUsers([{ email: op.email, ...changed }]);
      if (o && 'name' in changed && o.name !== name) toast.warning(`Saved, but the name came back as ${o.name}`, { description: 'The server added the number. That needs a backend fix.' });
      else toast.success(`Saved ${o?.name || name}`);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!op}
      onOpenChange={(v) => !v && onClose()}
      title={`Edit ${op.name}`}
      description={`${op.id} · ${op.email}. The operator ID and email can't change.`}
      footer={<button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>}
    >
      <Group footer={err ? <span className="err" role="alert">{err}</span> : plain ? <span role="status">Looks like a number was added by mistake. <button type="button" className="link" onClick={() => setF((x) => ({ ...x, name: plain }))}>Use “{plain}”</button></span> : undefined}>
        <label className="field-row"><span>Name</span><input value={f.name} onChange={set('name')} placeholder="Full name" autoComplete="off" /></label>
        <label className="field-row"><span>Home lab</span><Select className="sel-field" label="Home lab" value={f.location} onChange={set('location')} options={[{ value: '', label: 'None' }, ...LOCATIONS.map((l) => ({ value: l.id, label: l.name }))]} /></label>
        <label className="field-row"><span>Cohort</span><input value={f.cohort} onChange={set('cohort')} placeholder="Cohort 1" autoComplete="off" /></label>
        <label className="field-row"><span>Training</span><input value={f.training} onChange={set('training')} placeholder="Trained" autoComplete="off" /></label>
        <label className="field-row"><span>Sessions done</span><input className="num-input" type="number" min="0" value={f.completed} onChange={set('completed')} /></label>
      </Group>
      <Group footer="Inactive operators keep their past records and exports, but can't sign in.">
        <div className="pad"><Segmented label="On the roster" value={f.active} onChange={set('active')} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} /></div>
      </Group>
    </Sheet>
  );
}
