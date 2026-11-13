import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, Mail, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { hasRole } from '../lib/auth.js';
import * as auth from '../lib/auth/api.js';
import { passwordProblem, tempPassword } from '../lib/auth/crypto.js';
import { firstName } from '../lib/time.js';
import { DEMO } from '../lib/config.js';
import { dayKey } from '../lib/time.js';
import { useTemplates } from '../lib/email/useTemplates.js';
import { TEMP_DAYS, welcomeMessage } from '../lib/email/welcome.js';
import { resetLinkFor, resetMessage } from '../lib/email/reset.js';
import { RESET_HOURS } from '../lib/auth/crypto.js';
import { Group, Row, Sheet } from './ui.jsx';

// Sign-in set-up shared by Roster (Add operator, Set up sign-in) and Users.
// The admin picks the username and the temp password (a random one is filled
// in); the person must choose their own password the first time they sign in.

export const suggestUsername = (email) => String(email || '').split('@')[0].trim();

/** Everyone's sign-in, for admins (null while loading, [] for everyone else).
 *  `roster`: the sample operators of demo data never get real sign-ins. */
export function useSignIns({ roster = false } = {}) {
  const session = useStore((s) => s.session);
  const admin = hasRole(session, 'admin') && !(roster && DEMO && !auth.LOCAL_AUTH);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!admin) { setUsers([]); return; }
    try { setUsers(await auth.listUsers(session.token)); setError(''); } catch (e) { setError(e.message || 'Couldn’t load sign-ins.'); }
  }, [admin, session?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { users, error, load, admin, token: session?.token };
}

/** Why a username or temp password can't be used, or ''. */
export function signInProblem({ username, temp }, taken = [], except) {
  const u = String(username || '').trim();
  if (!u) return 'Add a username.';
  if (/\s/.test(u)) return 'Usernames can’t have spaces.';
  if (taken.some((x) => x.username !== except && x.username.toLowerCase() === u.toLowerCase())) return 'That username is taken.';
  if (temp !== undefined) return passwordProblem(temp, u) || '';
  return '';
}

/** Username and temp password rows, for inside a form Group. */
export function SignInFields({ value, onChange, withTemp = true, lockUsername = false }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <label className="field-row"><span>Username</span><input value={value.username} onChange={set('username')} readOnly={lockUsername} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="What they type to sign in" /></label>
      {withTemp && (
        <label className="field-row"><span>Temp password</span>
          <input aria-label="Temp password" className="mono-input" value={value.temp} onChange={set('temp')} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="At least 10 characters" />
          <button type="button" className="login-eye" onClick={() => onChange({ ...value, temp: tempPassword() })} aria-label="Make a new random temp password" title="New random password"><RefreshCw size={16} aria-hidden="true" /></button>
        </label>
      )}
    </>
  );
}

export const newSignIn = (email = '') => ({ username: suggestUsername(email), temp: tempPassword() });

/** The "Email their sign-in" switch on Add operator and Set up sign-in. */
export function WelcomeSwitch({ on, onChange, email }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="row row-btn" onClick={() => onChange(!on)}>
      <span className="row-main">
        <span className="row-title">Email their sign-in</span>
        <span className="row-sub">{email ? `Username, temp password and a button to open Lotus, to ${email}` : 'Username, temp password and a button to open Lotus'}</span>
      </span>
      <span className="row-trail"><span className={on ? 'switch is-on' : 'switch'} aria-hidden="true"><span /></span></span>
    </button>
  );
}

/** Sends the onboarding email. Resolves to 'sent', 'test' or 'demo', or throws. */
export function useWelcome() {
  const sendEmails = useStore((s) => s.sendEmails);
  const testMode = useStore((s) => s.data?.emailTestMode !== false);
  const templates = useTemplates();
  return useCallback(async (op, username, temp) => {
    const message = welcomeMessage({ op, username, temp, templates });
    await sendEmails({ kind: 'welcome', weekStart: dayKey(new Date()), messages: [message] });
    return DEMO ? 'demo' : testMode ? 'test' : 'sent';
  }, [sendEmails, templates, testMode]);
}

const EMAILED = {
  saving: (n) => `Saving ${n}’s sign-in… You can close this; it keeps going, and a message says when it’s done.`,
  sending: (n, e) => `Sending the welcome email to ${e}… You can close this; it keeps going.`,
  sent: (n, e) => `Emailed to ${e} with their username, temp password and a button to open Lotus. ${n} chooses their own password at the first sign-in.`,
  test: () => 'Test mode is on, so the welcome email went to project_lotus@centific.com, not to them. Share these yourself until test mode is off.',
  demo: () => 'Demo mode: no email leaves this browser. In the live app they get the welcome email.',
};

/** Shown once after a sign-in is made or reset. */
export function TempReveal({ user, temp, onDone, emailed }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(temp); setCopied(true); } catch { toast.error('Couldn’t copy. Select the password and copy it by hand.'); }
  };
  return (
    <div>
      <p className="lede">{emailed === 'sent' ? `${firstName(user.name)}’s sign-in is ready.` : `Give ${firstName(user.name)} this username and temp password.`} The password shows only once here; they choose their own the first time they sign in.</p>
      <Group>
        <Row title="Username" trailing={<span className="user-temp-user">{user.username}</span>} />
        <Row title="Temp password" trailing={<output className="user-temp" aria-label="Temp password">{temp}</output>} />
      </Group>
      {emailed?.failed ? (
        <p className="login-local err" role="alert">This sign-in didn’t save, so the password above won’t work: {emailed.failed}</p>
      ) : emailed && EMAILED[emailed] ? (
        <p className="login-local"><Mail size={13} aria-hidden="true" /> {EMAILED[emailed](firstName(user.name), user.email)}</p>
      ) : emailed ? (
        <p className="login-local err" role="alert">The welcome email didn’t send: {emailed} Share these yourself.</p>
      ) : (
        <p className="login-local">Send the password apart from the username (for example by text or in person), never in the same message.</p>
      )}
      <p className="login-local">The temp password stops working after {TEMP_DAYS} days.</p>
      <div className="user-foot">
        <button type="button" className="btn btn-plain" onClick={copy}><Copy size={15} aria-hidden="true" /> {copied ? 'Copied' : 'Copy password'}</button>
        <button type="button" className="btn btn-primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

const RESET_SENT = {
  sent: (u) => `Sent to ${u.email}. The link works once, for ${RESET_HOURS} hours. Their current password keeps working until they choose a new one.`,
  test: () => 'Test mode is on, so the reset email went to project_lotus@centific.com, not to them. Forward it. Test mode is switched off in SharePoint (Lotus_Settings, EmailTestMode = No).',
  demo: () => 'Demo mode: no email leaves this browser. Open the link below to try the reset page.',
};

/**
 * "Send reset link": emails someone a one-time link to choose a new password.
 * `user` is their sign-in ({ username, email, name, operatorId }); `op` their
 * Roster entry, if any. Shared by Users and Roster.
 */
export function ResetLinkSheet({ user, op, onClose }) {
  const token = useStore((s) => s.session?.token);
  const sendEmails = useStore((s) => s.sendEmails);
  const testMode = useStore((s) => s.data?.emailTestMode !== false);
  const templates = useTemplates();
  const [state, setState] = useState(null); // null | 'sending' | { result, link? } | { error }
  useEffect(() => { if (user) setState(null); }, [user?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  const background = useStore((s) => s.background);
  const send = async () => {
    // Live, the sheet closes at once and the link is made and emailed in the
    // background; a toast says when it's sent. The demo shows its link right here.
    if (!DEMO) {
      const who = user;
      const mode = testMode;
      background(`Emailing ${who.name || who.username} a reset link`, async () => {
        const { code, expiresAt } = await auth.startReset(token, who.username);
        await sendEmails({ kind: 'password-reset', weekStart: dayKey(new Date()), messages: [resetMessage({ user: who, op, code, expiresAt, templates })] });
      }).then(
        () => toast.success(`Reset link sent to ${who.name || who.username}`, { description: RESET_SENT[mode ? 'test' : 'sent'](who) }),
        (e) => toast.error(`The reset link for ${who.name || who.username} didn’t send`, { description: e.message, duration: 20000 }),
      );
      onClose();
      return;
    }
    setState('sending');
    try {
      const { code } = await auth.startReset(token, user.username);
      setState({ result: 'demo', link: resetLinkFor(user.username, code, `${location.origin}${location.pathname}`) });
    } catch (e) {
      setState({ error: e.message || 'That didn’t work.' });
    }
  };

  const done = state && state !== 'sending' && state.result;
  return (
    <Sheet
      open={!!user}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={done ? 'Reset link sent' : 'Send a password reset link'}
      description={user && !done ? `${user.name || user.username} gets an email with a link to choose a new password. It works once, for ${RESET_HOURS} hours.` : undefined}
      footer={done
        ? <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Done</button>
        : <button type="button" className="btn btn-primary btn-block" onClick={send} disabled={state === 'sending'} aria-busy={state === 'sending' || undefined}><Mail size={16} aria-hidden="true" /> {state === 'sending' ? 'Sending…' : `Email ${user ? firstName(user.name || user.username) : ''} a reset link`}</button>}
    >
      {user && (
        <Group>
          <Row title={user.name || user.username} subtitle={`${user.username} · ${user.email}`} />
        </Group>
      )}
      {done && <p className="login-local"><Mail size={13} aria-hidden="true" /> {RESET_SENT[state.result](user)}</p>}
      {done && state.link && <p className="login-local"><Link2 size={13} aria-hidden="true" /> <a href={state.link} target="_blank" rel="noopener">Open the reset page (demo)</a></p>}
      {state?.error && <p className="login-error" role="alert">The reset link didn’t send: {state.error}</p>}
      {!done && <p className="login-local">Their current password keeps working until they use the link. If they’re locked out, using the link unlocks them.</p>}
    </Sheet>
  );
}
