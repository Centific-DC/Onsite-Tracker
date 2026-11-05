import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { ROLES, ROLE_NOTE } from '../lib/auth.js';
import * as auth from '../lib/auth/api.js';
import { tempPassword, passwordProblem } from '../lib/auth/crypto.js';
import { Avatar, Group, Row, Select, Sheet, Tag } from '../components/ui.jsx';
import { SignInFields, TempReveal, suggestUsername } from '../components/SignInSetup.jsx';

// Users: who can sign in to Lotus, with which roles, as in Project Atlas. Adding
// a person or resetting a password makes a temp password here in the browser and
// shows it once; only its hash goes to SharePoint. The person picks their own
// password the first time they sign in. Only admins see this page, and the Lotus
// Auth flow refuses these calls from anyone else.

const ROLE_IDS = Object.keys(ROLES);
const empty = () => ({ name: '', email: '', username: '', temp: tempPassword(), roles: ['operator'], operatorId: '' });

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
  const { data, session } = useStore();
  const token = session?.token;
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState('');
  // { mode: 'add' } | { mode: 'edit', username } | { mode: 'reset', username } | { mode: 'temp', user, temp }
  const [sheet, setSheet] = useState(null);

  const load = useCallback(async () => {
    try { setUsers(await auth.listUsers(token)); setLoadError(''); } catch (e) { setLoadError(e.message || 'Couldn’t load sign-ins.'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const editing = sheet?.mode === 'edit' || sheet?.mode === 'reset' ? users?.find((u) => u.username === sheet.username) : null;
  const list = (users || []).slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  // Operators on the Roster who can't sign in yet.
  const withSignIn = new Set((users || []).map((u) => u.email));
  const noSignIn = (data?.operators || []).filter((o) => o.active !== false && (o.roles || ['operator']).includes('operator') && !withSignIn.has(o.email));

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
      <Group footer={noSignIn.length ? `${noSignIn.length} operators on the Roster can’t sign in yet. Use Add person and pick them from the Roster.` : undefined}>
        {users === null && !loadError && <div className="empty-row">Loading…</div>}
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
        title={sheet?.mode === 'add' ? 'Add a person' : sheet?.mode === 'temp' ? sheet.user.name : sheet?.mode === 'reset' ? `Reset ${editing?.name || ''}’s password` : editing?.name || ''}
        description={sheet?.mode === 'add' ? 'Set their username and a temp password. They choose their own password at first sign-in.' : sheet?.mode === 'temp' ? 'Their sign-in' : editing ? `${editing.username} · ${editing.email}` : ''}
      >
        {sheet?.mode === 'temp' && <TempReveal user={sheet.user} temp={sheet.temp} onDone={() => setSheet(null)} />}
        {sheet?.mode === 'add' && (
          <UserForm
            key="add"
            roster={noSignIn}
            taken={users || []}
            onSave={async ({ temp, ...form }) => {
              await auth.createUser(token, form, temp);
              setSheet({ mode: 'temp', user: form, temp });
              load();
            }}
          />
        )}
        {sheet?.mode === 'edit' && editing && (
          <UserForm
            key={editing.username}
            user={editing}
            self={editing.username === session?.username}
            taken={users || []}
            onSave={async (form) => {
              const changes = {};
              if (form.name !== editing.name) changes.name = form.name;
              if (form.username !== editing.username) changes.username = form.username;
              if (form.roles.join() !== editing.roles.join()) changes.roles = form.roles;
              if (Object.keys(changes).length) await auth.updateUser(token, editing.username, changes);
              toast.success(`${form.name} saved`);
              setSheet(null);
              load();
            }}
            onReset={() => setSheet({ mode: 'reset', username: editing.username })}
            onToggle={async () => {
              await auth.updateUser(token, editing.username, { active: !editing.active });
              toast.success(editing.active ? `${editing.name} can no longer sign in` : `${editing.name} can sign in again`);
              setSheet(null);
              load();
            }}
          />
        )}
        {sheet?.mode === 'reset' && editing && (
          <ResetForm
            user={editing}
            onReset={async (temp) => {
              await auth.resetUser(token, editing.username, temp);
              setSheet({ mode: 'temp', user: editing, temp });
              load();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function UserForm({ user, self, roster = [], taken, onSave, onReset, onToggle }) {
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
    if (adding) { const p = passwordProblem(form.temp, username); if (p) return setError(`Temp password: ${p}`); }
    run('save', () => onSave({ ...form, name, username, email: form.email.trim().toLowerCase() }))();
  };

  return (
    <form onSubmit={submit} noValidate>
      {adding && roster.length > 0 && (
        <Group footer="Operators on the Roster who can’t sign in yet.">
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
      <Group title="Roles" footer={self ? 'You can’t change your own roles.' : undefined}>
        <RolePicker value={form.roles} onChange={set('roles')} disabled={self} />
      </Group>
      {!adding && !self && (
        <div className="user-more">
          <button type="button" className="btn btn-plain btn-sm" onClick={onReset} disabled={!!busy}><KeyRound size={15} aria-hidden="true" /> Reset password</button>
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

function ResetForm({ user, onReset }) {
  const [temp, setTemp] = useState(tempPassword);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const p = passwordProblem(temp, user.username);
    if (p) return setError(`Temp password: ${p}`);
    setBusy(true);
    try { await onReset(temp); } catch (err) { setError(err.message || 'Couldn’t reset the password.'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate>
      <p className="lede">This signs {user.name} out everywhere. They sign in with the temp password and choose a new one.</p>
      <Group>
        <SignInFields lockUsername value={{ username: user.username, temp }} onChange={(v) => { setTemp(v.temp); setError(''); }} />
      </Group>
      <p className="login-error" role="alert">{error}</p>
      <div className="user-foot">
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Resetting…' : 'Reset password'}</button>
      </div>
    </form>
  );
}
