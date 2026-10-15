import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Trash2, Printer, Download, Wallet, History, EyeOff, Eye, Pencil, Undo2 } from 'lucide-react';
import SaleEditModal from '../components/SaleEditModal';
import DocActions from '../components/DocActions';
import MoreMenu from '../components/MoreMenu';
import { saleMessage } from '../lib/share';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, useConfirm } from '../components/ui';
import { IdProofView } from '../components/IdProof';
import PaymentForm from '../components/PaymentForm';
import { deleteSale, setSaleHidden } from '../lib/db';
import { accountName } from '../lib/ledger';
import { returnableSaleLines, returnOf } from '../lib/returns';
import { money, num, round2, fmtDate, amountInWords } from '../lib/format';

export default function SaleView() {
  const { id } = useParams();
  const data = useData();
  const canDelete = useData().can('deleteRecords');
  const { sales, payments, accounts, settings, privacy, returns, devices } = data;
  const canProfit = data.can('viewProfit');
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [payPreset, setPayPreset] = useState(null);
  const [busy, setBusy] = useState('');
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit') === '1';
  const setEditing = (on) => setParams(on ? { edit: '1' } : {}, { replace: true });

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
  const notes = returns.filter((x) => x.kind === 'sale' && x.billId === id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const refunds = payments.filter((x) => x.refType === 'saleReturn' && x.billId === id);
  const canReturn = new Set(returnableSaleLines(s, devices).map((l) => l.deviceId));
  const due = round2(num(s.due));

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
        subtitle={[fmtDate(s.date), s.customerName, s.createdBy && `billed by ${s.createdBy}`].filter(Boolean).join(' · ')}
        back={
          <div className="capsule-group glass">
            <button type="button" className="btn btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={18} /></button>
          </div>
        }
        actions={
          <>
            <DocActions
              title={`Bill ${s.invoiceNo}`}
              build={async (output) => {
                const { invoicePdf } = await import('../lib/export');
                return invoicePdf(s, settings, { action: output === 'save' ? 'download' : output });
              }}
              message={saleMessage(s, settings)}
              phone={s.customerPhone || data.parties.find((x) => x.id === s.partyId)?.phone}
            />
            <button className="btn" onClick={() => pdf('print')} disabled={Boolean(busy)}><Printer size={16} /> Print</button>
            <button className="btn" onClick={() => setEditing(true)}><Pencil size={16} /> Edit</button>
            <MoreMenu
              items={[
                { label: 'Download PDF', icon: Download, onClick: () => pdf('download') },
                { label: 'Return phones', icon: Undo2, to: `/returns/new?kind=sale&bill=${s.id}`, hidden: !canReturn.size },
                { label: s.hidden ? 'Make visible' : 'Make private', icon: s.hidden ? Eye : EyeOff, onClick: togglePrivate, hidden: !privacy.unlocked },
                { label: 'Delete bill', icon: Trash2, onClick: remove, danger: true, hidden: !canDelete },
              ]}
            />
            {due < -0.004 && notes.length > 0 && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  const n = notes[notes.length - 1];
                  setPayPreset({ direction: 'out', partyId: s.partyId, partyName: s.customerName, refType: 'saleReturn', refId: n.id, refNo: n.returnNo, billId: s.id, amount: -due, note: `Refund for ${n.returnNo}`, hidden: s.hidden });
                }}
              >
                <Wallet size={16} /> Refund
              </button>
            )}
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
                {notes.length > 0 && <span className="chip plain">{s.returnedCount >= s.items.length ? 'Returned' : `${s.returnedCount} returned`}</span>}
                {due > 0 ? <span className="chip caution">Due {money(due)}</span> : due < -0.004 ? <span className="chip caution">Refund owed {money(-due)}</span> : <span className="chip success">Paid</span>}
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>{s.mode} · {accountName(accounts, s.accountId)}</div>
            </div>
          </div>

          <div className="stack">
            {s.items.map((it, n) => {
              const back = returnOf(notes, s.id, it.deviceId);
              return (
              <div className={`line ${back ? 'muted-line' : ''}`} key={it.deviceId}>
                <div className="line-head">
                  <div className="row" style={{ gap: 10 }}>
                    <span className="line-index">{n + 1}</span>
                    <div>
                      <div className="cell-main">{[it.brand, it.model, it.variant, it.color].filter(Boolean).join(' ')}</div>
                      <div className="cell-sub mono">{[it.imei, it.imei2].filter(Boolean).join(' / ')}</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {back && <Link className="chip plain" to={`/returns/${back.id}`}>Returned · {back.returnNo}</Link>}
                    <div className="cell-main num" style={{ fontSize: 18 }}>{money(it.price)}</div>
                  </div>
                </div>
                <dl className="dl">
                  <div><dt>Condition</dt><dd>{it.condition}</dd></div>
                  <div><dt>Warranty</dt><dd>{it.warranty || '—'}</dd></div>
                  {canProfit && <div><dt>Cost</dt><dd className="num">{money(it.cost)}</dd></div>}
                  {canProfit && <div><dt>Margin</dt><dd className="num">{money(num(it.taxable ?? it.price) - num(it.cost))}</dd></div>}
                </dl>
                <div className="sub-box">
                  <div className="field-label" style={{ marginBottom: 6 }}>Buyer ID proof</div>
                  <IdProofView ids={it.buyerIdProofs} idType={it.buyerIdType} idNumber={it.buyerIdNumber} />
                </div>
                <div className="row" style={{ marginTop: 12, gap: 8 }}>
                  <Link className="btn btn-sm" to={`/timeline/${it.imei}`}><History size={15} /> Timeline</Link>
                  {canReturn.has(it.deviceId) && (
                    <Link className="btn btn-sm" to={`/returns/new?kind=sale&bill=${s.id}&device=${it.deviceId}`}><Undo2 size={15} /> Return this phone</Link>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          <div className="grid grid-2" style={{ marginTop: 24, alignItems: 'start' }}>
            <div className="stack-sm small">
              <div><span className="muted">Amount in words:</span> <b>{amountInWords(s.total)}</b></div>
              {s.notes && <div><span className="muted">Notes:</span> {s.notes}</div>}
            </div>
            <div className="totals">
              <div><span className="muted">Subtotal</span><span className="num">{money(s.subtotal)}</span></div>
              {num(s.discount) > 0 && <div><span className="muted">Discount</span><span className="num">− {money(s.discount)}</span></div>}
              {num(s.tax) > 0 && (
                <>
                  <div><span className="muted">Taxable value</span><span className="num">{money(s.taxable ?? num(s.total) - num(s.tax))}</span></div>
                  {num(s.igst) > 0 ? (
                    <div><span className="muted">IGST {s.taxPercent}%</span><span className="num">{money(s.igst)}</span></div>
                  ) : (
                    <>
                      <div><span className="muted">CGST {num(s.taxPercent) / 2}%</span><span className="num">{money(s.cgst ?? num(s.tax) / 2)}</span></div>
                      <div><span className="muted">SGST {num(s.taxPercent) / 2}%</span><span className="num">{money(s.sgst ?? num(s.tax) / 2)}</span></div>
                    </>
                  )}
                </>
              )}
              <div className="grand"><span>Total</span><span className="num">{money(s.total)}</span></div>
              <div><span className="muted">Received</span><span className="num">{money(s.received)}</span></div>
              {num(s.returned) > 0 && (
                <>
                  <div><span className="muted">Returned (credit notes)</span><span className="num">− {money(s.returned)}</span></div>
                  <div><span className="muted">Refunded</span><span className="num">{money(s.refunded)}</span></div>
                </>
              )}
              {due < -0.004 ? (
                <div><b>Refund owed</b><b className="num">{money(-due)}</b></div>
              ) : (
                <div><b>Balance due</b><b className="num">{money(Math.max(due, 0))}</b></div>
              )}
              {canProfit && <div><span className="muted">Profit</span><span className="num">{money(s.profit)}</span></div>}
            </div>
          </div>
        </section>

        {notes.length > 0 && (
          <section className="card card-lg">
            <div className="card-head">
              <h2>Returns</h2>
              <span className="muted small">{money(s.returned)} credited · {money(s.refunded)} refunded</span>
            </div>
            <table className="table">
              <tbody>
                {notes.map((x) => (
                  <tr key={x.id} className="clickable" onClick={() => navigate(`/returns/${x.id}`)}>
                    <td className="tnum">{fmtDate(x.date)}</td>
                    <td className="cell-main">{x.returnNo}</td>
                    <td className="small">{x.items.map((i) => `${i.brand} ${i.model}`).join(', ')}{x.reason && <div className="cell-sub">{x.reason}</div>}</td>
                    <td className="num cell-main">{money(x.total)}</td>
                  </tr>
                ))}
                {refunds.map((x) => (
                  <tr key={x.id}>
                    <td className="tnum">{fmtDate(x.date)}</td>
                    <td className="muted">Refund · {x.refNo}</td>
                    <td className="small">{x.mode} · <span className="muted">{accountName(accounts, x.accountId)}</span></td>
                    <td className="num">− {money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

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
      <SaleEditModal sale={s} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}
