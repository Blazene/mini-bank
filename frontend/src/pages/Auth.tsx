import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  Landmark,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { useSession } from '../context/Session';
import { errorMessage } from '../lib/api';
import { Brand, Notice } from '../components/ui';
export function Auth() {
  const { user, login, api, expired } = useSession(),
    navigate = useNavigate();
  const [register, setRegister] = useState(false),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  if (user) return <Navigate to="/app/overview" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (register) {
        await api.request('POST', '/auth/register', {
          body: { fullName: name.trim(), email: email.trim(), password },
          token: null,
        });
        setRegister(false);
      }
      await login(email.trim(), password);
      navigate('/app/overview', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Link to="/login" className="brand-link">
          <Brand light />
        </Link>
        <div className="auth-story-content">
          <span className="story-kicker">
            <span /> A FRESH PERSPECTIVE ON BANKING
          </span>
          <h1>
            Your money.
            <br />A little more
            <br />
            <em>clarity.</em>
          </h1>
          <p>
            One thoughtful workspace for your everyday accounts, money movements and bigger plans.
          </p>
          <div
            className="illustrative-card"
            aria-label="Illustrative account card, not a real balance"
          >
            <div>
              <Landmark size={24} />
              <span>mini bank</span>
            </div>
            <small>ILLUSTRATIVE SAVINGS BALANCE</small>
            <strong>₹2,48,560.00</strong>
            <footer>
              <span>•••• &nbsp; •••• &nbsp; 8426</span>
              <span>INR</span>
            </footer>
          </div>
          <div className="story-features">
            <span>
              <Check size={16} /> Clear account insights
            </span>
            <span>
              <Check size={16} /> Thoughtful, simple tools
            </span>
          </div>
        </div>
        <div className="story-footer">
          <ShieldCheck size={16} /> Built for learning. Designed with care.
        </div>
      </section>
      <section className="auth-content">
        <div className="auth-top">
          <span>Just looking around?</span>
          <Link to="/demo/overview">
            Explore preview <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="auth-form-wrap">
          <div className="eyebrow">YOUR PERSONAL WORKSPACE</div>
          <h2>{register ? 'A fresh start.' : 'Welcome back.'}</h2>
          <p className="auth-subtitle">
            {register
              ? 'Create your account and make yourself at home.'
              : 'A clearer view of your money starts here.'}
          </p>
          {expired && <Notice tone="info">Your session expired. Sign in again to continue.</Notice>}
          {error && <Notice>{error}</Notice>}
          <form onSubmit={submit} className="form-stack">
            {register && (
              <label>
                Full name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  disabled={busy}
                  placeholder="How should we call you?"
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                disabled={busy}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <div className="password-input">
                <input
                  type={visible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  required
                  minLength={register ? 8 : 1}
                  disabled={busy}
                  placeholder={register ? 'At least 8 characters' : 'Enter your password'}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? 'Hide password' : 'Show password'}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <button className="button button-primary auth-submit" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={18} /> Connecting securely…
                </>
              ) : (
                <>
                  {register ? 'Create account' : 'Sign in to your workspace'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
            <p className="form-hint">
              {busy
                ? 'Free hosting can take up to 90 seconds to wake. Please don’t resubmit.'
                : 'Your session stays in memory and ends when you reload or sign out.'}
            </p>
          </form>
          <p className="auth-switch">
            {register ? 'Already have an account?' : 'New to Mini Bank?'}{' '}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
              disabled={busy}
            >
              {register ? 'Sign in' : 'Create an account'} <ArrowRight size={14} />
            </button>
          </p>
          <div className="demo-disclaimer">
            <ShieldCheck size={19} />
            <p>
              <strong>A real API. Simulated money.</strong>
              <br />
              An educational project, not a real bank. Use disposable information only.
            </p>
          </div>
        </div>
        <footer className="auth-legal">
          © {new Date().getFullYear()} Mini Bank <span>Made for clarity, not real currency.</span>
        </footer>
      </section>
    </div>
  );
}
