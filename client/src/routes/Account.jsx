import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import * as authApi from '../api/auth.js';
import TopNav from '../components/TopNav.jsx';
import Button from '../components/Button.jsx';
import { Input } from '../components/Input.jsx';

export default function Account() {
  const { user, refresh, signOut } = useAuth();
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

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
      setNewKey('');
      setRotating(false);
      await refresh();
      setSuccess('API key rotated.');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err.message || 'Failed to rotate key');
    } finally {
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
              <span className="account-meta-value mono">— <span style={{ color: 'var(--text-faint)' }}>tracked in Session 6</span></span>
            </li>
            <li>
              <span className="account-meta-label">Anthropic key</span>
              <span className="account-meta-value mono">{user.apiKeyMasked || '— failed to load'}</span>
            </li>
          </ul>

          <div className="account-actions">
            {!rotating ? (
              <>
                <Button variant="ghost" onClick={() => setRotating(true)}>Rotate API key</Button>
                <Button variant="ghost" onClick={signOut}>Sign out</Button>
              </>
            ) : null}
          </div>

          {success && (
            <div style={{ marginTop: 20, padding: '12px 16px', border: '1px solid var(--accent-line)', background: 'var(--accent-faint)', color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              ✓ {success}
            </div>
          )}
        </div>

        <div>
          {rotating && (
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
                <Button variant="ghost" type="button" onClick={() => { setRotating(false); setNewKey(''); setError(null); }}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}
