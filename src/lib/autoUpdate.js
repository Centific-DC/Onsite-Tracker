// When a new build is live, Lotus refreshes itself after a 10-second countdown, but
// never in the middle of someone's work. Pure helpers; UpdateNotice.jsx runs them.

export const COUNTDOWN_S = 10;

// Why a refresh has to wait right now, or '' when it's safe. Queued edits that are
// only waiting are kept in this browser and survive a reload; anything being sent
// right now (a save, approval, email, import or clock-in) isn't, so it waits for that.
export function waitReason({ tasks = [], jobs = [] } = {}, doc = globalThis.document) {
  if (tasks.length || jobs.some((j) => j.state === 'sending')) return 'saving';
  if (!doc) return '';
  // A sheet, dialog or tour is open: there may be a half-filled form in it.
  if (doc.querySelector('[role="dialog"], [role="alertdialog"], .sheet, .tour')) return 'open';
  // Someone is typing: a focused text field with something in it. (An empty one, like
  // the sign-in box a lab laptop sits on, doesn't hold the refresh.)
  const el = doc.activeElement;
  if (el?.isContentEditable && el.textContent) return 'typing';
  if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && !['button', 'submit', 'checkbox', 'radio', 'range', 'color', 'file'].includes(el.type) && el.value) return 'typing';
  return '';
}

// One tick of the countdown: `left` seconds remain. Paused (hover, focus) or waiting
// (work in progress) holds it; once it's quiet again it starts over from the full 10.
export function nextLeft(left, { paused, waiting }) {
  if (waiting) return COUNTDOWN_S;
  if (paused) return left;
  return Math.max(0, left - 1);
}
