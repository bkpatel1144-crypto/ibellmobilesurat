import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Modal, Field } from './ui';
import PartySelect from './PartySelect';
import { IdProofEditor } from './IdProof';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { updateSale } from '../lib/db';
import { billTotals, splitGst, validGstin } from '../lib/gst';
import { money, num, amountText } from '../lib/format';
import { accLines, lineQty } from '../lib/accessories';

/** Edit a bill: customer, date, prices, warranty, buyer ID proof, discount, GST. Phones and accessory pieces stay the same. */
export default function SaleEditModal({ sale, open, onClose }) {
  const data = useData();
  const { settings, parties } = data;
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proofOpen, setProofOpen] = useState({});
  const locked = num(sale?.returnedCount) > 0;

  useEffect(() => {
    if (!open || !sale) return;
    setError('');
    setProofOpen({});
    setF({
      partyId: sale.partyId || null,
      customerName: sale.customerName === 'Walk-in Customer' ? '' : sale.customerName || '',
      customerPhone: sale.customerPhone || '',
      customerAddress: sale.customerAddress || '',
      customerGstin: sale.customerGstin || '',
      date: sale.date,
      discount: sale.discount ? String(sale.discount) : '',
      taxPercent: String(sale.taxPercent || 0),
      notes: sale.notes || '',
      items: sale.items.map((it) => ({
        deviceId: it.deviceId,
        name: [it.brand, it.model, it.variant, it.color].filter(Boolean).join(' '),
        imei: it.imei,
        price: String(it.price),
        warranty: it.warranty || '',
        idType: it.buyerIdType || '',
        idNumber: it.buyerIdNumber || '',
        idFiles: it.buyerIdProofs || [],
      })),
      accessories: accLines(sale).map((l) => ({ accessoryId: l.accessoryId, name: l.name, qty: lineQty(l), serials: l.serials || [], rate: String(l.rate), warranty: l.warranty || '' })),
    });
  }, [open, sale]);

  if (!open || !f) return null;

  const setItem = (i, patch) => setF((p) => ({ ...p, items: p.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const setAcc = (i, patch) => setF((p) => ({ ...p, accessories: p.accessories.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const subtotal = f.items.reduce((s, it) => s + num(it.price), 0) + f.accessories.reduce((s, l) => s + l.qty * num(l.rate), 0);
  const rate = num(f.taxPercent);
  const inclusive = rate > 0 && (sale.tax > 0 ? sale.gstInclusive !== false : settings.gstInclusive !== false);
  const t = billTotals({ subtotal, discount: f.discount, rate, inclusive });
  const split = splitGst(t.tax, settings.gstin, f.customerGstin);

  const submit = async (e) => {
    e.preventDefault();
    if (f.items.some((it) => num(it.price) <= 0)) return setError('Every phone needs a selling price.');
    if (f.accessories.some((l) => num(l.rate) <= 0)) return setError('Every accessory needs a selling price.');
    if (f.customerGstin && !validGstin(f.customerGstin)) return setError('Customer GSTIN looks wrong (15 characters).');
    setBusy(true);
    try {
      const raw = data.raw.sales.find((s) => s.id === sale.id) || sale;
      await updateSale(raw, f, { settings, payments: data.raw.payments, devices: data.raw.devices });
      toast(`${sale.invoiceNo} updated`);
      onClose(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => onClose(false)} title={`Edit ${sale.invoiceNo}`} subtitle="To change the phones or accessory pieces on a bill, delete it and make a new one." size="wide">
      <form onSubmit={submit} className="stack">
        {locked && (
          <div className="sub-box small" role="note">
            This bill has returns ({money(sale.returned)} on credit notes), so its party and amounts are locked. To change them, delete the returns first.
          </div>
        )}
        <div className="form-grid">
          <Field label="Party" className="span-2">
            {locked ? <input className="input" value={sale.customerName} disabled /> : <PartySelect
              value={f.partyId}
              allowEmpty
              emptyLabel="Walk-in customer"
              defaultType="customer"
              onChange={(p) => {
                const party = p && parties.find((x) => x.id === p.id);
                setF((x) => ({
                  ...x,
                  partyId: p?.id || null,
                  customerName: p?.name || '',
                  customerPhone: party?.phone || p?.phone || '',
                  customerAddress: party?.address || p?.address || '',
                  customerGstin: party?.gstin || x.customerGstin,
                }));
              }}
            />}
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <Field label="Customer name"><input className="input" placeholder="Walk-in Customer" value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></Field>
          <Field label="Mobile"><input className="input" value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} /></Field>
          <Field label="Address"><input className="input" value={f.customerAddress} onChange={(e) => setF({ ...f, customerAddress: e.target.value })} /></Field>
          {(settings.gstEnabled || sale.tax > 0) && (
            <Field label="Customer GSTIN"><input className="input mono" maxLength={15} value={f.customerGstin} onChange={(e) => setF({ ...f, customerGstin: e.target.value.toUpperCase() })} /></Field>
          )}
        </div>

        {f.items.map((it, i) => (
          <div className="line" key={it.deviceId}>
            <div className="line-head">
              <div className="row" style={{ gap: 10 }}>
                <span className="line-index">{i + 1}</span>
                <div>
                  <div className="cell-main">{it.name}</div>
                  <div className="cell-sub mono">{it.imei}</div>
                </div>
              </div>
            </div>
            <div className="form-grid">
              <Field label="Selling price (₹)" required>
                <input className="input num" type="number" min="0" step="0.01" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} disabled={locked} />
              </Field>
              <Field label="Warranty"><input className="input" value={it.warranty} onChange={(e) => setItem(i, { warranty: e.target.value })} /></Field>
            </div>
            {proofOpen[i] || it.idFiles.length || it.idType ? (
              <IdProofEditor title="Buyer ID proof" value={it} onChange={(v) => setItem(i, v)} />
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setProofOpen((o) => ({ ...o, [i]: true }))}>
                <Paperclip size={15} /> Add buyer ID proof
              </button>
            )}
          </div>
        ))}

        {f.accessories.map((l, i) => (
          <div className="line" key={l.accessoryId}>
            <div className="line-head">
              <div>
                <div className="cell-main">{l.name} × {l.qty}</div>
                {l.serials.length > 0 && <div className="cell-sub mono">{l.serials.join(', ')}</div>}
              </div>
              <span className="num cell-main">{money(l.qty * num(l.rate))}</span>
            </div>
            <div className="form-grid">
              <Field label="Price per piece (₹)" required>
                <input className="input num" inputMode="decimal" value={l.rate} onChange={(e) => setAcc(i, { rate: amountText(e.target.value) })} disabled={locked} aria-label={`${l.name} price`} />
              </Field>
              <Field label="Warranty"><input className="input" value={l.warranty} onChange={(e) => setAcc(i, { warranty: e.target.value })} aria-label={`${l.name} warranty`} /></Field>
            </div>
          </div>
        ))}

        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <Field label="Notes">
            <textarea className="textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <div className="totals">
            <div><span className="muted">Subtotal</span><b className="num">{money(subtotal)}</b></div>
            <div>
              <span className="muted">Discount</span>
              <input className="input num" type="number" min="0" step="0.01" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} aria-label="Discount" disabled={locked} />
            </div>
            <div>
              <span className="muted">GST %</span>
              <input className="input num" type="number" min="0" step="0.01" value={f.taxPercent} onChange={(e) => setF({ ...f, taxPercent: e.target.value })} aria-label="GST percent" disabled={locked} />
            </div>
            {t.tax > 0 && (
              <>
                <div><span className="muted">Taxable value</span><span className="num">{money(t.taxable)}</span></div>
                <div><span className="muted">{split.inter ? `IGST ${rate}%` : `CGST + SGST ${rate}%`}</span><span className="num">{money(t.tax)}</span></div>
              </>
            )}
            <div className="grand"><span>Total</span><span className="num">{money(t.total)}</span></div>
            <div><span className="muted">Already received</span><span className="num">{money(sale.received)}</span></div>
          </div>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={() => onClose(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}
