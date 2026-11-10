import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { VERSION } from '../version.js';
import { COUNTDOWN_S, nextLeft, waitReason } from '../lib/autoUpdate.js';
import { useStore } from '../lib/store.js';

// "A new version of Lotus is ready", as in Atlas. The app reads version.json beside
// the build every 5 minutes and whenever the tab comes back; a different version
// shows this notice, which refreshes the page after a 10-second countdown (ux-behavior-
// spec section 8a). It waits while anything is saving, a sheet is open or someone is
// typing, and holds while hovered or focused. "Not now" skips this version; Settings
// keeps a "Refresh to update" row. Offline or no version file: nothing happens.
const CHECK_MS = 5 * 60 * 1000;
const EXIT_MS = 180;

export const useUpdate = create(() => ({ latest: null }));

export function hardRefresh() {
  Promise.allSettled([
    fetch(window.location.href, { cache: 'reload' }),
    window.caches?.keys().then((keys) => Promise.all(keys.map((k) => window.caches.delete(k)))),
  ]).finally(() => window.location.reload());
}

export function useVersionCheck() {
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json();
        if (alive && typeof version === 'string' && version && version !== VERSION) useUpdate.setState({ latest: version });
      } catch { /* offline or no version file: try again later */ }
    };
    const onBack = () => { if (document.visibilityState === 'visible') check(); };
    check();
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', onBack);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onBack); };
  }, []);
}

export function UpdateNotice() {
  useVersionCheck();
  const latest = useUpdate((s) => s.latest);
  const [shown, setShown] = useState(null); // the version this notice is about
  const [dismissed, setDismissed] = useState(null); // "Not now" for this version
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(COUNTDOWN_S);
  const [reason, setReason] = useState('');
  const paused = useRef(false);
  const leftRef = useRef(COUNTDOWN_S);
  const exit = useRef(0);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const refresh = () => { setBusy(true); hardRefresh(); };
  const close = () => {
    clearTimeout(exit.current);
    if (reduced) { setShown(null); return; }
    setLeaving(true);
    exit.current = setTimeout(() => { setShown(null); setLeaving(false); }, EXIT_MS);
  };
  const notNow = () => { setDismissed(shown); close(); };

  useEffect(() => {
    if (!latest || latest === dismissed) return;
    setShown(latest);
    setLeaving(false);
    leftRef.current = COUNTDOWN_S;
    setLeft(COUNTDOWN_S);
  }, [latest, dismissed]);

  // Once a second: wait while work is in progress, hold while hovered or focused,
  // otherwise count down and refresh at 0. A tab nobody is looking at refreshes as
  // soon as it's quiet, so it's on the new build when they come back.
  useEffect(() => {
    if (!shown || leaving || busy) return undefined;
    const tick = () => {
      const why = waitReason(useStore.getState());
      setReason(why);
      if (!why && document.visibilityState === 'hidden') { refresh(); return; }
      leftRef.current = nextLeft(leftRef.current, { paused: paused.current, waiting: !!why });
      setLeft(leftRef.current);
      if (leftRef.current === 0) refresh();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [shown, leaving, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(exit.current), []);

  if (!shown) return null;
  const sub = busy ? `Getting ${shown}…`
    : reason === 'saving' ? `Lotus will refresh to ${shown} once your changes are saved.`
    : reason ? `Lotus will refresh to ${shown} when you’re done here.`
    : `Refreshing to ${shown} in ${left}s.`;
  return (
    <div
      className="update-notice"
      data-leaving={leaving || undefined}
      onPointerEnter={() => { paused.current = true; }}
      onPointerLeave={() => { paused.current = false; }}
      onFocus={() => { paused.current = true; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) paused.current = false; }}
    >
      <span className="update-dot" aria-hidden="true" />
      {/* Read out once; the ticking seconds aren't announced. */}
      <p className="sr-only" role="status">A new version of Lotus is ready. It refreshes in {COUNTDOWN_S} seconds unless you choose Not now. Nothing you're saving is lost.</p>
      <p className="update-text" aria-hidden="true">
        <strong>A new version of Lotus is ready</strong>
        <span className="update-sub">{sub}</span>
      </p>
      <div className="update-actions">
        <button type="button" className="link" disabled={busy} onClick={notNow}>Not now</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={refresh}>
          {busy ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
    </div>
  );
}
