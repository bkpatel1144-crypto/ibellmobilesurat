import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Search, Save, Undo2, ScanBarcode, Headphones } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Field, Segmented, Empty, SkeletonPage } from '../components/ui';
import PaymentFields from '../components/PaymentFields';
import { createReturn, updateReturn, CASH_ACCOUNT } from '../lib/db';
import { REASONS, KIND_LABEL, NOTE_TITLE, returnTotals, returnableSaleLines, returnablePurchaseLines, returnOf, saleLineValue, suggestedRefund, otherOpenDue } from '../lib/returns';
import { money, num, round2, today, fmtDate, cleanImei, amountText } from '../lib/format';
import { accLines, accReturned, billItemsText, cleanSerial, lineQty } from '../lib/accessories';

/** One form for a new return and for editing one; keyed so switching bills starts fresh. */
export default function ReturnNew() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { ready } = useData();
  if (!ready) return <SkeletonPage />;
  const kind = params.get('kind') === 'purchase' ? 'purchase' : 'sale';
  return <ReturnForm key={id || `${kind}-${params.get('bill') || ''}`} noteId={id} startKind={kind} startBill={params.get('bill')} startDevice={params.get('device')} startAcc={params.get('accessory')} startSerial={params.get('serial')} />;
}

function ReturnForm({ noteId, startKind, startBill, startDevice, startAcc, startSerial }) {
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

  /**
   * Accessory lines of a bill and what can still come back:
   *   sales: pieces not yet returned (serials: the ones not back in stock)
   *   purchases: pieces not yet returned that are in stock now
   */
  const accOptions = useCallback(
    (b) => {
      if (!b) return [];
      const k = b.invoiceNo ? 'sale' : 'purchase';
      const notes = returns.filter((x) => x.kind === k && x.id !== noteId);
      return accLines(b).map((l) => {
        const back = accReturned(notes, b.id, l.accessoryId);
        const st = data.accStock.get(l.accessoryId);
        const serial = l.track === 'serial' || (l.serials || []).length > 0;
        let serials = (l.serials || []).map(cleanSerial).filter((x) => !back.serials.has(x));
        let left = lineQty(l) - back.qty;
        if (serial) {
          serials = serials.filter((x) => (k === 'purchase' ? st?.serials.get(x)?.count > 0 : !(st?.serials.get(x)?.count > 0)));
          left = serials.length;
        } else if (k === 'purchase') left = Math.min(left, Math.max(0, st?.qty || 0));
        const unit = lineQty(l) ? (k === 'sale' ? saleLineValue(b, l) / lineQty(l) : num(l.rate)) : 0;
        return { line: l, serial, serials, left: Math.max(0, left), returned: back.qty, unit: round2(unit) };
      });
    },
    [returns, noteId, data.accStock],
  );
  const accOpts = useMemo(() => {
    const all = accOptions(bill);
    if (!editing) return all;
    const on = new Set(accLines(note).map((l) => l.accessoryId));
    return all.filter((o) => on.has(o.line.accessoryId));
  }, [accOptions, bill, editing, note]);
  /** Phones + accessory pieces that can come back on a bill (bill picker). */
  const returnableCount = (b) =>
    (sale ? returnableSaleLines(b, devices) : returnablePurchaseLines(b, devices)).length + accOptions(b).reduce((t, o) => t + o.left, 0);
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
    const accLeft = accOptions(bill).some((o) => o.left > 0);
    const only = startDevice ? lines.filter((l) => l.deviceId === startDevice) : lines.length === 1 && !startAcc && !accLeft ? lines : [];
    return Object.fromEntries(only.map((l) => [l.deviceId, String(sale ? saleLineValue(bill, l) : num(l.price))]));
  });
  // accPick: accessoryId → { qty, serials, value, auto } (auto = the value follows the quantity)
  const startPick = (b, accId, serial) => {
    const opts = accOptions(b);
    const pick = (o, ser) => {
      const serials = o.serial ? (ser ? [ser] : o.serials) : [];
      const qty = o.serial ? serials.length : o.left;
      return { qty: String(qty), serials, value: String(round2(o.unit * qty)), auto: true };
    };
    if (accId) {
      const o = opts.find((x) => x.line.accessoryId === accId && x.left > 0);
      return o ? { [accId]: pick(o, serial && o.serials.includes(serial) ? serial : '') } : {};
    }
    const phones = (b.invoiceNo ? returnableSaleLines(b, devices) : returnablePurchaseLines(b, devices)).length;
    const live = opts.filter((o) => o.left > 0);
    return !phones && live.length === 1 ? { [live[0].line.accessoryId]: pick(live[0]) } : {};
  };
  const [accPick, setAccPick] = useState(() => {
    if (note) return Object.fromEntries(accLines(note).map((l) => [l.accessoryId, { qty: String(l.qty), serials: l.serials || [], value: String(l.value), auto: false }]));
    if (!bill || startDevice) return {};
    return startPick(bill, startAcc, cleanSerial(startSerial));
  });
  const setPick = (id, patch) =>
    setAccPick((p) => {
      const o = accOpts.find((x) => x.line.accessoryId === id);
      const cur = { ...p[id], ...patch };
      if (o && cur.auto && !('value' in patch)) {
        const qty = o.serial ? cur.serials.length : num(cur.qty);
        cur.value = String(round2(o.unit * qty));
      }
      return { ...p, [id]: cur };
    });
  const accChosen = accOpts
    .filter((o) => accPick[o.line.accessoryId])
    .map((o) => {
      const pk = accPick[o.line.accessoryId];
      const qty = o.serial ? pk.serials.length : Math.round(num(pk.qty));
      const l = o.line;
      return {
        o,
        line: {
          ...l,
          qty,
          serials: o.serial ? pk.serials : [],
          billQty: lineQty(l),
          cost: sale ? round2((num(l.cost) * qty) / Math.max(1, lineQty(l))) : round2(num(l.rate) * qty),
          value: num(pk.value),
        },
      };
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
  const [tried, setTried] = useState(false); // after a failed save the messages follow the form live
  const setPay = useCallback((v) => setF((p) => ({ ...p, ...v })), []);

  const lines = returnable
    .filter((it) => picked[it.deviceId] !== undefined)
    .map((it) => ({ ...it, cost: costOf(it), value: num(picked[it.deviceId]) }));
  const t = bill ? returnTotals(kind, bill, lines, accChosen.map((c) => c.line)) : null;
  const walkIn = sale && bill && !bill.partyId;
  // where the bill stands before and after this note (due > 0: still owed to / by the shop).
  // Credit left on this bill settles the party's other open bills first (see withSettlement).
  const before = bill ? round2(num(bill.due)) : 0;
  const others = bill && !editing ? otherOpenDue(bills, bill) : 0;
  const suggest = t ? suggestedRefund(kind, bill, t.total, before + others) : 0;
  const refund = walkIn ? t?.total || 0 : f.refund === null ? suggest : num(f.refund);
  const party = bill ? (sale ? bill.customerName : bill.partyName) : '';
  const own = round2(before - (t?.total || 0) + refund);
  const toOthers = own < -0.004 ? round2(Math.min(-own, others)) : 0;
  const after = round2(own + toOthers);
  const balLabel = (v) => {
    if (Math.abs(v) < 0.005) return 'settled';
    if (sale) return v > 0 ? `${party || 'customer'} owes you` : `you owe ${party || 'customer'}`;
    return v > 0 ? `you owe ${party}` : `${party} owes you`;
  };
  let refundHint = 'No account to keep a balance on';
  if (!walkIn) {
    if (!t?.total) refundHint = 'Tick a phone or accessory and enter its return value first';
    else if (suggest > 0) {
      refundHint = `Suggested ${money(suggest)}: ${sale ? 'they paid' : 'you paid'} more than ${sale ? 'they owe' : 'you owe'} now${others > 0.004 ? ` (after their other open bills of ${money(others)})` : ''}. Less stays as credit with them.`;
    } else {
      const here = Math.max(0, before);
      const where = [here > 0.004 && `${money(here)} on this bill`, others > 0.004 && `${money(others)} on other bills`].filter(Boolean).join(' and ');
      refundHint = sale
        ? `They still owe ${where}, so no cash refund - the return comes off what they owe.`
        : `You still owe ${where}, so no cash back - the return comes off what you owe.`;
    }
  }

  const pickBill = (b, deviceId, accId, serial) => {
    setBillId(b.id);
    const ls = sale ? returnableSaleLines(b, devices) : returnablePurchaseLines(b, devices);
    const accLeft = accOptions(b).some((o) => o.left > 0);
    const only = deviceId ? ls.filter((l) => l.deviceId === deviceId) : ls.length === 1 && !accId && !accLeft ? ls : [];
    setPicked(Object.fromEntries(only.map((l) => [l.deviceId, String(sale ? saleLineValue(b, l) : num(l.price))])));
    setAccPick(deviceId ? {} : startPick(b, accId, serial));
    setF((x) => ({ ...x, refund: null }));
    setQ('');
  };

  // bills that still have phones to return, matched by number / party / IMEI / SN
  const candidates = useMemo(() => {
    if (bill) return [];
    const s = q.trim().toLowerCase();
    return bills
      .map((b) => ({ b, n: returnableCount(b) }))
      .filter(({ b, n }) => {
        if (!n) return false;
        if (!s) return true;
        const no = (sale ? b.invoiceNo : b.purchaseNo).toLowerCase();
        const who = ((sale ? b.customerName : b.partyName) || '').toLowerCase();
        return no.includes(s) || who.includes(s) || (b.customerPhone || '').includes(s) || b.items.some((i) => i.imei.includes(s) || (i.imei2 || '').includes(s) || (i.sn || devMap.get(i.deviceId)?.sn || '').toLowerCase() === s) || accLines(b).some((l) => l.name.toLowerCase().includes(s) || (l.serials || []).some((x) => x.toLowerCase() === s));
      })
      .sort((a, b) => (b.b.date || '').localeCompare(a.b.date || ''))
      .slice(0, 25);
  }, [bill, bills, q, sale, devices, devMap, accOptions]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // an accessory serial: the bill it was sold on (sales) / bought on and still in stock (purchases)
    const serial = cleanSerial(q);
    const hit = serial && bills.find((b) => accOptions(b).some((o) => o.serials.includes(serial)));
    if (hit) {
      const o = accOptions(hit).find((x) => x.serials.includes(serial));
      return pickBill(hit, null, o.line.accessoryId, serial);
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
    if (!lines.length && !accChosen.length) errs.push('Tick at least one phone or accessory to return.');
    for (const { o, line: l } of accChosen) {
      if (l.qty <= 0) errs.push(`${l.name}: ${o.serial ? 'tick the serial number(s) coming back' : 'enter how many come back'}.`);
      else if (!editing && l.qty > o.left) errs.push(`${l.name}: only ${o.left} can come back.`);
      if (!(l.value > 0)) errs.push(`${l.name}: enter its return value (more than ₹0).`);
      else if (sale && l.qty > 0 && l.value > round2(o.unit * l.qty) + 0.004) errs.push(`${l.name}: can not be more than its bill value ${money(o.unit * l.qty)}.`);
    }
    for (const l of lines) {
      if (!(l.value > 0)) errs.push(`${l.brand} ${l.model}: enter its return value (more than ₹0 - usually ${sale ? 'its bill value' : 'the price you bought it for'}; cash back is separate).`);
      else if (sale && l.value > fullValue(l) + 0.004) errs.push(`${l.brand} ${l.model}: can't be more than its bill value ${money(fullValue(l))}.`);
    }
    if (!editing && t && refund > t.total + 0.004) errs.push('Refund is more than the return total.');
    if (!editing && refund < 0) errs.push('Refund cannot be negative.');
    return errs;
  };

  const save = async (e) => {
    e.preventDefault();
    setTried(true);
    if (validate().length) return;
    setBusy(true);
    const values = new Map(lines.map((l) => [l.deviceId, l.value]));
    const accValues = new Map(accChosen.map(({ line: l }) => [l.accessoryId, { qty: l.qty, serials: l.serials, value: l.value }]));
    try {
      if (editing) {
        const rawBill = sale ? data.raw.sales.find((s) => s.id === billId) : data.raw.purchases.find((p) => p.id === billId);
        await updateReturn(rawNote, { ...f, values, accValues: new Map(accChosen.map(({ line: l }) => [l.accessoryId, l.value])) }, { bill: rawBill, payments: data.raw.payments });
        toast(`${note.returnNo} updated`);
        navigate(`/returns/${noteId}`);
      } else {
        // purchases: save the real number, not the one shown while private sales are locked
        const rawNo = !sale && data.raw.purchases.find((p) => p.id === bill.id)?.purchaseNo;
        const { id, returnNo } = await createReturn(kind, rawNo ? { ...bill, purchaseNo: rawNo } : bill, { ...f, refund, values, accValues }, {
          settings,
          returns: data.raw.returns,
          devices: data.raw.devices,
          accStock: data.rawAccStock,
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

  const errors = tried ? validate() : [];
  const title = editing ? `Edit ${note.returnNo}` : sale ? 'New sales return' : 'New purchase return';
  const already = bill && !editing ? bill.items.filter((it) => !returnable.some((r) => r.deviceId === it.deviceId)) : [];

  return (
    <form className="page" onSubmit={save}>
      <PageHeader
        title={title}
        subtitle={sale ? `${NOTE_TITLE.sale} · items come back to stock, the customer is refunded or credited` : `${NOTE_TITLE.purchase} · items go back to the supplier, they refund you or owe you less`}
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
                  <span className="xs muted">{sale ? 'Bills with phones or accessories that can come back' : 'Purchases with phones or accessories still in stock'} - tap one</span>
                  {candidates.map(({ b, n }) => (
                    <button type="button" key={b.id} className="combo-item" onClick={() => pickBill(b)}>
                      <span style={{ minWidth: 0 }}>
                        <span className="cell-main">{sale ? b.invoiceNo : b.purchaseNo}</span>
                        <span className="cell-sub" style={{ display: 'block' }}>
                          {fmtDate(b.date)} · {sale ? b.customerName : b.partyName} · {billItemsText(b)}
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
                <Empty icon={Undo2} title={q ? 'No matching bill' : sale ? 'Nothing sold to return' : 'No stock to return'}>
                  {sale ? 'Only phones and accessories still sold on a bill can come back.' : 'Only stock bought on a purchase can go back to the supplier.'}
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
                  <button type="button" className="btn btn-sm" onClick={() => { setBillId(null); setPicked({}); setAccPick({}); }}>
                    Change bill
                  </button>
                )}
              </div>
            </section>

            <section className="card card-lg">
              <div className="card-head">
                <h2>{editing ? 'On this return' : 'Items to return'}</h2>
                <span className="muted small">{lines.length + accChosen.length} of {returnable.length + accOpts.length} ticked</span>
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
                          <Field
                            label="Return value (₹)"
                            required
                            hint={sale ? `Comes off the bill${num(bill.tax) > 0 ? ' · GST included' : ''} · not the cash refund` : 'Comes off what you owe them · not the cash back'}
                          >
                            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                              <input
                                className="input num"
                                inputMode="decimal"
                                placeholder={String(fullValue(it))}
                                value={picked[it.deviceId]}
                                onChange={(e) => setPicked((p) => ({ ...p, [it.deviceId]: amountText(e.target.value) }))}
                                aria-invalid={tried && !(num(picked[it.deviceId]) > 0)}
                              />
                              <button type="button" className="btn btn-sm" onClick={() => setPicked((p) => ({ ...p, [it.deviceId]: String(fullValue(it)) }))}>Full</button>
                            </div>
                          </Field>
                          <div className="small muted" style={{ alignSelf: 'center' }}>
                            {canProfit && (
                              <div>
                                Cost {money(costOf(it))}
                                {!sale && num(d?.repairCost) > 0 && ` (incl. repair ${money(d.repairCost)})`}
                              </div>
                            )}
                            {(() => {
                              const diff = round2(num(picked[it.deviceId]) - fullValue(it));
                              if (!(num(picked[it.deviceId]) > 0) || Math.abs(diff) < 0.005) return null;
                              if (sale) return diff < 0 ? <div>{money(-diff)} kept as deduction</div> : null;
                              return <div className={diff < 0 ? 'neg' : ''}>{money(Math.abs(diff))} {diff < 0 ? 'less' : 'more'} than you bought it for</div>;
                            })()}
                          </div>
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
                {accOpts.map((o) => {
                  const l = o.line;
                  const id = l.accessoryId;
                  const pk = accPick[id];
                  const on = Boolean(pk);
                  const chosen = accChosen.find((c) => c.line.accessoryId === id)?.line;
                  const full = chosen ? round2(o.unit * chosen.qty) : 0;
                  const none = !editing && o.left <= 0;
                  return (
                    <div className={`line ${on ? '' : 'muted-line'}`} key={id}>
                      <div className="line-head">
                        <label className="check" style={{ gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={editing || none}
                            aria-label={`Return ${l.name}`}
                            onChange={() =>
                              setAccPick((p) => {
                                const n = { ...p };
                                if (n[id]) delete n[id];
                                else {
                                  const serials = o.serial ? o.serials.slice(0, 1) : [];
                                  const qty = o.serial ? serials.length : 1;
                                  n[id] = { qty: String(qty), serials, value: String(round2(o.unit * qty)), auto: true };
                                }
                                return n;
                              })
                            }
                          />
                          <span>
                            <span className="cell-main"><Headphones size={13} /> {l.name}</span>
                            <span className="cell-sub" style={{ display: 'block' }}>
                              {[`${lineQty(l)} on this bill`, o.returned > 0 && `${o.returned} already returned`, !editing && (none ? (sale ? 'nothing left to return' : 'none of these in stock') : `${o.left} can come back`)].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </label>
                        <span className="muted small num">{sale ? `Billed ${money(o.unit)} each` : `Bought ${money(o.unit)} each`}</span>
                      </div>
                      {on && (
                        <div className="form-grid">
                          {o.serial ? (
                            <Field label={`Serial numbers (${pk.serials.length})`} className="span-2" hint={editing ? 'Delete the note to change the pieces' : 'Tap the serials coming back'}>
                              <div className="row" style={{ gap: 6 }}>
                                {(editing ? pk.serials : o.serials).map((x) => (
                                  <button
                                    type="button"
                                    key={x}
                                    disabled={editing}
                                    className={`chip plain mono ${pk.serials.includes(x) ? 'solid' : ''}`}
                                    aria-pressed={pk.serials.includes(x)}
                                    onClick={() => setPick(id, { serials: pk.serials.includes(x) ? pk.serials.filter((y) => y !== x) : [...pk.serials, x] })}
                                  >
                                    {x}
                                  </button>
                                ))}
                              </div>
                            </Field>
                          ) : (
                            <Field label="Quantity coming back" required hint={editing ? 'Delete the note to change the pieces' : `Up to ${o.left}`}>
                              <input className="input num" inputMode="numeric" value={pk.qty} disabled={editing} onChange={(e) => setPick(id, { qty: e.target.value.replace(/\D/g, '') })} aria-label={`${l.name} quantity back`} />
                            </Field>
                          )}
                          <Field label="Return value (₹)" required hint={sale ? 'For all pieces coming back · not the cash refund' : 'For all pieces going back · not the cash back'}>
                            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                              <input
                                className="input num"
                                inputMode="decimal"
                                value={pk.value}
                                placeholder={String(full)}
                                onChange={(e) => setPick(id, { value: amountText(e.target.value), auto: false })}
                                aria-label={`${l.name} return value`}
                                aria-invalid={tried && !(num(pk.value) > 0)}
                              />
                              <button type="button" className="btn btn-sm" onClick={() => setPick(id, { value: String(full), auto: true })}>Full</button>
                            </div>
                          </Field>
                        </div>
                      )}
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
                        {sale ? (walkIn ? 'Cash refund to customer (walk-in: full amount)' : `Cash refund to ${party} now`) : `Cash back from ${party} now`}
                      </div>
                      <div className="form-grid">
                        <Field label="Amount (₹)" hint={refundHint}>
                          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <input
                              className="input num"
                              inputMode="decimal"
                              value={walkIn ? String(t.total) : f.refund === null ? String(suggest) : f.refund}
                              onChange={(e) => setF({ ...f, refund: amountText(e.target.value) })}
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
                  <div><span className="muted">Items</span><span className="num">{lines.length + accChosen.reduce((n, c) => n + c.line.qty, 0)}</span></div>
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
                      <div className="totals-sep"><span className="muted">Bill now · {balLabel(before)}</span><span className="num">{money(Math.abs(before))}</span></div>
                      <div><span className="muted">Less this return</span><span className="num">− {money(t.total)}</span></div>
                      <div><span className="muted">{sale ? 'Cash refund now' : 'Cash back now'}</span><span className="num">{refund > 0 ? '+ ' : ''}{money(refund)}</span></div>
                      {toOthers > 0 && <div><span className="muted">Goes against other open bills</span><span className="num">{money(toOthers)}</span></div>}
                      <div className="after"><span>After · {balLabel(after)}</span><span className="num">{money(Math.abs(after))}</span></div>
                    </>
                  )}
                  {canProfit && lines.length > 0 && (
                    sale ? (
                      <div><span className="muted">Profit taken back</span><span className="num">{money(t.profit)}</span></div>
                    ) : (
                      <div><span className="muted">{t.profit > 0.004 ? 'Gain on return' : t.profit < -0.004 ? 'Loss on return' : 'No gain or loss'}</span><span className={`num ${t.profit < 0 ? 'neg' : 'pos'}`}>{money(Math.abs(t.profit))}</span></div>
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
