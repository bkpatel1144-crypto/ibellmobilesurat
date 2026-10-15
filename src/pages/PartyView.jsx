import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, ArrowDownLeft, ArrowUpRight, Phone, MapPin } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Kpi, Segmented, StatusChip, useConfirm } from '../components/ui';
import { DateRange, ExportButtons, PRESETS } from '../components/Filters';
import PartyForm from '../components/PartyForm';
import PaymentForm from '../components/PaymentForm';
import { MoneyBars } from '../components/Charts';
import { partyLedger, balanceLabel } from '../lib/ledger';
import { deleteParty, partyInUse } from '../lib/db';
import { money, num, fmtDate, plain, byDateDesc, monthKey, fmtMonth, deviceName } from '../lib/format';
import { TYPE_LABEL } from './Parties';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';

export default function PartyView() {
  const { id } = useParams();
  const data = useData();
  const canDelete = useData().can('deleteRecords');
  const { parties, sales, purchases, devices, settings } = data;
  const showProfit = data.can('viewProfit');
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [tab, setTab] = useState('ledger');
  const [range, setRange] = useState(PRESETS.all());
  const [editing, setEditing] = useState(false);
  const [payPreset, setPayPreset] = useState(null);

  const party = parties.find((p) => p.id === id);

  const ledger = useMemo(() => (party ? partyLedger(party, data, range) : null), [party, data, range]);
  const full = useMemo(() => (party ? partyLedger(party, data) : null), [party, data]);

  const a = useMemo(() => {
    const ps = sales.filter((s) => s.partyId === id).sort(byDateDesc);
    const pp = purchases.filter((p) => p.partyId === id).sort(byDateDesc);
    const sum = (arr, f) => arr.reduce((t, x) => t + num(f(x)), 0);
    const months = new Map();
    for (const s of ps) months.set(monthKey(s.date), (months.get(monthKey(s.date)) || 0) + num(s.total));
    for (const p of pp) if (!months.has(monthKey(p.date))) months.set(monthKey(p.date), months.get(monthKey(p.date)) || 0);
    const boughtIds = new Set(pp.flatMap((p) => p.items.map((i) => i.deviceId)));
    const fromThem = devices.filter((d) => boughtIds.has(d.id));
    const soldFromThem = fromThem.filter((d) => d.status === 'sold');
    return {
      sales: ps,
      purchases: pp,
      salesTotal: sum(ps, (s) => s.total),
      salesProfit: sum(ps, (s) => s.profit),
      salesCount: ps.reduce((t, s) => t + s.items.length, 0),
      purchTotal: sum(pp, (p) => p.total),
      purchCount: pp.reduce((t, p) => t + p.items.length, 0),
      fromThem,
      // profit made on devices bought from this party (wherever they were sold)
      supplyProfit: sum(soldFromThem, (d) => num(d.salePrice) - num(d.purchasePrice) - num(d.repairCost)),
      soldFromThem: soldFromThem.length,
      months: [...months.entries()].sort().slice(-12).map(([k, v]) => ({ label: fmtMonth(k), value: v })),
    };
  }, [id, sales, purchases, devices]);

  // one pager per tab (hooks must run before the early return below)
  const pgLedger = usePaged(ledger?.rows || [], {
    resetOn: [id, range],
    sort: [(r) => r.date, (r) => r.type, (r) => r.particulars, (r) => r.debit || null, (r) => r.credit || null, (r) => r.balance],
  });
  const pgSales = usePaged(a.sales, {
    resetOn: [id],
    sort: [(s) => s.date, (s) => s.invoiceNo, (s) => s.items.map((i) => `${i.brand} ${i.model}`).join(', '), (s) => num(s.total), ...(showProfit ? [(s) => num(s.profit)] : [])],
  });
  const pgPurch = usePaged(a.purchases, {
    resetOn: [id],
    sort: [(p) => p.date, (p) => p.purchaseNo, (p) => p.items.map((i) => `${i.brand} ${i.model}`).join(', '), (p) => num(p.total), (p) => num(p.paid)],
  });
  const devCost = (d) => num(d.purchasePrice) + num(d.repairCost);
  const pgDevices = usePaged(a.fromThem, {
    resetOn: [id],
    sort: [
      (d) => deviceName(d),
      (d) => d.imei,
      ...(showProfit ? [devCost] : []),
      (d) => d.status,
      (d) => (d.status === 'sold' ? num(d.salePrice) : null),
      ...(showProfit ? [(d) => (d.status === 'sold' ? num(d.salePrice) - devCost(d) : null)] : []),
    ],
  });

  if (!party) {
    return (
      <div className="page">
        <PageHeader title="Party" />
        <div className="card"><Empty title="Party not found" action={<Link className="btn" to="/parties">Back to parties</Link>} /></div>
      </div>
    );
  }

  const bal = full.closing;

  const remove = async () => {
    if (partyInUse(party.id, data.raw)) return toast('This party has transactions and cannot be deleted.', 'error');
    const ok = await confirm({ title: `Delete ${party.name}?`, message: 'This cannot be undone.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteParty(party.id, party.name, data.raw);
      toast('Party deleted');
      navigate('/parties');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const balText = (v) => `${plain(Math.abs(v))} ${v > 0.004 ? 'Dr' : v < -0.004 ? 'Cr' : ''}`.trim();

  const ledgerSpec = () => ({
    settings,
    title: 'Party Ledger',
    rightLines: [`Period: ${range.from ? fmtDate(range.from) : 'Beginning'} - ${range.to ? fmtDate(range.to) : fmtDate(new Date().toISOString().slice(0, 10))}`],
    filename: `ledger-${party.name.replace(/\s+/g, '-')}`,
    meta: [
      ['Party', party.name],
      ...(party.phone ? [['Phone', party.phone]] : []),
      ...(party.address ? [['Address', party.address]] : []),
      ...(party.gstin ? [['GSTIN', party.gstin]] : []),
      ['Opening balance', balText(ledger.opening)],
    ],
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'Type', key: 'type' },
      { header: 'Ref', key: 'ref' },
      { header: 'Particulars', key: 'particulars' },
      { header: 'Debit', key: 'debit', money: true },
      { header: 'Credit', key: 'credit', money: true },
      { header: 'Balance', key: 'bal', align: 'right' },
    ],
    rows: [
      { date: '', type: '', ref: '', particulars: 'Opening Balance', debit: '', credit: '', bal: balText(ledger.opening) },
      ...ledger.rows.map((r) => ({
        date: fmtDate(r.date),
        type: r.type,
        ref: r.ref,
        particulars: r.particulars,
        debit: r.debit || '',
        credit: r.credit || '',
        bal: balText(r.balance),
      })),
    ],
    foot: { date: 'Total', debit: ledger.debit, credit: ledger.credit, bal: balText(ledger.closing) },
    summary: [
      ['Closing balance', `Rs. ${plain(Math.abs(ledger.closing))}`],
      ['Status', ledger.closing > 0.004 ? 'Receivable from party' : ledger.closing < -0.004 ? 'Payable to party' : 'Settled'],
    ],
    landscape: true,
  });

  return (
    <div className="page">
      <PageHeader
        title={party.name}
        subtitle={TYPE_LABEL[party.type] || party.type}
        back={
          <div className="capsule-group glass">
            <button type="button" className="btn btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={18} /></button>
          </div>
        }
        actions={
          <>
            <button className="btn" onClick={() => setEditing(true)} aria-label="Edit party"><Pencil size={16} /></button>
            {canDelete && <button className="btn btn-danger" onClick={remove} aria-label="Delete party"><Trash2 size={16} /></button>}
            <button className="btn" onClick={() => setPayPreset({ direction: 'out', partyId: party.id, partyName: party.name, amount: bal < 0 ? -bal : '' })}>
              <ArrowUpRight size={16} /> Pay
            </button>
            <button className="btn btn-primary" onClick={() => setPayPreset({ direction: 'in', partyId: party.id, partyName: party.name, amount: bal > 0 ? bal : '' })}>
              <ArrowDownLeft size={16} /> Receive
            </button>
          </>
        }
      />

      <div className="stack">
        <div className="row small muted" style={{ gap: 16 }}>
          {party.phone && <span><Phone size={14} /> {party.phone}</span>}
          {party.address && <span><MapPin size={14} /> {party.address}</span>}
          {party.gstin && <span>GSTIN {party.gstin}</span>}
        </div>

        <div className="kpis">
          <Kpi inverse label="Balance" value={money(Math.abs(bal))} sub={balanceLabel(bal)} />
          <Kpi label="Sold to them" value={money(a.salesTotal)} sub={showProfit ? `${a.salesCount} devices · profit ${money(a.salesProfit)}` : `${a.salesCount} devices`} />
          <Kpi label="Bought from them" value={money(a.purchTotal)} sub={`${a.purchCount} devices`} />
          {showProfit && <Kpi label="Profit on their devices" value={money(a.supplyProfit)} sub={`${a.soldFromThem} of ${a.fromThem.length} sold`} />}
        </div>

        <section className="card card-lg">
          <div className="toolbar">
            <Segmented
              label="Party view"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'ledger', label: 'Ledger' },
                { value: 'sales', label: `Sales (${a.sales.length})` },
                { value: 'purchases', label: `Purchases (${a.purchases.length})` },
                { value: 'devices', label: 'Devices' },
                { value: 'chart', label: 'Analysis' },
              ]}
            />
            {tab === 'ledger' && (
              <>
                <DateRange value={range} onChange={setRange} />
                <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
                  <ExportButtons build={ledgerSpec} small />
                </div>
              </>
            )}
          </div>

          {tab === 'ledger' && (
            <div className="table-wrap">
              <table className="table" {...pgLedger.tableProps}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Particulars</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {pgLedger.pager.page === 1 && (
                    <tr>
                      <td />
                      <td colSpan={2} className="cell-main">Opening balance</td>
                      <td />
                      <td />
                      <td className="num cell-main">{balText(ledger.opening)}</td>
                    </tr>
                  )}
                  {pgLedger.rows.map((r, i) => (
                    <tr key={i} className={r.link ? 'clickable' : ''} onClick={() => r.link && navigate(r.link)}>
                      <td className="tnum">{fmtDate(r.date)}</td>
                      <td>
                        <div className="cell-main">{r.type}</div>
                        <div className="cell-sub">{r.ref}</div>
                      </td>
                      <td className="small">{r.particulars}</td>
                      <td className="num">{r.debit ? money(r.debit) : ''}</td>
                      <td className="num">{r.credit ? money(r.credit) : ''}</td>
                      <td className="num cell-main">{balText(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Closing balance · {balanceLabel(ledger.closing)}</td>
                    <td className="num">{money(ledger.debit)}</td>
                    <td className="num">{money(ledger.credit)}</td>
                    <td className="num">{balText(ledger.closing)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="xs muted" style={{ marginTop: 8 }}>Dr = party owes you · Cr = you owe the party</p>
              <Pager {...pgLedger.pager} />
            </div>
          )}

          {tab === 'sales' &&
            (a.sales.length ? (
              <div className="table-wrap">
              <table className="table" {...pgSales.tableProps}>
                <thead><tr><th>Date</th><th>Invoice</th><th>Devices</th><th className="num">Total</th>{showProfit && <th className="num">Profit</th>}</tr></thead>
                <tbody>
                  {pgSales.rows.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => navigate(`/sales/${s.id}`)}>
                      <td className="tnum">{fmtDate(s.date)}</td>
                      <td className="cell-main">{s.invoiceNo}</td>
                      <td className="small">{s.items.map((i) => `${i.brand} ${i.model}`).join(', ')}</td>
                      <td className="num">{money(s.total)}</td>
                      {showProfit && <td className="num">{money(s.profit)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager {...pgSales.pager} />
              </div>
            ) : (
              <Empty title="No sales to this party" />
            ))}

          {tab === 'purchases' &&
            (a.purchases.length ? (
              <div className="table-wrap">
              <table className="table" {...pgPurch.tableProps}>
                <thead><tr><th>Date</th><th>No.</th><th>Devices</th><th className="num">Total</th><th className="num">Paid</th></tr></thead>
                <tbody>
                  {pgPurch.rows.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/purchases/${p.id}`)}>
                      <td className="tnum">{fmtDate(p.date)}</td>
                      <td className="cell-main">{p.purchaseNo}</td>
                      <td className="small">{p.items.map((i) => `${i.brand} ${i.model}`).join(', ')}</td>
                      <td className="num">{money(p.total)}</td>
                      <td className="num">{money(p.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager {...pgPurch.pager} />
              </div>
            ) : (
              <Empty title="No purchases from this party" />
            ))}

          {tab === 'devices' &&
            (a.fromThem.length ? (
              <div className="table-wrap">
              <table className="table" {...pgDevices.tableProps}>
                <thead><tr><th>Device</th><th>IMEI</th>{showProfit && <th className="num">Cost</th>}<th>Status</th><th className="num">Sold for</th>{showProfit && <th className="num">Profit</th>}</tr></thead>
                <tbody>
                  {pgDevices.rows.map((d) => {
                    const c = num(d.purchasePrice) + num(d.repairCost);
                    return (
                      <tr key={d.id} className="clickable" onClick={() => navigate(`/timeline/${d.imei}`)}>
                        <td className="cell-main">{deviceName(d)}</td>
                        <td className="mono small">{d.imei}</td>
                        {showProfit && <td className="num">{money(c)}</td>}
                        <td><StatusChip status={d.status} /></td>
                        <td className="num">{d.status === 'sold' ? money(d.salePrice) : '—'}</td>
                        {showProfit && <td className="num">{d.status === 'sold' ? money(num(d.salePrice) - c) : '—'}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager {...pgDevices.pager} />
              </div>
            ) : (
              <Empty title="No devices bought from this party" />
            ))}

          {tab === 'chart' && (
            <div className="stack">
              <div>
                <h3 style={{ fontSize: 15 }}>Sales to {party.name} by month</h3>
                <p className="muted small" style={{ margin: '2px 0 8px' }}>Bill total, last 12 active months</p>
                {a.months.some((m) => m.value) ? <MoneyBars data={a.months} height={240} /> : <p className="muted small">No sales yet.</p>}
              </div>
              <dl className="dl">
                <div><dt>Avg. sale per device</dt><dd className="num">{money(a.salesCount ? a.salesTotal / a.salesCount : 0)}</dd></div>
                <div><dt>Avg. buy per device</dt><dd className="num">{money(a.purchCount ? a.purchTotal / a.purchCount : 0)}</dd></div>
                {showProfit && <div><dt>Margin on sales</dt><dd className="num">{a.salesTotal ? ((a.salesProfit / a.salesTotal) * 100).toFixed(1) : '0.0'}%</dd></div>}
                <div><dt>Unsold from them</dt><dd className="num">{a.fromThem.length - a.soldFromThem} devices</dd></div>
              </dl>
            </div>
          )}
        </section>
      </div>

      {confirmDialog}
      <PartyForm open={editing} party={party} onClose={() => setEditing(false)} />
      <PaymentForm open={Boolean(payPreset)} preset={payPreset} onClose={() => setPayPreset(null)} />
    </div>
  );
}
