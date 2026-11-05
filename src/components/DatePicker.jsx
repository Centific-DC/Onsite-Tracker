import { useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import clsx from 'clsx';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, dayKey, parseDay } from '../lib/time.js';

// The app's own date picker (in place of the browser's): the field shows the date
// in words; the calendar opens in the same soft raised popup as the dropdowns.
// value and onChange use 'YYYY-MM-DD'. min/max limit the days that can be picked.
// Keyboard: arrows move a day or a week, Page Up/Down a month, Home/End the week,
// Enter picks, Esc closes.
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d, n) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
};
const label = (k) => parseDay(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const fullLabel = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export function DatePicker({ value, onChange, min, max, disabled, label: aria, placeholder = 'Pick a date', className }) {
  const [open, setOpen] = useState(false);
  const today = dayKey(new Date());
  const [focus, setFocus] = useState(() => value || today);
  const grid = useRef(null);
  const inRange = (k) => (!min || k >= min) && (!max || k <= max);
  const clamp = (k) => (min && k < min ? min : max && k > max ? max : k);

  const onOpenChange = (o) => {
    if (o) setFocus(clamp(value || today));
    setOpen(o);
  };
  const pick = (k) => {
    if (!inRange(k)) return;
    onChange(k);
    setOpen(false);
  };
  // Moving focus to a day in another month turns the page.
  const moveTo = (k) => {
    setFocus(k);
    requestAnimationFrame(() => grid.current?.querySelector(`[data-day="${k}"]`)?.focus());
  };

  const focusDate = parseDay(focus);
  const first = monthStart(focusDate);
  const days = useMemo(() => {
    const start = addDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [first.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  // Always six rows, so the popup keeps its size from month to month.
  const rows = 6;

  const onKey = (e) => {
    const d = parseDay(focus);
    const step = {
      ArrowLeft: () => addDays(d, -1), ArrowRight: () => addDays(d, 1),
      ArrowUp: () => addDays(d, -7), ArrowDown: () => addDays(d, 7),
      PageUp: () => addMonths(d, e.shiftKey ? -12 : -1), PageDown: () => addMonths(d, e.shiftKey ? 12 : 1),
      Home: () => addDays(d, -d.getDay()), End: () => addDays(d, 6 - d.getDay()),
    }[e.key];
    if (step) { e.preventDefault(); moveTo(dayKey(step())); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(focus); }
  };
  const turn = (n) => setFocus(dayKey(addMonths(focusDate, n)));

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Popover.Trigger
        className={clsx('sel sel-field date-field', className)}
        disabled={disabled}
        aria-label={aria ? `${aria}: ${value ? fullLabel(parseDay(value)) : 'not set'}` : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={clsx('sel-value', !value && 'is-placeholder')}>{value ? label(value) : placeholder}</span>
        <span className="sel-icon"><CalendarDays size={15} aria-hidden="true" /></span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="sel-pos" sideOffset={6} align="end">
          <Popover.Popup
            className="sel-pop cal-pop"
            aria-label={aria ? `Choose ${aria.toLowerCase()}` : 'Choose a date'}
            initialFocus={() => grid.current?.querySelector('[tabindex="0"]') || true}
            // Esc closes just the calendar, not the sheet it sits in.
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
          >
            <div className="cal-head">
              <span className="cal-month" aria-live="polite">{focusDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
              <button type="button" className="cal-nav" aria-label="Previous month" onClick={() => turn(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
              <button type="button" className="cal-nav" aria-label="Next month" onClick={() => turn(1)}><ChevronRight size={16} aria-hidden="true" /></button>
            </div>
            <div className="cal-grid" role="grid" ref={grid} onKeyDown={onKey}>
              <div className="cal-row" role="row">
                {WEEKDAYS.map((w, i) => <span key={WEEKDAY_NAMES[i]} className="cal-wd" role="columnheader" aria-label={WEEKDAY_NAMES[i]}>{w}</span>)}
              </div>
              {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="cal-row" role="row">
                  {days.slice(r * 7, r * 7 + 7).map((d, i) => {
                    const k = dayKey(d);
                    const ok = inRange(k);
                    return (
                      // Keyed by place in the grid, so turning the month keeps the
                      // focused button and focus never drops out of the calendar.
                      <button
                        key={r * 7 + i}
                        type="button"
                        role="gridcell"
                        data-day={k}
                        tabIndex={k === focus ? 0 : -1}
                        aria-selected={k === value}
                        aria-disabled={!ok || undefined}
                        aria-current={k === today ? 'date' : undefined}
                        aria-label={fullLabel(d)}
                        className={clsx('cal-day', d.getMonth() !== first.getMonth() && 'is-out', k === today && 'is-today', k === value && 'is-picked')}
                        onClick={() => pick(k)}
                        onFocus={() => k !== focus && setFocus(k)}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="cal-foot">
              <button type="button" className="link" disabled={!inRange(today)} onClick={() => pick(today)}>Today</button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
