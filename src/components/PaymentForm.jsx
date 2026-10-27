import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Field, Segmented } from './ui';
import PartySelect from './PartySelect';
import PaymentFields from './PaymentFields';
import { savePayment, CASH_ACCOUNT } from '../lib/db';
import { today, money, num, round2, fmtDate, amountText } from '../lib/format';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';

/**
 * Record money received from / paid to a party, optionally against one bill.
 * preset: { direction, partyId, partyName, refType, refId, refNo, amount }
 */
export default function PaymentForm({ open, onClose, payment, preset }) {
  const { sales, purchases, privacy, settleWith } = useData();
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
        .filter((s) => s.partyId === f.partyId && round2(num(s.due)) > 0)
        .map((s) => ({ refType: 'sale', id: s.id, no: s.invoiceNo, date: s.date, due: round2(num(s.due)) }));
    return purchases
      .filter((p) => p.partyId === f.partyId && round2(num(p.due)) > 0)
      .map((p) => ({ refType: 'purchase', id: p.id, no: p.purchaseNo, date: p.date, due: round2(num(p.due)) }));
  }, [f?.partyId, f?.direction, sales, purchases]);

  // Money "on account" (no bill chosen) settles the party's old balance first, then their oldest
  // open bills (see withSettlement). Show exactly where it lands before saving.
  const amount = num(f?.amount);
  const preview = useMemo(() => {
    if (!open || payment || !f?.partyId || f.refType !== 'manual' || !(amount > 0)) return null;
    const dir = f.direction === 'in' ? 'in' : 'out';
    const kind = dir === 'in' ? 'sales' : 'purchases';
    const before = settleWith([]);
    const after = settleWith([{ id: '__preview', direction: dir, amount, partyId: f.partyId, partyName: f.partyName, refType: 'manual', date: f.date }]);
    const old = new Map(before[kind].map((b) => [b.id, b]));
    const rows = [];
    for (const b of after[kind]) {
      if (b.partyId !== f.partyId) continue;
      const cut = round2(num(old.get(b.id)?.due) - num(b.due));
      if (cut > 0.004) rows.push({ id: b.id, no: b.invoiceNo || b.purchaseNo, date: b.date, cut, left: round2(num(b.due)) });
    }
    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const adv = round2((after.advances.get(f.partyId)?.[dir] || 0) - (before.advances.get(f.partyId)?.[dir] || 0));
    const opening = round2(amount - rows.reduce((t, r) => t + r.cut, 0) - adv);
    return { rows, adv, opening: opening > 0.004 ? opening : 0 };
  }, [open, payment, f?.partyId, f?.partyName, f?.refType, f?.direction, f?.date, amount, settleWith]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <input
              className="input num"
              inputMode="decimal"
              value={f.amount}
              onChange={(e) => {
                setF({ ...f, amount: amountText(e.target.value) });
                if (error === 'Enter an amount.') setError('');
              }}
              aria-invalid={error === 'Enter an amount.'}
            />
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <PaymentFields mode={f.mode} accountId={f.accountId} onChange={setPay} />
        </div>
        {preview && (
          <div className="sub-box small pay-preview" role="status" aria-label="Where this payment goes">
            <div className="field-label" style={{ marginBottom: 6 }}>Where this {money(amount)} goes</div>
            {preview.opening > 0 && (
              <div className="row-between"><span>Old balance (opening)</span><span className="num">{money(preview.opening)}</span></div>
            )}
            {preview.rows.map((r) => (
              <div className="row-between" key={r.id}>
                <span>{r.no} <span className="muted">· {fmtDate(r.date)}</span></span>
                <span className="num">{money(r.cut)} <span className={r.left > 0.004 ? 'neg' : 'pos'}>{r.left > 0.004 ? `· ${money(r.left)} still due` : '· settled'}</span></span>
              </div>
            ))}
            {preview.adv > 0 && (
              <div className="row-between"><span>Kept as advance {f.direction === 'in' ? 'for their next bill' : 'for their next purchase'}</span><span className="num">{money(preview.adv)}</span></div>
            )}
            {bills.length > 0 && <p className="xs muted" style={{ margin: '6px 0 0' }}>Oldest first. To put it on one bill only, choose it in “Against bill” above.</p>}
          </div>
        )}
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
