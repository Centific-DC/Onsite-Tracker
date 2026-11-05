import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { VERSION } from '../version.js';

// "A new version of Lotus is ready", as in Atlas. The app reads version.json beside
// the build every 5 minutes and whenever the tab comes back; a different version
// shows this notice. Like every notice (ux-behavior-spec section 8) it closes after
// 6 seconds, pausing while hovered or focused; Settings keeps a "Refresh to update"
// row until the page is reloaded. Offline or no version file: nothing happens.
const CHECK_MS = 5 * 60 * 1000;
const NOTICE_MS = 6000;
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
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(0);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const close = () => {
    clearTimeout(timer.current);
    if (reduced) { setShown(null); return; }
    setLeaving(true);
    timer.current = setTimeout(() => { setShown(null); setLeaving(false); }, EXIT_MS);
  };
  const arm = () => { clearTimeout(timer.current); timer.current = setTimeout(close, NOTICE_MS); };
  const pause = () => clearTimeout(timer.current);

  useEffect(() => {
    if (!latest) return undefined;
    setShown(latest);
    setLeaving(false);
    arm();
    return () => clearTimeout(timer.current);
  }, [latest]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  return (
    <div
      className="update-notice"
      data-leaving={leaving || undefined}
      role="status"
      aria-live="polite"
      onPointerEnter={pause}
      onPointerLeave={arm}
      onFocus={pause}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) arm(); }}
    >
      <span className="update-dot" aria-hidden="true" />
      <p className="update-text">
        <strong>A new version of Lotus is ready</strong>
        <span className="update-sub">You're on {VERSION}. Refresh to get {shown}.</span>
      </p>
      <div className="update-actions">
        <button type="button" className="link" onClick={close}>Later</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => { setBusy(true); hardRefresh(); }}>
          {busy ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
    </div>
  );
}
