/**
 * «boundary» / user interaction — LoginPage
 *
 * Realizes: UC-G17 Login, and the entry point to UC-C03 Reset Forgotten Password.
 *
 * Every credential failure renders the same message the server sent, which is
 * deliberately generic (UC-G17 exceptions 1.0.E2/1.0.E3) so the screen cannot
 * be used to discover which email addresses exist.
 */
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks';
import { authApi } from '../api/endpoints';
import { ApiError } from '../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const tokens = await login(email, password);

      // Step 10 — land the user where their role belongs.
      const permissions = tokens.user.permissions;
      if (permissions.includes('CHECK_IN')) navigate('/front-desk');
      else if (permissions.includes('APPROVE_LEAVE')) navigate('/approvals');
      else if (permissions.includes('MANAGE_ACCOUNTS')) navigate('/admin');
      else navigate('/my-bookings');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    if (!email) return setError(new ApiError('MISSING_EMAIL', 'Enter your email first', 400));
    await authApi.forgotPassword(email);
    setForgotSent(true);
  }

  return (
    <div className="page narrow">
      <h1>Sign in</h1>

      <form className="form" onSubmit={submit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && (
          <p className="error">
            {/* BR-02 — a locked account needs a different call to action. */}
            {error.code === 'ACCOUNT_LOCKED'
              ? 'Your account is locked after too many failed attempts. Contact the administrator or reset your password.'
              : error.message}
          </p>
        )}

        {forgotSent && (
          <p className="info">
            If that account exists, a verification code has been sent.
          </p>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="links">
        <button type="button" className="link" onClick={forgotPassword}>
          Forgot password?
        </button>
        <button type="button" className="link" onClick={() => navigate('/register')}>
          Create an account
        </button>
      </div>
    </div>
  );
}
