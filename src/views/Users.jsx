import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, Mail, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { ROLES, ROLE_NOTE, STAFF_ROLES, staffSignIns } from '../lib/auth.js';
import * as auth from '../lib/auth/api.js';
import { tempPassword, passwordProblem } from '../lib/auth/crypto.js';
import { Avatar, Group, Row, Select, Sheet, Tag } from '../components/ui.jsx';
import { ResetLinkSheet, SignInFields, TempPasswordForm, TempReveal, suggestUsername } from '../components/SignInSetup.jsx';

// Users: who can sign in to Lotus, with which roles, as in Project Atlas. Adding
// a person or resetting a password makes a temp password here in the browser and
// shows it once; only its hash goes to SharePoint. The person picks their own
// password the first time they sign in. Only admins see this page, and the Lotus
// Auth flow refuses these calls from anyone else. Users lists staff only (anyone
// with a scheduler, approver, reporting or admin role); operator-only sign-ins
// are set up and managed on the Roster.

const ROLE_IDS = Object.keys(ROLES);
const empty = () => ({ name: '', email: '', username: '', temp: tempPassword(), roles: [], operatorId: '' });

function stateOf(u) {
  if (!u.active) return { tone: 'bad', label: 'Turned off' };
  if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) return { tone: 'bad', label: 'Locked 15 min' };
  if (u.mustChangePassword) return { tone: 'warn', label: 'Temp password' };
  return { tone: 'on', label: 'Active' };
}
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never signed in');

function RolePicker({ value, onChange, disabled }) {
  const toggle = (r) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r]);
  return (
    <div className="role-pick" role="group" aria-label="Roles">
      {ROLE_IDS.map((r) => {
        const on = value.includes(r);
        return (
          <button key={r} type="button" role="checkbox" aria-checked={on} className="role-opt" onClick={() => toggle(r)} disabled={disabled}>
            <span className="send-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
            <span className="role-text"><span className="role-name">{ROLES[r]}</span><span className="role-note">{ROLE_NOTE[r]}</span></span>
          </button>
        );
      })}
    </div>
  );
}

export function Users() {
  const { data, session, background } = useStore();
  const token = session?.token;
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState('');
  // { mode: 'add' } | { mode: 'edit', username } | { mode: 'reset', username } | { mode: 'temp', user, temp }
  const [sheet, setSheet] = useState(null);
  const [linking, setLinking] = useState(null); // whose reset link is being sent

  const load = useCallback(async () => {
    try { setUsers(await auth.listUsers(token)); setLoadError(''); } catch (e) { setLoadError(e.message || 'Couldn’t load sign-ins.'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const editing = sheet?.mode === 'edit' || sheet?.mode === 'reset' ? users?.find((u) => u.username === sheet.username) : null;
  const list = staffSignIns(users || []).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  // Roster people without a sign-in, for giving an operator who is also staff (a lead) one here.
  const withSignIn = new Set((users || []).map((u) => u.email));
  const noSignIn = (data?.operators || []).filter((o) => o.active !== false && !withSignIn.has(o.email));

  return (
    <div className="view view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">Users</h1>
          <p className="lede">Who can sign in, and what they see.{auth.LOCAL_AUTH ? ' Demo mode: sign-ins are kept in this browser until the Lotus Auth flow is connected.' : ''}</p>
        </div>
        <div className="stepper">
          <button type="button" className="btn btn-primary btn-sm" data-tour="users-add" onClick={() => setSheet({ mode: 'add' })}><UserPlus size={16} aria-hidden="true" /> Add person</button>
        </div>
      </header>
      {loadError && <p className="login-error" role="alert">{loadError} <button type="button" className="link" onClick={load}>Try again</button></p>}
      <Group footer={<>Staff only. Operators and their sign-ins are on the <a className="link" href="#/admin/roster">Roster</a>.</>}>
        {users === null && !loadError && <div className="empty-row">Loading…</div>}
        {users !== null && !list.length && <div className="empty-row">No staff sign-ins yet.</div>}
        {list.map((u) => {
          const st = stateOf(u);
          return (
            <Row
              key={u.username}
              className={u.active ? undefined : 'is-off'}
              leading={<Avatar name={u.name} />}
              title={<span className="send-name">{u.name}{u.username === session?.username ? ' (you)' : ''} <Tag tone={st.tone}>{st.label}</Tag></span>}
              subtitle={`${u.username} · ${u.roles.map((r) => ROLES[r] || r).join(', ')} · ${when(u.lastSignIn)}`}
              onClick={() => setSheet({ mode: 'edit', username: u.username })}
            />
          );
        })}
      </Group>

      <Sheet
        open={!!sheet && (sheet.mode !== 'edit' || !!editing)}
        onOpenChange={(o) => { if (!o) setSheet(null); }}
        title={sheet?.mode === 'add' ? 'Add a person' : sheet?.mode === 'temp' ? sheet.user.name : sheet?.mode === 'reset' ? `Temp password for ${editing?.name || ''}` : editing?.name || ''}
        description={sheet?.mode === 'add' ? 'Set their username and a temp password. They choose their own password at first sign-in.' : sheet?.mode === 'temp' ? 'Their sign-in' : editing ? `${editing.username} · ${editing.email}` : ''}
      >
        {sheet?.mode === 'temp' && <TempReveal user={sheet.user} temp={sheet.temp} onDone={() => setSheet(null)} />}
        {sheet?.mode === 'add' && (
          <UserForm
            key="add"
            roster={noSignIn}
            taken={users || []}
            onSave={({ temp, ...form }) => {
              // The temp password is chosen here, so it shows at once; the sign-in saves behind it.
              setSheet({ mode: 'temp', user: form, temp });
              background(`Adding ${form.name}’s sign-in`, () => auth.createUser(token, form, temp)).then(
                () => { toast.success(`${form.name}’s sign-in is ready`); load(); },
                (e) => toast.error(`${form.name}’s sign-in didn’t save`, { description: `${e.message} The temp password shown won’t work.`, duration: 20000 }),
              );
            }}
          />
        )}
        {sheet?.mode === 'edit' && editing && (
          <UserForm
            key={editing.username}
            user={editing}
            self={editing.username === session?.username}
            taken={users || []}
            onSave={(form) => {
              const changes = {};
              if (form.name !== editing.name) changes.name = form.name;
              if (form.username !== editing.username) changes.username = form.username;
              if (form.roles.join() !== editing.roles.join()) changes.roles = form.roles;
              setSheet(null);
              if (!Object.keys(changes).length) return;
              const was = editing;
              background(`Saving ${form.name}`, () => auth.updateUser(token, was.username, changes)).then(
                () => { toast.success(`${form.name} saved`); load(); },
                (e) => toast.error(`Changes to ${was.name} didn’t save`, { description: e.message, duration: 20000 }),
              );
            }}
            onReset={() => setSheet({ mode: 'reset', username: editing.username })}
            onLink={() => { setLinking(editing); setSheet(null); }}
            onToggle={() => {
              const was = editing;
              setSheet(null);
              background(was.active ? `Turning off ${was.name}’s sign-in` : `Turning on ${was.name}’s sign-in`, () => auth.updateUser(token, was.username, { active: !was.active })).then(
                () => { toast.success(was.active ? `${was.name} can no longer sign in` : `${was.name} can sign in again`); load(); },
                (e) => toast.error(`${was.name}’s sign-in didn’t change`, { description: e.message, duration: 20000 }),
              );
            }}
          />
        )}
        {sheet?.mode === 'reset' && editing && (
          <TempPasswordForm
            user={editing}
            onReset={(temp) => {
              const was = editing;
              setSheet({ mode: 'temp', user: was, temp });
              background(`Setting ${was.name}’s temp password`, () => auth.resetUser(token, was.username, temp)).then(
                () => { toast.success(`${was.name}’s temp password is set`); load(); },
                (e) => toast.error(`${was.name}’s temp password didn’t save`, { description: `${e.message} Their old password still works.`, duration: 20000 }),
              );
            }}
          />
        )}
      </Sheet>
      <ResetLinkSheet user={linking} op={linking && (data?.operators || []).find((o) => o.email === linking.email)} onClose={() => { setLinking(null); load(); }} />
    </div>
  );
}

function UserForm({ user, self, roster = [], taken, onSave, onReset, onLink, onToggle }) {
  const adding = !user;
  const [form, setForm] = useState(() => (user ? { ...user } : empty()));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null); // 'save' | 'reset' | 'toggle'
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setError(''); };
  const run = (kind, fn) => async () => {
    if (busy) return;
    setBusy(kind);
    try { await fn(); } catch (e) { setError(e.message || 'That didn’t work.'); } finally { setBusy(null); }
  };
  // Picking someone from the Roster fills in their details.
  const fromRoster = (email) => {
    const o = roster.find((x) => x.email === email);
    if (!o) return;
    setForm((f) => ({ ...f, name: o.name, email: o.email, operatorId: o.id, username: f.username || suggestUsername(o.email), roles: f.roles.includes('operator') ? f.roles : ['operator', ...f.roles] }));
    setError('');
  };

  const submit = (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const username = form.username.trim();
    if (!name) return setError('Add their name.');
    if (adding && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return setError('Add a valid email.');
    if (!username) return setError('Add a username.');
    if (/\s/.test(username)) return setError('Usernames can’t have spaces.');
    if (taken.some((u) => u !== user && u.username.toLowerCase() === username.toLowerCase())) return setError('That username is taken.');
    if (!form.roles.length) return setError('Pick at least one role.');
    if (adding && !form.roles.some((r) => STAFF_ROLES.includes(r))) return setError('Users is for staff. Give an operator a sign-in on the Roster with Set up sign-in.');
    if (adding) { const p = passwordProblem(form.temp, username); if (p) return setError(`Temp password: ${p}`); }
    run('save', () => onSave({ ...form, name, username, email: form.email.trim().toLowerCase() }))();
  };

  return (
    <form onSubmit={submit} noValidate>
      {adding && roster.length > 0 && (
        <Group footer="For a lead or staff member who is also on the Roster.">
          <label className="field-row"><span>From Roster</span>
            <Select className="sel-field" label="From the Roster" value={roster.some((o) => o.email === form.email) ? form.email : ''} onChange={fromRoster} placeholder="Pick an operator" options={roster.map((o) => ({ value: o.email, label: o.name, hint: o.id }))} />
          </label>
        </Group>
      )}
      <Group>
        <label className="field-row"><span>Name</span><input value={form.name} onChange={(e) => set('name')(e.target.value)} autoComplete="off" placeholder="Full name" /></label>
        {adding && (
          <label className="field-row"><span>Email</span>
            <input type="email" value={form.email} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, email: v, username: !f.username || f.username === suggestUsername(f.email) ? suggestUsername(v) : f.username })); setError(''); }} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="name@centific.com" />
          </label>
        )}
        <SignInFields value={form} withTemp={adding} onChange={(v) => { setForm((f) => ({ ...f, username: v.username, temp: v.temp })); setError(''); }} />
      </Group>
      <Group title="Roles" footer={self ? 'You can’t change your own roles.' : adding ? 'Pick at least one staff role. Operators get their sign-in on the Roster.' : form.roles.some((r) => STAFF_ROLES.includes(r)) ? undefined : 'With no staff role they’re an operator only: after saving they leave this list and show on the Roster.'}>
        <RolePicker value={form.roles} onChange={set('roles')} disabled={self} />
      </Group>
      {!adding && !self && (
        <div className="user-more">
          {user.active && <button type="button" className="btn btn-plain btn-sm" onClick={onLink} disabled={!!busy}><Mail size={15} aria-hidden="true" /> Email a reset link</button>}
          <button type="button" className="btn btn-plain btn-sm" onClick={onReset} disabled={!!busy}><KeyRound size={15} aria-hidden="true" /> Set a temp password</button>
          <button type="button" className={user.active ? 'btn btn-plain btn-sm btn-danger-text' : 'btn btn-plain btn-sm'} onClick={run('toggle', onToggle)} disabled={!!busy} aria-busy={busy === 'toggle' || undefined}>
            {busy === 'toggle' ? 'Saving…' : user.active ? 'Turn off sign-in' : 'Turn sign-in back on'}
          </button>
        </div>
      )}
      <p className="login-error" role="alert">{error}</p>
      <div className="user-foot">
        <button type="submit" className="btn btn-primary" disabled={!!busy} aria-busy={busy === 'save' || undefined}>{busy === 'save' ? 'Saving…' : adding ? 'Add and make temp password' : 'Save changes'}</button>
      </div>
    </form>
  );
}
