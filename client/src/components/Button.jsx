export default function Button({
  children,
  variant = 'primary',
  arrow = false,
  className = '',
  ...rest
}) {
  const cls = ['btn', variant === 'ghost' && 'btn-ghost', className]
    .filter(Boolean).join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
      {arrow && <span className="btn-arrow">{arrow === true ? '→' : arrow}</span>}
    </button>
  );
}
