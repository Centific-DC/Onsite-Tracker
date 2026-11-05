import clsx from 'clsx';

// The operator page's soft (neumorphic) building blocks: raised cards, sunken
// wells, pills, a progress bar and the clock dial. Styles live in operator.css,
// and the rest of the app picks up the same tokens through soft.css.

export const Label = ({ children, className, ...rest }) => <div className={clsx('op-label', className)} {...rest}>{children}</div>;

export const Card = ({ children, className, ...rest }) => <section className={clsx('op-card', className)} {...rest}>{children}</section>;

export const Well = ({ children, className, ...rest }) => <div className={clsx('op-well', className)} {...rest}>{children}</div>;

export function Pill({ inset, tone, children, className, ...rest }) {
  return <span className={clsx(inset ? 'op-pill-in' : 'op-pill', tone && `is-${tone}`, className)} {...rest}>{children}</span>;
}

// A sunken track with a raised fill. `value` 0..1; anything over 1 is clipped.
export function Bar({ value, tone = 'coral', label }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className="op-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <div className={clsx('op-bar-fill', `is-${tone}`)} style={{ '--v': v }} />
    </div>
  );
}

// A row with a small sunken icon chip.
export const Detail = ({ icon, children }) => (
  <div className="op-detail">
    <span className="op-detail-icon" aria-hidden="true">{icon}</span>
    <span>{children}</span>
  </div>
);

// The dial: a sunken ring with a coloured sweep (`value` 0..1) around a raised
// plate. The plate is the button when `onClick` is given.
export function Dial({ value = 0, tone = 'green', onClick, label, disabled, busy, children, className }) {
  const Plate = onClick ? 'button' : 'div';
  return (
    <div className={clsx('op-dial', `is-${tone}`, className)} style={{ '--sweep': `${Math.max(0, Math.min(1, value)) * 100}%` }}>
      <div className="op-dial-sweep" aria-hidden="true" />
      <Plate
        type={onClick ? 'button' : undefined}
        className={clsx('op-dial-plate', onClick && 'is-button')}
        onClick={onClick}
        aria-label={label}
        disabled={onClick ? disabled || busy : undefined}
        aria-busy={busy || undefined}
      >
        {children}
      </Plate>
    </div>
  );
}

// The large round Clock in button.
export function BigButton({ children, onClick, disabled, busy, label, tone = 'coral', className }) {
  return (
    <button type="button" className={clsx('op-big', `is-${tone}`, className)} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined} aria-label={label}>
      {children}
    </button>
  );
}
