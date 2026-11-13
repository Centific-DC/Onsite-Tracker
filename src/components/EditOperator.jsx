import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { DELETE_USER_URL, DEMO, LOCATIONS } from '../lib/config.js';
import { hasRole } from '../lib/auth.js';
import { claimName, deleteCheck, strayNumber } from '../lib/onboarding.js';
import { Group, Segmented, Select, Sheet } from './ui.jsx';

// Fix an operator's details after import: name, home lab, cohort, training and
// sessions done, or take them off the roster. The email is the key, so it stays.
// Admins can also delete someone added by mistake, while they have no records.
export function EditOperatorSheet({ op, onClose }) {
  const { data, updateUsers, session } = useStore();
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setDeleting(false);
    if (op) setF({ name: op.name, location: op.location || '', cohort: op.cohort || '', training: op.training || '', completed: String(op.completedSessions ?? 0), active: op.active === false ? 'no' : 'yes' });
    setErr('');
  }, [op]);
  if (!op || !f) return <Sheet open={false} onOpenChange={onClose} title="" />;
  const admin = hasRole(session, 'admin');
  const del = deleteCheck(data, op.email, session?.email);
  const flowReady = DEMO || !!DELETE_USER_URL;
  const others = (data.operators || []).filter((o) => o.email !== op.email);
  const plain = strayNumber({ ...op, name: f.name }, data.operators || []);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: typeof e === 'string' ? e : e.target.value })); setErr(''); };
  const save = () => {
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
    updateUsers([{ email: op.email, ...changed }], `Changes to ${name}`);
    toast.success(`Saved ${name}`);
    onClose();
  };
  return (
    <Sheet
      open={!!op}
      onOpenChange={(v) => !v && onClose()}
      title={`Edit ${op.name}`}
      description={`${op.id} · ${op.email}. The operator ID and email can't change.`}
      footer={<button type="button" className="btn btn-primary btn-block" onClick={save}>Save changes</button>}
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
      {admin && (
        <Group footer={!del.ok ? del.why : !flowReady ? 'Deleting needs the Lotus Delete User flow, which isn’t set up yet. Set them Inactive for now.' : 'For someone added by mistake, like a typo in the email. Removes them, their sign-in and their booked shifts from Lotus for good.'}>
          <button type="button" className="row row-btn row-danger" disabled={!del.ok || !flowReady} onClick={() => setDeleting(true)}>Delete {op.name}…</button>
        </Group>
      )}
      <DeleteOperatorSheet op={deleting ? op : null} shifts={del.shifts} onClose={() => setDeleting(false)} onDeleted={onClose} />
    </Sheet>
  );
}

// "Are you sure?": names the person and email, says what goes with them, and asks why.
function DeleteOperatorSheet({ op, shifts, onClose, onDeleted }) {
  const { deleteUser } = useStore();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setReason(''); setErr(''); setBusy(false); }, [op]);
  if (!op) return <Sheet open={false} onOpenChange={onClose} title="" />;
  const go = async () => {
    if (!reason.trim()) return setErr('Say why, for the audit trail.');
    setBusy(true);
    setErr('');
    try {
      await deleteUser(op.email, reason.trim());
      toast.success(`Deleted ${op.name}`, { description: `${op.email} is no longer in Lotus.` });
      onDeleted();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!op}
      onOpenChange={(v) => !v && !busy && onClose()}
      title={`Delete ${op.name}?`}
      description={`${op.email} will be removed from Lotus, with their sign-in${shifts ? ` and ${shifts} booked ${shifts === 1 ? 'shift' : 'shifts'}` : ''}. This can’t be undone. The audit log keeps a record of the delete.`}
      footer={(
        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={busy || !reason.trim()} onClick={go}>{busy ? 'Deleting…' : 'Delete for good'}</button>
        </div>
      )}
    >
      <Group footer={err ? <span className="err" role="alert">{err}</span> : 'For example: added with a typo in the email.'}>
        <label className="field-row"><span>Why</span><input value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} placeholder="Wrong email address" autoComplete="off" autoFocus /></label>
      </Group>
    </Sheet>
  );
}
