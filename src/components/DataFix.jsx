import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Wrench, Link2, Wallet } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from './ui';
import { repairExpenseDuplicates, unlinkedPayments, orphanPayments } from '../lib/datafix';
import { removeDuplicateRepairExpenses, linkPaymentsToParties, movePaymentsOnAccount } from '../lib/db';
import { money, fmtDate } from '../lib/format';

/**
 * Settings → Data → "Check & fix old data". Finds records made with older versions that now
 * count twice or settle nothing, shows each one, and fixes them only when the owner presses the button.
 * Works on all records (private ones included).
 */
export default function DataFix() {
  const { raw } = useData();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [busy, setBusy] = useState('');

  const repairs = useMemo(() => repairExpenseDuplicates(raw), [raw]);
  const dupes = repairs.filter((x) => x.repair);
  const keep = repairs.filter((x) => !x.repair);
  const unlinked = useMemo(() => unlinkedPayments(raw), [raw]);
  const orphans = useMemo(() => orphanPayments(raw), [raw]);

  const run = async (key, ask, fn, done) => {
    const ok = await confirm(ask);
    if (!ok) return;
    setBusy(key);
    try {
      await fn();
      toast(done);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const allClear = !dupes.length && !unlinked.length && !orphans.length;

  return (
    <div className="stack">
      {allClear && (
        <div className="row" style={{ gap: 8 }}>
          <CheckCircle2 size={18} className="pos" />
          <span className="small"><b>All clear</b> - no duplicate repair expenses and no unlinked payments found.</span>
        </div>
      )}

      {/* 1 - repair costs also typed in as expenses */}
      <div className="fix-block">
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="cell-main"><Wrench size={15} /> Expenses: repair costs entered twice</div>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              A finished repair already adds its cost to the phone, so profit counts it when the phone is sold. The same amount typed in as an expense takes it off profit a second time.
            </p>
          </div>
          {dupes.length > 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  'exp',
                  { title: `Remove ${dupes.length} duplicate expense${dupes.length === 1 ? '' : 's'}?`, message: `${money(dupes.reduce((t, x) => t + Number(x.expense.amount || 0), 0))} of expenses that repeat a repair are removed. The repairs stay and still show in Expenses → Repairs. Take a backup first if you are unsure.`, confirmText: 'Remove duplicates', danger: true },
                  () => removeDuplicateRepairExpenses(dupes),
                  `${dupes.length} duplicate expense${dupes.length === 1 ? '' : 's'} removed`,
                )
              }
            >
              {busy === 'exp' ? 'Fixing…' : `Remove ${dupes.length} duplicate${dupes.length === 1 ? '' : 's'}`}
            </button>
          ) : (
            <span className="chip success">Nothing to fix</span>
          )}
        </div>
        {dupes.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Expense</th><th className="num">Amount</th><th>Same as repair</th></tr></thead>
              <tbody>
                {dupes.map(({ expense: e, repair: r }) => (
                  <tr key={e.id}>
                    <td>
                      <div>{fmtDate(e.date)} · {e.category}</div>
                      <div className="cell-sub">{[e.paidTo, e.note].filter(Boolean).join(' · ') || '—'}</div>
                    </td>
                    <td className="num cell-main">{money(e.amount)}</td>
                    <td>
                      <div>{r.deviceName} <span className="mono small muted">{r.imei}</span></div>
                      <div className="cell-sub">{r.partyName || r.repairer || 'Repairer'} · done {fmtDate(r.doneDate || r.sentDate)} · {money(r.cost)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {keep.length > 0 && (
          <p className="xs muted" style={{ margin: '8px 0 0' }}>
            {keep.length} other repair-like expense{keep.length === 1 ? '' : 's'} ({money(keep.reduce((t, x) => t + Number(x.expense.amount || 0), 0))}) match no repair record, so they are counted only once - left as they are.
          </p>
        )}
      </div>

      {/* 2 - payments with a typed name */}
      <div className="fix-block">
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="cell-main"><Link2 size={15} /> Payments: not linked to their party</div>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Money entered with “No party (enter name)” instead of choosing the party never settles that party's bills - so their bills keep showing Due. When the typed name matches a party exactly, it can be linked.
            </p>
          </div>
          {unlinked.length > 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  'link',
                  { title: `Link ${unlinked.length} payment${unlinked.length === 1 ? '' : 's'}?`, message: 'Each payment is linked to the party with the same name. It then settles that party’s oldest open bills and shows in their ledger.', confirmText: 'Link payments' },
                  () => linkPaymentsToParties(unlinked),
                  `${unlinked.length} payment${unlinked.length === 1 ? '' : 's'} linked`,
                )
              }
            >
              {busy === 'link' ? 'Fixing…' : `Link ${unlinked.length} payment${unlinked.length === 1 ? '' : 's'}`}
            </button>
          ) : (
            <span className="chip success">Nothing to fix</span>
          )}
        </div>
        {unlinked.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Payment</th><th className="num">Amount</th><th>Will be linked to</th></tr></thead>
              <tbody>
                {unlinked.map(({ payment: p, party }) => (
                  <tr key={p.id}>
                    <td>
                      <div>{fmtDate(p.date)} · {p.direction === 'in' ? 'Received from' : 'Paid to'} “{p.partyName}”</div>
                      <div className="cell-sub">{[p.mode, p.note].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="num cell-main">{money(p.amount)}</td>
                    <td><Link to={`/parties/${party.id}`}>{party.name}</Link> <span className="muted small">· {party.type}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3 - payments of deleted bills */}
      <div className="fix-block">
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="cell-main"><Wallet size={15} /> Payments: of a bill that was deleted</div>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              They still sit on the party's account but settle no bill. Moved “on account”, they settle the party's other open bills.
            </p>
          </div>
          {orphans.length > 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  'orphan',
                  { title: `Move ${orphans.length} payment${orphans.length === 1 ? '' : 's'} on account?`, message: 'The amount and party stay the same; only the link to the deleted bill is removed.', confirmText: 'Move on account' },
                  () => movePaymentsOnAccount(orphans),
                  `${orphans.length} payment${orphans.length === 1 ? '' : 's'} moved on account`,
                )
              }
            >
              {busy === 'orphan' ? 'Fixing…' : `Move ${orphans.length} on account`}
            </button>
          ) : (
            <span className="chip success">Nothing to fix</span>
          )}
        </div>
        {orphans.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Payment</th><th className="num">Amount</th><th>Was on</th></tr></thead>
              <tbody>
                {orphans.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.date)} · {p.direction === 'in' ? 'Received from' : 'Paid to'} {p.partyName || '—'}</td>
                    <td className="num cell-main">{money(p.amount)}</td>
                    <td className="small muted">{p.refNo || 'a deleted bill'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
