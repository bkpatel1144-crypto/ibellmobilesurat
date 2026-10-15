import { useEffect, useState } from 'react';
import { Modal, Field, Segmented } from './ui';
import { saveParty } from '../lib/db';
import { useToast } from '../context/ToastContext';

const blank = { name: '', phone: '', email: '', address: '', gstin: '', type: 'both', openingBalance: '', obSide: 'receive', notes: '' };

export default function PartyForm({ open, onClose, party, defaultType = 'both', initialName = '' }) {
  const toast = useToast();
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (party) {
      const ob = Number(party.openingBalance) || 0;
      setF({ ...blank, ...party, openingBalance: ob ? Math.abs(ob) : '', obSide: ob < 0 ? 'pay' : 'receive' });
    } else setF({ ...blank, type: defaultType, name: initialName });
  }, [open, party, defaultType]); // eslint-disable-line react-hooks/exhaustive-deps -- name is only a starting value

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target ? e.target.value : e }));

  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return setError('Name is required.');
    setBusy(true);
    try {
      const ob = (Number(f.openingBalance) || 0) * (f.obSide === 'pay' ? -1 : 1);
      const id = await saveParty({ ...f, openingBalance: ob, id: party?.id });
      toast(party ? 'Party updated' : 'Party added');
      onClose({ id, name: f.name.trim(), phone: f.phone.trim(), address: f.address.trim() });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => onClose(null)} title={party ? 'Edit party' : 'New party'}>
      <form onSubmit={submit} className="stack">
        <Field label="Party type">
          <Segmented
            label="Party type"
            value={f.type}
            onChange={set('type')}
            options={[
              { value: 'both', label: 'Buy & Sell' },
              { value: 'supplier', label: 'Supplier' },
              { value: 'customer', label: 'Customer' },
              { value: 'repairer', label: 'Repairer' },
            ]}
          />
        </Field>
        <div className="form-grid">
          <Field label="Name" required>
            <input className="input" value={f.name} onChange={set('name')} autoFocus />
          </Field>
          <Field label="Phone">
            <input className="input" value={f.phone} onChange={set('phone')} inputMode="tel" />
          </Field>
          <Field label="E-mail">
            <input className="input" value={f.email} onChange={set('email')} type="email" />
          </Field>
          <Field label="GSTIN">
            <input className="input" value={f.gstin} onChange={set('gstin')} />
          </Field>
        </div>
        <Field label="Address">
          <textarea className="textarea" rows={2} value={f.address} onChange={set('address')} />
        </Field>
        <div className="form-grid">
          <Field label="Opening balance (₹)">
            <input className="input num" type="number" min="0" step="0.01" value={f.openingBalance} onChange={set('openingBalance')} />
          </Field>
          <Field label="Opening balance is">
            <select className="select" value={f.obSide} onChange={set('obSide')}>
              <option value="receive">To receive (they owe us)</option>
              <option value="pay">To pay (we owe them)</option>
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <input className="input" value={f.notes} onChange={set('notes')} />
        </Field>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={() => onClose(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save party'}</button>
        </div>
      </form>
    </Modal>
  );
}
