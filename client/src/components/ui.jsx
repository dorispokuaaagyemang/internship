import { useId } from 'react';

// Small shared building blocks. Every field has a visible label and announces its error,
// so the forms work with a keyboard and a screen reader (US-02: missing fields highlighted).

export function Field({ label, error, hint, children, id: givenId }) {
  const generated = useId();
  const id = givenId ?? generated;
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint && !error && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Button({ variant = 'primary', busy = false, children, ...props }) {
  return (
    <button className={`btn btn--${variant}`} disabled={busy || props.disabled} aria-busy={busy || undefined} {...props}>
      {busy ? 'Please wait…' : children}
    </button>
  );
}

export function Alert({ tone = 'error', children }) {
  if (!children) return null;
  return (
    <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function PageLoading() {
  return (
    <main className="page page--center" aria-busy="true">
      <p className="muted">Loading…</p>
    </main>
  );
}

export function Card({ title, children, actions }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__header">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

// "shortlisted" -> "Shortlisted", as US-07 names the statuses.
export function StatusBadge({ status }) {
  const label = String(status).replace(/_/g, ' ');
  return <span className={`badge badge--${status}`}>{label.charAt(0).toUpperCase() + label.slice(1)}</span>;
}
