import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTour } from './tourStore.js';

// The tour on screen, as in Project Atlas: the page dims, a spotlight with a soft
// ring sits on the step's target, and a card explains it. On phones the card is a
// bottom sheet. Arrow keys move, Esc skips; the page underneath can't be clicked.

const PAD = 8; // spotlight around the target
const GAP = 14; // spotlight to card
const EDGE = 12; // card to the window edge
const PHONE = 640;

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The step's target if it's on screen for this person. */
function findTarget(selector) {
  if (!selector) return null;
  for (const el of document.querySelectorAll(selector)) {
    if (el.closest('[inert]') || el.closest('.tour')) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

// Below the target if it fits, else above, right, left; always inside the window.
function place(rect, bw, bh, vw, vh) {
  const clampX = (x) => Math.min(Math.max(x, EDGE), vw - bw - EDGE);
  const clampY = (y) => Math.min(Math.max(y, EDGE), vh - bh - EDGE);
  if (!rect) return { left: clampX((vw - bw) / 2), top: clampY((vh - bh) / 2) };
  const midX = rect.left + rect.width / 2 - bw / 2;
  const midY = rect.top + rect.height / 2 - bh / 2;
  if (vh - rect.bottom - PAD - GAP >= bh + EDGE) return { left: clampX(midX), top: rect.bottom + PAD + GAP };
  if (rect.top - PAD - GAP >= bh + EDGE) return { left: clampX(midX), top: rect.top - PAD - GAP - bh };
  if (vw - rect.right - PAD - GAP >= bw + EDGE) return { left: rect.right + PAD + GAP, top: clampY(midY) };
  if (rect.left - PAD - GAP >= bw + EDGE) return { left: rect.left - PAD - GAP - bw, top: clampY(midY) };
  return { left: clampX(rect.right - bw), top: clampY(vh - bh - EDGE) };
}

const same = (a, b) => a && b && Object.keys(a).every((k) => Math.abs(a[k] - b[k]) < 0.5);

export function Tour() {
  const { run, finish, skip } = useTour();
  const [list, setList] = useState([]);
  const [index, setIndex] = useState(0);
  const [moving, setMoving] = useState(false);
  const opener = useRef(null);

  // The steps this person can see right now, worked out when the tour starts.
  useEffect(() => {
    if (!run) return;
    opener.current = document.activeElement;
    setIndex(0);
    setList(run.steps.filter((s) => !s.target || findTarget(s.target)));
  }, [run]);
  useEffect(() => {
    if (run) return;
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    opener.current = null;
  }, [run]);

  const step = run ? list[index] : null;
  const isLast = index === list.length - 1;
  const next = useCallback(() => (isLast ? finish() : setIndex((i) => i + 1)), [isLast, finish]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Nothing to show for this person: count it as seen.
  useEffect(() => { if (run && list.length === 0 && run.steps.every((s) => s.target && !findTarget(s.target))) finish(); }, [run, list, finish]);

  // Bring the target into view, then let the spotlight and card glide to it.
  useEffect(() => {
    if (!step) return undefined;
    const el = findTarget(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 64 || r.bottom > innerHeight - 80) el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    }
    setMoving(true);
    const t = setTimeout(() => setMoving(false), 420);
    return () => clearTimeout(t);
  }, [step]);

  // Follow the target every frame: scrolling, resizing and panels opening all move it.
  const cardRef = useRef(null);
  const [geo, setGeo] = useState(null);
  useLayoutEffect(() => {
    if (!step) { setGeo(null); return undefined; }
    let raf = 0;
    const tick = () => {
      const vw = innerWidth;
      const vh = innerHeight;
      const r = findTarget(step.target)?.getBoundingClientRect() || null;
      const c = cardRef.current;
      const phone = vw < PHONE;
      const box = r && { left: Math.max(r.left, PAD), top: Math.max(r.top, PAD), right: Math.min(r.right, vw - PAD), bottom: Math.min(r.bottom, vh - PAD) };
      if (box) { box.width = box.right - box.left; box.height = box.bottom - box.top; }
      const spot = box ? { x: box.left - PAD, y: box.top - PAD, w: box.width + PAD * 2, h: box.height + PAD * 2 } : { x: vw / 2, y: vh / 2, w: 0, h: 0 };
      const pos = phone || !c ? { left: 0, top: 0 } : place(box, c.offsetWidth, c.offsetHeight, vw, vh);
      const g = { ...spot, left: pos.left, top: pos.top, phone: phone ? 1 : 0, none: r ? 0 : 1 };
      setGeo((old) => (same(old, g) ? old : g));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // Keys: arrows move, Esc skips, Tab stays inside the card. Caught first, so nothing underneath reacts.
  useEffect(() => {
    if (!run) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); skip(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'Tab' && cardRef.current) {
        const f = [...cardRef.current.querySelectorAll('button')];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [run, next, back, skip]);

  // Focus lands on Next (or Done) each step, so Enter moves on.
  const nextRef = useRef(null);
  useEffect(() => { if (step) nextRef.current?.focus({ preventScroll: true }); }, [step]);

  if (!run || !step) return null;
  const phone = geo?.phone === 1;
  return createPortal(
    <div className={`tour${moving ? ' is-moving' : ''}`}>
      <div className="tour-block" aria-hidden="true" />
      {geo && <div className={`tour-spot${geo.none ? ' is-none' : ''}`} aria-hidden="true" style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h }} />}
      <div
        ref={cardRef}
        className={`tour-card${phone ? ' is-sheet' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={phone || !geo ? undefined : { left: geo.left, top: geo.top }}
      >
        <div key={`${run.id}-${index}`} className="tour-content">
          <h2 id="tour-title" className="tour-title">{step.title}</h2>
          <p id="tour-body" className="tour-body">{step.body}</p>
        </div>
        <div className="tour-foot">
          {list.length > 1 && (
            <span className="tour-count" aria-label={`Step ${index + 1} of ${list.length}`}>
              <span className="tour-dots" aria-hidden="true">{list.map((s, i) => <span key={i} className={`tour-dot${i === index ? ' is-on' : ''}`} />)}</span>
              <span aria-hidden="true">{index + 1} of {list.length}</span>
            </span>
          )}
          <div className="tour-actions">
            {!isLast && <button type="button" className="tour-skip" onClick={skip}>Skip</button>}
            {index > 0 && <button type="button" className="btn btn-plain btn-sm" onClick={back}>Back</button>}
            <button ref={nextRef} type="button" className="btn btn-primary btn-sm" onClick={next}>{isLast ? 'Done' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
