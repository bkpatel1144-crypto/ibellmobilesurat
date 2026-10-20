import { useEffect, useMemo, useState } from 'react';
import { Modal, Field, Segmented } from './ui';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { saveAccessory, saveAdjustment } from '../lib/db';
import { ACC_CATEGORIES, ADJUST_REASONS, TRACK_LABEL, categoryHsn, cleanSerial } from '../lib/accessories';
import { amountText, money, num, today } from '../lib/format';

const WARRANTIES = ['No Warranty', '7 Days', '15 Days', '1 Month', '3 Months', '6 Months', '1 Year', 'Brand Warranty'];

/** Serials typed or scanned one per line (commas and spaces also split). */
export const splitSerials = (text) => [...new Set(String(text || '').split(/[\n,;\t]+/).map(cleanSerial).filter(Boolean))];

const blank = (name = '') => ({
  name,
  brand: '',
  category: 'Charger / Adapter',
  track: 'qty',
  code: '',
  hsn: '',
  purchasePrice: '',
  salePrice: '',
  warranty: '',
  lowStock: '',
  notes: '',
  openingQty: '',
  openingCost: '',
  openingSerialsText: '',
  openingDate: today(),
});

/**
 * Create / edit one accessory in the catalogue.
 * onClose(saved) - saved = { id, code } after a save.
 */
export default function AccessoryForm({ open, accessory, initialName = '', onClose }) {
  const data = useData();
  const toast = useToast();
  const [f, setF] = useState(blank());
  const [busy, setBusy] = useState(false);
  const [showOpening, setShowOpening] = useState(false);
  const st = accessory ? data.rawAccStock.get(accessory.id) : null;
  const used = Boolean(st && (st.purchasedQty || st.soldQty));

  useEffect(() => {
    if (!open) return;
    setF(
      accessory
        ? {
            ...blank(),
            ...accessory,
            purchasePrice: accessory.purchasePrice ? String(accessory.purchasePrice) : '',
            salePrice: accessory.salePrice ? String(accessory.salePrice) : '',
            lowStock: accessory.lowStock ? String(accessory.lowStock) : '',
            openingQty: accessory.openingQty ? String(accessory.openingQty) : '',
            openingCost: accessory.openingCost ? String(accessory.openingCost) : '',
            openingSerialsText: (accessory.openingSerials || []).join('\n'),
          }
        : blank(initialName),
    );
    setShowOpening(Boolean(accessory && (num(accessory.openingQty) > 0 || (accessory.openingSerials || []).length)));
  }, [open, accessory, initialName]);

  const brands = useMemo(() => [...new Set(data.accessories.map((a) => a.brand).filter(Boolean))].sort(), [data.accessories]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setAmt = (k) => (e) => setF((x) => ({ ...x, [k]: amountText(e.target.value) }));
  const serials = splitSerials(f.openingSerialsText);

  const submit = async (e) => {
    e.preventDefault();
    e.stopPropagation(); // the dialog can open inside another form (New purchase) - never submit that one
    if (!f.name.trim()) return toast('Enter the accessory name', 'error');
    setBusy(true);
    try {
      const saved = await saveAccessory(
        {
          ...f,
          id: accessory?.id,
          openingSerials: f.track === 'serial' ? serials : [],
          openingCost: f.openingCost === '' ? f.purchasePrice : f.openingCost,
        },
        { accessories: data.raw.accessories, settings: data.settings, accStock: data.rawAccStock },
      );
      toast(accessory ? `${f.name.trim()} updated` : `${f.name.trim()} added · code ${saved.code}`);
      onClose({ ...saved, track: f.track, purchasePrice: num(f.purchasePrice), salePrice: num(f.salePrice), warranty: f.warranty });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => onClose(null)} title={accessory ? `Edit ${accessory.name}` : 'New accessory'} subtitle={accessory?.code} size="wide">
      <form onSubmit={submit} className="stack">
        <datalist id="acc-brand-list">{brands.map((b) => <option key={b} value={b} />)}</datalist>
        <datalist id="acc-warranty-list">{WARRANTIES.map((w) => <option key={w} value={w} />)}</datalist>
        <div className="form-grid">
          <Field label="Name" required className="span-2">
            <input className="input" placeholder="e.g. Apple 20W USB-C Power Adapter" value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Brand">
            <input className="input" list="acc-brand-list" value={f.brand} onChange={set('brand')} />
          </Field>
          <Field label="Category">
            <select className="select" value={f.category} onChange={set('category')}>
              {ACC_CATEGORIES.map((c) => <option key={c.name}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Track stock by" className="span-2" hint={used ? 'Can’t change once the item is on a bill' : f.track === 'serial' ? 'Each piece has its own serial number and warranty (adapters, AirPods, watches)' : 'Only the count (covers, glass, cables)'}>
            {used ? (
              <input className="input" value={TRACK_LABEL[f.track === 'serial' ? 'serial' : 'qty']} disabled />
            ) : (
              <Segmented
                label="Track stock by"
                value={f.track === 'serial' ? 'serial' : 'qty'}
                onChange={(v) => setF((x) => ({ ...x, track: v }))}
                options={[
                  { value: 'qty', label: 'Quantity' },
                  { value: 'serial', label: 'Serial number' },
                ]}
              />
            )}
          </Field>
          <Field label="Barcode / code" hint="Scan the box barcode, or leave empty for an auto code">
            <input className="input mono" value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toUpperCase() }))} placeholder="Auto" />
          </Field>
          <Field label="HSN code (GST)" hint={categoryHsn(f.category) ? `Usual for this category: ${categoryHsn(f.category)}` : 'Check with your CA'}>
            <input className="input mono" value={f.hsn} onChange={set('hsn')} placeholder={categoryHsn(f.category) || ''} />
          </Field>
          <Field label="Purchase price (₹)">
            <input className="input num" inputMode="decimal" value={f.purchasePrice} onChange={setAmt('purchasePrice')} />
          </Field>
          <Field label="Selling price (₹)">
            <input className="input num" inputMode="decimal" value={f.salePrice} onChange={setAmt('salePrice')} />
          </Field>
          <Field label="Warranty">
            <input className="input" list="acc-warranty-list" placeholder="e.g. 1 Year" value={f.warranty} onChange={set('warranty')} />
          </Field>
          <Field label="Low stock alert at" hint="Shows a warning at or below this count">
            <input className="input num" inputMode="numeric" value={f.lowStock} onChange={(e) => setF((x) => ({ ...x, lowStock: e.target.value.replace(/\D/g, '') }))} />
          </Field>
        </div>
        <Field label="Notes (compatible models…)">
          <input className="input" value={f.notes} onChange={set('notes')} />
        </Field>

        {!showOpening ? (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowOpening(true)}>
            + Opening stock (only for pieces already on your shelf with no purchase bill)
          </button>
        ) : (
        <div className="sub-box">
          <div className="field-label" style={{ marginBottom: 4 }}>Opening stock - pieces already on your shelf with no purchase bill</div>
          <p className="xs muted" style={{ margin: '0 0 8px' }}>New stock should come in through New Purchase (party, payment and ledger are kept there).</p>
          <div className="form-grid">
            {f.track === 'serial' ? (
              <Field label={`Serial numbers (${serials.length})`} className="span-2" hint="One per line - scan them one after another">
                <textarea className="textarea mono" rows={3} value={f.openingSerialsText} onChange={set('openingSerialsText')} />
              </Field>
            ) : (
              <Field label="Quantity">
                <input className="input num" inputMode="numeric" value={f.openingQty} onChange={(e) => setF((x) => ({ ...x, openingQty: e.target.value.replace(/\D/g, '') }))} />
              </Field>
            )}
            <Field label="Cost per piece (₹)" hint="Empty = purchase price">
              <input className="input num" inputMode="decimal" value={f.openingCost} onChange={setAmt('openingCost')} />
            </Field>
            <Field label="As on">
              <input className="input" type="date" value={f.openingDate} onChange={set('openingDate')} />
            </Field>
          </div>
        </div>
        )}

        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={() => onClose(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : accessory ? 'Save changes' : 'Add accessory'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Damaged / lost / found / count correction for one accessory. */
export function AdjustStock({ accessory, onClose }) {
  const data = useData();
  const toast = useToast();
  const [f, setF] = useState({ direction: 'out', qty: '', serialsText: '', reason: ADJUST_REASONS[0], note: '', date: today() });
  const [busy, setBusy] = useState(false);
  const st = accessory ? data.rawAccStock.get(accessory.id) : null;
  const serial = accessory?.track === 'serial';
  const picked = splitSerials(f.serialsText);

  useEffect(() => {
    if (accessory) setF({ direction: 'out', qty: '', serialsText: '', reason: ADJUST_REASONS[0], note: '', date: today() });
  }, [accessory]);

  const submit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await saveAdjustment({ accessory, date: f.date, direction: f.direction, qty: f.qty, serials: picked, reason: f.reason, note: f.note }, { accStock: data.rawAccStock });
      toast('Stock adjusted');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (s) =>
    setF((x) => {
      const cur = splitSerials(x.serialsText);
      return { ...x, serialsText: (cur.includes(s) ? cur.filter((y) => y !== s) : [...cur, s]).join('\n') };
    });

  return (
    <Modal open={Boolean(accessory)} onClose={onClose} title="Adjust stock" subtitle={accessory && `${accessory.name} · ${st?.qty ?? 0} in stock`}>
      <form onSubmit={submit} className="stack">
        <Segmented
          label="Direction"
          value={f.direction}
          onChange={(v) => setF((x) => ({ ...x, direction: v, serialsText: '', reason: v === 'out' ? ADJUST_REASONS[0] : ADJUST_REASONS[2] }))}
          options={[
            { value: 'out', label: 'Remove (damaged / lost)' },
            { value: 'in', label: 'Add (found / count)' },
          ]}
        />
        <div className="form-grid">
          {serial ? (
            <Field label={`Serial numbers (${picked.length})`} className="span-2" hint={f.direction === 'out' ? 'Tap the serials below, or scan them' : 'Scan or type the serials found'}>
              <textarea className="textarea mono" rows={3} value={f.serialsText} onChange={(e) => setF({ ...f, serialsText: e.target.value })} />
            </Field>
          ) : (
            <Field label="Quantity" required>
              <input className="input num" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, '') })} />
            </Field>
          )}
          <Field label="Reason">
            <select className="select" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
              {ADJUST_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
        </div>
        {serial && f.direction === 'out' && st?.inStock?.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            {st.inStock.map((s) => (
              <button type="button" key={s} className={`chip plain mono ${picked.includes(s) ? 'solid' : ''}`} onClick={() => toggle(s)}>{s}</button>
            ))}
          </div>
        )}
        <Field label="Note">
          <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        {st && <p className="small muted" style={{ margin: 0 }}>Valued at the average cost {money(st.avgCost)} per piece{num(f.qty) > 0 && !serial ? ` · ${money(st.avgCost * num(f.qty))}` : ''}.</p>}
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save adjustment'}</button>
        </div>
      </form>
    </Modal>
  );
}
