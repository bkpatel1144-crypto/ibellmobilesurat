import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Wallet, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Pencil, Trash2 } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Segmented, Kpi, useConfirm } from '../components/ui';
import { DateRange, ExportButtons, PRESETS, defaultRange } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import PaymentForm from '../components/PaymentForm';
import TransferForm from '../components/TransferForm';
import { deletePayment } from '../lib/db';
import { accountName } from '../lib/ledger';
import { money, num, fmtDate, inRange, byDateDesc } from '../lib/format';

const REF_LINK = { sale: '/sales/', purchase: '/purchases/' };

export default function Payments() {
  const { payments, accounts, settings } = useData();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [range, setRange] = useState(defaultRange);
  const [dir, setDir] = useState('all');
  const [acc, setAcc] = useState('all');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // { payment } | { preset }
  const [transfer, setTransfer] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return payments
      .filter((p) => inRange(p.date, range.from, range.to))
      .filter((p) => dir === 'all' || p.direction === dir)
      .filter((p) => acc === 'all' || p.accountId === acc || p.fromAccountId === acc || p.toAccountId === acc)
      .filter((p) => !s || (p.partyName || '').toLowerCase().includes(s) || (p.refNo || '').toLowerCase().includes(s) || (p.note || '').toLowerCase().includes(s))
      .sort(byDateDesc);
  }, [payments, range, dir, acc, q]);

  const tin = rows.filter((p) => p.direction === 'in').reduce((s, p) => s + num(p.amount), 0);
  const tout = rows.filter((p) => p.direction === 'out').reduce((s, p) => s + num(p.amount), 0);

  const remove = async (p) => {
    const ok = await confirm({
      title: 'Delete this payment?',
      message: p.refNo ? `The bill ${p.refNo} will show this amount as unpaid again.` : 'This cannot be undone.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deletePayment(p.id);
    toast('Payment deleted');
  };

  const label = (p) =>
    p.direction === 'transfer'
      ? `${accountName(accounts, p.fromAccountId)} → ${accountName(accounts, p.toAccountId)}`
      : accountName(accounts, p.accountId);

  const spec = () => ({
    settings,
    title: 'Payments Register',
    filename: `payments-${range.from || 'all'}-${range.to || 'all'}`,
    landscape: true,
    meta: [['Period', `${range.from ? fmtDate(range.from) : 'Beginning'} to ${range.to ? fmtDate(range.to) : 'Today'}`]],
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'Type', key: 'type' },
      { header: 'Party', key: 'party' },
      { header: 'Ref', key: 'ref' },
      { header: 'Mode', key: 'mode' },
      { header: 'Account', key: 'acc' },
      { header: 'In', key: 'in', money: true },
      { header: 'Out', key: 'out', money: true },
    ],
    rows: rows.map((p) => ({
      date: fmtDate(p.date),
      type: p.direction === 'in' ? 'Received' : p.direction === 'out' ? 'Paid' : 'Transfer',
      party: p.partyName,
      ref: [p.refNo, p.note].filter(Boolean).join(' · '),
      mode: p.mode,
      acc: label(p),
      in: p.direction === 'in' ? p.amount : '',
      out: p.direction === 'out' ? p.amount : '',
    })),
    foot: { date: 'Total', in: tin, out: tout },
  });

  const pg = usePaged(rows, {
    resetOn: [range, dir, acc, q],
    sort: [
      (p) => p.date,
      (p) => p.partyName,
      (p) => p.refNo,
      (p) => p.mode,
      (p) => (p.direction !== 'out' ? num(p.amount) : null),
      (p) => (p.direction === 'out' ? num(p.amount) : null),
      null,
    ],
  });

  return (
    <div className="page">
      <PageHeader
        title="Payments"
        subtitle="All money received and paid"
        actions={
          <>
            <button className="btn" onClick={() => setTransfer(true)}><ArrowLeftRight size={16} /> Transfer</button>
            <button className="btn" onClick={() => setForm({ preset: { direction: 'out' } })}><ArrowUpRight size={16} /> Pay</button>
            <button className="btn btn-primary" onClick={() => setForm({ preset: { direction: 'in' } })}><Plus size={16} /> Receive</button>
          </>
        }
      />
      <div className="stack">
        <div className="kpis">
          <Kpi inverse icon={ArrowDownLeft} label="Received" value={money(tin)} sub={`${rows.filter((p) => p.direction === 'in').length} entries`} />
          <Kpi icon={ArrowUpRight} label="Paid" value={money(tout)} sub={`${rows.filter((p) => p.direction === 'out').length} entries`} />
          <Kpi icon={Wallet} label="Net" value={money(tin - tout)} sub="Received − paid" />
        </div>
        <section className="card card-lg">
          <div className="toolbar">
            <div className="input-group">
              <Search size={16} />
              <input className="input" placeholder="Search party, bill, note…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <DateRange value={range} onChange={setRange} />
            <Segmented
              label="Direction"
              value={dir}
              onChange={setDir}
              options={[
                { value: 'all', label: 'All' },
                { value: 'in', label: 'Received' },
                { value: 'out', label: 'Paid' },
                { value: 'transfer', label: 'Transfers' },
              ]}
            />
            <select className="select" style={{ width: 180 }} value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="Account">
              <option value="all">All accounts</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
              <ExportButtons build={spec} small />
            </div>
          </div>
          {rows.length ? (
            <>
            <div className="table-wrap">
              <table className="table" {...pg.tableProps}>
                <thead>
                  <tr><th>Date</th><th>Party</th><th>Against</th><th>Mode · Account</th><th className="num">In</th><th className="num">Out</th><th /></tr>
                </thead>
                <tbody>
                  {pg.rows.map((p) => (
                    <tr key={p.id}>
                      <td className="tnum">{fmtDate(p.date)}</td>
                      <td>
                        <div className="cell-main">
                          {p.direction === 'transfer' ? 'Transfer' : p.partyId ? <Link to={`/parties/${p.partyId}`}>{p.partyName}</Link> : p.partyName || '—'}
                        </div>
                        {p.note && <div className="cell-sub">{p.note}</div>}
                      </td>
                      <td className="small">
                        {REF_LINK[p.refType] && p.refId ? <Link to={`${REF_LINK[p.refType]}${p.refId}`}>{p.refNo}</Link> : p.refType === 'repair' ? `Repair · ${p.refNo}` : p.refType === 'manual' ? 'On account' : ''}
                      </td>
                      <td className="small">{p.mode} · <span className="muted">{label(p)}</span></td>
                      <td className="num pos">{p.direction === 'in' ? money(p.amount) : p.direction === 'transfer' ? money(p.amount) : ''}</td>
                      <td className="num neg">{p.direction === 'out' ? money(p.amount) : ''}</td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                          {p.direction !== 'transfer' && (
                            <button className="btn btn-sm btn-icon" onClick={() => setForm({ payment: p })} aria-label="Edit payment"><Pencil size={14} /></button>
                          )}
                          <button className="btn btn-sm btn-icon btn-danger" onClick={() => remove(p)} aria-label="Delete payment"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager {...pg.pager} />
            </>
          ) : (
            <Empty icon={Wallet} title="No payments in this period" />
          )}
        </section>
      </div>
      {confirmDialog}
      <PaymentForm open={Boolean(form)} payment={form?.payment} preset={form?.preset} onClose={() => setForm(null)} />
      <TransferForm open={transfer} onClose={() => setTransfer(false)} />
    </div>
  );
}
