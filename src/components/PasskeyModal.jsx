import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Modal } from './ui';
import { useData } from '../context/DataContext';

/** First use: sets the passkey. After that: asks for it and unlocks private sales. */
export default function PasskeyModal({ open, onClose, forceSet = false }) {
  const { privacy } = useData();
  const setting = forceSet || !privacy.hasPasskey;
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  useEffect(() => {
    if (open) {
      setPass('');
      setConfirm('');
      setError('');
    }
  }, [open]);

  const fail = (msg) => {
    setError(msg);
    setShakeKey((k) => k + 1);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (setting) {
      if (pass.length < 4) return fail('Passkey must be at least 4 characters.');
      if (pass !== confirm) return fail('Passkeys do not match.');
      setBusy(true);
      try {
        await privacy.setPasskey(pass);
        onClose(true);
      } catch (err) {
        fail(err.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    const ok = await privacy.unlock(pass);
    setBusy(false);
    if (ok) onClose(true);
    else {
      setPass('');
      fail('Wrong passkey.');
    }
  };

  return (
    <Modal open={open} onClose={() => onClose(false)} title={setting ? 'Set passkey' : 'Enter passkey'} size="narrow">
      <form onSubmit={submit} key={shakeKey} className={shakeKey ? 'shake' : ''}>
        <div className="stack">
          <div style={{ textAlign: 'center' }}>
            <div className="auth-logo" style={{ width: 52, height: 52, borderRadius: 16 }}>
              <KeyRound size={24} />
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {setting
                ? 'Create a passkey. You will need it every time you open the private view.'
                : 'Enter your passkey to continue.'}
            </p>
          </div>
          <input
            className="input pin-input"
            type="password"
            autoComplete="off"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="••••"
            aria-label="Passkey"
            autoFocus
          />
          {setting && (
            <input
              className="input pin-input"
              type="password"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm"
              aria-label="Confirm passkey"
            />
          )}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy || !pass}>
            {busy ? 'Please wait…' : setting ? 'Save passkey' : 'Unlock'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
