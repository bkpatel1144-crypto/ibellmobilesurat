import { useEffect, useMemo, useState } from 'react';
import { Plus, Landmark, Banknote, ArrowLeftRight, Pencil, Trash2 } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Modal, Field, useConfirm } from '../components/ui';
import { ExportButtons, DateRange, PRESETS, defaultRange } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import TransferForm from '../components/TransferForm';
import { accountLedger } from '../lib/ledger';
import { saveBank, deleteBank, saveSettings, CASH_ACCOUNT } from '../lib/db';
import { money, fmtDate, inRange, round2 } from '../lib/format';

export default function Banks() {
  const data = useData();
  const canDelete = useData().can('deleteRecords');
  const { accounts, settings } = data;
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [sel, setSel] = useState(CASH_ACCOUNT);
  const [editing, setEditing] = useState(null);
  const [transfer, setTransfer] = useState(false);
  const [range, setRange] = useState(defaultRange);

  const ledgers = useMemo(() => new Map(accounts.map((a) => [a.id, accountLedger(a, data)])), [accounts, data]);
  const total = [...ledgers.values()].reduce((s, l) => s + l.closing, 0);
  const account = accounts.find((a) => a.id === sel) || accounts[0];
  const ledger = ledgers.get(account.id);

  // statement for the chosen period, with the balance carried in
  const stmt = useMemo(() => {
    let opening = ledger.opening;
    const rows = [];
    for (const r of ledger.rows) {
      if (range.from && r.date < range.from) opening = r.balance;
      else if (inRange(r.date, range.from, range.to)) rows.push(r);
    }
    const tin = rows.reduce((s, r) => s + r.in, 0);
    const tout = rows.reduce((s, r) => s + r.out, 0);
    return { opening, rows, in: tin, out: tout, closing: round2(opening + tin - tout) };
  }, [ledger, range]);

  const remove = async (a) => {
    if (ledgers.get(a.id).rows.length) return toast('This account has transactions and cannot be deleted.', 'error');
    const ok = await confirm({ title: `Delete ${a.name}?`, message: 'This cannot be undone.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    await deleteBank(a.id, a.name);
    setSel(CASH_ACCOUNT);
    toast('Account deleted');
  };

  const spec = () => ({
    settings,
    title: 'Account Statement',
    rightLines: [account.name],
    filename: `statement-${account.name.replace(/\s+/g, '-')}`,
    meta: [
      ['Account', [account.name, account.bankName, account.accountNo].filter(Boolean).join(' · ')],
      ['Period', `${range.from ? fmtDate(range.from) : 'Beginning'} to ${range.to ? fmtDate(range.to) : 'Today'}`],
      ['Opening balance', money(stmt.opening).replace('₹', 'Rs. ')],
    ],
    columns: [
      { header: 'Date', key: 'date' },
      { header: 'Type', key: 'type' },
      { header: 'Particulars', key: 'p' },
      { header: 'In', key: 'in', money: true },
      { header: 'Out', key: 'out', money: true },
      { header: 'Balance', key: 'bal', money: true },
    ],
    rows: stmt.rows.map((r) => ({ date: fmtDate(r.date), type: r.type, p: [r.ref, r.particulars].filter(Boolean).join(' · '), in: r.in || '', out: r.out || '', bal: r.balance })),
    foot: { date: 'Total', in: stmt.in, out: stmt.out, bal: stmt.closing },
    landscape: true,
  });

  const pg = usePaged(stmt.rows, {
    resetOn: [sel, range],
    sort: [(r) => r.date, (r) => r.type, (r) => r.particulars, (r) => r.in || null, (r) => r.out || null, (r) => r.balance],
  });

  return (
    <div className="page">
      <PageHeader
        title="Banks"
        subtitle={`Total balance ${money(total)}`}
        actions={
          <>
            <button className="btn" onClick={() => setTransfer(true)}><ArrowLeftRight size={16} /> Transfer</button>
            <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Add account</button>
          </>
        }
      />
      <div className="stack">
        <div className="kpis cascade">
          {accounts.map((a) => {
            const active = a.id === account.id;
            return (
              <button
                key={a.id}
                type="button"
                className={`kpi ${active ? 'inverse' : ''}`}
                style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
                onClick={() => setSel(a.id)}
                aria-pressed={active}
              >
                <div className="kpi-label">
                  {a.isCash ? <Banknote size={16} /> : <Landmark size={16} />} {a.name}
                </div>
                <div className="kpi-value">{money(ledgers.get(a.id).closing)}</div>
                <div className="kpi-sub">{a.isCash ? 'Cash drawer' : [a.bankName, a.accountNo && `A/c ${a.accountNo}`].filter(Boolean).join(' · ') || 'Bank account'}</div>
              </button>
            );
          })}
        </div>

        <section className="card card-lg">
          <div className="card-head">
            <div>
              <h2>{account.name}</h2>
              <p className="muted small" style={{ margin: 0 }}>
                {[account.bankName, account.accountNo, account.ifsc, account.upiId].filter(Boolean).join(' · ') || 'Statement'}
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {(!account.isCash || data.can('editSettings')) && (
                <button className="btn btn-sm" onClick={() => setEditing(account)}><Pencil size={14} /> Edit</button>
              )}
              {!account.isCash && canDelete && (
                <button className="btn btn-sm btn-danger btn-icon" onClick={() => remove(account)} aria-label="Delete account"><Trash2 size={14} /></button>
              )}
            </div>
          </div>
          <div className="toolbar">
            <DateRange value={range} onChange={setRange} />
            <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
              <ExportButtons build={spec} small />
            </div>
          </div>
          <div className="row small" style={{ gap: 24, marginBottom: 12 }}>
            <span>Opening <b className="num">{money(stmt.opening)}</b></span>
            <span>In <b className="num pos">{money(stmt.in)}</b></span>
            <span>Out <b className="num neg">{money(stmt.out)}</b></span>
            <span>Closing <b className="num">{money(stmt.closing)}</b></span>
          </div>
          {stmt.rows.length ? (
            <>
            <div className="table-wrap">
              <table className="table" {...pg.tableProps}>
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Particulars</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th></tr>
                </thead>
                <tbody>
                  {pg.rows.map((r, i) => (
                    <tr key={`${r.id}-${i}`}>
                      <td className="tnum">{fmtDate(r.date)}</td>
                      <td><div className="cell-main">{r.type}</div><div className="cell-sub">{r.ref}</div></td>
                      <td className="small">{r.particulars}</td>
                      <td className="num pos">{r.in ? money(r.in) : ''}</td>
                      <td className="num neg">{r.out ? money(r.out) : ''}</td>
                      <td className="num cell-main">{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager {...pg.pager} />
            </>
          ) : (
            <Empty icon={Landmark} title="No transactions in this period" />
          )}
        </section>
      </div>

      {confirmDialog}
      <BankForm account={editing} onClose={() => setEditing(null)} />
      <TransferForm open={transfer} onClose={() => setTransfer(false)} />
    </div>
  );
}

function BankForm({ account, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (account) setF({ name: '', bankName: '', accountNo: '', ifsc: '', upiId: '', ...account, openingBalance: account.openingBalance ?? '' });
  }, [account]);

  if (!account) return null;
  const isCash = account.isCash;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isCash) await saveSettings({ cashOpening: Number(f.openingBalance) || 0 });
      else {
        if (!f.name?.trim()) throw new Error('Account name is required.');
        await saveBank({ ...f, id: account.id });
      }
      toast('Account saved');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isCash ? 'Cash in Hand' : account.id ? 'Edit account' : 'New bank account'}>
      <form onSubmit={submit} className="stack">
        {!isCash && (
          <div className="form-grid">
            <Field label="Display name" required><input className="input" placeholder="e.g. HDFC Current" value={f.name || ''} onChange={set('name')} /></Field>
            <Field label="Bank name"><input className="input" value={f.bankName || ''} onChange={set('bankName')} /></Field>
            <Field label="Account no."><input className="input mono" value={f.accountNo || ''} onChange={set('accountNo')} /></Field>
            <Field label="IFSC"><input className="input mono" value={f.ifsc || ''} onChange={set('ifsc')} /></Field>
            <Field label="UPI ID"><input className="input" value={f.upiId || ''} onChange={set('upiId')} /></Field>
          </div>
        )}
        <Field label="Opening balance (₹)" hint="Balance before you started using IBELL MOBILE">
          <input className="input num" type="number" step="0.01" value={f.openingBalance ?? ''} onChange={set('openingBalance')} />
        </Field>
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
