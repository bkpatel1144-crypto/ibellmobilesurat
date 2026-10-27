import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Receipt, Wrench, History } from 'lucide-react';
import RowActions from '../components/RowActions';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Kpi, Modal, Field, Segmented, StatusChip, useConfirm } from '../components/ui';
import { DateRange, ExportButtons, PRESETS, defaultRange } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import { BarList } from '../components/Charts';
import PaymentFields from '../components/PaymentFields';
import { saveExpense, deleteExpense, CASH_ACCOUNT } from '../lib/db';
import { accountName } from '../lib/ledger';
import { money, num, fmtDate, inRange, byDateDesc, today, EXPENSE_CATEGORIES } from '../lib/format';

/** Finished phone repairs show here too, read-only - they are edited on the Repairs page. */
export const REPAIR_CATEGORY = 'Phone repair';

export default function Expenses() {
  const { expenses, accounts, settings, repairs, payments, devices } = useData();
  const canDelete = useData().can('deleteRecords');
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [range, setRange] = useState(defaultRange);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [kind, setKind] = useState('all'); // all · shop · repair

  const categories = useMemo(() => [...new Set([...EXPENSE_CATEGORIES, ...expenses.map((e) => e.category)])], [expenses]);

  // repairs as expense rows: finished ones by the day they were done (cost known); phones still at
  // repair show in the Repairs view only, with the cost pending
  const repairRows = useMemo(() => {
    const paidBy = new Map();
    for (const x of payments) if (x.refType === 'repair' && x.refId) paidBy.set(x.refId, (paidBy.get(x.refId) || 0) + num(x.amount));
    const devMap = new Map(devices.map((d) => [d.id, d]));
    return repairs
      .filter((r) => r.status === 'done' || r.status === 'in_repair')
      .map((r) => {
        const done = r.status === 'done';
        const paid = paidBy.get(r.id) || 0;
        return {
          id: `repair-${r.id}`,
          repair: r,
          device: devMap.get(r.deviceId),
          date: done ? r.doneDate || r.sentDate : r.sentDate,
          category: REPAIR_CATEGORY,
          paidTo: r.partyName || r.repairer || 'Repairer',
          note: [r.deviceName, r.issue].filter(Boolean).join(' · '),
          amount: done ? num(r.cost) : 0,
          paid,
          owed: done && r.partyId ? Math.max(0, num(r.cost) - paid) : 0,
          pending: !done,
          createdAt: r.createdAt,
        };
      });
  }, [repairs, payments, devices]);

  const shopInPeriod = useMemo(() => expenses.filter((e) => inRange(e.date, range.from, range.to)), [expenses, range]);
  const repairsInPeriod = useMemo(() => repairRows.filter((r) => inRange(r.date, range.from, range.to)), [repairRows, range]);
  const inPeriod = useMemo(() => [...shopInPeriod, ...repairsInPeriod.filter((r) => !r.pending)], [shopInPeriod, repairsInPeriod]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = kind === 'shop' ? shopInPeriod : kind === 'repair' ? repairsInPeriod : inPeriod;
    return list
      .filter((e) => cat === 'all' || e.category === cat)
      .filter(
        (e) =>
          !s ||
          (e.paidTo || '').toLowerCase().includes(s) ||
          (e.note || '').toLowerCase().includes(s) ||
          e.category.toLowerCase().includes(s) ||
          (e.repair?.imei || '').includes(s),
      )
      .sort(byDateDesc);
  }, [kind, shopInPeriod, repairsInPeriod, inPeriod, cat, q]);

  const total = rows.reduce((s, e) => s + num(e.amount), 0);
  const shopTotal = shopInPeriod.reduce((s, e) => s + num(e.amount), 0);
  const repairTotal = repairsInPeriod.reduce((s, e) => s + num(e.amount), 0);
  const repairOwed = repairsInPeriod.reduce((s, e) => s + num(e.owed), 0);
  const byCat = useMemo(() => {
    const m = new Map();
    for (const e of inPeriod) m.set(e.category, (m.get(e.category) || 0) + num(e.amount));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [inPeriod]);

  const remove = async (e) => {
    const ok = await confirm({ title: 'Delete this expense?', message: `${e.category} · ${money(e.amount)}`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    await deleteExpense(e.id, e);
    toast('Expense deleted');
  };

  const spec = () => ({
    settings,
    title: 'Expense Report',
    filename: `expenses-${range.from || 'all'}-${range.to || 'all'}`,
    meta: [
      ['Period', `${range.from ? fmtDate(range.from) : 'Beginning'} to ${range.to ? fmtDate(range.to) : 'Today'}`],
      ['Category', cat === 'all' ? 'All' : cat],
      ['Showing', { all: 'Shop expenses + phone repairs', shop: 'Shop expenses', repair: 'Phone repairs' }[kind]],
    ],
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'Category', key: 'cat' },
      { header: 'Paid to', key: 'to' },
      { header: 'Note', key: 'note' },
      { header: 'Mode', key: 'mode' },
      { header: 'Amount', key: 'amt', money: true },
    ],
    rows: rows.map((e) => ({
      date: fmtDate(e.date),
      cat: e.category,
      to: e.paidTo,
      note: e.repair ? [e.note, e.repair.imei, e.pending ? 'at repair - cost pending' : e.owed > 0 ? `${money(e.owed)} still owed` : ''].filter(Boolean).join(' · ') : e.note,
      mode: e.repair ? `Paid ${money(e.paid)}` : `${e.mode} · ${accountName(accounts, e.accountId)}`,
      amt: e.amount,
    })),
    foot: { date: 'Total', amt: total },
  });

  const pg = usePaged(rows, {
    resetOn: [range, cat, q, kind],
    sort: [(e) => e.date, (e) => e.category, (e) => e.paidTo, (e) => e.mode, (e) => num(e.amount), null],
  });

  return (
    <div className="page">
      <PageHeader
        title="Expenses"
        subtitle="Shop running costs and phone repair spending"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={16} /> Add expense
          </button>
        }
      />
      <div className="stack">
        <div className="grid grid-main-side">
          <section className="card card-lg">
            <div className="toolbar">
              <div className="input-group">
                <Search size={16} />
                <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <DateRange value={range} onChange={setRange} />
              <Segmented
                label="Show"
                value={kind}
                onChange={(v) => { setKind(v); setCat('all'); }}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'shop', label: 'Shop' },
                  { value: 'repair', label: 'Repairs' },
                ]}
              />
              {kind !== 'repair' && (
                <select className="select" style={{ width: 180 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
                  <option value="all">All categories</option>
                  {categories.map((c) => <option key={c}>{c}</option>)}
                  {kind === 'all' && <option>{REPAIR_CATEGORY}</option>}
                </select>
              )}
              <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
                <ExportButtons build={spec} small />
              </div>
            </div>
            {rows.length ? (
              <>
              <div className="table-wrap">
                <table className="table" {...pg.tableProps}>
                  <thead>
                    <tr><th>Date</th><th>Category</th><th>Details</th><th>Paid from</th><th className="num">Amount</th><th className="actions">Actions</th></tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((e) =>
                      e.repair ? (
                        <tr key={e.id}>
                          <td className="tnum">{fmtDate(e.date)}</td>
                          <td><span className="chip"><Wrench size={12} /> {e.category}</span></td>
                          <td>
                            <div>{e.repair.deviceName} <span className="muted mono small">· {e.repair.imei}</span></div>
                            <div className="cell-sub">
                              {[`${e.paidTo}`, e.repair.issue, `sent ${fmtDate(e.repair.sentDate)}`, !e.pending && e.repair.doneDate && `done ${fmtDate(e.repair.doneDate)}`].filter(Boolean).join(' · ')}
                            </div>
                            {e.device && <div className="cell-sub">Phone now: <StatusChip status={e.device.status} /></div>}
                          </td>
                          <td className="small">
                            {e.pending ? <span className="chip caution">At repair · cost pending</span> : <>Paid {money(e.paid)}{e.owed > 0 && <div className="neg">{money(e.owed)} still owed</div>}</>}
                          </td>
                          <td className="num cell-main">{e.pending ? '—' : money(e.amount)}</td>
                          <td className="actions">
                            <div className="row-actions">
                              <Link className="btn btn-sm btn-icon" to="/repairs" aria-label="Open in Repairs" title="Open in Repairs"><Wrench size={14} /></Link>
                              <Link className="btn btn-sm btn-icon" to={`/timeline/${e.repair.imei}`} aria-label="IMEI timeline" title="IMEI timeline"><History size={14} /></Link>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={e.id}>
                          <td className="tnum">{fmtDate(e.date)}</td>
                          <td><span className="chip plain">{e.category}</span></td>
                          <td>
                            <div>{e.paidTo || '—'}</div>
                            {e.note && <div className="cell-sub">{e.note}</div>}
                          </td>
                          <td className="small">{e.mode} · <span className="muted">{accountName(accounts, e.accountId)}</span></td>
                          <td className="num cell-main">{money(e.amount)}</td>
                          <td className="actions">
                            <RowActions onEdit={() => setEditing(e)} onDelete={canDelete ? () => remove(e) : null} editLabel="Edit expense" deleteLabel="Delete expense" />
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4}>Total</td><td className="num">{money(total)}</td><td /></tr>
                  </tfoot>
                </table>
              </div>
              <Pager {...pg.pager} />
              </>
            ) : (
              <Empty icon={kind === 'repair' ? Wrench : Receipt} title={kind === 'repair' ? 'No phone repairs in this period' : 'No expenses in this period'} action={kind !== 'repair' && <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Add expense</button>} />
            )}
          </section>
          <div className="stack">
            <Kpi inverse icon={Receipt} label="All spending in period" value={money(shopTotal + repairTotal)} sub={`Shop ${money(shopTotal)} · repairs ${money(repairTotal)}`} />
            <Kpi
              icon={Wrench}
              label="Phone repairs"
              value={money(repairTotal)}
              sub={[`${repairsInPeriod.filter((r) => !r.pending).length} done`, repairsInPeriod.some((r) => r.pending) && `${repairsInPeriod.filter((r) => r.pending).length} at repair`, repairOwed > 0 && `${money(repairOwed)} owed`].filter(Boolean).join(' · ')}
            />
            <p className="xs muted" style={{ margin: 0 }}>
              Repair cost is also part of each phone's cost, so profit counts it once - when the phone is sold.
            </p>
            <section className="card card-lg">
              <div className="card-head"><h2>By category</h2></div>
              <BarList rows={byCat} empty="Nothing spent in this period." />
            </section>
          </div>
        </div>
      </div>
      {confirmDialog}
      <ExpenseForm expense={editing} categories={categories} onClose={() => setEditing(null)} />
    </div>
  );
}

function ExpenseForm({ expense, categories, onClose }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState(false);

  useEffect(() => {
    if (expense) {
      setNewCat(false);
      setF({ date: today(), category: 'Rent', amount: '', mode: 'Cash', accountId: CASH_ACCOUNT, paidTo: '', note: '', ...expense, amount: expense.amount ?? '' });
    }
  }, [expense]);
  const setPay = useCallback((v) => setF((p) => ({ ...p, ...v })), []);

  if (!expense || !f) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (num(f.amount) <= 0) return toast('Enter an amount', 'error');
    if (!f.category?.trim()) return toast('Enter a category', 'error');
    setBusy(true);
    try {
      await saveExpense({ ...f, category: f.category.trim() });
      toast(expense.id ? 'Expense updated' : 'Expense added');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={expense.id ? 'Edit expense' : 'Add expense'}>
      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <Field label="Category" required>
            {newCat ? (
              <input className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} autoFocus />
            ) : (
              <select
                className="select"
                value={f.category}
                onChange={(e) => (e.target.value === '__new' ? (setNewCat(true), setF({ ...f, category: '' })) : setF({ ...f, category: e.target.value }))}
              >
                {categories.map((c) => <option key={c}>{c}</option>)}
                <option value="__new">+ New category…</option>
              </select>
            )}
          </Field>
          <Field label="Amount (₹)" required>
            <input className="input num" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <Field label="Paid to">
            <input className="input" value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} />
          </Field>
          <PaymentFields mode={f.mode} accountId={f.accountId} onChange={setPay} modeLabel="Paid by" />
        </div>
        <Field label="Note">
          <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
