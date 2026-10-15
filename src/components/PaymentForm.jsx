import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Field, Segmented } from './ui';
import PartySelect from './PartySelect';
import PaymentFields from './PaymentFields';
import { savePayment, CASH_ACCOUNT } from '../lib/db';
import { today, money, num, round2, fmtDate } from '../lib/format';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';

/**
 * Record money received from / paid to a party, optionally against one bill.
 * preset: { direction, partyId, partyName, refType, refId, refNo, amount }
 */
export default function PaymentForm({ open, onClose, payment, preset }) {
  const { sales, purchases, privacy } = useData();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setF(
      payment
        ? { ...payment, amount: String(payment.amount) }
        : {
            direction: 'in',
            partyId: null,
            partyName: '',
            amount: '',
            date: today(),
            mode: 'Cash',
            accountId: CASH_ACCOUNT,
            refType: 'manual',
            refId: null,
            refNo: '',
            note: '',
            ...preset,
            ...(preset?.amount !== undefined ? { amount: String(preset.amount) } : {}),
          },
    );
  }, [open, payment, preset]);

  const setPay = useCallback((v) => setF((p) => ({ ...p, ...v })), []);

  // open bills of the chosen party, to settle a specific one
  const bills = useMemo(() => {
    if (!f?.partyId) return [];
    if (f.direction === 'in')
      return sales
        .filter((s) => s.partyId === f.partyId && round2(num(s.total) - num(s.received)) > 0)
        .map((s) => ({ refType: 'sale', id: s.id, no: s.invoiceNo, date: s.date, due: round2(num(s.total) - num(s.received)) }));
    return purchases
      .filter((p) => p.partyId === f.partyId && round2(num(p.total) - num(p.paid)) > 0)
      .map((p) => ({ refType: 'purchase', id: p.id, no: p.purchaseNo, date: p.date, due: round2(num(p.total) - num(p.paid)) }));
  }, [f?.partyId, f?.direction, sales, purchases]);

  if (!f) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (num(f.amount) <= 0) return setError('Enter an amount.');
    if (!f.partyId && !f.partyName.trim()) return setError('Select a party or enter a name.');
    setBusy(true);
    try {
      await savePayment(f);
      toast(payment ? 'Payment updated' : f.direction === 'in' ? 'Payment received' : 'Payment recorded');
      onClose(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const locked = Boolean(preset?.refId) || (payment && payment.refType !== 'manual');

  return (
    <Modal open={open} onClose={() => onClose(false)} title={payment ? 'Edit payment' : f.direction === 'in' ? 'Payment received' : 'Payment paid'}>
      <form onSubmit={submit} className="stack">
        {!locked && (
          <Segmented
            label="Direction"
            value={f.direction}
            onChange={(v) => setF({ ...f, direction: v, refType: 'manual', refId: null, refNo: '' })}
            options={[
              { value: 'in', label: 'Received (In)' },
              { value: 'out', label: 'Paid (Out)' },
            ]}
          />
        )}
        <Field label="Party">
          {locked ? (
            <input className="input" value={f.partyName} disabled />
          ) : (
            <PartySelect
              value={f.partyId}
              allowEmpty
              emptyLabel="No party (enter name)"
              onChange={(p) => setF((x) => ({ ...x, partyId: p?.id || null, partyName: p?.name || '', refType: 'manual', refId: null, refNo: '' }))}
            />
          )}
        </Field>
        {!f.partyId && !locked && (
          <Field label="Name">
            <input className="input" value={f.partyName} onChange={(e) => setF({ ...f, partyName: e.target.value })} />
          </Field>
        )}
        {!locked && bills.length > 0 && (
          <Field label="Against bill (optional)">
            <select
              className="select"
              value={f.refId || ''}
              onChange={(e) => {
                const b = bills.find((x) => x.id === e.target.value);
                setF({ ...f, refType: b ? b.refType : 'manual', refId: b?.id || null, refNo: b?.no || '', amount: b ? String(b.due) : f.amount });
              }}
            >
              <option value="">On account (no specific bill)</option>
              {bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.no} · {fmtDate(b.date)} · due {money(b.due)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {locked && f.refNo && <div className="small muted">Against <b>{f.refNo}</b></div>}
        <div className="form-grid">
          <Field label="Amount (₹)" required>
            <input className="input num" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <PaymentFields mode={f.mode} accountId={f.accountId} onChange={setPay} />
        </div>
        <Field label="Note">
          <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        {privacy.unlocked && (
          <label className="check small">
            <input type="checkbox" checked={Boolean(f.hidden)} onChange={(e) => setF({ ...f, hidden: e.target.checked })} />
            Private entry (hidden when locked)
          </label>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={() => onClose(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
