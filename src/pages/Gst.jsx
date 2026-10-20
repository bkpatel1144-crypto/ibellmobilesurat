import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Landmark, Receipt, Banknote, Undo2, Settings as SettingsIcon } from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Empty, Kpi } from '../components/ui';
import { DateRange, ExportButtons, defaultRange } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import { stateName } from '../lib/gst';
import { money, num, round2, fmtDate, inRange, monthKey, fmtMonth, byDateDesc } from '../lib/format';
import { accLines, lineQty } from '../lib/accessories';

/** Normalises old and new bills to the same GST numbers. */
const gstOf = (s) => {
  const tax = num(s.tax);
  const taxable = s.taxable ?? round2(num(s.total) - tax);
  const igst = num(s.igst);
  const cgst = s.cgst ?? (igst ? 0 : round2(tax / 2));
  const sgst = s.sgst ?? (igst ? 0 : round2(tax - cgst));
  return { taxable, tax, cgst, sgst, igst };
};

export default function Gst() {
  const { sales, settings, returns } = useData();
  const navigate = useNavigate();
  const [range, setRange] = useState(defaultRange);

  const r = useMemo(() => {
    const inPeriod = sales.filter((s) => inRange(s.date, range.from, range.to));
    const taxed = inPeriod.filter((s) => num(s.tax) > 0).sort(byDateDesc);
    const untaxed = inPeriod.filter((s) => !(num(s.tax) > 0));
    // credit notes (sales returns of GST bills) reduce output tax in the month they are issued
    const notes = returns.filter((x) => x.kind === 'sale' && num(x.tax) > 0 && inRange(x.date, range.from, range.to)).sort(byDateDesc);
    const cn = (k) => round2(notes.reduce((t, x) => t + num(x[k]), 0));
    const sum = (k) => round2(taxed.reduce((t, s) => t + gstOf(s)[k], 0) - cn(k));
    const months = new Map();
    for (const s of taxed) {
      const g = gstOf(s);
      const m = months.get(monthKey(s.date)) || { n: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0 };
      m.n += 1;
      m.taxable += g.taxable;
      m.cgst += g.cgst;
      m.sgst += g.sgst;
      m.igst += g.igst;
      m.tax += g.tax;
      m.total += num(s.total);
      months.set(monthKey(s.date), m);
    }
    for (const x of notes) {
      const m = months.get(monthKey(x.date)) || { n: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0 };
      m.cn = (m.cn || 0) + 1;
      m.taxable -= num(x.taxable);
      m.cgst -= num(x.cgst);
      m.sgst -= num(x.sgst);
      m.igst -= num(x.igst);
      m.tax -= num(x.tax);
      m.total -= num(x.total);
      months.set(monthKey(x.date), m);
    }
    const hsn = new Map();
    for (const s of taxed) {
      const g = gstOf(s);
      const lines = s.items.length || 1;
      s.items.forEach((it) => {
        const code = it.hsn || settings.hsnDefault || '8517';
        const h = hsn.get(code) || { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        // per-line values when saved; otherwise split the bill evenly
        const lt = it.taxable ?? g.taxable / lines;
        const share = g.taxable ? lt / g.taxable : 1 / lines;
        h.qty += 1;
        h.taxable += lt;
        h.cgst += g.cgst * share;
        h.sgst += g.sgst * share;
        h.igst += g.igst * share;
        hsn.set(code, h);
      });
      // accessories: one HSN row per code, quantity = pieces
      for (const l of accLines(s)) {
        const code = l.hsn || settings.hsnDefault || '8517';
        const h = hsn.get(code) || { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        const share = g.taxable ? num(l.taxable) / g.taxable : 0;
        h.qty += lineQty(l);
        h.taxable += num(l.taxable);
        h.cgst += g.cgst * share;
        h.sgst += g.sgst * share;
        h.igst += g.igst * share;
        hsn.set(code, h);
      }
    }
    for (const x of notes) {
      for (const l of accLines(x)) {
        const code = l.hsn || settings.hsnDefault || '8517';
        const h = hsn.get(code) || { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        const share = num(x.taxable) ? num(l.taxable) / num(x.taxable) : 0;
        h.qty -= lineQty(l);
        h.taxable -= num(l.taxable);
        h.cgst -= num(x.cgst) * share;
        h.sgst -= num(x.sgst) * share;
        h.igst -= num(x.igst) * share;
        hsn.set(code, h);
      }
      for (const it of x.items) {
        const code = it.hsn || settings.hsnDefault || '8517';
        const h = hsn.get(code) || { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        const share = num(x.taxable) ? num(it.taxable) / num(x.taxable) : 1 / x.items.length;
        h.qty -= 1;
        h.taxable -= num(it.taxable);
        h.cgst -= num(x.cgst) * share;
        h.sgst -= num(x.sgst) * share;
        h.igst -= num(x.igst) * share;
        hsn.set(code, h);
      }
    }
    return {
      taxed,
      untaxedCount: untaxed.length,
      untaxedTotal: round2(untaxed.reduce((t, s) => t + num(s.total), 0)),
      taxable: sum('taxable'),
      cgst: sum('cgst'),
      sgst: sum('sgst'),
      igst: sum('igst'),
      tax: sum('tax'),
      b2b: taxed.filter((s) => s.customerGstin).length,
      inv: Object.fromEntries(['taxable', 'cgst', 'sgst', 'igst', 'tax'].map((k) => [k, round2(taxed.reduce((t, s) => t + gstOf(s)[k], 0))])),
      notes,
      cnTax: cn('tax'),
      cnTotal: cn('total'),
      months: [...months.entries()].sort().reverse(),
      hsn: [...hsn.entries()],
    };
  }, [sales, returns, range, settings.hsnDefault]);

  const pg = usePaged(r.taxed, {
    resetOn: [range],
    sort: [
      (s) => s.date,
      (s) => s.invoiceNo,
      (s) => s.customerName,
      (s) => s.customerGstin || null,
      (s) => gstOf(s).taxable,
      (s) => gstOf(s).cgst,
      (s) => gstOf(s).sgst,
      (s) => gstOf(s).igst,
      (s) => num(s.total),
    ],
  });

  const period = `${range.from ? fmtDate(range.from) : 'Beginning'} to ${range.to ? fmtDate(range.to) : 'Today'}`;

  const registerSpec = () => ({
    settings,
    title: 'GST Sales Register',
    filename: `gst-register-${range.from || 'all'}-${range.to || 'all'}`,
    landscape: true,
    meta: [
      ['Period', period],
      ['GSTIN', settings.gstin || '-'],
    ],
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'Invoice', key: 'no' },
      { header: 'Customer', key: 'cust' },
      { header: 'Customer GSTIN', key: 'gstin' },
      { header: 'Type', key: 'type' },
      { header: 'Place of supply', key: 'pos' },
      { header: 'Taxable', key: 'taxable', money: true },
      { header: 'CGST', key: 'cgst', money: true },
      { header: 'SGST', key: 'sgst', money: true },
      { header: 'IGST', key: 'igst', money: true },
      { header: 'Invoice total', key: 'total', money: true },
    ],
    rows: r.taxed.map((s) => {
      const g = gstOf(s);
      return {
        date: fmtDate(s.date),
        no: s.invoiceNo,
        cust: s.customerName,
        gstin: s.customerGstin || '',
        type: s.customerGstin ? 'B2B' : 'B2C',
        pos: s.placeOfSupply ? `${s.placeOfSupply}-${stateName(s.placeOfSupply)}` : '',
        taxable: g.taxable,
        cgst: g.cgst,
        sgst: g.sgst,
        igst: g.igst,
        total: s.total,
      };
    }),
    // the register lists invoices only, so its total is before credit notes
    foot: { date: 'Total', ...['taxable', 'cgst', 'sgst', 'igst'].reduce((o, k) => ({ ...o, [k]: round2(r.taxed.reduce((t, s) => t + gstOf(s)[k], 0)) }), {}), total: r.taxed.reduce((t, s) => t + num(s.total), 0) },
  });

  const notesSpec = () => ({
    settings,
    title: 'Credit Notes (Sales Returns)',
    filename: `gst-credit-notes-${range.from || 'all'}-${range.to || 'all'}`,
    landscape: true,
    meta: [
      ['Period', period],
      ['GSTIN', settings.gstin || '-'],
    ],
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'Note no.', key: 'no' },
      { header: 'Against invoice', key: 'inv' },
      { header: 'Invoice date', key: 'invDate' },
      { header: 'Customer', key: 'cust' },
      { header: 'Customer GSTIN', key: 'gstin' },
      { header: 'Type', key: 'type' },
      { header: 'Taxable', key: 'taxable', money: true },
      { header: 'CGST', key: 'cgst', money: true },
      { header: 'SGST', key: 'sgst', money: true },
      { header: 'IGST', key: 'igst', money: true },
      { header: 'Note value', key: 'total', money: true },
    ],
    rows: r.notes.map((x) => ({
      date: fmtDate(x.date),
      no: x.returnNo,
      inv: x.billNo,
      invDate: fmtDate(x.billDate),
      cust: x.partyName,
      gstin: x.customerGstin || '',
      type: x.customerGstin ? 'CDNR (B2B)' : 'CDNUR (B2C)',
      taxable: x.taxable,
      cgst: x.cgst,
      sgst: x.sgst,
      igst: x.igst,
      total: x.total,
    })),
    foot: {
      date: 'Total',
      ...['taxable', 'cgst', 'sgst', 'igst'].reduce((o, k) => ({ ...o, [k]: round2(r.notes.reduce((t, x) => t + num(x[k]), 0)) }), {}),
      total: r.cnTotal,
    },
  });

  const hsnSpec = () => ({
    settings,
    title: 'HSN Summary',
    filename: `gst-hsn-${range.from || 'all'}-${range.to || 'all'}`,
    meta: [['Period', period]],
    columns: [
      { header: 'HSN', key: 'hsn' },
      { header: 'Qty', key: 'qty' },
      { header: 'Taxable', key: 'taxable', money: true },
      { header: 'CGST', key: 'cgst', money: true },
      { header: 'SGST', key: 'sgst', money: true },
      { header: 'IGST', key: 'igst', money: true },
    ],
    rows: r.hsn.map(([code, h]) => ({ hsn: code, qty: h.qty, taxable: round2(h.taxable), cgst: round2(h.cgst), sgst: round2(h.sgst), igst: round2(h.igst) })),
  });

  if (!settings.gstEnabled && !r.taxed.length) {
    return (
      <div className="page">
        <PageHeader title="GST Report" subtitle="Tax invoices for your GST return" />
        <div className="card">
          <Empty icon={Landmark} title="GST is turned off">
            Turn it on in Settings → Billing. You can charge GST on every bill, or only on bills paid into the bank.
          </Empty>
          <div style={{ textAlign: 'center', paddingBottom: 24 }}>
            <Link className="btn btn-primary" to="/settings?tab=billing"><SettingsIcon size={16} /> GST settings</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="GST Report"
        subtitle={`${period} · ${settings.gstOn === 'all' ? 'GST on every bill' : 'GST only on bank payments (UPI, card, bank, cheque)'}`}
        actions={<ExportButtons build={registerSpec} />}
      />
      <div className="stack">
        <div className="card" style={{ padding: 12 }}>
          <DateRange value={range} onChange={setRange} />
        </div>

        <div className="kpis">
          <Kpi inverse icon={Landmark} label={r.notes.length ? 'Net GST payable' : 'GST payable'} value={money(r.tax)} sub={r.igst ? `CGST ${money(r.cgst)} · SGST ${money(r.sgst)} · IGST ${money(r.igst)}` : `CGST ${money(r.cgst)} · SGST ${money(r.sgst)}`} />
          <Kpi icon={Receipt} label={r.notes.length ? 'Net taxable value' : 'Taxable value'} value={money(r.taxable)} sub={`${r.taxed.length} tax invoice(s) · ${r.b2b} B2B`} />
          <Kpi icon={Banknote} label="Bills without GST" value={money(r.untaxedTotal)} sub={`${r.untaxedCount} bill(s) · cash / no GST`} />
          {r.notes.length > 0 && <Kpi icon={Undo2} label="Credit notes" value={money(r.cnTax)} sub={`GST reversed on ${r.notes.length} sales return(s)`} />}
        </div>

        <div className="grid grid-2">
          <section className="card card-lg">
            <div className="card-head"><h2>Month-wise</h2></div>
            {r.months.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Month</th><th className="num">Invoices</th><th className="num">Credit notes</th><th className="num">Net taxable</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th></tr></thead>
                  <tbody>
                    {r.months.map(([k, m]) => (
                      <tr key={k}>
                        <td className="cell-main">{fmtMonth(k)}</td>
                        <td className="num">{m.n}</td>
                        <td className="num">{m.cn || '—'}</td>
                        <td className="num">{money(m.taxable)}</td>
                        <td className="num">{money(m.cgst)}</td>
                        <td className="num">{money(m.sgst)}</td>
                        <td className="num">{money(m.igst)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>No tax invoices in this period.</p>
            )}
          </section>
          <section className="card card-lg">
            <div className="card-head">
              <h2>HSN summary</h2>
              <div className="row" style={{ gap: 8 }}><ExportButtons build={hsnSpec} small /></div>
            </div>
            {r.hsn.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>HSN</th><th className="num">Qty</th><th className="num">Taxable</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th></tr></thead>
                  <tbody>
                    {r.hsn.map(([code, h]) => (
                      <tr key={code}>
                        <td className="cell-main mono">{code}</td>
                        <td className="num">{h.qty}</td>
                        <td className="num">{money(h.taxable)}</td>
                        <td className="num">{money(h.cgst)}</td>
                        <td className="num">{money(h.sgst)}</td>
                        <td className="num">{money(h.igst)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>No tax invoices in this period.</p>
            )}
          </section>
        </div>

        {r.notes.length > 0 && (
          <section className="card card-lg">
            <div className="card-head">
              <h2>Credit notes (sales returns)</h2>
              <div className="row" style={{ gap: 8 }}><ExportButtons build={notesSpec} small /></div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th><th>Note</th><th>Against</th><th>Customer</th>
                    <th className="num">Taxable</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {r.notes.map((x) => (
                    <tr key={x.id} className="clickable" onClick={() => navigate(`/returns/${x.id}`)}>
                      <td className="tnum">{fmtDate(x.date)}</td>
                      <td className="cell-main">{x.returnNo}</td>
                      <td>{x.billNo}<div className="cell-sub">{fmtDate(x.billDate)}</div></td>
                      <td>{x.partyName}<div className="cell-sub mono">{x.customerGstin || 'B2C'}</div></td>
                      <td className="num">− {money(x.taxable)}</td>
                      <td className="num">− {money(x.cgst)}</td>
                      <td className="num">− {money(x.sgst)}</td>
                      <td className="num">− {money(x.igst)}</td>
                      <td className="num cell-main">− {money(x.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="card card-lg">
          <div className="card-head"><h2>Tax invoices</h2></div>
          {r.taxed.length ? (
            <>
              <div className="table-wrap">
                <table className="table" {...pg.tableProps}>
                  <thead>
                    <tr>
                      <th>Date</th><th>Invoice</th><th>Customer</th><th>GSTIN</th>
                      <th className="num">Taxable</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((s) => {
                      const g = gstOf(s);
                      return (
                        <tr key={s.id} className="clickable" onClick={() => navigate(`/sales/${s.id}`)}>
                          <td className="tnum">{fmtDate(s.date)}</td>
                          <td className="cell-main">{s.invoiceNo}</td>
                          <td>{s.customerName}<div className="cell-sub">{s.mode}</div></td>
                          <td className="mono small">{s.customerGstin || <span className="muted">B2C</span>}</td>
                          <td className="num">{money(g.taxable)}</td>
                          <td className="num">{money(g.cgst)}</td>
                          <td className="num">{money(g.sgst)}</td>
                          <td className="num">{money(g.igst)}</td>
                          <td className="num cell-main">{money(s.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>Total</td>
                      <td className="num">{money(r.inv.taxable)}</td>
                      <td className="num">{money(r.inv.cgst)}</td>
                      <td className="num">{money(r.inv.sgst)}</td>
                      <td className="num">{money(r.inv.igst)}</td>
                      <td className="num">{money(r.inv.taxable + r.inv.tax)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Pager {...pg.pager} />
            </>
          ) : (
            <Empty icon={Receipt} title="No tax invoices in this period" />
          )}
        </section>
      </div>
    </div>
  );
}
