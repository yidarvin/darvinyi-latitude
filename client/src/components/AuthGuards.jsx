import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import LoadingDot from './LoadingDot.jsx';

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingDot />;
  if (!user) return <Navigate to="/setup" replace />;
  return children;
}

export function RedirectIfAuthed({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingDot />;
  if (user) return <Navigate to="/folio" replace />;
  return children;
}
