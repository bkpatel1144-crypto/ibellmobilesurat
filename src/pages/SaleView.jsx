import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, Printer, Download, Wallet, History, EyeOff, Eye } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, useConfirm } from '../components/ui';
import { IdProofView } from '../components/IdProof';
import PaymentForm from '../components/PaymentForm';
import { deleteSale, setSaleHidden } from '../lib/db';
import { accountName } from '../lib/ledger';
import { money, num, round2, fmtDate, amountInWords } from '../lib/format';

export default function SaleView() {
  const { id } = useParams();
  const data = useData();
  const { sales, payments, accounts, settings, privacy } = data;
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [payPreset, setPayPreset] = useState(null);
  const [busy, setBusy] = useState('');

  const s = sales.find((x) => x.id === id);
  if (!s) {
    return (
      <div className="page">
        <PageHeader title="Sale" />
        <div className="card"><Empty title="Bill not found" action={<Link className="btn" to="/sales">Back to sales</Link>} /></div>
      </div>
    );
  }

  const pays = payments.filter((x) => x.refType === 'sale' && x.refId === id);
  const due = round2(num(s.total) - num(s.received));

  const pdf = async (action) => {
    setBusy(action);
    try {
      const { invoicePdf } = await import('../lib/export');
      await invoicePdf(s, settings, { action });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${s.invoiceNo}?`,
      message: 'The devices go back to stock and the payments for this bill are removed. This cannot be undone.',
      confirmText: 'Delete bill',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteSale(s, data.raw);
      toast('Bill deleted, devices back in stock');
      navigate('/sales');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const togglePrivate = async () => {
    await setSaleHidden(s, !s.hidden, data.raw);
    toast(s.hidden ? 'Bill is now visible to everyone' : 'Bill is now private');
  };

  return (
    <div className="page">
      <PageHeader
        title={s.invoiceNo}
        subtitle={`${fmtDate(s.date)} · ${s.customerName}`}
        back={
          <div className="capsule-group glass">
            <button type="button" className="btn btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={18} /></button>
          </div>
        }
        actions={
          <>
            <button className="btn" onClick={() => pdf('download')} disabled={Boolean(busy)} aria-label="Download PDF"><Download size={16} /></button>
            <button className="btn" onClick={() => pdf('print')} disabled={Boolean(busy)}><Printer size={16} /> Print</button>
            <button className="btn btn-danger" onClick={remove} aria-label="Delete bill"><Trash2 size={16} /></button>
            {due > 0 && (
              <button
                className="btn btn-primary"
                onClick={() =>
                  setPayPreset({ direction: 'in', partyId: s.partyId, partyName: s.customerName, refType: 'sale', refId: s.id, refNo: s.invoiceNo, amount: due, hidden: s.hidden })
                }
              >
                <Wallet size={16} /> Receive
              </button>
            )}
          </>
        }
      />

      <div className="stack">
        <section className="card card-lg">
          <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <div className="xs muted" style={{ fontWeight: 600, letterSpacing: '0.06em' }}>BILL TO</div>
              <div className="cell-main" style={{ fontSize: 18 }}>
                {s.partyId ? <Link to={`/parties/${s.partyId}`}>{s.customerName}</Link> : s.customerName}
              </div>
              <div className="muted small">{[s.customerPhone, s.customerAddress].filter(Boolean).join(' · ')}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                {s.hidden && <span className="chip solid">Private</span>}
                {due > 0 ? <span className="chip caution">Due {money(due)}</span> : <span className="chip success">Paid</span>}
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>{s.mode} · {accountName(accounts, s.accountId)}</div>
            </div>
          </div>

          <div className="stack">
            {s.items.map((it, n) => (
              <div className="line" key={it.deviceId}>
                <div className="line-head">
                  <div className="row" style={{ gap: 10 }}>
                    <span className="line-index">{n + 1}</span>
                    <div>
                      <div className="cell-main">{[it.brand, it.model, it.variant, it.color].filter(Boolean).join(' ')}</div>
                      <div className="cell-sub mono">{[it.imei, it.imei2].filter(Boolean).join(' / ')}</div>
                    </div>
                  </div>
                  <div className="cell-main num" style={{ fontSize: 18 }}>{money(it.price)}</div>
                </div>
                <dl className="dl">
                  <div><dt>Condition</dt><dd>{it.condition}</dd></div>
                  <div><dt>Warranty</dt><dd>{it.warranty || '—'}</dd></div>
                  <div><dt>Cost</dt><dd className="num">{money(it.cost)}</dd></div>
                  <div><dt>Margin</dt><dd className="num">{money(num(it.price) - num(it.cost))}</dd></div>
                </dl>
                <div className="sub-box">
                  <div className="field-label" style={{ marginBottom: 6 }}>Buyer ID proof</div>
                  <IdProofView ids={it.buyerIdProofs} idType={it.buyerIdType} idNumber={it.buyerIdNumber} />
                </div>
                <Link className="btn btn-sm" style={{ marginTop: 12 }} to={`/timeline/${it.imei}`}><History size={15} /> Timeline</Link>
              </div>
            ))}
          </div>

          <div className="grid grid-2" style={{ marginTop: 24, alignItems: 'start' }}>
            <div className="stack-sm small">
              <div><span className="muted">Amount in words:</span> <b>{amountInWords(s.total)}</b></div>
              {s.notes && <div><span className="muted">Notes:</span> {s.notes}</div>}
            </div>
            <div className="totals">
              <div><span className="muted">Subtotal</span><span className="num">{money(s.subtotal)}</span></div>
              {num(s.discount) > 0 && <div><span className="muted">Discount</span><span className="num">− {money(s.discount)}</span></div>}
              {num(s.tax) > 0 && <div><span className="muted">GST {s.taxPercent}%</span><span className="num">{money(s.tax)}</span></div>}
              <div className="grand"><span>Total</span><span className="num">{money(s.total)}</span></div>
              <div><span className="muted">Received</span><span className="num">{money(s.received)}</span></div>
              <div><b>Balance due</b><b className="num">{money(Math.max(due, 0))}</b></div>
              <div><span className="muted">Profit</span><span className="num">{money(s.profit)}</span></div>
            </div>
          </div>
        </section>

        <section className="card card-lg">
          <div className="card-head">
            <h2>Payments received</h2>
            {privacy.unlocked && (
              <button className="btn btn-sm" onClick={togglePrivate}>
                {s.hidden ? <><Eye size={15} /> Make visible</> : <><EyeOff size={15} /> Make private</>}
              </button>
            )}
          </div>
          {pays.length ? (
            <table className="table">
              <tbody>
                {pays.map((x) => (
                  <tr key={x.id}>
                    <td className="tnum">{fmtDate(x.date)}</td>
                    <td>{x.mode} · <span className="muted">{accountName(accounts, x.accountId)}</span></td>
                    <td className="num cell-main">{money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>No payment received yet.</p>
          )}
        </section>
      </div>

      {confirmDialog}
      <PaymentForm open={Boolean(payPreset)} preset={payPreset} onClose={() => setPayPreset(null)} />
    </div>
  );
}
