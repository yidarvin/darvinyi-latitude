import { forwardRef } from 'react';

export const Input = forwardRef(function Input(
  { label, aux, hint, error, className = '', ...rest }, ref
) {
  return (
    <div className={`form-row ${className}`}>
      {label && (
        <label className="form-label">
          {label}
          {aux && <span className="form-label-aux">— {aux}</span>}
        </label>
      )}
      <input ref={ref} className="form-input" {...rest} />
      {hint && <div className="form-hint">{hint}</div>}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, aux, hint, error, className = '', ...rest }, ref
) {
  return (
    <div className={`form-row ${className}`}>
      {label && (
        <label className="form-label">
          {label}
          {aux && <span className="form-label-aux">— {aux}</span>}
        </label>
      )}
      <textarea ref={ref} className="form-input" {...rest} />
      {hint && <div className="form-hint">{hint}</div>}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
});

export function Select({ label, aux, hint, children, className = '', ...rest }) {
  return (
    <div className={`form-row ${className}`}>
      {label && (
        <label className="form-label">
          {label}
          {aux && <span className="form-label-aux">— {aux}</span>}
        </label>
      )}
      <select className="form-input" {...rest}>{children}</select>
      {hint && <div className="form-hint">{hint}</div>}
    </div>
  );
}
