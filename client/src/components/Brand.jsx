import { Link } from 'react-router-dom';

export default function Brand({ to = '/folio' }) {
  return (
    <Link to={to} className="brand" aria-label="Latitude home">
      <span className="brand-mark">L</span>atitude<span className="brand-dot" />
    </Link>
  );
}
