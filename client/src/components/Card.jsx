export default function Card({ children, hover = false, className = '', ...rest }) {
  const cls = ['card', hover && 'card-hover', className].filter(Boolean).join(' ');
  return <div className={cls} {...rest}>{children}</div>;
}
