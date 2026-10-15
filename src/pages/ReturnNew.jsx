import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Search, Save, Undo2, ScanBarcode } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Field, Segmented, Empty, SkeletonPage } from '../components/ui';
import PaymentFields from '../components/PaymentFields';
import { createReturn, updateReturn, CASH_ACCOUNT } from '../lib/db';
import { REASONS, KIND_LABEL, NOTE_TITLE, returnTotals, returnableSaleLines, returnablePurchaseLines, returnOf, saleLineValue, suggestedRefund } from '../lib/returns';
import { money, num, round2, today, fmtDate, cleanImei } from '../lib/format';

/** One form for a new return and for editing one; keyed so switching bills starts fresh. */
export default function ReturnNew() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { ready } = useData();
  if (!ready) return <SkeletonPage />;
  const kind = params.get('kind') === 'purchase' ? 'purchase' : 'sale';
  return <ReturnForm key={id || `${kind}-${params.get('bill') || ''}`} noteId={id} startKind={kind} startBill={params.get('bill')} startDevice={params.get('device')} />;
}

function ReturnForm({ noteId, startKind, startBill, startDevice }) {
  const data = useData();
  const { settings, devices, returns, can } = data;
  const canProfit = can('viewProfit');
  const toast = useToast();
  const navigate = useNavigate();
  const editing = Boolean(noteId);
  const note = editing ? returns.find((x) => x.id === noteId) : null;
  const rawNote = editing ? data.raw.returns.find((x) => x.id === noteId) : null;

  const [kind, setKind] = useState(note?.kind || startKind);
  const [billId, setBillId] = useState(note?.billId || startBill || null);
  const [q, setQ] = useState('');
  const sale = kind === 'sale';
  const bills = sale ? data.sales : data.purchases;
  const bill = billId ? bills.find((b) => b.id === billId) : null;

  // lines that can come back now (edit: exactly the note's lines)
  const returnable = useMemo(() => {
    if (!bill) return [];
    if (editing) return bill.items.filter((it) => note.items.some((i) => i.deviceId === it.deviceId));
    return sale ? returnableSaleLines(bill, devices) : returnablePurchaseLines(bill, devices);
  }, [bill, devices, sale, editing, note]);

  const devMap = useMemo(() => new Map(data.raw.devices.map((d) => [d.id, d])), [data.raw.devices]);
  const costOf = useCallback(
    (it) => {
      if (sale) return num(it.cost);
      const d = devMap.get(it.deviceId);
      return round2(num(d?.purchasePrice ?? it.price) + num(d?.repairCost));
    },
    [sale, devMap],
  );
  const fullValue = useCallback((it) => (sale ? saleLineValue(bill, it) : num(it.price)), [sale, bill]);

  // picked: deviceId → amount typed
  const [picked, setPicked] = useState(() => {
    if (note) return Object.fromEntries(note.items.map((i) => [i.deviceId, String(i.value)]));
    if (!bill) return {};
    const lines = sale ? returnableSaleLines(bill, devices) : returnablePurchaseLines(bill, devices);
    const only = startDevice ? lines.filter((l) => l.deviceId === startDevice) : lines.length === 1 ? lines : [];
    return Object.fromEntries(only.map((l) => [l.deviceId, String(sale ? saleLineValue(bill, l) : num(l.price))]));
  });
  const [f, setF] = useState(() => ({
    date: note?.date || today(),
    reason: note?.reason || REASONS[note?.kind || startKind][0],
    notes: note?.notes || '',
    refund: null, // null = follow the suggestion
    mode: 'Cash',
    accountId: CASH_ACCOUNT,
  }));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const setPay = useCallback((v) => setF((p) => ({ ...p, ...v })), []);

  const lines = returnable
    .filter((it) => picked[it.deviceId] !== undefined)
    .map((it) => ({ ...it, cost: costOf(it), value: num(picked[it.deviceId]) }));
  const t = bill ? returnTotals(kind, bill, lines) : null;
  const walkIn = sale && bill && !bill.partyId;
  const suggest = t ? suggestedRefund(kind, bill, t.total) : 0;
  const refund = walkIn ? t?.total || 0 : f.refund === null ? suggest : num(f.refund);
  const party = bill ? (sale ? bill.customerName : bill.partyName) : '';

  const pickBill = (b, deviceId) => {
    setBillId(b.id);
    const ls = sale ? returnableSaleLines(b, devices) : returnablePurchaseLines(b, devices);
    const only = deviceId ? ls.filter((l) => l.deviceId === deviceId) : ls.length === 1 ? ls : [];
    setPicked(Object.fromEntries(only.map((l) => [l.deviceId, String(sale ? saleLineValue(b, l) : num(l.price))])));
    setF((x) => ({ ...x, refund: null }));
    setQ('');
  };

  // bills that still have phones to return, matched by number / party / IMEI / SN
  const candidates = useMemo(() => {
    if (bill) return [];
    const s = q.trim().toLowerCase();
    return bills
      .map((b) => ({ b, n: (sale ? returnableSaleLines(b, devices) : returnablePurchaseLines(b, devices)).length }))
      .filter(({ b, n }) => {
        if (!n) return false;
        if (!s) return true;
        const no = (sale ? b.invoiceNo : b.purchaseNo).toLowerCase();
        const who = ((sale ? b.customerName : b.partyName) || '').toLowerCase();
        return no.includes(s) || who.includes(s) || (b.customerPhone || '').includes(s) || b.items.some((i) => i.imei.includes(s) || (i.imei2 || '').includes(s) || (i.sn || devMap.get(i.deviceId)?.sn || '').toLowerCase() === s);
      })
      .sort((a, b) => (b.b.date || '').localeCompare(a.b.date || ''))
      .slice(0, 25);
  }, [bill, bills, q, sale, devices, devMap]);

  // Enter with a scanned IMEI / SN jumps straight to that phone's bill
  const onScan = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = cleanImei(q).toLowerCase();
    const d = devices.find((x) => x.imei.toLowerCase() === code || (x.imei2 || '').toLowerCase() === code || (x.sn || '').toLowerCase() === code);
    if (d) {
      const b = sale ? d.status === 'sold' && bills.find((x) => x.id === d.saleId) : d.status === 'in_stock' && bills.find((x) => x.id === d.purchaseId);
      if (b) return pickBill(b, d.id);
      return toast(sale ? `${d.brand} ${d.model} is not sold right now` : `${d.brand} ${d.model} is not in stock`, 'error');
    }
    if (candidates.length === 1) pickBill(candidates[0].b);
  };

  const toggle = (it) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[it.deviceId] !== undefined) delete n[it.deviceId];
      else n[it.deviceId] = String(fullValue(it));
      return n;
    });

  const validate = () => {
    const errs = [];
    if (!lines.length) errs.push('Tick at least one phone to return.');
    for (const l of lines) {
      if (!(l.value > 0)) errs.push(`${l.brand} ${l.model}: enter the return amount.`);
      else if (sale && l.value > fullValue(l) + 0.004) errs.push(`${l.brand} ${l.model}: can't be more than its bill value ${money(fullValue(l))}.`);
    }
    if (!editing && t && refund > t.total + 0.004) errs.push('Refund is more than the return total.');
    if (!editing && refund < 0) errs.push('Refund cannot be negative.');
    return errs;
  };

  const save = async (e) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    const values = new Map(lines.map((l) => [l.deviceId, l.value]));
    try {
      if (editing) {
        const rawBill = sale ? data.raw.sales.find((s) => s.id === billId) : data.raw.purchases.find((p) => p.id === billId);
        await updateReturn(rawNote, { ...f, values }, { bill: rawBill, payments: data.raw.payments });
        toast(`${note.returnNo} updated`);
        navigate(`/returns/${noteId}`);
      } else {
        // purchases: save the real number, not the one shown while private sales are locked
        const rawNo = !sale && data.raw.purchases.find((p) => p.id === bill.id)?.purchaseNo;
        const { id, returnNo } = await createReturn(kind, rawNo ? { ...bill, purchaseNo: rawNo } : bill, { ...f, refund, values }, {
          settings,
          returns: data.raw.returns,
          devices: data.raw.devices,
        });
        toast(`${returnNo} saved`);
        navigate(`/returns/${id}`, { replace: true });
      }
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  if (editing && !note) {
    return (
      <div className="page">
        <PageHeader title="Edit return" />
        <div className="card"><Empty title="Return not found" action={<Link className="btn" to="/returns">Back to returns</Link>} /></div>
      </div>
    );
  }

  const title = editing ? `Edit ${note.returnNo}` : sale ? 'New sales return' : 'New purchase return';
  const already = bill && !editing ? bill.items.filter((it) => !returnable.some((r) => r.deviceId === it.deviceId)) : [];

  return (
    <form className="page" onSubmit={save}>
      <PageHeader
        title={title}
        subtitle={sale ? `${NOTE_TITLE.sale} · phones come back to stock, the customer is refunded or credited` : `${NOTE_TITLE.purchase} · phones go back to the supplier, they refund you or owe you less`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !bill}>
              <Save size={16} /> {busy ? 'Saving…' : editing ? 'Save changes' : 'Save return'}
            </button>
          </>
        }
      />

      <div className="stack">
        {!editing && !bill && (
          <section className="card card-lg">
            <div className="stack">
              <Segmented
                label="Return type"
                value={kind}
                onChange={(k) => {
                  setKind(k);
                  setF((x) => ({ ...x, reason: REASONS[k][0] }));
                }}
                options={[
                  { value: 'sale', label: 'Sales return (from customer)' },
                  { value: 'purchase', label: 'Purchase return (to supplier)' },
                ]}
              />
              <div className="input-group">
                {q ? <Search size={16} /> : <ScanBarcode size={16} />}
                <input
                  className="input"
                  placeholder={sale ? 'Scan IMEI / SN, or search invoice no., customer, mobile…' : 'Scan IMEI / SN, or search purchase no., supplier…'}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onScan}
                  autoFocus
                  aria-label="Find bill"
                />
              </div>
              {candidates.length ? (
                <div className="stack-sm">
                  <span className="xs muted">{sale ? 'Bills with phones that can come back' : 'Purchases with phones still in stock'} - tap one</span>
                  {candidates.map(({ b, n }) => (
                    <button type="button" key={b.id} className="combo-item" onClick={() => pickBill(b)}>
                      <span style={{ minWidth: 0 }}>
                        <span className="cell-main">{sale ? b.invoiceNo : b.purchaseNo}</span>
                        <span className="cell-sub" style={{ display: 'block' }}>
                          {fmtDate(b.date)} · {sale ? b.customerName : b.partyName} · {b.items.map((i) => `${i.brand} ${i.model}`).join(', ')}
                        </span>
                      </span>
                      <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <span className="chip plain">{n} returnable</span>
                        <b className="num">{money(b.total)}</b>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty icon={Undo2} title={q ? 'No matching bill' : sale ? 'No sold phones to return' : 'No stock to return'}>
                  {sale ? 'Only phones that are still sold on a bill can come back.' : 'Only phones still in stock can go back to the supplier.'}
                </Empty>
              )}
            </div>
          </section>
        )}

        {bill && (
          <>
            <section className="card card-lg">
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="xs muted" style={{ fontWeight: 600, letterSpacing: '0.06em' }}>{sale ? 'AGAINST INVOICE' : 'AGAINST PURCHASE'}</div>
                  <div className="cell-main" style={{ fontSize: 18 }}>
                    <Link to={sale ? `/sales/${bill.id}` : `/purchases/${bill.id}`}>{sale ? bill.invoiceNo : bill.purchaseNo}</Link> · {party}
                  </div>
                  <div className="muted small">
                    {fmtDate(bill.date)} · Bill {money(bill.total)}
                    {num(bill.returned) > 0 && ` · already returned ${money(bill.returned)}`}
                    {bill.due > 0.004 ? ` · due ${money(bill.due)}` : bill.due < -0.004 ? ` · ${sale ? 'refund owed' : 'supplier owes'} ${money(-bill.due)}` : ' · settled'}
                    {sale && num(bill.tax) > 0 && ` · GST ${bill.taxPercent}%`}
                  </div>
                </div>
                {!editing && (
                  <button type="button" className="btn btn-sm" onClick={() => { setBillId(null); setPicked({}); }}>
                    Change bill
                  </button>
                )}
              </div>
            </section>

            <section className="card card-lg">
              <div className="card-head">
                <h2>Phones {editing ? 'on this return' : 'to return'}</h2>
                <span className="muted small">{lines.length} of {returnable.length} ticked</span>
              </div>
              <div className="stack">
                {returnable.map((it) => {
                  const on = picked[it.deviceId] !== undefined;
                  const d = devMap.get(it.deviceId);
                  return (
                    <div className={`line ${on ? '' : 'muted-line'}`} key={it.deviceId}>
                      <div className="line-head">
                        <label className="check" style={{ gap: 10 }}>
                          <input type="checkbox" checked={on} onChange={() => toggle(it)} disabled={editing} aria-label={`Return ${it.brand} ${it.model}`} />
                          <span>
                            <span className="cell-main">{[it.brand, it.model, it.variant, it.color].filter(Boolean).join(' ')}</span>
                            <span className="cell-sub mono" style={{ display: 'block' }}>{[d?.sn || it.sn, it.imei, it.imei2].filter(Boolean).join(' · ')}</span>
                          </span>
                        </label>
                        <span className="muted small num">{sale ? `Billed ${money(fullValue(it))}` : `Bought ${money(it.price)}`}</span>
                      </div>
                      {on && (
                        <div className="form-grid">
                          <Field label={sale ? 'Return amount (₹)' : 'Supplier gives back (₹)'} required hint={sale ? (num(bill.tax) > 0 ? 'GST included · less than billed keeps a deduction' : 'Less than billed keeps a deduction') : 'What the supplier credits for this phone'}>
                            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                              <input
                                className="input num"
                                type="number"
                                min="0"
                                step="0.01"
                                value={picked[it.deviceId]}
                                onChange={(e) => setPicked((p) => ({ ...p, [it.deviceId]: e.target.value }))}
                              />
                              <button type="button" className="btn btn-sm" onClick={() => setPicked((p) => ({ ...p, [it.deviceId]: String(fullValue(it)) }))}>Full</button>
                            </div>
                          </Field>
                          {canProfit && (
                            <div className="small muted" style={{ alignSelf: 'center' }}>
                              Cost {money(costOf(it))}
                              {!sale && num(d?.repairCost) > 0 && ` (incl. repair ${money(d.repairCost)})`}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {already.map((it) => {
                  const n = returnOf(returns, bill.id, it.deviceId);
                  const d = devMap.get(it.deviceId);
                  return (
                    <div className="line muted-line" key={it.deviceId}>
                      <div className="line-head">
                        <span>
                          <span className="cell-main">{[it.brand, it.model].filter(Boolean).join(' ')}</span>
                          <span className="cell-sub mono" style={{ display: 'block' }}>{it.imei}</span>
                        </span>
                        <span className="chip plain">
                          {n ? <>Returned on <Link to={`/returns/${n.id}`}>{n.returnNo}</Link></> : sale ? 'Not on this bill now' : { sold: 'Sold', in_repair: 'At repair', returned: 'Returned' }[d?.status] || 'Not in stock'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="card card-lg">
              <div className="grid grid-2" style={{ alignItems: 'start' }}>
                <div className="stack">
                  <div className="form-grid">
                    <Field label="Return date" required>
                      <input className="input" type="date" value={f.date} min={bill.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
                    </Field>
                    <Field label="Reason">
                      <select className="select" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
                        {REASONS[kind].map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Notes">
                    <input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Condition, accessories returned…" />
                  </Field>
                  {editing ? (
                    <p className="small muted" style={{ margin: 0 }}>
                      Refunds for this return are changed on its page or in Payments.{walkIn && ' For a walk-in customer the refund follows the new total.'}
                    </p>
                  ) : (
                    <div className="sub-box">
                      <div className="field-label" style={{ marginBottom: 8 }}>
                        {sale ? (walkIn ? 'Refund to customer (walk-in: full amount)' : `Refund to ${party} now`) : `Refund received from ${party} now`}
                      </div>
                      <div className="form-grid">
                        <Field label="Amount (₹)" hint={walkIn ? 'No account to keep a balance on' : `Suggested ${money(suggest)} · the rest is adjusted in their account`}>
                          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <input
                              className="input num"
                              type="number"
                              min="0"
                              step="0.01"
                              value={walkIn ? String(t.total) : f.refund === null ? String(suggest) : f.refund}
                              onChange={(e) => setF({ ...f, refund: e.target.value })}
                              disabled={walkIn}
                            />
                            {!walkIn && <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, refund: '0' })}>None</button>}
                          </div>
                        </Field>
                        {refund > 0 && <PaymentFields mode={f.mode} accountId={f.accountId} onChange={setPay} modeLabel={sale ? 'Refund by' : 'Received by'} />}
                      </div>
                    </div>
                  )}
                </div>

                <div className="totals">
                  <div><span className="muted">Phones</span><span className="num">{lines.length}</span></div>
                  {t.tax > 0 && (
                    <>
                      <div><span className="muted">Taxable value</span><span className="num">{money(t.taxable)}</span></div>
                      {t.igst > 0 ? (
                        <div><span className="muted">IGST {bill.taxPercent}%</span><span className="num">{money(t.igst)}</span></div>
                      ) : (
                        <>
                          <div><span className="muted">CGST {num(bill.taxPercent) / 2}%</span><span className="num">{money(t.cgst)}</span></div>
                          <div><span className="muted">SGST {num(bill.taxPercent) / 2}%</span><span className="num">{money(t.sgst)}</span></div>
                        </>
                      )}
                    </>
                  )}
                  <div className="grand"><span>{sale ? 'Total credit' : 'Total debit'}</span><span className="num">{money(t.total)}</span></div>
                  {!editing && (
                    <>
                      <div><span className="muted">{sale ? 'Refund now' : 'Refund received now'}</span><span className="num">{money(refund)}</span></div>
                      <div><span className="muted">Adjusted in account</span><span className="num">{money(Math.max(0, t.total - refund))}</span></div>
                    </>
                  )}
                  {canProfit && lines.length > 0 && (
                    sale ? (
                      <div><span className="muted">Profit taken back</span><span className="num">{money(t.profit)}</span></div>
                    ) : (
                      <div><span className="muted">{t.profit >= 0 ? 'Gain on return' : 'Loss on return'}</span><span className={`num ${t.profit < 0 ? 'neg' : 'pos'}`}>{money(Math.abs(t.profit))}</span></div>
                    )
                  )}
                </div>
              </div>
              {errors.length > 0 && (
                <div className="form-error" role="alert" style={{ marginTop: 12 }}>
                  {errors.map((x) => <div key={x}>{x}</div>)}
                </div>
              )}
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn btn-primary" disabled={busy}>
                  <Save size={16} /> {busy ? 'Saving…' : editing ? 'Save changes' : `Save ${KIND_LABEL[kind].toLowerCase()}`}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </form>
  );
}
