import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth.jsx';
import { RequireAuth, RedirectIfAuthed } from './components/AuthGuards.jsx';

import Setup from './routes/Setup.jsx';
import Folio from './routes/Folio.jsx';
import Brief from './routes/Brief.jsx';
import Dialogue from './routes/Dialogue.jsx';
import Plan from './routes/Plan.jsx';
import WalkReview from './routes/WalkReview.jsx';
import Account from './routes/Account.jsx';

import './styles/global.css';
import './styles/components.css';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/folio" replace />} />
        <Route path="/setup"            element={<RedirectIfAuthed><Setup /></RedirectIfAuthed>} />
        <Route path="/folio"            element={<RequireAuth><Folio /></RequireAuth>} />
        <Route path="/brief"            element={<RequireAuth><Brief /></RequireAuth>} />
        <Route path="/dialogue/:id"     element={<RequireAuth><Dialogue /></RequireAuth>} />
        <Route path="/folio/walks/:id"  element={<RequireAuth><WalkReview /></RequireAuth>} />
        <Route path="/account"          element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="*"                 element={<Navigate to="/folio" replace />} />
      </Routes>
    </AuthProvider>
  );
}
