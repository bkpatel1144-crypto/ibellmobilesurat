import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Undo2, Redo2 } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Segmented, Kpi, useConfirm } from '../components/ui';
import { DateRange, ExportButtons, defaultRange } from '../components/Filters';
import RowActions from '../components/RowActions';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import { deleteReturn } from '../lib/db';
import { NOTE_TITLE } from '../lib/returns';
import { money, num, round2, fmtDate, inRange, byDateDesc } from '../lib/format';

const REFUND_REF = { sale: 'saleReturn', purchase: 'purchaseReturn' };

export default function Returns() {
  const data = useData();
  const { returns, payments, settings, can } = data;
  const canDelete = can('deleteRecords');
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') === 'purchase' ? 'purchase' : 'sale';
  const sale = kind === 'sale';
  const [range, setRange] = useState(defaultRange);
  const [q, setQ] = useState('');

  const refunded = useMemo(() => {
    const m = new Map();
    for (const p of payments) if (p.refType === REFUND_REF.sale || p.refType === REFUND_REF.purchase) m.set(p.refId, (m.get(p.refId) || 0) + num(p.amount));
    return m;
  }, [payments]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return returns
      .filter((x) => x.kind === kind && inRange(x.date, range.from, range.to))
      .filter(
        (x) =>
          !s ||
          x.returnNo.toLowerCase().includes(s) ||
          (x.billNo || '').toLowerCase().includes(s) ||
          (x.partyName || '').toLowerCase().includes(s) ||
          x.items.some((i) => i.imei.includes(s) || `${i.brand} ${i.model}`.toLowerCase().includes(s)),
      )
      .sort(byDateDesc);
  }, [returns, kind, range, q]);

  const tot = rows.reduce(
    (a, x) => ({ total: a.total + num(x.total), tax: a.tax + num(x.tax), refund: a.refund + (refunded.get(x.id) || 0), devices: a.devices + x.items.length }),
    { total: 0, tax: 0, refund: 0, devices: 0 },
  );

  const pg = usePaged(rows, {
    resetOn: [kind, range, q],
    sort: [
      (x) => x.date,
      (x) => x.returnNo,
      (x) => x.billNo,
      (x) => x.partyName,
      (x) => x.items.map((i) => `${i.brand} ${i.model}`).join(', '),
      (x) => num(x.total),
      (x) => refunded.get(x.id) || 0,
    ],
  });

  const remove = async (x) => {
    const ok = await confirm({
      title: `Delete ${x.returnNo}?`,
      message: sale
        ? `The phones go back on ${x.billNo} as sold and the refunds for this return are removed. This cannot be undone.`
        : 'The phones come back into stock and the refunds for this return are removed. This cannot be undone.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteReturn(data.raw.returns.find((r) => r.id === x.id) || x, data.raw);
      toast(`${x.returnNo} deleted`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const exportSpec = () => ({
    settings,
    title: sale ? 'Sales Return Register (Credit Notes)' : 'Purchase Return Register (Debit Notes)',
    filename: `${sale ? 'sales' : 'purchase'}-returns-${range.from || 'all'}-${range.to || 'all'}`,
    landscape: true,
    meta: [['Period', `${fmtDate(range.from) || 'Start'} to ${fmtDate(range.to) || 'Today'}`]],
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'Note no.', key: 'no' },
      { header: sale ? 'Invoice' : 'Purchase', key: 'bill' },
      { header: sale ? 'Customer' : 'Supplier', key: 'party' },
      { header: 'Devices', key: 'devices' },
      { header: 'Reason', key: 'reason' },
      ...(sale ? [{ header: 'Taxable', key: 'taxable', money: true }, { header: 'GST', key: 'tax', money: true }] : []),
      { header: 'Amount', key: 'total', money: true },
      { header: 'Refund', key: 'refund', money: true },
    ],
    rows: rows.map((x) => ({
      date: fmtDate(x.date),
      no: x.returnNo,
      bill: x.billNo,
      party: x.partyName,
      devices: x.items.map((i) => `${i.brand} ${i.model} (${i.imei})`).join(', '),
      reason: x.reason,
      taxable: x.taxable,
      tax: x.tax,
      total: x.total,
      refund: refunded.get(x.id) || 0,
    })),
    foot: { date: 'Total', devices: `${tot.devices} devices`, tax: tot.tax, total: tot.total, refund: tot.refund },
  });

  const all = returns.filter((x) => inRange(x.date, range.from, range.to));
  const sum = (k) => round2(all.filter((x) => x.kind === k).reduce((s, x) => s + num(x.total), 0));
  const count = (k) => all.filter((x) => x.kind === k).reduce((s, x) => s + x.items.length, 0);

  return (
    <div className="page">
      <PageHeader
        title="Returns"
        subtitle="Sales returns (credit notes) and purchase returns (debit notes)"
        actions={
          <>
            <Link to="/returns/new?kind=purchase" className="btn"><Redo2 size={16} /> Return to supplier</Link>
            <Link to="/returns/new?kind=sale" className="btn btn-primary"><Plus size={16} /> Sales return</Link>
          </>
        }
      />
      <div className="stack">
        <div className="kpis">
          <Kpi inverse icon={Undo2} label="Sales returns" value={money(sum('sale'))} sub={`${count('sale')} phone(s) back from customers`} />
          <Kpi icon={Redo2} label="Purchase returns" value={money(sum('purchase'))} sub={`${count('purchase')} phone(s) back to suppliers`} />
          <Kpi label={sale ? 'Refunded (this list)' : 'Refund received (this list)'} value={money(tot.refund)} sub={`${money(tot.total - tot.refund)} adjusted against bills`} />
        </div>
        <section className="card card-lg">
          <div className="toolbar">
            <Segmented
              label="Return type"
              value={kind}
              onChange={(k) => setParams(k === 'purchase' ? { kind: k } : {}, { replace: true })}
              options={[
                { value: 'sale', label: 'Sales returns' },
                { value: 'purchase', label: 'Purchase returns' },
              ]}
            />
            <div className="input-group">
              <Search size={16} />
              <input className="input" placeholder="Search note, bill, party, IMEI…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <DateRange value={range} onChange={setRange} />
            <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
              <ExportButtons build={exportSpec} small />
            </div>
          </div>
          {rows.length ? (
            <>
              <div className="table-wrap">
                <table className="table" {...pg.tableProps}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>{NOTE_TITLE[kind]}</th>
                      <th>{sale ? 'Invoice' : 'Purchase'}</th>
                      <th>{sale ? 'Customer' : 'Supplier'}</th>
                      <th>Devices</th>
                      <th className="num">Amount</th>
                      <th className="num">Refund</th>
                      <th className="actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((x) => {
                      const rf = refunded.get(x.id) || 0;
                      return (
                        <tr key={x.id} className="clickable" onClick={() => navigate(`/returns/${x.id}`)}>
                          <td className="tnum">{fmtDate(x.date)}</td>
                          <td className="cell-main">{x.returnNo}</td>
                          <td>
                            <Link to={sale ? `/sales/${x.billId}` : `/purchases/${x.billId}`} onClick={(e) => e.stopPropagation()}>{x.billNo}</Link>
                          </td>
                          <td>
                            <div>{x.partyName}</div>
                            {x.reason && <div className="cell-sub">{x.reason}</div>}
                          </td>
                          <td className="small">
                            {x.items.slice(0, 2).map((i) => `${i.brand} ${i.model}`).join(', ')}
                            {x.items.length > 2 && <span className="muted"> +{x.items.length - 2}</span>}
                          </td>
                          <td className="num cell-main">
                            {money(x.total)}
                            {num(x.tax) > 0 && <div className="cell-sub">GST {money(x.tax)}</div>}
                          </td>
                          <td className="num">
                            {rf > 0.004 ? money(rf) : <span className="chip plain">In account</span>}
                          </td>
                          <td className="actions">
                            <RowActions
                              onEdit={() => navigate(`/returns/${x.id}/edit`)}
                              onDelete={canDelete ? () => remove(x) : null}
                              editLabel={`Edit ${x.returnNo}`}
                              deleteLabel={`Delete ${x.returnNo}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>Total · {tot.devices} phone(s)</td>
                      <td className="num">{money(tot.total)}</td>
                      <td className="num">{money(tot.refund)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Pager {...pg.pager} />
            </>
          ) : (
            <Empty
              icon={Undo2}
              title={sale ? 'No sales returns in this period' : 'No purchase returns in this period'}
              action={
                <Link to={`/returns/new?kind=${kind}`} className="btn btn-primary">
                  <Plus size={16} /> {sale ? 'Sales return' : 'Return to supplier'}
                </Link>
              }
            >
              {sale ? 'When a customer brings phones back, make a sales return from the bill or here.' : 'When you send phones back to a supplier, make a purchase return here.'}
            </Empty>
          )}
        </section>
      </div>
      {confirmDialog}
    </div>
  );
}
