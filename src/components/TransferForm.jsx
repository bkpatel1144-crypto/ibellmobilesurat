import { useEffect, useState } from 'react';
import { Modal, Field } from './ui';
import { saveTransfer, updateTransfer, CASH_ACCOUNT } from '../lib/db';
import { today, num } from '../lib/format';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';

/** Move money between accounts, e.g. deposit cash into the bank. Pass `transfer` to edit one. */
export default function TransferForm({ open, onClose, transfer = null }) {
  const { accounts } = useData();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      setF(
        transfer
          ? { fromAccountId: transfer.fromAccountId, toAccountId: transfer.toAccountId, amount: String(transfer.amount ?? ''), date: transfer.date, note: transfer.note || '' }
          : { fromAccountId: CASH_ACCOUNT, toAccountId: accounts.find((a) => !a.isCash)?.id || '', amount: '', date: today(), note: '' },
      );
    }
  }, [open, transfer]); // eslint-disable-line react-hooks/exhaustive-deps -- accounts only pick the starting value

  if (!open || !f) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (f.fromAccountId === f.toAccountId) return setError('Choose two different accounts.');
    if (!f.toAccountId) return setError('Choose the account to transfer to.');
    if (num(f.amount) <= 0) return setError('Enter an amount.');
    setBusy(true);
    try {
      if (transfer) await updateTransfer(transfer.id, { ...f, amount: num(f.amount) });
      else await saveTransfer(f);
      toast(transfer ? 'Transfer updated' : 'Transfer saved');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const opts = accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>);
  return (
    <Modal open onClose={onClose} title={transfer ? 'Edit transfer' : 'Transfer between accounts'} subtitle="Cash deposit, withdrawal or bank to bank">
      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <Field label="From">
            <select className="select" value={f.fromAccountId} onChange={(e) => setF({ ...f, fromAccountId: e.target.value })}>{opts}</select>
          </Field>
          <Field label="To">
            <select className="select" value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}>
              <option value="">Select…</option>
              {opts}
            </select>
          </Field>
          <Field label="Amount (₹)" required>
            <input className="input num" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
        </div>
        <Field label="Note">
          <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : transfer ? 'Save changes' : 'Transfer'}</button>
        </div>
      </form>
    </Modal>
  );
}
