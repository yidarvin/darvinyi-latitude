import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as authApi from '../api/auth.js';
import * as walksApi from '../api/walks.js';
import TopNav from '../components/TopNav.jsx';
import Button from '../components/Button.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { Input } from '../components/Input.jsx';

// Which inline form (if any) is open in the right column — mutually
// exclusive so only one destructive/sensitive action is mid-flight at once.
const MODE = { NONE: null, ROTATE: 'rotate', DELETE_ACCOUNT: 'delete-account' };

export default function Account() {
  const { user, refresh, signOut, setUser } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState(MODE.NONE);
  const [newKey, setNewKey] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [totalWalks, setTotalWalks] = useState(null);
  const [confirmingRemoveKey, setConfirmingRemoveKey] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    walksApi.getFolioInsight()
      .then((res) => { if (!cancelled) setTotalWalks(res.stats.totalWalks); })
      .catch(() => { /* leave the placeholder dash — non-critical stat */ });
    return () => { cancelled = true; };
  }, []);

  const closeForm = () => { setMode(MODE.NONE); setNewKey(''); setDeletePassword(''); setError(null); };

  const handleRotate = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!newKey.startsWith('sk-ant-') || newKey.length < 20) {
      setError('API key must start with sk-ant- and be at least 20 characters');
      return;
    }
    setSubmitting(true);
    try {
      await authApi.rotateApiKey(newKey);
      closeForm();
      await refresh();
      setSuccess('API key rotated.');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err.message || 'Failed to rotate key');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmRemoveKey = async () => {
    setConfirmingRemoveKey(false);
    setRemovingKey(true);
    try {
      await authApi.removeApiKey();
      await refresh();
      setSuccess('API key removed. Add a new one any time to keep planning walks.');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err.message || 'Failed to remove key');
    } finally {
      setRemovingKey(false);
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    setError(null);
    if (!deletePassword) {
      setError('Enter your password to confirm');
      return;
    }
    setSubmitting(true);
    try {
      await authApi.deleteAccount(deletePassword);
      setUser(null);
      navigate('/setup', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to delete account');
      setSubmitting(false);
    }
  };

  if (!user) return null;

  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="app">
      <TopNav />

      <main>
      <div className="account-head">
        <div className="kicker">Your account</div>
        <h1 className="display-sm">Settings &amp; <em>API key.</em></h1>
      </div>

      <div className="account-grid">

        <div>
          <ul className="account-meta-list">
            <li>
              <span className="account-meta-label">Email</span>
              <span className="account-meta-value mono">{user.email}</span>
            </li>
            <li>
              <span className="account-meta-label">Member since</span>
              <span className="account-meta-value">{memberSince}</span>
            </li>
            <li>
              <span className="account-meta-label">Walks composed</span>
              <span className="account-meta-value mono">{totalWalks === null ? '—' : totalWalks}</span>
            </li>
            <li>
              <span className="account-meta-label">Anthropic key</span>
              <span className="account-meta-value mono">
                {user.apiKeyMasked || (user.hasApiKey === false ? '— none on file' : '— failed to load')}
              </span>
            </li>
          </ul>

          <div className="account-actions">
            {mode === MODE.NONE && (
              <>
                <Button variant="ghost" onClick={() => setMode(MODE.ROTATE)}>Rotate API key</Button>
                {user.hasApiKey !== false && (
                  <Button variant="ghost" onClick={() => setConfirmingRemoveKey(true)} disabled={removingKey}>
                    {removingKey ? 'Removing…' : 'Remove key'}
                  </Button>
                )}
                <Button variant="ghost" onClick={signOut}>Sign out</Button>
                <Button variant="ghost" className="btn-danger-ghost" onClick={() => setMode(MODE.DELETE_ACCOUNT)}>
                  Delete account
                </Button>
              </>
            )}
          </div>

          {success && (
            <div style={{ marginTop: 20, padding: '12px 16px', border: '1px solid var(--accent-line)', background: 'var(--accent-faint)', color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              ✓ {success}
            </div>
          )}
        </div>

        <div>
          {mode === MODE.ROTATE && (
            <form className="form-card" onSubmit={handleRotate}>
              <div className="form-card-label">ROTATE KEY</div>
              <p style={{ fontFamily: 'var(--serif)', fontSize: 15, color: 'var(--text-soft)', marginBottom: 20, lineHeight: 1.5 }}>
                Paste a new Anthropic API key. The old one will be discarded and overwritten.
              </p>
              <Input
                label="New API Key"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-···"
                value={newKey}
                onChange={(e) => { setNewKey(e.target.value); setError(null); }}
                error={error}
                disabled={submitting}
                hint={<><strong>Encrypted at rest.</strong> Never logged.</>}
              />
              <div style={{ display: 'flex', gap: 12 }}>
                <Button type="submit" disabled={submitting || !newKey}>
                  {submitting ? 'Rotating…' : 'Rotate'}
                </Button>
                <Button variant="ghost" type="button" onClick={closeForm}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {mode === MODE.DELETE_ACCOUNT && (
            <form className="form-card" onSubmit={handleDeleteAccount}>
              <div className="form-card-label">DELETE ACCOUNT</div>
              <p style={{ fontFamily: 'var(--serif)', fontSize: 15, color: 'var(--text-soft)', marginBottom: 20, lineHeight: 1.5 }}>
                This permanently deletes your account, every walk in your folio, and your
                stored API key. <em style={{ color: 'var(--danger)', fontStyle: 'italic' }}>This can't be undone.</em>
              </p>
              <Input
                label="Confirm your password"
                type="password"
                autoComplete="current-password"
                placeholder="········"
                value={deletePassword}
                onChange={(e) => { setDeletePassword(e.target.value); setError(null); }}
                error={error}
                disabled={submitting}
              />
              <div style={{ display: 'flex', gap: 12 }}>
                <Button type="submit" className="btn-danger" disabled={submitting || !deletePassword}>
                  {submitting ? 'Deleting…' : 'Permanently delete'}
                </Button>
                <Button variant="ghost" type="button" onClick={closeForm}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

      </div>
      </main>

      <ConfirmDialog
        open={confirmingRemoveKey}
        title="Remove your API key?"
        message="Latitude won't be able to plan new walks until you add a key again. Existing walks stay in your folio."
        confirmLabel="Remove key"
        danger
        onConfirm={confirmRemoveKey}
        onCancel={() => setConfirmingRemoveKey(false)}
      />
    </div>
  );
}
