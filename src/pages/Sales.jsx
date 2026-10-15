import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, ShoppingCart, EyeOff } from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Empty, Segmented, useConfirm } from '../components/ui';
import RowActions from '../components/RowActions';
import { useToast } from '../context/ToastContext';
import { deleteSale } from '../lib/db';
import { DateRange, ExportButtons, PRESETS, defaultRange } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import { money, num, fmtDate, inRange, byDateDesc, round2 } from '../lib/format';

export default function Sales() {
  const data = useData();
  const { sales, settings, privacy, can } = data;
  const canDelete = can('deleteRecords');
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const showProfit = can('viewProfit');
  const navigate = useNavigate();
  const [range, setRange] = useState(defaultRange);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return sales
      .filter((x) => inRange(x.date, range.from, range.to))
      .filter((x) => {
        const due = round2(num(x.due));
        if (status === 'due') return due > 0;
        if (status === 'paid') return due <= 0;
        if (status === 'private') return x.hidden;
        if (status === 'returned') return x.returnedCount > 0;
        return true;
      })
      .filter(
        (x) =>
          !s ||
          x.invoiceNo.toLowerCase().includes(s) ||
          (x.customerName || '').toLowerCase().includes(s) ||
          (x.customerPhone || '').includes(s) ||
          x.items.some((i) => i.imei.includes(s) || `${i.brand} ${i.model}`.toLowerCase().includes(s)),
      )
      .sort(byDateDesc);
  }, [sales, range, q, status]);

  const tot = rows.reduce(
    (a, x) => ({
      total: a.total + num(x.total),
      received: a.received + num(x.received),
      due: a.due + num(x.due),
      returned: a.returned + num(x.returned),
      profit: a.profit + num(x.profit),
      devices: a.devices + x.items.length,
    }),
    { total: 0, received: 0, profit: 0, devices: 0, due: 0, returned: 0 },
  );

  const pg = usePaged(rows, {
    resetOn: [range, q, status],
    sort: [
      (x) => x.date,
      (x) => x.invoiceNo,
      (x) => x.customerName,
      (x) => x.items.map((i) => `${i.brand} ${i.model}`).join(', '),
      (x) => num(x.total),
      ...(showProfit ? [(x) => num(x.profit)] : []),
      (x) => round2(num(x.due)),
    ],
  });

  const exportSpec = () => ({
    settings,
    title: 'Sales Register',
    filename: `sales-${range.from || 'all'}-${range.to || 'all'}`,
    meta: [['Period', `${fmtDate(range.from) || 'Start'} to ${fmtDate(range.to) || 'Today'}`]],
    landscape: true,
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'Invoice', key: 'no' },
      { header: 'Customer', key: 'cust' },
      { header: 'Devices', key: 'devices' },
      { header: 'Mode', key: 'mode' },
      { header: 'Total', key: 'total', money: true },
      { header: 'Returned', key: 'returned', money: true },
      { header: 'Received', key: 'received', money: true },
      { header: 'Due', key: 'due', money: true },
      ...(showProfit ? [{ header: 'Profit', key: 'profit', money: true }] : []),
    ],
    rows: rows.map((x) => ({
      date: fmtDate(x.date),
      no: x.invoiceNo,
      cust: [x.customerName, x.customerPhone].filter(Boolean).join(' · '),
      devices: x.items.map((i) => `${i.brand} ${i.model} (${i.imei})`).join(', '),
      mode: x.mode,
      total: x.total,
      received: x.received,
      returned: x.returned || '',
      due: round2(num(x.due)),
      profit: x.profit,
    })),
    foot: { date: 'Total', devices: `${tot.devices} devices`, total: tot.total, received: tot.received, due: tot.due, returned: tot.returned, profit: tot.profit },
  });

  const remove = async (x) => {
    const ok = await confirm({
      title: `Delete ${x.invoiceNo}?`,
      message: 'The devices go back to stock and the payments for this bill are removed. This cannot be undone.',
      confirmText: 'Delete bill',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteSale(x, data.raw);
      toast(`${x.invoiceNo} deleted, devices back in stock`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const filters = [
    { value: 'all', label: 'All' },
    { value: 'due', label: 'Due' },
    { value: 'paid', label: 'Paid' },
    { value: 'returned', label: 'Returns' },
    ...(privacy.unlocked ? [{ value: 'private', label: 'Private' }] : []),
  ];

  return (
    <div className="page">
      <PageHeader
        title="Sales"
        subtitle={`${rows.length} bill(s) · ${tot.devices} device(s) · ${money(tot.total)}`}
        actions={
          <Link to="/sales/new" className="btn btn-primary">
            <Plus size={16} /> New Sale
          </Link>
        }
      />
      <section className="card card-lg">
        <div className="toolbar">
          <div className="input-group">
            <Search size={16} />
            <input className="input" placeholder="Search invoice, customer, IMEI…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <DateRange value={range} onChange={setRange} />
          <Segmented label="Payment status" value={status} onChange={setStatus} options={filters} />
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
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Devices</th>
                  <th className="num">Total</th>
                  {showProfit && <th className="num">Profit</th>}
                  <th className="num">Status</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((x) => {
                  const due = round2(num(x.due));
                  return (
                    <tr key={x.id} className="clickable" onClick={() => navigate(`/sales/${x.id}`)}>
                      <td className="tnum">{fmtDate(x.date)}</td>
                      <td className="cell-main">
                        {x.invoiceNo} {x.hidden && <EyeOff size={13} aria-label="Private" />}
                      </td>
                      <td>
                        <div>{x.customerName}</div>
                        <div className="cell-sub">{x.customerPhone}</div>
                      </td>
                      <td className="small">
                        {x.items.slice(0, 2).map((i) => `${i.brand} ${i.model}`).join(', ')}
                        {x.items.length > 2 && <span className="muted"> +{x.items.length - 2}</span>}
                      </td>
                      <td className="num cell-main">{money(x.total)}</td>
                      {showProfit && <td className="num">{money(x.profit)}</td>}
                      <td className="num">
                        <div className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {x.returnedCount > 0 && <span className="chip plain" title={`${money(x.returned)} returned`}>{x.returnedCount >= x.items.length ? 'Returned' : `${x.returnedCount} returned`}</span>}
                          {due > 0 ? <span className="chip caution">Due {money(due)}</span> : due < -0.004 ? <span className="chip caution">Refund {money(-due)}</span> : <span className="chip success">Paid</span>}
                        </div>
                      </td>
                      <td className="actions">
                        <RowActions
                          onEdit={() => navigate(`/sales/${x.id}?edit=1`)}
                          onDelete={canDelete ? () => remove(x) : null}
                          editLabel={`Edit ${x.invoiceNo}`}
                          deleteLabel={`Delete ${x.invoiceNo}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="num">{money(tot.total)}</td>
                  {showProfit && <td className="num">{money(tot.profit)}</td>}
                  <td className="num">{money(tot.due)} due</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <Pager {...pg.pager} />
          </>
        ) : (
          <Empty
            icon={ShoppingCart}
            title="No sales in this period"
            action={<Link to="/sales/new" className="btn btn-primary"><Plus size={16} /> New Sale</Link>}
          />
        )}
      </section>
      {confirmDialog}
    </div>
  );
}
