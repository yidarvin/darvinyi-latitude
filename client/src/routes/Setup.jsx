import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as authApi from '../api/auth.js';
import { useAuth } from '../hooks/useAuth.jsx';
import Button from '../components/Button.jsx';
import { Input } from '../components/Input.jsx';
import Brand from '../components/Brand.jsx';

const INITIAL = {
  email: '',
  password: '',
  anthropicApiKey: '',
};

export default function Setup() {
  const [mode, setMode] = useState('signup'); // 'signup' | 'login'
  const [form, setForm] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const { refresh } = useAuth();
  const navigate = useNavigate();
  const firstInputRef = useRef(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  const isSignup = mode === 'signup';

  const update = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: null });
  };

  const validate = () => {
    const next = {};
    if (!form.email.includes('@')) next.email = 'Enter a valid email';
    if (form.password.length < (isSignup ? 8 : 1)) {
      next.password = isSignup ? 'At least 8 characters' : 'Required';
    }
    if (isSignup) {
      if (!form.anthropicApiKey.startsWith('sk-ant-')) {
        next.anthropicApiKey = 'Should start with sk-ant-';
      } else if (form.anthropicApiKey.length < 20) {
        next.anthropicApiKey = 'API key looks too short';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (isSignup) {
        await authApi.signup(form.email, form.password, form.anthropicApiKey);
      } else {
        await authApi.login(form.email, form.password);
      }
      await refresh();
      navigate('/folio', { replace: true });
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      {/* Slimmer header — no full TopNav on /setup since user isn't authed yet */}
      <header style={{ marginBottom: 36, paddingBottom: 22, borderBottom: '1px solid var(--border)' }}>
        <Brand to="/setup" />
      </header>

      <main className="setup-grid">
        <div className="setup-intro">
          <div className="kicker">A walking agenda · Ed. 2026</div>
          <h1 className="display">
            Where to walk,<br />
            what to <em>shoot,</em><br />
            and <em>why.</em>
          </h1>
          <p className="lede">
            Latitude plans the route, picks the stops, and assigns the project
            &mdash; <em>then remembers</em>, so the next walk isn't where the last one was.
          </p>
          <ol className="setup-bullets">
            <li><span className="b-num">01</span><span className="b-text">Tell it your gear, your time, and the kind of work you're after.</span></li>
            <li><span className="b-num">02</span><span className="b-text">An agent asks the questions <em>worth asking.</em></span></li>
            <li><span className="b-num">03</span><span className="b-text">Get a real route on a real map, with a project worth working on.</span></li>
            <li><span className="b-num">04</span><span className="b-text">It remembers where you've been &mdash; <em>so it can send you somewhere new.</em></span></li>
          </ol>
        </div>

        <form className="form-card" onSubmit={submit} noValidate>
          <div className="form-card-label">
            FORM &middot; {isSignup ? 'NEW ACCOUNT' : 'SIGN IN'}
          </div>

          <Input
            ref={firstInputRef}
            label="Email Address"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={update('email')}
            error={errors.email}
            disabled={submitting}
          />

          <Input
            label="Passphrase"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder="········"
            value={form.password}
            onChange={update('password')}
            error={errors.password}
            disabled={submitting}
          />

          {isSignup && (
            <Input
              label="Anthropic API Key"
              type="password"
              autoComplete="off"
              placeholder="sk-ant-···"
              value={form.anthropicApiKey}
              onChange={update('anthropicApiKey')}
              error={errors.anthropicApiKey}
              disabled={submitting}
              hint={
                <>
                  <strong>Encrypted at rest.</strong> Used only when the agent thinks —
                  roughly $0.10&ndash;0.30 per walk in Anthropic usage on your own key.
                  Get one at{' '}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                    console.anthropic.com
                  </a>. You can rotate it any time from Account.
                </>
              }
            />
          )}

          {submitError && (
            <div className="form-error" style={{ marginBottom: 14, marginTop: -6 }}>
              {submitError}
            </div>
          )}

          <Button type="submit" disabled={submitting} arrow={!submitting}>
            {submitting
              ? (isSignup ? 'Creating…' : 'Signing in…')
              : (isSignup ? 'Begin' : 'Sign in')}
          </Button>

          <div className="mode-toggle">
            {isSignup ? (
              <>Already have an account? <button type="button" onClick={() => { setMode('login'); setErrors({}); setSubmitError(null); }}>Sign in</button></>
            ) : (
              <>New to Latitude? <button type="button" onClick={() => { setMode('signup'); setErrors({}); setSubmitError(null); }}>Create an account</button></>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
