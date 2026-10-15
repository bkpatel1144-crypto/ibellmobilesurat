import { useEffect } from 'react';
import { useData } from '../context/DataContext';
import { PAYMENT_MODES } from '../lib/format';
import { CASH_ACCOUNT } from '../lib/db';
import { Field } from './ui';

/** Payment mode + the account the money goes into / comes out of.
 *  Cash → "Cash in Hand"; any other mode → a bank account. */
export default function PaymentFields({ mode, accountId, onChange, modeLabel = 'Payment mode' }) {
  const { accounts } = useData();
  const banks = accounts.filter((a) => !a.isCash);

  useEffect(() => {
    if (mode === 'Cash' && accountId !== CASH_ACCOUNT) onChange({ mode, accountId: CASH_ACCOUNT });
    if (mode !== 'Cash' && (accountId === CASH_ACCOUNT || !accountId) && banks[0]) onChange({ mode, accountId: banks[0].id });
  }, [mode, accountId, banks, onChange]);

  return (
    <>
      <Field label={modeLabel}>
        <select className="select" value={mode} onChange={(e) => onChange({ mode: e.target.value, accountId })}>
          {PAYMENT_MODES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Field>
      <Field label="Account" hint={mode !== 'Cash' && !banks.length ? 'Add a bank account in Banks' : undefined}>
        <select className="select" value={accountId || CASH_ACCOUNT} onChange={(e) => onChange({ mode, accountId: e.target.value })}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </Field>
    </>
  );
}
