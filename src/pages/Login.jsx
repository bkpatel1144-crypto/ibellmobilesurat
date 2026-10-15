import { useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { Smartphone, Mail, Lock } from 'lucide-react';
import { auth } from '../firebase';

const MESSAGES = {
  'auth/invalid-credential': 'Wrong e-mail or password.',
  'auth/wrong-password': 'Wrong e-mail or password.',
  'auth/user-not-found': 'Wrong e-mail or password.',
  'auth/invalid-email': 'Enter a valid e-mail address.',
  'auth/user-disabled': 'This account is disabled.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/network-request-failed': 'No internet connection.',
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(MESSAGES[err.code] || err.message);
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError('');
    if (!email.trim()) return setError('Enter your e-mail first, then tap "Forgot password".');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo('Password reset link sent to your e-mail.');
    } catch (err) {
      setError(MESSAGES[err.code] || err.message);
    }
  };

  return (
    <div className="auth-page">
      <form key={shake} className={`auth-card glass--large page ${shake ? 'shake' : ''}`} onSubmit={submit}>
        <div className="auth-logo">
          <Smartphone size={30} />
        </div>
        <h1 style={{ textAlign: 'center', letterSpacing: '0.08em', fontSize: 24 }}>IBELL MOBILE</h1>
        <p className="muted" style={{ textAlign: 'center', margin: '4px 0 24px' }}>Sign in to manage your shop</p>
        <div className="stack">
          <label className="field">
            <span>E-mail</span>
            <div className="input-group">
              <Mail size={16} />
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
          </label>
          <label className="field">
            <span>Password</span>
            <div className="input-group">
              <Lock size={16} />
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          {info && <div className="small pos" role="status">{info}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Forgot password?</button>
        </div>
      </form>
    </div>
  );
}
