import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, ShoppingBag } from 'lucide-react';
import { useData } from '../context/DataContext';
import { PageHeader } from '../components/Layout';
import { Empty } from '../components/ui';
import { DateRange, ExportButtons, PRESETS } from '../components/Filters';
import { money, num, fmtDate, inRange, byDateDesc, round2 } from '../lib/format';

export default function Purchases() {
  const { purchases, settings } = useData();
  const navigate = useNavigate();
  const [range, setRange] = useState(PRESETS.month());
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return purchases
      .filter((p) => inRange(p.date, range.from, range.to))
      .filter(
        (p) =>
          !s ||
          p.purchaseNo.toLowerCase().includes(s) ||
          (p.partyName || '').toLowerCase().includes(s) ||
          (p.supplierBillNo || '').toLowerCase().includes(s) ||
          p.items.some((i) => i.imei.includes(s) || `${i.brand} ${i.model}`.toLowerCase().includes(s)),
      )
      .sort(byDateDesc);
  }, [purchases, range, q]);

  const tot = rows.reduce(
    (a, p) => ({ total: a.total + num(p.total), paid: a.paid + num(p.paid), devices: a.devices + p.items.length }),
    { total: 0, paid: 0, devices: 0 },
  );

  const exportSpec = () => ({
    settings,
    title: 'Purchase Register',
    filename: `purchases-${range.from || 'all'}-${range.to || 'all'}`,
    meta: [['Period', `${fmtDate(range.from) || 'Start'} to ${fmtDate(range.to) || 'Today'}`]],
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'No.', key: 'no' },
      { header: 'Party', key: 'party' },
      { header: 'Devices', key: 'devices' },
      { header: 'Total', key: 'total', money: true },
      { header: 'Paid', key: 'paid', money: true },
      { header: 'Due', key: 'due', money: true },
    ],
    rows: rows.map((p) => ({
      date: fmtDate(p.date),
      no: p.purchaseNo,
      party: p.partyName,
      devices: p.items.map((i) => `${i.brand} ${i.model} (${i.imei})`).join(', '),
      total: p.total,
      paid: p.paid,
      due: round2(num(p.total) - num(p.paid)),
    })),
    foot: { date: 'Total', no: '', party: '', devices: `${tot.devices} devices`, total: tot.total, paid: tot.paid, due: tot.total - tot.paid },
  });

  return (
    <div className="page">
      <PageHeader
        title="Purchases"
        subtitle={`${rows.length} purchase(s) · ${tot.devices} device(s) · ${money(tot.total)}`}
        actions={
          <Link to="/purchases/new" className="btn btn-primary">
            <Plus size={16} /> New Purchase
          </Link>
        }
      />
      <section className="card card-lg">
        <div className="toolbar">
          <div className="input-group">
            <Search size={16} />
            <input className="input" placeholder="Search no., party, IMEI, model…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <DateRange value={range} onChange={setRange} />
          <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
            <ExportButtons build={exportSpec} small />
          </div>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>No.</th>
                  <th>Party</th>
                  <th>Devices</th>
                  <th className="num">Total</th>
                  <th className="num">Paid</th>
                  <th className="num">Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const due = round2(num(p.total) - num(p.paid));
                  return (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/purchases/${p.id}`)}>
                      <td className="tnum">{fmtDate(p.date)}</td>
                      <td className="cell-main">{p.purchaseNo}</td>
                      <td>{p.partyName}</td>
                      <td className="small">
                        {p.items.slice(0, 2).map((i) => `${i.brand} ${i.model}`).join(', ')}
                        {p.items.length > 2 && <span className="muted"> +{p.items.length - 2} more</span>}
                      </td>
                      <td className="num cell-main">{money(p.total)}</td>
                      <td className="num">{money(p.paid)}</td>
                      <td className="num">{due > 0 ? <span className="chip caution">{money(due)}</span> : <span className="chip success">Paid</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="num">{money(tot.total)}</td>
                  <td className="num">{money(tot.paid)}</td>
                  <td className="num">{money(tot.total - tot.paid)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Empty
            icon={ShoppingBag}
            title="No purchases in this period"
            action={<Link to="/purchases/new" className="btn btn-primary"><Plus size={16} /> New Purchase</Link>}
          />
        )}
      </section>
    </div>
  );
}
