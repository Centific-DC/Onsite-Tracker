// How long each call to the flows took, newest first, so slowness can be traced to a
// step (Settings > About > Speed, and the browser console). Times only: never bodies.
import { create } from 'zustand';

export const useTimings = create(() => ({ list: [] }));

export function timed(label, promise) {
  const t0 = performance.now();
  const done = (ok) => {
    const ms = Math.round(performance.now() - t0);
    useTimings.setState((s) => ({ list: [{ label, ms, ok, at: Date.now() }, ...s.list].slice(0, 12) }));
    console.info(`[Lotus] ${label}: ${(ms / 1000).toFixed(1)} s${ok ? '' : ' (failed)'}`);
  };
  return promise.then((v) => { done(true); return v; }, (e) => { done(false); throw e; });
}
