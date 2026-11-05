import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const prefersReduced = () => !!reduced?.matches;

// Re-render every `ms` so elapsed times stay live.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const hashSub = (cb) => { addEventListener('hashchange', cb); return () => removeEventListener('hashchange', cb); };
export function useRoute() {
  const hash = useSyncExternalStore(hashSub, () => location.hash);
  return hash.replace(/^#\/?/, '').split('?')[0] || 'checkin';
}
export const go = (route) => { location.hash = `/${route}`; };
// The ?key=value part of the hash, for links that open a view at a day or person.
export function useHashQuery() {
  const hash = useSyncExternalStore(hashSub, () => location.hash);
  const i = hash.indexOf('?');
  return i < 0 ? '' : hash.slice(i + 1);
}

// Numbers count from the last shown value (0 the first time), 900ms cubic ease-out.
export function useCountUp(value) {
  const [shown, setShown] = useState(prefersReduced() ? value : 0);
  const from = useRef(prefersReduced() ? value : 0);
  useEffect(() => {
    if (prefersReduced()) { from.current = value; setShown(value); return undefined; }
    const start = from.current;
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      const v = start + (value - start) * (1 - (1 - k) ** 3);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

export function useMedia(q) {
  const sub = (cb) => { const m = matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };
  return useSyncExternalStore(sub, () => matchMedia(q).matches);
}
