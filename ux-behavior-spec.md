# UX and Behavior Spec (motion, interaction, feedback)

Standing design rule for any app built in this project. It defines **how things move, respond and behave**, not how they look. Colors, fonts, spacing, layout and brand are out of scope: pick those per project. Everything here comes from the Sesame Production Tracker (v0.1.38 on main, plus the 0.1.39 filter rules), where each rule was asked for or approved by DswK.

## How to use this file (instructions for Claude)

- Treat every rule below as a requirement for new UI, unless the person asks otherwise in that project.
- When you add a component, give it motion from this spec. **No section should feel static.** A new bar, chart, list row, tooltip, panel, toggle or headline number gets the matching pattern below.
- Use the shared tokens and classes (section 1). Do not invent new easings or one-off durations.
- Every animation has a `prefers-reduced-motion: reduce` fallback (section 9). No exceptions.
- When a rule here conflicts with what the person says in a thread, the person wins. Write the new rule back into this file.

---

## 1. Motion tokens

One easing family, short durations. Use these names in CSS or JS.

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Default for almost everything: enters, hovers, presses, reveals |
| `--ease-slide` | `cubic-bezier(0.32, 0.72, 0, 1)` | Things that travel a distance: sliding toggle pill, side drawer |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Leaving: panels, sheets, scrims (accelerate away, no bounce) |
| `--ease-loop` | `cubic-bezier(0.45, 0, 0.55, 1)` | Looping "working" indicators (pulses, chasing dots) |
| `--spring` | `linear(0, 0.07, 0.228, 0.417, 0.6, 0.757, 0.878, 0.964, 1.018, 1.048, 1.059, 1.058, 1.05, 1.039, 1.028, 1.018, 1.01, 1.004, 1, 0.998, 0.997, 0.997, 0.997, 0.997, 1)` | Glass panels, sheets, badges, a pill turning on. About 6% overshoot, then settles |
| JS ease-out | `t => 1 - (1 - t) ** 3` | Number count-ups (requestAnimationFrame) |

Duration scale (ms):

| Duration | Use |
|---|---|
| 120-160 | Press scale, tooltip fade (140), menu pop (160), menu rows (160), icon swap (160) |
| 180 | Every exit (toasts, inline notes, fades). Exits are faster than enters |
| 200-260 | Hover washes (200), view enter (240), toast enter (240), row enter (260), crossfade (260) |
| 300 | Collapse/expand by height, drawer slide, scrim fade |
| 350 | Sliding segmented pill |
| 420-560 | Spring moves: badge (420), panel open (520), phone sheet (560) |
| 700 | Bar and chart reveals |
| 900 | Count-up of a headline number |

Principles behind the numbers:

1. **Answer immediately.** Feedback starts on the same frame as the input (press scale, colour change). Never delay feedback to wait for data.
2. **Enter softly, leave fast.** Enter with `--ease-out` or `--spring`; exit at about 60-70% of the enter time with `--ease-exit`, no overshoot.
3. **Small distances.** Enters move 2-8px (or scale from 0.9-0.97). Large travel only for things that really come from somewhere (drawer from the edge, sheet from the bottom, panel out of its icon).
4. **Grow from the source.** A popover's `transform-origin` is the control that opened it.
5. **State changes are instant; decoration eases.** An on/off colour switches at once (an eased colour left two pills half-lit together, which read as a blink). The hover wash and the "pop" on top of it are what animate.
6. **Motion follows meaning.** Bars grow from their baseline; numbers count from their last value; a list row joining a list fades up into place.

---

## 2. Entrance patterns

| Class | What it does | Spec |
|---|---|---|
| `.view-enter` | A page, tab view or filter bar appearing | opacity 0, translateY(6px) to rest, 240ms `--ease-out` |
| `.fade-up` + `.fade-delay-1..4` | Hero or landing blocks, staggered | translateY(20px), 600ms `cubic-bezier(0.16,1,0.3,1)`, 100ms steps |
| `.reveal-x` | Horizontal bar grows left to right | `clip-path: inset(0 100% 0 0)` to `inset(0)`, 700ms `--ease-out` |
| `.reveal-x-end` | Bar anchored right (e.g. left side of a butterfly chart) | `inset(0 0 0 100%)` to `inset(0)`, 700ms |
| `.reveal-y` | Vertical bar / column chart grows up | `inset(100% 0 0 0)` to `inset(0)`, 700ms |
| `.chart-in` | Chart swapped in by a toggle | fade 260ms + reveal-x 700ms together |
| `.swap-in` | Content crossfade when a toggle changes it | opacity, 260ms |
| `.rows-in > tr`, `.row-in` | Table rows / list items / chips joining a list | opacity 0, translateY(4px), 260ms |
| `.tip-in` | Tooltip | opacity only, 140ms (tooltips never move) |
| `.menu-pop` | Small dropdown menu | translateY(-4px) scale(0.97), 160ms, origin top-right |
| `.status-line` | A status text that just changed | translateY(2px) fade, 240ms; key the element on its text so it replays on change |

Use `clip-path` for reveals, not width or scaleX: the bar's text and rounded ends are not distorted, and the layout does not shift.

### Count-up numbers (`CountUp`)

- Headline numbers count up: from 0 the first time, then **from the last shown value** when data changes (never back to 0 on refresh).
- 900ms, cubic ease-out, driven by requestAnimationFrame.
- Keep prefix and suffix fixed (`$`, `%`, `h`, `K`), and keep the target's decimals and thousands separators on every frame. Use tabular numerals so width does not jitter.
- A number below the fold starts counting when it scrolls into view (IntersectionObserver, once).
- Screen readers get the final value only (animated digits `aria-hidden`, real value in an `sr-only` span).
- Non-numeric values and composed elements render as they are, never as `[object Object]`.
- Reduced motion: show the final value at once.

---

## 3. Toggles, tabs and views

### Segmented control (sliding pill)

- One highlight pill sits behind the active option and **slides** to the new one: transform + width + height, 350ms `--ease-slide`.
- Measure the active button (`offsetLeft/Top/Width/Height`), re-measure on resize (ResizeObserver).
- **No slide on first paint**: the pill just appears under the current option.
- Text colour of options eases 200ms; the pill itself carries the "on" state.
- Use it for any mutually exclusive choice: date presets, chart kind, table layout, nav tabs.
- Buttons carry `aria-pressed`; the bar is `role="group"` with a label.

### Swipeable multi-view tiles

A tile with two or more views (for example "Progress" and "Pace"):

- Views sit side by side and move with `translateX`, 450ms `--ease-out`.
- Touch drag follows the finger with no transition. Direction locks after 8px of travel; only a horizontal lock captures the pointer, so vertical page scroll still works (`touch-action: pan-y`).
- Past the first or last view the drag gives only a quarter of the distance (rubber band).
- Release changes view when travel is over `min(80px, 20% of width)`; otherwise it springs back.
- Trackpad horizontal wheel also switches: accumulate `deltaX` past 60, then a 700ms cooldown.
- Mouse users get a view-switch control (one dot per view, the active one long, plus an arrow).
- Hidden views are `inert` and `aria-hidden`; each view is labelled "Name, 1 of 2".

### Collapse / expand

- Animate `grid-template-rows: 0fr` to `1fr` plus opacity, 300ms `--ease-out`. Never animate `height: auto` by hand.
- The closed content is `inert` so it cannot be tabbed into.

---

## 4. Hover and press language

"Clean, Apple-like." **Nothing underlines, anywhere**, including links on hover.

| Element | Hover | Press |
|---|---|---|
| Clickable row, number or tile (`.hit`) | Soft wash of its own text colour: `color-mix(in srgb, currentColor 7%, transparent)`, 200ms | — |
| Link inside a sentence (`.link`) | Tinted text, dims to 70% opacity, 150ms | — |
| Quiet link (`.link-quiet`) | Secondary text goes to primary | — |
| Buttons, chips, fields | Fill lifts one step lighter, 150-200ms | `scale: 0.97`, 150ms `--ease-out` |
| Icon buttons in a nav | Fill lifts, text brightens | `scale: 0.95` |
| Big cards (launcher tiles) | Lift `translateY(-4px)` + deeper shadow, 300ms | `translateY(-2px) scale(0.995)` |
| Table rows, menu items, large surfaces | Colour change only | **No scale** (shrinking big things reads as a wobble) |
| Selected filter row on a tile (`.focus-on`) | 10% wash + a 6px soft ring in its own colour | `scale: 0.99` |

Rules:

- Hover styles only apply under `@media (hover: hover) and (pointer: fine)`, so a tap on a phone never leaves a hover stuck on.
- Use `scale` (the individual property), not `transform: scale()`, for press, so it stacks with any transform the element already has. Include `scale` in the default transition-property list so it eases both ways.
- Remove the mobile tap highlight (`-webkit-tap-highlight-color: transparent`); the press scale replaces it.
- Keyboard focus: a 2px `:focus-visible` outline with 2px offset, in currentColor on washes. Never remove focus rings.
- Disabled controls: 45% opacity, `not-allowed` cursor, no hover or press response.
- Edit-mode controls on tiles appear on hover or focus-within (150ms fade); on touch screens (`hover: none`) they are always visible.
- A tile being dragged stays in place as a 35% opacity placeholder while others slide around it.

---

## 5. Popovers, glass panels and sheets

The filter menu is the reference ("liquid glass"):

**Open (desktop popover)**
- Grows out of its trigger icon: `transform-origin` at the icon's corner.
- From `scale(0.18, 0.08)`, fully rounded, `blur(6px)`, to rest; 520ms `--spring` (blur clears by 60%). Opacity fades in separately over 200ms `--ease-out`.
- Its rows follow a beat behind: each row fades from `translateY(-6px) blur(2px)`, 420ms `--ease-out`, delay `60ms + index * 35ms`.

**Close**
- 200ms `--ease-exit` to `opacity 0, scale(0.6, 0.4), blur(4px)`. No bounce.
- Use a presence state machine: `closed -> open -> closing -> closed`. The element stays mounted during `closing` and unmounts on `animationend`. Under reduced motion it goes straight to `closed`.

**Phones (under 640px)**
- The same panel becomes a **bottom sheet**: fixed, 8px from the edges, respects `safe-area-inset-bottom`, grab handle on top, a full-width **Done** button at the bottom.
- Rises from `translateY(105%) scale(0.96)` on 560ms `--spring`; leaves to `translateY(105%)` in 220ms `--ease-exit`.
- A scrim behind it (40% black) fades in 260ms and out 200ms; tapping the scrim closes.
- Content scrolls inside, capped at 58vh.

**Behaviour (all sizes)**
- Escape, a press outside (pointerdown on document), the close button or Done closes it.
- Focus moves into the panel once it is on screen (next animation frame), Tab is trapped inside while open, and focus returns to the trigger on close (except when closed by an outside press).
- Trigger has `aria-expanded`, `aria-controls`, `aria-haspopup="dialog"`, and an aria-label that includes the active count ("Filters, 3 on").
- The trigger shows a count badge when anything is active; the badge pops in on `--spring` (scale 0.4 to 1, 420ms) and re-pops when the count changes (key it on the count).

**Side drawer (record details)**
- Slides in from the right edge, 300ms `--ease-slide`; backdrop fades 300ms.
- Keeps showing the last record while it slides out, then unmounts.
- Escape closes; focus moves in once it is mounted.

---

## 6. Filtering

**Model**
- Filters are groups of options (for example Status, Pipeline, Site, Group size).
- **Multi-select inside a group = OR** (widens). **Across groups = AND** (narrows). Completed + Cancelled + Site A means "completed or cancelled, at Site A".
- Pressing a lit option turns it off. Each group has its own **Clear** (shown only when the group has picks); the panel has **Clear all**.
- One filter state per page session, **shared by every tab**. The toolbar menu and any in-page shortcut (clicking a number or row on a dashboard tile) read and write the **same** picks, so each shows what the other picked.
- Each pick remembers where it came from (`from: 'menu'` or a tile id).

**Tiles that filter in place**
- Clicking a number or row on a dashboard tile toggles that pick; every *other* tile narrows to it.
- The tile that made the pick keeps showing its full breakdown (it skips its own picks), with the picked row highlighted (`.focus-on`), so the choice stays in context. Click again to clear. Tooltip says "filters this page" / "click again to clear".
- Off the dashboard the same element is a plain link to the matching list.

**"Showing" chips**
- When anything is on, a bar under the toolbar reads `Showing:` followed by one chip per pick, each with its own ×. **Clear all** appears with two or more picks.
- On the dashboard it adds "picked on <tile name> · every other tile shows only these sessions".
- When the filter maps to one list elsewhere, it offers "Open in <tab>" with the filter carried in the URL.
- The bar enters with `.view-enter`; chips enter with `.row-in`.

**Responsiveness**
- The menu's pills update instantly. The page recomputes from a **deferred copy** of the filter (React `useDeferredValue`), so a heavy re-filter never delays the pill. Same for search: typing is instant, results follow.
- The pill's on/off colour switches with **no transition**; only its press scale eases, plus a one-time `--spring` pop (scale 0.92 to 1, 360ms) and a check mark that pops in (260ms).

---

## 7. Sync, loading and status feedback

**Cache, then refresh**
- On load, show the server's cached copy immediately. If it is older than about a minute, show it **and** run a fresh read behind it; swap in the new data when it lands. Say so: "Showing the 2:41 PM copy · refreshing".
- A manual "Sync" waits for a fresh read.
- The first quiet load never shows an error; a manual sync reports errors.
- If the refresh fails, keep the old copy on screen and say "refresh failed" with the reason in the tooltip. Never blank the screen on a failed refresh.

**Sync button**
- While working, the icon crossfades (200ms, opacity + scale 0.6) to a **four-dot chasing glyph**: each dot pulses opacity 0.25 to 1 and scale 0.7 to 1 over 1.2s `--ease-loop`, staggered 0.3s.
- Label reads "Syncing" with a running seconds count, timed from a fixed start (`performance.now()`, checked every 250ms) so it never drifts.
- The button stays at full strength while busy (only the click is blocked, cursor `progress`), so the motion is readable. Then it settles back ("Sync again" / Live).

**Per-source status line**
- One line per upstream source, each with a dot and a short detail: `loaded` (filled dot + count), `empty` (ring, "Nothing sent"), `failed` (error dot, red text), `loading` (dot breathing 1.2s), `waiting` (dim dot, "After SharePoint").
- Dependent sources say what they wait for. Dot colour changes ease 300ms; detail text replays `.status-line` when it changes.
- Summary first: "Loading · 2 of 4 in", then "Fully loaded · 3:05 PM" with a check, or "Loaded, 1 source failed · 3:05 PM". The timestamp is there so a screenshot shows when the data was complete.
- Tooltips carry the detail (hop-by-hop timings, the error text, where the data came from).
- `role="status"` + `aria-live="polite"`.
- Phones show the summary plus one dot per source; a "…" button expands the per-source lines (Collapse, 300ms).

**Saving and inline notes**
- After an edit: an inline "Saved: <value>" note with an **Undo** link, fading in and out in place (180ms, no slide).
- **Nobody waits on a save** (Lotus, 2026-11-06). Sheets close and the change shows at once; the work runs in the background while people keep navigating. The header sync button shows the four-dot glyph with "Saving N…" (or the one job's own words, like "Approving 37 days · 9 of 37…") and stays clickable. A failure is a toast that says what didn't save and why. Things that only count once the server confirms them (approvals) say "Approving…" on their row until then. Closing the tab mid-save asks first.

---

## 8. Notifications

- Toasts and notices **auto-close after 6 seconds** (`TOAST_MS = 6000`).
- The timer **pauses** while the pointer is over the notification or focus is inside it, and restarts from a full 6s after.
- They leave the way they came in: enter 240ms (`translateY(8px)` fade) or from the side for corner notices (260ms, `translateX(16px)`); exit 180ms reversed.
- Mark "leaving" first, play the exit, then unmount (exit length matches the CSS). Under reduced motion it unmounts immediately.
- The same message shown again later gets its full 6 seconds.
- Every notification can be dismissed by hand.

### 8a. "A new version of Lotus is ready"

The one notice that doesn't auto-close. When a newer build is live (version.json, checked every 5 minutes and when the tab comes back), it shows a **10-second countdown** and then refreshes the page to the new build.

- **Refresh now** refreshes at once. **Not now** closes it for that version; Settings keeps a "Refresh to update" row.
- The countdown **holds** while the pointer is over the notice or focus is inside it.
- It **waits** (and starts the full 10 seconds again once quiet) while anything is being sent (a save, approval, email, import or clock-in), while a sheet, dialog or tour is open, or while someone is typing in a field (a focused, empty field like the sign-in box doesn't count). The text says why: "once your changes are saved" or "when you're done here". Queued edits that are only waiting are kept in the browser and survive the refresh, so they don't hold it.
- A tab in the background refreshes as soon as it's quiet, so it's on the new build when the person comes back.
- Screen readers hear it once; the ticking seconds aren't announced. Reduced motion: no enter or exit movement.

---

## 9. Reduced motion

Under `@media (prefers-reduced-motion: reduce)`:

- Reveals, row enters, crossfades, tooltips, menu pops, toasts: **no animation**, content appears in place.
- Count-ups show the final value at once.
- Sliding pill: no transition. Swipe views: no transition (drag still works).
- Glass panel / sheet: a plain 120ms opacity fade, no scale, blur or spring; rows, badge and pill pops off.
- Press scale off. Looping indicators (chasing dots, breathing dots, pulses) hold still at a readable opacity.
- Icon swaps become a 120-150ms linear fade.
- JS timers that wait for an exit animation use 0ms.

---

## 10. Responsive behaviour

**Fit scaling (desktop and laptop)**
- The UI is designed for **1536 x 864** (a 15-16" laptop at default scaling).
- On smaller windows the whole UI scales through the root font size: `scale = clamp(0.8, min(width/1536, height/864), 1)`, rounded to 3 decimals, applied as `html { font-size: 16px * scale }` and exposed as `--fit`. It never scales above 1.
- So spacing and type must be in `rem`. The few 10-11px micro-labels stay fixed px so they never shrink further.
- Recompute on resize, throttled with requestAnimationFrame.
- An app framed inside a host page sizes by the **top window** (when same-origin), so it matches the host instead of shrinking twice.

**Phones**
- Under 640px: popovers become bottom sheets (section 5); secondary status lines fold behind a "…" button; dashboards stack tiles full width (from 768px tiles use their saved column spans).
- Touch targets at least 44px. Hover-only controls are always visible on touch screens.
- Horizontal swipes only capture after a clear horizontal lock, so vertical scrolling is never hijacked.
- Respect safe-area insets on anything fixed to an edge.

---

## 11. Accessibility checklist for any new component

- Real buttons for actions (`type="button"`), links for navigation.
- Toggles use `aria-pressed`; disclosures use `aria-expanded`; live status uses `role="status"` + `aria-live="polite"`.
- Hidden or off-screen content is `inert`.
- Escape closes anything that opened; focus returns to what opened it.
- Animated numbers expose their final value to screen readers.
- Everything works with the keyboard and with reduced motion on.

---

## 12. Quick reference CSS (motion only)

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-slide: cubic-bezier(0.32, 0.72, 0, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --ease-loop: cubic-bezier(0.45, 0, 0.55, 1);
  --spring: linear(0, 0.07, 0.228, 0.417, 0.6, 0.757, 0.878, 0.964, 1.018, 1.048, 1.059, 1.058, 1.05, 1.039, 1.028, 1.018, 1.01, 1.004, 1, 0.998, 0.997, 0.997, 0.997, 0.997, 1);
}

a, a:hover, button, button:hover { text-decoration: none; }

button, [role='button'], [role='tab'], .chip {
  transition-property: scale; transition-duration: 150ms; transition-timing-function: var(--ease-out);
  -webkit-tap-highlight-color: transparent;
}
button:active:not(:disabled), [role='button']:active, [role='tab']:active { scale: 0.97; }
tr:active, [role='menuitem']:active { scale: none; }

.hit { border-radius: 0.75rem; cursor: pointer; transition: background-color 200ms var(--ease-out); }
@media (hover: hover) and (pointer: fine) {
  .hit:hover { background-color: color-mix(in srgb, currentColor 7%, transparent); }
}

.view-enter { animation: viewEnter 240ms var(--ease-out) both; }
.reveal-x   { animation: revealX 700ms var(--ease-out) both; }
.reveal-x-end { animation: revealXEnd 700ms var(--ease-out) both; }
.reveal-y   { animation: revealY 700ms var(--ease-out) both; }
.rows-in > tr, .row-in { animation: rowIn 260ms var(--ease-out) both; }
.swap-in    { animation: fade 260ms var(--ease-out) both; }
.chart-in   { animation: fade 260ms var(--ease-out) both, revealX 700ms var(--ease-out) both; }
.tip-in     { animation: fade 140ms var(--ease-out) both; }
.fade-out   { animation: fadeOut 180ms var(--ease-out) both; }

@keyframes viewEnter { from { opacity: 0; transform: translateY(6px); } }
@keyframes rowIn { from { opacity: 0; transform: translateY(4px); } }
@keyframes fade { from { opacity: 0; } }
@keyframes fadeOut { to { opacity: 0; } }
@keyframes revealX { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0); } }
@keyframes revealXEnd { from { clip-path: inset(0 0 0 100%); } to { clip-path: inset(0); } }
@keyframes revealY { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0); } }

@media (prefers-reduced-motion: reduce) {
  .view-enter, .reveal-x, .reveal-x-end, .reveal-y, .rows-in > tr, .row-in,
  .swap-in, .chart-in, .tip-in, .fade-out { animation: none; }
  button:active, [role='button']:active, [role='tab']:active { scale: none; }
}
```

Source of truth: `RR-Centific/Sesame-Tracker`, `prod-tracker/src/index.css`, `components/ui.jsx` (CountUp, Segmented, useSlidingPill, Collapse, useAutoDismiss), `components/views.jsx` (SwipeViews), `components/FilterMenu.jsx`, `components/FilterBar.jsx`, `components/focus.jsx`, `components/Toolbar.jsx`, `lib/pageFilter.js`, `lib/sources.js`, `lib/fit.js`.
