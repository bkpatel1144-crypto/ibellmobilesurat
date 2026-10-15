import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Receipt, Pencil, Trash2 } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Kpi, Modal, Field, useConfirm } from '../components/ui';
import { DateRange, ExportButtons, PRESETS, defaultRange } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import { BarList } from '../components/Charts';
import PaymentFields from '../components/PaymentFields';
import { saveExpense, deleteExpense, CASH_ACCOUNT } from '../lib/db';
import { accountName } from '../lib/ledger';
import { money, num, fmtDate, inRange, byDateDesc, today, EXPENSE_CATEGORIES } from '../lib/format';

export default function Expenses() {
  const { expenses, accounts, settings } = useData();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [range, setRange] = useState(defaultRange);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const categories = useMemo(() => [...new Set([...EXPENSE_CATEGORIES, ...expenses.map((e) => e.category)])], [expenses]);

  const inPeriod = useMemo(() => expenses.filter((e) => inRange(e.date, range.from, range.to)), [expenses, range]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return inPeriod
      .filter((e) => cat === 'all' || e.category === cat)
      .filter((e) => !s || (e.paidTo || '').toLowerCase().includes(s) || (e.note || '').toLowerCase().includes(s) || e.category.toLowerCase().includes(s))
      .sort(byDateDesc);
  }, [inPeriod, cat, q]);

  const total = rows.reduce((s, e) => s + num(e.amount), 0);
  const byCat = useMemo(() => {
    const m = new Map();
    for (const e of inPeriod) m.set(e.category, (m.get(e.category) || 0) + num(e.amount));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [inPeriod]);

  const remove = async (e) => {
    const ok = await confirm({ title: 'Delete this expense?', message: `${e.category} · ${money(e.amount)}`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    await deleteExpense(e.id);
    toast('Expense deleted');
  };

  const spec = () => ({
    settings,
    title: 'Expense Report',
    filename: `expenses-${range.from || 'all'}-${range.to || 'all'}`,
    meta: [
      ['Period', `${range.from ? fmtDate(range.from) : 'Beginning'} to ${range.to ? fmtDate(range.to) : 'Today'}`],
      ['Category', cat === 'all' ? 'All' : cat],
    ],
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'Category', key: 'cat' },
      { header: 'Paid to', key: 'to' },
      { header: 'Note', key: 'note' },
      { header: 'Mode', key: 'mode' },
      { header: 'Amount', key: 'amt', money: true },
    ],
    rows: rows.map((e) => ({ date: fmtDate(e.date), cat: e.category, to: e.paidTo, note: e.note, mode: `${e.mode} · ${accountName(accounts, e.accountId)}`, amt: e.amount })),
    foot: { date: 'Total', amt: total },
  });

  const pg = usePaged(rows, {
    resetOn: [range, cat, q],
    sort: [(e) => e.date, (e) => e.category, (e) => e.paidTo, (e) => e.mode, (e) => num(e.amount), null],
  });

  return (
    <div className="page">
      <PageHeader
        title="Expenses"
        subtitle="Shop running costs"
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
              <select className="select" style={{ width: 180 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
                <option value="all">All categories</option>
                {categories.map((c) => <option key={c}>{c}</option>)}
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
                    <tr><th>Date</th><th>Category</th><th>Details</th><th>Paid from</th><th className="num">Amount</th><th /></tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((e) => (
                      <tr key={e.id}>
                        <td className="tnum">{fmtDate(e.date)}</td>
                        <td><span className="chip plain">{e.category}</span></td>
                        <td>
                          <div>{e.paidTo || '—'}</div>
                          {e.note && <div className="cell-sub">{e.note}</div>}
                        </td>
                        <td className="small">{e.mode} · <span className="muted">{accountName(accounts, e.accountId)}</span></td>
                        <td className="num cell-main">{money(e.amount)}</td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                            <button className="btn btn-sm btn-icon" onClick={() => setEditing(e)} aria-label="Edit expense"><Pencil size={14} /></button>
                            <button className="btn btn-sm btn-icon btn-danger" onClick={() => remove(e)} aria-label="Delete expense"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4}>Total</td><td className="num">{money(total)}</td><td /></tr>
                  </tfoot>
                </table>
              </div>
              <Pager {...pg.pager} />
              </>
            ) : (
              <Empty icon={Receipt} title="No expenses in this period" action={<button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Add expense</button>} />
            )}
          </section>
          <div className="stack">
            <Kpi inverse icon={Receipt} label="Total in period" value={money(inPeriod.reduce((s, e) => s + num(e.amount), 0))} sub={`${inPeriod.length} entries`} />
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
