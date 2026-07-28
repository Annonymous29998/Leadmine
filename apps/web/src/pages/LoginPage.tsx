import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, clearAuthToken, getAuthToken, setAuthToken } from '@/lib/api';
import '@/styles/sniffy.css';

const LOGO = ` _      _____    _    ____    __  __ ___ _   _ _____
| |    | ____|  / \\  |  _ \\  |  \\/  |_ _| \\ | | ____|
| |    |  _|   / _ \\ | | | | | |\\/| || ||  \\| |  _|
| |___ | |___ / ___ \\| |_| | | |  | || || |\\  | |___
|_____||_____/_/   \\_\\____/  |_|  |_|___|_| \\_|_____|`;

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (getAuthToken()) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.login(email, password);
      setAuthToken(res.token);
      navigate('/', { replace: true });
    } catch (err) {
      clearAuthToken();
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sniffy-root">
      <div className="sniffy-container" style={{ maxWidth: 420 }}>
        <div className="sniffy-logo">
          <pre>{LOGO}</pre>
          <span className="sniffy-online">SECURE ACCESS</span>
        </div>

        <div className="sniffy-card">
          <h2 style={{ margin: '0 0 0.5rem', color: 'var(--sn-primary)', fontSize: '1.1rem' }}>
            Sign in
          </h2>
          <p className="sniffy-hint" style={{ marginBottom: '1.25rem' }}>
            Enter your LeadMine credentials to open the extractor.
          </p>

          <form onSubmit={onSubmit}>
            <label className="sniffy-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="sniffy-input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@leadmine.com"
              required
              disabled={busy}
            />

            <label className="sniffy-label" htmlFor="login-password" style={{ marginTop: '0.85rem' }}>
              Password
            </label>
            <div className="sniffy-password-wrap">
              <input
                id="login-password"
                className="sniffy-input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={busy}
              />
              <button
                type="button"
                className="sniffy-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                disabled={busy}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {error ? (
              <div className="sniffy-hint" style={{ color: 'var(--sn-danger)', marginTop: '0.85rem' }}>
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              className="sniffy-btn sniffy-btn-primary"
              style={{ width: '100%', marginTop: '1.25rem' }}
              disabled={busy}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
