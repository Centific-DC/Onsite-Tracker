import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { useCountUp } from '../lib/hooks.js';

// Headline number that counts from its last value. Screen readers get the final value.
export function Num({ value, format, className }) {
  const shown = useCountUp(value);
  return (
    <span className={clsx('num', className)}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

// Segmented control with one pill that slides to the active option (no slide on first paint).
export function Segmented({ label, options, value, onChange, size }) {
  const root = useRef(null);
  const [pill, setPill] = useState(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const place = () => {
      const b = root.current?.querySelector('[aria-pressed="true"]');
      if (b) setPill({ x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root.current);
    const id = requestAnimationFrame(() => setReady(true));
    return () => { ro.disconnect(); cancelAnimationFrame(id); };
  }, [value]);
  return (
    <div className={clsx('seg', size && `seg-${size}`)} role="group" aria-label={label} ref={root}>
      {pill && (
        <span
          className={clsx('seg-pill', ready && 'ready')}
          aria-hidden="true"
          style={{ width: pill.w, height: pill.h, transform: `translate(${pill.x}px, ${pill.y}px)` }}
        />
      )}
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Bottom sheet on phones, centred panel on larger screens.
export function Sheet({ open, onOpenChange, title, description, children, footer, className, initialFocus }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Popup className={clsx('sheet', className)} initialFocus={initialFocus}>
          <div className="sheet-grab" aria-hidden="true" />
          <div className="sheet-head">
            <Dialog.Title className="sheet-title">{title}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close"><X size={18} /></Dialog.Close>
          </div>
          {description && <Dialog.Description className="sheet-desc">{description}</Dialog.Description>}
          <div className="sheet-body">{children}</div>
          {footer && <div className="sheet-foot">{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Inset grouped list, iOS-style.
export function Group({ title, action, children, footer, className }) {
  return (
    <section className={clsx('group', className)}>
      {(title || action) && (
        <div className="group-head">
          {title && <h2 className="group-title">{title}</h2>}
          {action}
        </div>
      )}
      <div className="group-body">{children}</div>
      {footer && <p className="group-foot">{footer}</p>}
    </section>
  );
}

export function Row({ leading, title, subtitle, trailing, onClick, className, style }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={clsx('row', onClick && 'row-btn', className)} onClick={onClick} style={style}>
      {leading && <span className="row-lead">{leading}</span>}
      <span className="row-main">
        <span className="row-title">{title}</span>
        {subtitle && <span className="row-sub">{subtitle}</span>}
      </span>
      {trailing != null && <span className="row-trail">{trailing}</span>}
    </Tag>
  );
}

export function Avatar({ name, tone }) {
  const parts = name.split(/\s+/).filter(Boolean);
  const ini = parts.slice(0, 2).map((s) => s[0].toUpperCase()).join('');
  return <span className={clsx('avatar', tone && `avatar-${tone}`)} aria-hidden="true">{ini}</span>;
}

export function Tag({ tone, icon, children }) {
  return <span className={clsx('tag', `tag-${tone}`)}>{icon}{children}</span>;
}

// Status text that replays a small fade when its text changes.
export function StatusLine({ text, className, title }) {
  const [k, setK] = useState(0);
  const prev = useRef(text);
  useEffect(() => { if (prev.current !== text) { prev.current = text; setK((n) => n + 1); } }, [text]);
  return <span key={k} className={clsx('status-line', className)} title={title}>{text}</span>;
}
