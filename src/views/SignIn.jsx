import { useEffect, useState } from 'react';
import { VERSION } from '../version.js';
import { ArrowLeft, ChevronRight, Eye, EyeOff, LogIn, Search } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { locationName } from '../lib/config.js';
import { LOCAL_AUTH, prefetchSalt } from '../lib/auth/api.js';
import { passwordProblem } from '../lib/auth/crypto.js';
import { firstName } from '../lib/time.js';
import { Avatar, Group, Row } from '../components/ui.jsx';

// One screen for every way in, as in Project Atlas: first-time setup (no admin
// yet), sign-in with the username and password a Lotus admin gave you, and the
// forced new password after a temp one.
const COPY = {
  setup: { title: 'Set up Lotus', text: 'Create the first admin account. You add everyone else from Users.', button: 'Create admin and sign in' },
  signedOut: { title: 'Sign in', text: 'Use the username and password your Lotus admin gave you.', button: 'Sign in' },
  mustChange: { title: 'Choose your password', text: 'You signed in with a temp password. Pick your own to continue.', button: 'Save and continue' },
};

function Field({ label, children }) {
  return <label className="field-row"><span>{label}</span>{children}</label>;
}

function PasswordInput({ label, value, onChange, autoComplete, autoFocus, placeholder, invalid }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <input aria-label={label} type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'login-error' : undefined} />
      <button type="button" className="login-eye" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}>
        {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </>
  );
}

export function SignIn() {
  const { authStage } = useStore();

  if (authStage === 'pick') return <DemoOperatorPick />;
  return <SignInForm key={authStage} stage={COPY[authStage] ? authStage : 'signedOut'} />;
}

function SignInForm({ stage }) {
  const { session, signIn, changePassword, setUp, signOut } = useStore();
  const copy = COPY[stage];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Start the salt lookup while the password is being typed (one flow call saved on Sign in).
  useEffect(() => {
    if (stage !== 'signedOut') return undefined;
    const t = setTimeout(() => prefetchSalt(username), 400);
    return () => clearTimeout(t);
  }, [username, stage]);

  const edit = (fn) => (v) => { fn(v); setError(''); };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (stage === 'setup') {
      if (!name.trim()) return setError('Add your name.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('Add a valid email.');
      if (!username.trim()) return setError('Choose a username.');
    }
    if (stage !== 'signedOut') {
      const fresh = stage === 'setup' ? password : next;
      const problem = passwordProblem(fresh, stage === 'setup' ? username : session?.username);
      if (problem) return setError(problem);
      if (fresh !== confirm) return setError('The two new passwords don’t match.');
      if (stage === 'mustChange' && fresh === password) return setError('Pick a password different from the temp one.');
    }
    setBusy(true);
    setError('');
    try {
      if (stage === 'setup') await setUp({ name: name.trim(), email: email.trim(), username: username.trim() }, password);
      else if (stage === 'mustChange') await changePassword(password, next);
      else await signIn(username, password);
    } catch (err) {
      setError(err?.message || 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const ready = stage === 'signedOut' ? username.trim() && password : stage === 'mustChange' ? password && next && confirm : name && email && username && password && confirm;
  return (
    <div className="view view-narrow view-enter">
      <h1 className="large-title">{copy.title}</h1>
      <p className="lede">{stage === 'mustChange' && session ? `Hi ${firstName(session.name)}. ${copy.text}` : copy.text}</p>
      <form className="login-form" onSubmit={submit} noValidate>
        <Group footer={stage !== 'signedOut' ? 'At least 10 characters. A short sentence is easy to remember.' : undefined}>
          {stage === 'setup' && (
            <>
              <Field label="Name"><input value={name} onChange={(e) => edit(setName)(e.target.value)} autoComplete="name" placeholder="Your name" autoFocus /></Field>
              <Field label="Email"><input type="email" inputMode="email" value={email} onChange={(e) => edit(setEmail)(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@centific.com" /></Field>
            </>
          )}
          {stage !== 'mustChange' && (
            <Field label="Username">
              <input value={username} onChange={(e) => edit(setUsername)(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={stage === 'setup' ? 'Choose one' : 'Your username'} autoFocus={stage === 'signedOut'} aria-invalid={(stage === 'signedOut' && !!error) || undefined} aria-describedby={error ? 'login-error' : undefined} />
            </Field>
          )}
          <Field label={stage === 'mustChange' ? 'Temp password' : 'Password'}>
            <PasswordInput label={stage === 'mustChange' ? 'Temp password' : 'Password'} value={password} onChange={edit(setPassword)} autoComplete={stage === 'setup' ? 'new-password' : 'current-password'} autoFocus={stage === 'mustChange'} placeholder={stage === 'mustChange' ? 'From your admin' : 'Your password'} invalid={stage === 'signedOut' && !!error} />
          </Field>
          {stage === 'mustChange' && (
            <Field label="New password"><PasswordInput label="New password" value={next} onChange={edit(setNext)} autoComplete="new-password" placeholder="Your own" /></Field>
          )}
          {stage !== 'signedOut' && (
            <Field label="Type it again"><PasswordInput label="Type it again" value={confirm} onChange={edit(setConfirm)} autoComplete="new-password" placeholder="Same again" /></Field>
          )}
        </Group>
        <p id="login-error" className="login-error" role="alert" aria-live="assertive">{error}</p>
        <div className="dock">
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={!ready || busy} aria-busy={busy || undefined}>
            {busy ? 'One moment…' : <><LogIn size={18} aria-hidden="true" /> {copy.button}</>}
          </button>
          {stage === 'mustChange' && <button type="button" className="link-quiet" onClick={signOut}>Not you? Sign out</button>}
        </div>
        {LOCAL_AUTH && <p className="login-local">Demo mode: sign-ins are kept in this browser only, until the Lotus Auth flow is connected. Demo accounts: Lotus-admin and Lotus-operator.</p>}
        <p className="app-version login-version">Lotus {VERSION}</p>
      </form>
    </div>
  );
}

// Demo only: after signing in as Lotus-operator, pick who you are, so you only
// ever see your own rows. Real operators each have their own sign-in.
function DemoOperatorPick() {
  const { data, pickOperator, signOut } = useStore();
  const [q, setQ] = useState('');
  const ops = (data?.operators || []).filter((o) => o.active !== false && `${o.name} ${o.email} ${o.id}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="view view-narrow view-enter">
      <button type="button" className="link-quiet login-back" onClick={signOut}><ArrowLeft size={16} aria-hidden="true" /> Sign in as someone else</button>
      <h1 className="large-title">Who are you?</h1>
      <p className="lede">Demo operator account: pick your name. You’ll only see your own shifts and time.</p>
      <label className="search">
        <Search size={18} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find your name" aria-label="Find your name" />
      </label>
      <Group title="Operators">
        {ops.slice(0, 40).map((o, i) => (
          <Row key={o.email} className="row-in" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }} leading={<Avatar name={o.name} />} title={o.name} subtitle={`${o.id} · ${locationName(o.location)}`} trailing={<ChevronRight size={18} />} onClick={() => pickOperator(o)} />
        ))}
        {!ops.length && <div className="empty-row">{q ? `No one called “${q}”.` : data ? 'No operators yet.' : 'Loading…'}</div>}
      </Group>
    </div>
  );
}
