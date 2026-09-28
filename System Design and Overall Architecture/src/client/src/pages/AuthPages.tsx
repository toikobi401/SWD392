/**
 * Sign-in family: UC-G17 Login, UC-G16 Register (+ step 11 verify),
 * UC-C03 Reset Forgotten Password.
 */
import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { homeFor, useAuth } from '../auth/AuthContext';
import { ErrorNotice, Notice } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const profile = await login(email, password);
      navigate(location.state?.from ?? homeFor(profile), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const code = error instanceof ApiError ? error.code : null;

  return (
    <main className="site-main narrow">
      <div className="panel stack">
        <h1>Sign in</h1>
        <form className="form" onSubmit={submit}>
          <label className="field">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" autoFocus />
          </label>
          <label className="field">
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>

          {code === 'ACCOUNT_LOCKED' ? (
            <Notice tone="error">
              This account is locked after five failed attempts. <Link to="/forgot-password">Reset your password</Link> to
              unlock it.
            </Notice>
          ) : code === 'EMAIL_NOT_VERIFIED' ? (
            <Notice tone="warn">Confirm your email first — use the link we sent when you registered.</Notice>
          ) : (
            <ErrorNotice error={error} />
          )}

          <button className="btn block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="row between small">
          <Link to="/forgot-password">Forgot your password?</Link>
          <Link to="/register">Create an account</Link>
        </div>
      </div>
    </main>
  );
}

export function RegisterPage() {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirmPassword: '', acceptedTerms: false });
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.register(form);
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="site-main narrow">
        <div className="panel stack">
          <h1>Check your email</h1>
          <p>We sent a confirmation link to <strong>{form.email}</strong>. Open it within 24 hours to activate your account.</p>
          <p className="muted small">In development without a mail provider, the link is printed in the server terminal.</p>
          <Link to="/login" className="btn">Go to sign in</Link>
        </div>
      </main>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: k === 'acceptedTerms' ? e.target.checked : e.target.value });

  return (
    <main className="site-main narrow">
      <div className="panel stack">
        <div>
          <h1>Create an account</h1>
          <p className="muted small" style={{ marginTop: 6 }}>See your bookings and invoices in one place, and earn points on every stay.</p>
        </div>
        <form className="form" onSubmit={submit}>
          <label className="field">
            Full name
            <input value={form.fullName} onChange={set('fullName')} required autoComplete="name" />
          </label>
          <label className="field">
            Email
            <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
          </label>
          <label className="field">
            Phone
            <input type="tel" value={form.phone} onChange={set('phone')} required autoComplete="tel" />
          </label>
          <label className="field">
            Password <span className="hint">At least 8 characters, with an uppercase letter, a lowercase letter and a digit.</span>
            <input type="password" value={form.password} onChange={set('password')} required autoComplete="new-password" />
          </label>
          <label className="field">
            Repeat password
            <input type="password" value={form.confirmPassword} onChange={set('confirmPassword')} required autoComplete="new-password" />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.acceptedTerms} onChange={set('acceptedTerms')} />
            I accept the terms of service
          </label>
          <ErrorNotice error={error} />
          <button className="btn block" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        </form>
        <p className="small">Already have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </main>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'working' | 'ok' | 'failed'>('working');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState('failed');
      return;
    }
    authApi
      .verify(token)
      .then(() => setState('ok'))
      .catch((err) => {
        setError(err);
        setState('failed');
      });
  }, [params]);

  return (
    <main className="site-main narrow">
      <div className="panel stack">
        {state === 'working' && <h1>Confirming your email…</h1>}
        {state === 'ok' && (
          <>
            <h1>Your account is active</h1>
            <p>You can sign in now.</p>
            <Link to="/login" className="btn">Sign in</Link>
          </>
        )}
        {state === 'failed' && (
          <>
            <h1>This link did not work</h1>
            <ErrorNotice error={error ?? new Error('The link is missing its token.')} />
            <p className="muted small">Confirmation links expire after 24 hours. Register again to get a new one.</p>
          </>
        )}
      </div>
    </main>
  );
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function request(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.forgotPassword(email);
      setStage('reset');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.resetPassword(email, otp, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="site-main narrow">
      <div className="panel stack">
        <h1>Reset your password</h1>
        {done ? (
          <Notice tone="ok">Password changed. Taking you to sign in…</Notice>
        ) : stage === 'request' ? (
          <form className="form" onSubmit={request}>
            <p className="muted small">We will send a 6-digit code to your email. It expires in 10 minutes.</p>
            <label className="field">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>
            <ErrorNotice error={error} />
            <button className="btn block" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          </form>
        ) : (
          <form className="form" onSubmit={reset}>
            <Notice tone="info">If {email} has an account, a code is on its way.</Notice>
            <label className="field">
              Code
              <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} required autoFocus />
            </label>
            <label className="field">
              New password <span className="hint">At least 8 characters, with upper- and lowercase letters and a digit.</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
            </label>
            <ErrorNotice error={error} />
            <button className="btn block" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
            <button type="button" className="btn ghost" onClick={() => setStage('request')}>Use a different email</button>
          </form>
        )}
      </div>
    </main>
  );
}
