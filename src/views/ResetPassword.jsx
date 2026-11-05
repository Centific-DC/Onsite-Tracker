import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { finishReset } from '../lib/auth/api.js';
import { passwordProblem } from '../lib/auth/crypto.js';
import { go } from '../lib/hooks.js';
import { VERSION } from '../version.js';
import { Group } from '../components/ui.jsx';
import { PasswordInput } from './SignIn.jsx';

// The page a password reset email links to: #/reset?u=<username>&c=<one-time code>.
// It works signed out. The code is taken out of the address bar as soon as the page
// reads it, so it doesn't stay in the browser history.
function readLink() {
  const i = location.hash.indexOf('?');
  const q = new URLSearchParams(i < 0 ? '' : location.hash.slice(i + 1));
  return { username: (q.get('u') || '').trim(), code: (q.get('c') || '').trim() };
}

export function ResetPassword() {
  const [link] = useState(readLink);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const signIn = useStore((s) => s.signIn);

  useEffect(() => {
    if (link.code) history.replaceState(null, '', `${location.pathname}${location.search}#/reset`);
  }, [link.code]);

  const edit = (fn) => (v) => { fn(v); setError(''); };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(next, link.username);
    if (problem) return setError(problem);
    if (next !== confirm) return setError('The two new passwords don’t match.');
    setBusy(true);
    setError('');
    try {
      await finishReset(link.username, link.code, next);
    } catch (err) {
      setBusy(false);
      return setError(err?.message || 'That didn’t work. Try again.');
    }
    setDone(true);
    // Sign them straight in with the new password; if that fails, the sign-in page is one tap away.
    try {
      await signIn(link.username, next);
      toast.success('Password changed', { description: 'You’re signed in with your new password.' });
      go('');
    } catch {
      setBusy(false);
    }
  };

  if (!link.username || !link.code) {
    return (
      <div className="view view-narrow view-enter">
        <h1 className="large-title">Reset your password</h1>
        <p className="lede">This reset link is incomplete. Open the link from your email again, or ask your Lotus admin to send a new one.</p>
        <div className="dock"><button type="button" className="btn btn-plain btn-block" onClick={() => go('')}>Go to sign-in</button></div>
      </div>
    );
  }

  if (done && !busy) {
    return (
      <div className="view view-narrow view-enter">
        <h1 className="large-title">Password changed</h1>
        <p className="lede">Sign in with your username, {link.username}, and your new password.</p>
        <div className="dock"><button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => go('')}>Go to sign-in</button></div>
      </div>
    );
  }

  return (
    <div className="view view-narrow view-enter">
      <h1 className="large-title">Choose a new password</h1>
      <p className="lede">For <strong>{link.username}</strong>. This link works once. After this, sign in with your new password.</p>
      <form className="login-form" onSubmit={submit} noValidate>
        <Group footer="At least 10 characters. A short sentence is easy to remember.">
          <label className="field-row"><span>New password</span><PasswordInput label="New password" value={next} onChange={edit(setNext)} autoComplete="new-password" autoFocus placeholder="Your own" invalid={!!error} /></label>
          <label className="field-row"><span>Type it again</span><PasswordInput label="Type it again" value={confirm} onChange={edit(setConfirm)} autoComplete="new-password" placeholder="Same again" /></label>
        </Group>
        <input type="text" name="username" autoComplete="username" value={link.username} readOnly hidden />
        <p id="login-error" className="login-error" role="alert" aria-live="assertive">{error}</p>
        <div className="dock">
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={!next || !confirm || busy} aria-busy={busy || undefined}>
            {busy ? 'One moment…' : <><KeyRound size={18} aria-hidden="true" /> Save new password</>}
          </button>
          <button type="button" className="link-quiet" onClick={() => go('')}>Back to sign-in</button>
        </div>
        <p className="app-version login-version">Lotus {VERSION}</p>
      </form>
    </div>
  );
}
