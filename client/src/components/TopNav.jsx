import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import Brand from './Brand.jsx';

export default function TopNav() {
  const { user } = useAuth();
  if (!user) return null;

  const initial = user.email?.[0]?.toUpperCase() || '?';

  return (
    <header className="topnav">
      <Brand />
      <nav className="nav-links">
        <NavLink to="/folio" className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
          Folio
        </NavLink>
        <NavLink to="/brief" className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
          New Walk
        </NavLink>
        <NavLink to="/account" className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
          Account
        </NavLink>
      </nav>
      <div className="nav-account">
        <span>{user.email}</span>
        <div className="avatar">{initial}</div>
      </div>
    </header>
  );
}
