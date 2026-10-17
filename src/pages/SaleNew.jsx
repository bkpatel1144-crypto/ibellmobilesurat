import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Trash2, Save, Printer, Paperclip, ScanLine } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Field, Empty } from '../components/ui';
import PartySelect from '../components/PartySelect';
import PaymentFields from '../components/PaymentFields';
import { IdProofEditor } from '../components/IdProof';
import { createSale, CASH_ACCOUNT } from '../lib/db';
import { money, num, round2, today, cleanImei, deviceName } from '../lib/format';
import { gstApplies, billTotals, splitGst, validGstin, stateOf, stateName } from '../lib/gst';

let seq = 0;

export default function SaleNew() {
  const data = useData();
  const { devices, settings, privacy, advances } = data;
  const canProfit = data.can('viewProfit');
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const initial = () => {
    const pre = params.get('device');
    const d = pre && devices.find((x) => x.id === pre && x.status === 'in_stock');
    return {
      partyId: null,
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      date: today(),
      items: d ? [lineFor(d, settings)] : [],
      discount: '',
      taxPercent: null, // null = automatic from the GST settings and payment mode
      customerGstin: '',
      received: '',
      mode: 'Cash',
      accountId: CASH_ACCOUNT,
      notes: '',
      hidden: null, // null = follow the payment mode
    };
  };
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState([]);
  const [q, setQ] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [openId, setOpenId] = useState({});
  const blurTimer = useRef();

  const chosen = new Set(f.items.map((i) => i.deviceId));
  const stock = useMemo(() => devices.filter((d) => d.status === 'in_stock'), [devices]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return stock
      .filter((d) => !chosen.has(d.id))
      .filter(
        (d) =>
          !s ||
          d.imei.includes(s) ||
          (d.sn || '').toLowerCase().includes(s) ||
          (d.imei2 || '').includes(s) ||
          deviceName(d).toLowerCase().includes(s) ||
          (d.color || '').toLowerCase().includes(s),
      )
      .slice(0, 30);
  }, [stock, q, f.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const devMap = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  const addDevice = (d) => {
    setF((p) => ({ ...p, items: [...p.items, lineFor(d, settings)] }));
    setQ('');
  };
  const setItem = (i, patch) => setF((p) => ({ ...p, items: p.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const setPay = useCallback((v) => setF((p) => ({ ...p, ...v })), []);

  // exact IMEI typed or scanned + Enter → add straight away
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const imei = cleanImei(q);
    const exact = stock.find(
      (d) => !chosen.has(d.id) && (d.imei === imei || d.imei2 === imei || (d.sn && d.sn.toLowerCase() === imei.toLowerCase())),
    );
    if (exact) addDevice(exact);
    else if (matches.length === 1) addDevice(matches[0]);
  };

  // GST: automatic from Settings → Billing (e.g. only on bank payments), can be changed per bill
  const autoRate = gstApplies(settings, f.mode) ? num(settings.gstRate) : 0;
  const rate = f.taxPercent === null ? autoRate : num(f.taxPercent);
  const inclusive = settings.gstInclusive !== false;
  const subtotal = round2(f.items.reduce((s, it) => s + num(it.price), 0));
  const { taxable, tax, total } = billTotals({ subtotal, discount: f.discount, rate, inclusive });
  const split = splitGst(tax, settings.gstin, f.customerGstin);
  // advance (booking amount) this customer paid earlier on account is adjusted against the bill
  const advanceFree = f.partyId ? advances?.get(f.partyId)?.in || 0 : 0;
  const advance = round2(Math.min(advanceFree, Math.max(0, total - num(f.received))));
  const balance = round2(total - num(f.received) - advance);
  const cost = f.items.reduce((s, it) => {
    const d = devMap.get(it.deviceId);
    return s + num(d?.purchasePrice) + num(d?.repairCost);
  }, 0);

  // Cash sales are private by default; the owner (unlocked) can override per sale
  const hidden = privacy.unlocked && f.hidden !== null ? f.hidden : f.mode === 'Cash';

  const validate = () => {
    const errs = [];
    if (!f.items.length) errs.push('Add at least one device.');
    f.items.forEach((it, i) => {
      if (num(it.price) <= 0) errs.push(`Device ${i + 1}: enter the selling price.`);
    });
    if (balance > 0.004 && !f.partyId) errs.push('Amount received is less than total. Select a party to sell on credit.');
    if (num(f.received) > total + 0.004) errs.push('Amount received is more than the bill total.');
    return errs;
  };

  const save = async (print) => {
    const errs = validate();
    setErrors(errs);
    if (errs.length) return;
    setBusy(print ? 'print' : 'save');
    try {
      const { id, invoiceNo, sale } = await createSale({ ...f, taxPercent: rate, hidden }, { settings, sales: data.raw.sales, devices: data.raw.devices });
      toast(`Bill ${invoiceNo} saved`);
      if (print) {
        const { invoicePdf } = await import('../lib/export');
        await invoicePdf(sale, settings, { action: 'print' });
      }
      if (hidden && !privacy.unlocked) {
        // the bill is private now - start a fresh one
        setF(initial());
        setOpenId({});
        setBusy('');
      } else {
        navigate(`/sales/${id}`);
      }
    } catch (err) {
      toast(err.message, 'error');
      setBusy('');
    }
  };

  return (
    <form
      className="page"
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <PageHeader
        title="New Sale"
        subtitle="Create a bill"
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
            <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => save(true)}>
              <Printer size={16} /> {busy === 'print' ? 'Saving…' : 'Save & Print'}
            </button>
            <button className="btn btn-primary" disabled={Boolean(busy)}>
              <Save size={16} /> {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      />

      <div className="stack">
        <section className="card card-lg">
          <div className="card-head"><h2>Customer</h2></div>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            <Field label="Party (optional - needed for credit)" className="span-2">
              <PartySelect
                value={f.partyId}
                allowEmpty
                emptyLabel="Walk-in customer"
                defaultType="customer"
                onChange={(p) =>
                  setF((x) => ({
                    ...x,
                    partyId: p?.id || null,
                    customerName: p?.name || '',
                    customerPhone: p?.phone || '',
                    customerAddress: p?.address || '',
                    customerGstin: p?.gstin || '',
                  }))
                }
              />
            </Field>
            <Field label="Date" required>
              <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
            </Field>
            <Field label="Customer name">
              <input className="input" placeholder="Walk-in Customer" value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <input className="input" inputMode="tel" value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} />
            </Field>
            <Field label="Address">
              <input className="input" value={f.customerAddress} onChange={(e) => setF({ ...f, customerAddress: e.target.value })} />
            </Field>
            {settings.gstEnabled && (
              <Field
                label="Customer GSTIN (business buyer)"
                hint={
                  f.customerGstin
                    ? validGstin(f.customerGstin)
                      ? `${stateName(stateOf(f.customerGstin))} · ${split.inter ? 'IGST (other state)' : 'CGST + SGST'}`
                      : 'Check the GSTIN - 15 characters'
                    : 'Optional'
                }
              >
                <input className="input mono" maxLength={15} value={f.customerGstin} onChange={(e) => setF({ ...f, customerGstin: e.target.value.toUpperCase() })} />
              </Field>
            )}
          </div>
        </section>

        <section className="card card-lg">
          <div className="card-head">
            <h2>Devices ({f.items.length})</h2>
            <span className="muted small">{stock.length} in stock</span>
          </div>

          <div className="combo" style={{ marginBottom: 16 }}>
            <div className="input-group">
              {q ? <Search size={16} /> : <ScanLine size={16} />}
              <input
                className="input"
                placeholder="Scan barcode / type IMEI or SN, or search model…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => setPickOpen(true)}
                onBlur={() => (blurTimer.current = setTimeout(() => setPickOpen(false), 150))}
                onKeyDown={onSearchKey}
                aria-label="Find device"
              />
            </div>
            {pickOpen && (
              <div className="combo-list glass--large" onMouseDown={() => clearTimeout(blurTimer.current)}>
                {matches.map((d) => (
                  <button type="button" key={d.id} className="combo-item" onMouseDown={(e) => e.preventDefault()} onClick={() => addDevice(d)}>
                    <span>
                      <span className="cell-main">{deviceName(d)}</span>{' '}
                      <span className="muted small">{d.color}</span>
                      <div className="cell-sub mono">{[d.sn, d.imei, d.battery != null && `BH ${d.battery}%`].filter(Boolean).join(' · ')}</div>
                    </span>
                    <span className="chip plain">{d.condition}</span>
                  </button>
                ))}
                {!matches.length && <div className="muted small" style={{ padding: 12 }}>No matching device in stock.</div>}
              </div>
            )}
          </div>

          {f.items.length ? (
            <div className="stack">
              {f.items.map((it, i) => {
                const d = devMap.get(it.deviceId);
                const c = num(d?.purchasePrice) + num(d?.repairCost);
                return (
                  <div className="line" key={it.key}>
                    <div className="line-head">
                      <div className="row" style={{ gap: 10, minWidth: 0 }}>
                        <span className="line-index">{i + 1}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="cell-main">{deviceName(d)} {d?.color && <span className="muted">· {d.color}</span>}</div>
                          <div className="cell-sub mono">
                            {[d?.sn && `SN ${d.sn}`, [d?.imei, d?.imei2].filter(Boolean).join(' / '), d?.battery != null && `BH ${d.battery}%`].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="chip plain">{d?.condition}</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm btn-danger"
                          aria-label="Remove device"
                          onClick={() => setF((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="form-grid">
                      <Field label="Selling price (₹)" required hint={canProfit ? `Cost ${money(c)}${num(it.price) ? ` · margin ${money(num(it.price) - c)}` : ''}` : undefined}>
                        <input className="input num" type="number" min="0" step="0.01" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} autoFocus={i === f.items.length - 1} />
                      </Field>
                      <Field label="Warranty">
                        <input className="input" placeholder="e.g. 6 months shop warranty" value={it.warranty} onChange={(e) => setItem(i, { warranty: e.target.value })} />
                      </Field>
                    </div>
                    {openId[it.key] || it.idFiles.length || it.idType ? (
                      <IdProofEditor title="Buyer ID proof (optional)" value={it} onChange={(v) => setItem(i, v)} />
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setOpenId((o) => ({ ...o, [it.key]: true }))}>
                        <Paperclip size={15} /> Add buyer ID proof
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty icon={ScanLine} title="No device added">Scan the IMEI or search above to add devices to this bill.</Empty>
          )}
        </section>

        <section className="card card-lg">
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <div className="stack">
              <h2 style={{ fontSize: 16 }}>Payment</h2>
              <div className="form-grid">
                <PaymentFields mode={f.mode} accountId={f.accountId} onChange={setPay} />
                <Field label="Amount received (₹)">
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <input className="input num" type="number" min="0" step="0.01" value={f.received} onChange={(e) => setF({ ...f, received: e.target.value })} />
                    <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, received: String(round2(Math.max(0, total - advanceFree))) })}>Full</button>
                  </div>
                </Field>
              </div>
              <Field label="Notes">
                <textarea className="textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              </Field>
              {privacy.unlocked && (
                <label className="check small">
                  <input type="checkbox" checked={hidden} onChange={(e) => setF({ ...f, hidden: e.target.checked })} />
                  Private sale - hide this bill and its devices when locked
                </label>
              )}
            </div>
            <div className="totals">
              <div><span className="muted">Subtotal</span><b className="num">{money(subtotal)}</b></div>
              <div>
                <span className="muted">Discount</span>
                <input className="input num" type="number" min="0" step="0.01" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} aria-label="Discount" />
              </div>
              <div>
                <span className="muted">
                  GST %
                  {f.taxPercent !== null && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ height: 22, padding: '0 6px' }} onClick={() => setF({ ...f, taxPercent: null })}>
                      auto
                    </button>
                  )}
                </span>
                <input className="input num" type="number" min="0" step="0.01" value={f.taxPercent === null ? rate : f.taxPercent} onChange={(e) => setF({ ...f, taxPercent: e.target.value })} aria-label="GST percent" />
              </div>
              {settings.gstEnabled && (
                <div>
                  {rate > 0 ? (
                    <span className="chip solid">Tax invoice · GST {rate}% {inclusive ? 'included' : 'added'}</span>
                  ) : (
                    <span className="chip plain">{f.mode === 'Cash' && settings.gstOn !== 'all' ? 'Cash bill · no GST' : 'No GST'}</span>
                  )}
                </div>
              )}
              {tax > 0 && (
                <>
                  <div><span className="muted">Taxable value</span><span className="num">{money(taxable)}</span></div>
                  {split.inter ? (
                    <div><span className="muted">IGST {rate}%</span><span className="num">{money(split.igst)}</span></div>
                  ) : (
                    <>
                      <div><span className="muted">CGST {rate / 2}%</span><span className="num">{money(split.cgst)}</span></div>
                      <div><span className="muted">SGST {rate / 2}%</span><span className="num">{money(split.sgst)}</span></div>
                    </>
                  )}
                </>
              )}
              <div className="grand"><span>Total</span><span className="num">{money(total)}</span></div>
              <div><span className="muted">Received</span><span className="num">{money(num(f.received))}</span></div>
              {advance > 0 && <div><span className="muted">Advance adjusted</span><span className="num">{money(advance)}</span></div>}
              <div><span className="muted">Balance due</span><b className="num">{money(Math.max(balance, 0))}</b></div>
              {canProfit && privacy.unlocked && f.items.length > 0 && (
                <div><span className="muted">Profit</span><span className="num">{money(taxable - cost)}</span></div>
              )}
            </div>
          </div>
          {errors.length > 0 && (
            <ul className="form-error" role="alert" style={{ margin: '16px 0 0', paddingLeft: 18 }}>
              {errors.map((er) => <li key={er}>{er}</li>)}
            </ul>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => save(true)}>
              <Printer size={16} /> Save & Print
            </button>
            <button className="btn btn-primary" disabled={Boolean(busy)}>
              <Save size={16} /> Save bill
            </button>
          </div>
        </section>
      </div>
    </form>
  );
}

function lineFor(d, settings) {
  seq += 1;
  return {
    key: seq,
    deviceId: d.id,
    price: '',
    warranty: d.warranty || (d.condition === 'New' ? 'As per brand warranty' : settings.defaultWarranty || ''),
    idType: '',
    idNumber: '',
    idFiles: [],
  };
}
