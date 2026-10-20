import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Copy, Wrench, Save, Headphones } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Field, Segmented, Empty, SkeletonPage } from '../components/ui';
import PartySelect from '../components/PartySelect';
import PaymentFields from '../components/PaymentFields';
import { IdProofEditor } from '../components/IdProof';
import AccessoryPicker from '../components/AccessoryPicker';
import AccessoryForm, { splitSerials } from '../components/AccessoryForm';
import { accLines, billCountText } from '../lib/accessories';
import { createPurchase, updatePurchase, CASH_ACCOUNT } from '../lib/db';
import { money, num, round2, today, cleanImei, amountText } from '../lib/format';

export const BRANDS = ['Apple', 'Samsung', 'OnePlus', 'Xiaomi', 'Redmi', 'Realme', 'Vivo', 'Oppo', 'iQOO', 'Motorola', 'Nothing', 'Google', 'Poco', 'Nokia', 'Infinix', 'Tecno', 'Lava'];

let seq = 0;
const blankItem = () => ({
  key: (seq += 1),
  imei: '',
  imei2: '',
  brand: '',
  model: '',
  variant: '',
  color: '',
  battery: '',
  warranty: '',
  condition: 'Used',
  price: '',
  notes: '',
  idType: '',
  idNumber: '',
  idFiles: [],
  repair: { send: false, partyId: null, partyName: '', repairer: '', issue: '' },
});

/** One accessory line on the form (serials typed / scanned one per line). */
const accLine = (a, serial = '') => ({ key: (seq += 1), accessoryId: a.id, qty: a.track === 'serial' ? '' : '1', rate: a.purchasePrice ? String(a.purchasePrice) : '', serialsText: serial });

/** One form for new and edit; a key per purchase so moving between them starts fresh. */
export default function PurchaseNew() {
  const { id } = useParams();
  const { ready } = useData();
  if (id && !ready) return <SkeletonPage />;
  return <PurchaseForm key={id || 'new'} editId={id} />;
}

function PurchaseForm({ editId }) {
  const data = useData();
  const { devices, settings, purchases } = data;
  const [params] = useSearchParams();
  const accessoryMode = params.get('accessories') === '1'; // "Buy stock" from the Accessories page
  const toast = useToast();
  const navigate = useNavigate();
  const editing = Boolean(editId);
  const canDelete = data.can('deleteRecords');
  const original = editing ? data.raw.purchases.find((p) => p.id === editId) : null; // what is saved
  const shown = editing ? purchases.find((p) => p.id === editId) : null; // what this user may see
  const rawDevices = useMemo(() => new Map(data.raw.devices.map((d) => [d.id, d])), [data.raw.devices]);

  const fromPurchase = (p) => ({
    partyId: p.partyId,
    partyName: p.partyName,
    date: p.date,
    billNo: p.supplierBillNo || '',
    items: p.items.map((line) => {
      const d = rawDevices.get(line.deviceId) || {};
      return {
        ...blankItem(),
        deviceId: line.deviceId,
        status: d.status || 'in_stock',
        sn: d.sn || line.sn || '',
        imei: d.imei ?? line.imei ?? '',
        imei2: d.imei2 ?? line.imei2 ?? '',
        brand: d.brand ?? line.brand ?? '',
        model: d.model ?? line.model ?? '',
        variant: d.variant ?? line.variant ?? '',
        color: d.color ?? line.color ?? '',
        battery: d.battery ?? '',
        warranty: d.warranty || '',
        condition: d.condition || line.condition || 'Used',
        price: String(d.purchasePrice ?? line.price ?? ''),
        notes: d.notes || '',
        idType: d.sellerIdType || line.idType || '',
        idNumber: d.sellerIdNumber || line.idNumber || '',
        idFiles: d.sellerIdProofs || line.idProofs || [],
      };
    }),
    accessories: accLines(p).map((l) => ({ key: (seq += 1), accessoryId: l.accessoryId, qty: String(l.qty), rate: String(l.rate ?? ''), serialsText: (l.serials || []).join('\n') })),
    otherCharges: p.otherCharges ? String(p.otherCharges) : '',
    discount: p.discount ? String(p.discount) : '',
    paid: '',
    mode: 'Cash',
    accountId: CASH_ACCOUNT,
    notes: p.notes || '',
  });

  const [f, setF] = useState(() =>
    shown
      ? fromPurchase(shown)
      : {
          partyId: null,
          partyName: '',
          date: today(),
          billNo: '',
          items: accessoryMode ? [] : [blankItem()],
          accessories: [],
          otherCharges: '',
          discount: '',
          paid: '',
          mode: 'Cash',
          accountId: CASH_ACCOUNT,
          notes: '',
        },
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);

  const brands = useMemo(() => [...new Set([...BRANDS, ...devices.map((d) => d.brand).filter(Boolean)])].sort(), [devices]);
  const models = useMemo(() => [...new Set(devices.map((d) => d.model).filter(Boolean))].sort(), [devices]);

  const setItem = (i, patch) => setF((p) => ({ ...p, items: p.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const setAcc = (i, patch) => setF((p) => ({ ...p, accessories: p.accessories.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const accById = useMemo(() => new Map(data.accessories.map((a) => [a.id, a])), [data.accessories]);
  const [newAcc, setNewAcc] = useState(null); // name typed in the picker → New accessory form
  const accSerials = (l) => splitSerials(l.serialsText);
  const accQty = (l) => (accById.get(l.accessoryId)?.track === 'serial' ? accSerials(l).length : Math.max(0, Math.round(num(l.qty))));
  const addAcc = (a, serial = '') =>
    setF((p) => {
      const at = p.accessories.findIndex((l) => l.accessoryId === a.id);
      if (at < 0) return { ...p, accessories: [...p.accessories, accLine(a, serial)] };
      // already on the bill: one more piece / serial on the same line
      return {
        ...p,
        accessories: p.accessories.map((l, j) =>
          j !== at ? l : a.track === 'serial' ? { ...l, serialsText: serial ? [...splitSerials(l.serialsText), serial].join('\n') : l.serialsText } : { ...l, qty: String(Math.round(num(l.qty)) + 1) },
        ),
      };
    });
  const setPay = useCallback((v) => setF((p) => ({ ...p, ...v })), []);

  const accTotal = round2(f.accessories.reduce((s, l) => s + accQty(l) * num(l.rate), 0));
  const subtotal = round2(f.items.reduce((s, it) => s + num(it.price), 0) + accTotal);
  const total = round2(subtotal + num(f.otherCharges) - num(f.discount));
  // advance already paid to this supplier (on account) is adjusted against the new purchase
  const advance = editing || !f.partyId ? 0 : round2(Math.min(data.advances?.get(f.partyId)?.out || 0, Math.max(0, total - num(f.paid))));
  const due = round2(total - num(f.paid) - advance);

  const validate = () => {
    const errs = [];
    if (!f.partyId) errs.push('Select the party you are buying from.');
    if (!f.items.length && !f.accessories.length) errs.push('Add at least one phone or accessory.');
    const serialSeen = new Set();
    f.accessories.forEach((l) => {
      const a = accById.get(l.accessoryId);
      const n = a?.name || 'Accessory';
      if (!a) return errs.push('An accessory on this purchase no longer exists - remove that line.');
      if (accQty(l) <= 0) errs.push(`${n}: ${a.track === 'serial' ? 'scan or type the serial numbers' : 'enter the quantity'}.`);
      if (num(l.rate) <= 0) errs.push(`${n}: enter the purchase rate per piece.`);
      for (const sr of a.track === 'serial' ? accSerials(l) : []) {
        if (serialSeen.has(sr)) errs.push(`Serial ${sr} is entered twice.`);
        serialSeen.add(sr);
      }
    });
    const own = new Set(f.items.map((it) => it.deviceId).filter(Boolean));
    const live = new Set(devices.filter((d) => d.status !== 'sold' && d.status !== 'returned' && !own.has(d.id)).map((d) => d.imei));
    const seen = new Set();
    f.items.forEach((it, i) => {
      const n = `Device ${i + 1}`;
      const imei = cleanImei(it.imei);
      if (imei.length < 5) errs.push(`${n}: enter the IMEI / serial number.`);
      if (!it.brand.trim() || !it.model.trim()) errs.push(`${n}: brand and model are required.`);
      if (num(it.price) <= 0) errs.push(`${n}: enter the purchase price.`);
      if (imei && seen.has(imei)) errs.push(`${n}: IMEI ${imei} is entered twice.`);
      if (imei && live.has(imei)) errs.push(`${n}: IMEI ${imei} is already in stock.`);
      seen.add(imei);
    });
    if (total < 0) errs.push('Total cannot be negative.');
    return errs;
  };

  // the form keeps serials as text - the save functions take a list
  const accForm = (x) => ({ ...x, accessories: x.accessories.map((l) => ({ accessoryId: l.accessoryId, qty: accQty(l), rate: l.rate, serials: accSerials(l) })) });

  const save = async (e) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    if (editing) {
      try {
        await updatePurchase(original, accForm(f), {
          settings,
          devices: data.raw.devices,
          sales: data.raw.sales,
          repairs: data.raw.repairs,
          payments: data.raw.payments,
          returns: data.raw.returns,
          accessories: data.raw.accessories,
          accStock: data.rawAccStock,
          // locked: the form shows only what is not on a private bill - the rest is kept as it is
          shownAccessories: data.privacy.unlocked ? null : accLines(shown),
        });
        toast(`${shown.purchaseNo} updated`);
        navigate(`/purchases/${editId}`);
      } catch (err) {
        toast(err.message, 'error');
        setBusy(false);
      }
      return;
    }
    try {
      const { id, purchaseNo, devices: saved } = await createPurchase(accForm(f), {
        settings,
        purchases: data.raw.purchases,
        devices: data.raw.devices,
        accessories: data.raw.accessories,
        accStock: data.rawAccStock,
      });
      toast(`Purchase ${purchaseNo} saved`);
      if (settings.autoPrintLabels && saved.length) {
        const { printLabels } = await import('../lib/labels');
        printLabels(saved, settings).catch((err) => toast(err.message, 'error'));
      }
      navigate(`/purchases/${id}`);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  if (editing && !shown) {
    return (
      <div className="page">
        <PageHeader title="Edit purchase" />
        <div className="card"><Empty title="Purchase not found" action={<Link className="btn" to="/purchases">Back to purchases</Link>} /></div>
      </div>
    );
  }

  // SN preview: existing phones keep theirs, new ones take the next numbers in order
  let nextSn = Math.floor(Number(settings.snNext)) || 1;
  const snOf = (it) => (it.deviceId ? it.sn : `${settings.snPrefix}${nextSn++}`);

  return (
    <form className="page" onSubmit={save}>
      <PageHeader
        title={editing ? `Edit ${shown.purchaseNo}` : 'New Purchase'}
        subtitle={editing ? 'Change details, add phones, or remove phones still in stock' : 'Add one or many devices in a single purchase'}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>
              <Save size={16} /> {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      />

      <datalist id="brand-list">{brands.map((b) => <option key={b} value={b} />)}</datalist>
      <datalist id="model-list">{models.map((m) => <option key={m} value={m} />)}</datalist>
      <datalist id="warranty-list">
        {['No Warranty', '7 Days Checking', '1 Month', '3 Months', '6 Months', '1 Year', 'Brand Warranty'].map((w) => <option key={w} value={w} />)}
      </datalist>

      <div className="stack">
        <section className="card card-lg">
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            <Field label="Purchased from (party)" required className="span-2">
              <PartySelect
                value={f.partyId}
                defaultType="supplier"
                onChange={(p) => setF((x) => ({ ...x, partyId: p?.id || null, partyName: p?.name || '' }))}
              />
            </Field>
            <Field label="Date" required>
              <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
            </Field>
            <Field label="Supplier bill no.">
              <input className="input" value={f.billNo} onChange={(e) => setF({ ...f, billNo: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="card card-lg">
          <div className="card-head">
            <h2>Devices ({f.items.length})</h2>
            <button type="button" className="btn btn-sm" onClick={() => setF((p) => ({ ...p, items: [...p.items, blankItem()] }))}>
              <Plus size={16} /> Add device
            </button>
          </div>
          <div className="stack">
            {f.items.map((it, i) => (
              <div className="line" key={it.key}>
                <div className="line-head">
                  <div className="row" style={{ gap: 10 }}>
                    <span className="line-index">{i + 1}</span>
                    <b>{[it.brand, it.model].filter(Boolean).join(' ') || 'Device'}</b>
                    <span className="chip plain mono" title={it.deviceId ? 'Stock number' : 'SN is given automatically when you save'}>
                      SN {snOf(it) || '—'}
                    </span>
                    {it.status === 'sold' && <span className="chip">Sold</span>}
                    {it.status === 'in_repair' && <span className="chip caution">At repair</span>}
                    {it.status === 'returned' && <span className="chip urgent">Returned</span>}
                    {editing && !it.deviceId && <span className="chip success">New</span>}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Copy as new device (same model)"
                      onClick={() =>
                        setF((p) => {
                          const copy = { ...blankItem(), brand: it.brand, model: it.model, variant: it.variant, color: it.color, condition: it.condition, price: it.price, warranty: it.warranty };
                          const items = [...p.items];
                          items.splice(i + 1, 0, copy);
                          return { ...p, items };
                        })
                      }
                    >
                      <Copy size={15} /> Copy
                    </button>
                    {(f.items.length > 1 || f.accessories.length > 0) && (!it.deviceId || (it.status === 'in_stock' && canDelete)) && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm btn-danger"
                        aria-label={`Remove device ${i + 1}`}
                        onClick={() => setF((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="form-grid">
                  <Field label="IMEI 1 / Serial" required>
                    <input className="input mono" value={it.imei} onChange={(e) => setItem(i, { imei: e.target.value })} inputMode="numeric" disabled={it.status === 'sold' || it.status === 'returned'} title={it.status === 'sold' ? 'Sold - the IMEI is on the customer bill' : it.status === 'returned' ? 'Returned to the supplier' : undefined} />
                  </Field>
                  <Field label="IMEI 2">
                    <input className="input mono" value={it.imei2} onChange={(e) => setItem(i, { imei2: e.target.value })} inputMode="numeric" disabled={it.status === 'sold' || it.status === 'returned'} />
                  </Field>
                  <Field label="Brand" required>
                    <input className="input" list="brand-list" value={it.brand} onChange={(e) => setItem(i, { brand: e.target.value })} />
                  </Field>
                  <Field label="Model" required>
                    <input className="input" list="model-list" value={it.model} onChange={(e) => setItem(i, { model: e.target.value })} />
                  </Field>
                  <Field label="RAM / Storage">
                    <input className="input" placeholder="8GB / 128GB" value={it.variant} onChange={(e) => setItem(i, { variant: e.target.value })} />
                  </Field>
                  <Field label="Colour">
                    <input className="input" value={it.color} onChange={(e) => setItem(i, { color: e.target.value })} />
                  </Field>
                  <Field label="Battery health (%)">
                    <input className="input num" type="number" min="0" max="100" placeholder="e.g. 95" value={it.battery} onChange={(e) => setItem(i, { battery: e.target.value })} />
                  </Field>
                  <Field label="Warranty">
                    <input className="input" list="warranty-list" placeholder="e.g. 6 Months" value={it.warranty} onChange={(e) => setItem(i, { warranty: e.target.value })} />
                  </Field>
                  <Field label="Condition">
                    <Segmented
                      label="Condition"
                      value={it.condition}
                      onChange={(v) => setItem(i, { condition: v })}
                      options={[
                        { value: 'New', label: 'New' },
                        { value: 'Used', label: 'Used' },
                      ]}
                    />
                  </Field>
                  <Field label="Purchase price (₹)" required>
                    <input className="input num" type="number" min="0" step="0.01" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} />
                  </Field>
                </div>
                <Field label="Notes (accessories, defects…)" style={{ marginTop: 12 }}>
                  <input className="input" value={it.notes} onChange={(e) => setItem(i, { notes: e.target.value })} />
                </Field>

                <IdProofEditor title="Seller ID proof (optional)" value={it} onChange={(v) => setItem(i, v)} />

                {!it.deviceId && (
                <div className="sub-box">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={it.repair.send}
                      onChange={(e) => setItem(i, { repair: { ...it.repair, send: e.target.checked } })}
                    />
                    <Wrench size={15} /> Send this device to repair
                  </label>
                  {it.repair.send && (
                    <div className="form-grid" style={{ marginTop: 12 }}>
                      <Field label="Repairer (party)">
                        <PartySelect
                          value={it.repair.partyId}
                          allowEmpty
                          emptyLabel="No party (enter name)"
                          defaultType="repairer"
                          onChange={(p) => setItem(i, { repair: { ...it.repair, partyId: p?.id || null, partyName: p?.name || '' } })}
                        />
                      </Field>
                      {!it.repair.partyId && (
                        <Field label="Repairer name">
                          <input className="input" value={it.repair.repairer} onChange={(e) => setItem(i, { repair: { ...it.repair, repairer: e.target.value } })} />
                        </Field>
                      )}
                      <Field label="Problem / work needed">
                        <input className="input" value={it.repair.issue} onChange={(e) => setItem(i, { repair: { ...it.repair, issue: e.target.value } })} />
                      </Field>
                    </div>
                  )}
                </div>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 16, width: '100%' }}
            onClick={() => setF((p) => ({ ...p, items: [...p.items, blankItem()] }))}
          >
            <Plus size={16} /> Add another device
          </button>
        </section>

        <section className="card card-lg">
          <div className="card-head">
            <h2>Accessories ({f.accessories.length})</h2>
            {accTotal > 0 && <span className="muted small num">{money(accTotal)}</span>}
          </div>
          <div style={{ marginBottom: f.accessories.length ? 16 : 0 }}>
            <AccessoryPicker onPick={(a, serial) => addAcc(a, serial)} onCreate={(name) => setNewAcc({ name })} placeholder="Scan box barcode, or search / add accessory…" />
          </div>
          <div className="stack">
            {f.accessories.map((l, i) => {
              const a = accById.get(l.accessoryId);
              const st = data.accStock.get(l.accessoryId);
              const serial = a?.track === 'serial';
              const list = accSerials(l);
              return (
                <div className="line" key={l.key}>
                  <div className="line-head">
                    <div className="row" style={{ gap: 10, minWidth: 0 }}>
                      <span className="line-index"><Headphones size={14} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="cell-main">{a?.name || 'Accessory'}</div>
                        <div className="cell-sub">{[a?.brand, a?.code, serial ? 'Serial no.' : 'Counted', `${st?.qty ?? 0} in stock now`].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="num cell-main">{money(accQty(l) * num(l.rate))}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm btn-danger"
                        aria-label={`Remove ${a?.name || 'accessory'}`}
                        onClick={() => setF((p) => ({ ...p, accessories: p.accessories.filter((_, j) => j !== i) }))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="form-grid">
                    {serial ? (
                      <Field label={`Serial numbers (${list.length})`} className="span-2" hint="Scan each piece - one per line">
                        <textarea className="textarea mono" rows={Math.min(6, Math.max(2, list.length + 1))} value={l.serialsText} onChange={(e) => setAcc(i, { serialsText: e.target.value })} aria-label={`${a?.name} serial numbers`} />
                      </Field>
                    ) : (
                      <Field label="Quantity" required>
                        <input className="input num" inputMode="numeric" value={l.qty} onChange={(e) => setAcc(i, { qty: e.target.value.replace(/\D/g, '') })} aria-label={`${a?.name} quantity`} />
                      </Field>
                    )}
                    <Field label="Rate per piece (₹)" required>
                      <input className="input num" inputMode="decimal" value={l.rate} onChange={(e) => setAcc(i, { rate: amountText(e.target.value) })} aria-label={`${a?.name} rate`} />
                    </Field>
                  </div>
                </div>
              );
            })}
            {!f.accessories.length && <p className="muted small" style={{ margin: 0 }}>Chargers, cables, covers… scan the barcode or search above. Items not in the list can be added on the spot.</p>}
          </div>
        </section>

        <section className="card card-lg">
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <div className="stack">
              {editing ? (
                <>
                  <h2 style={{ fontSize: 16 }}>Payments</h2>
                  <p className="small muted" style={{ margin: 0 }}>
                    Paid so far: <b>{money(shown.paid)}</b>. Record or change payments on the purchase page or in Payments.
                  </p>
                </>
              ) : (
                <>
                  <h2 style={{ fontSize: 16 }}>Payment</h2>
                  <div className="form-grid">
                    <PaymentFields mode={f.mode} accountId={f.accountId} onChange={setPay} />
                    <Field label="Paid now (₹)">
                      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <input className="input num" type="number" min="0" step="0.01" value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} />
                        <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, paid: String(round2(Math.max(0, total - (data.advances?.get(f.partyId)?.out || 0)))) })}>Full</button>
                      </div>
                    </Field>
                  </div>
                </>
              )}
              <Field label="Notes">
                <textarea className="textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              </Field>
            </div>
            <div className="totals">
              <div>
                <span className="muted">Subtotal ({billCountText({ items: f.items, accessories: f.accessories.map((l) => ({ qty: accQty(l) })) })})</span>
                <b className="num">{money(subtotal)}</b>
              </div>
              <div>
                <span className="muted">Other charges</span>
                <input className="input num" type="number" min="0" step="0.01" value={f.otherCharges} onChange={(e) => setF({ ...f, otherCharges: e.target.value })} aria-label="Other charges" />
              </div>
              <div>
                <span className="muted">Discount</span>
                <input className="input num" type="number" min="0" step="0.01" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} aria-label="Discount" />
              </div>
              <div className="grand">
                <span>Total</span>
                <span className="num">{money(total)}</span>
              </div>
              {!editing && (
                <>
                  <div>
                    <span className="muted">Paid</span>
                    <span className="num">{money(num(f.paid))}</span>
                  </div>
                  {advance > 0 && (
                    <div>
                      <span className="muted">Advance adjusted</span>
                      <span className="num">{money(advance)}</span>
                    </div>
                  )}
                  <div>
                    <span className="muted">{due >= 0 ? 'Balance to pay' : 'Paid extra'}</span>
                    <b className="num">{money(Math.abs(due))}</b>
                  </div>
                </>
              )}
            </div>
          </div>
          {errors.length > 0 && (
            <ul className="form-error" role="alert" style={{ margin: '16px 0 0', paddingLeft: 18 }}>
              {errors.map((er) => <li key={er}>{er}</li>)}
            </ul>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
            <button className="btn btn-primary" disabled={busy}>
              <Save size={16} /> {busy ? 'Saving…' : editing ? 'Save changes' : 'Save purchase'}
            </button>
          </div>
        </section>
      </div>
      <AccessoryForm
        open={Boolean(newAcc)}
        accessory={null}
        initialName={newAcc?.name || ''}
        onClose={(saved) => {
          setNewAcc(null);
          // the new item arrives from Firestore a moment later; the line shows its name as soon as it does
          if (saved) addAcc({ id: saved.id, track: saved.track, purchasePrice: saved.purchasePrice });
        }}
      />
    </form>
  );
}
