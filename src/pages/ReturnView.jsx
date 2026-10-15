import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, Pencil, FileText, Wallet, History } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, StatusChip, useConfirm } from '../components/ui';
import PaymentForm from '../components/PaymentForm';
import DocActions from '../components/DocActions';
import MoreMenu from '../components/MoreMenu';
import { returnMessage } from '../lib/share';
import { deleteReturn } from '../lib/db';
import { NOTE_TITLE, KIND_LABEL } from '../lib/returns';
import { accountName } from '../lib/ledger';
import { money, num, round2, fmtDate } from '../lib/format';

const REFUND_REF = { sale: 'saleReturn', purchase: 'purchaseReturn' };

export default function ReturnView() {
  const { id } = useParams();
  const data = useData();
  const { returns, payments, accounts, settings, devices, can } = data;
  const canDelete = can('deleteRecords');
  const canProfit = can('viewProfit');
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [payPreset, setPayPreset] = useState(null);
  const [busy, setBusy] = useState(false);

  const n = returns.find((x) => x.id === id);
  if (!n) {
    return (
      <div className="page">
        <PageHeader title="Return" />
        <div className="card"><Empty title="Return not found" action={<Link className="btn" to="/returns">Back to returns</Link>} /></div>
      </div>
    );
  }

  const sale = n.kind === 'sale';
  const bill = sale ? data.sales.find((s) => s.id === n.billId) : data.purchases.find((p) => p.id === n.billId);
  const refunds = payments.filter((p) => p.refType === REFUND_REF[n.kind] && p.refId === n.id);
  const refunded = round2(refunds.reduce((s, p) => s + num(p.amount), 0));
  // what is still owed back on the whole bill (negative due = we owe the customer / the supplier owes us)
  const owed = bill ? round2(Math.max(0, -num(bill.due))) : 0;
  const gst = sale && num(n.tax) > 0;
  const devMap = new Map(devices.map((d) => [d.id, d]));

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${n.returnNo}?`,
      message: sale
        ? `The phones go back on ${n.billNo} as sold and the refunds for this return are removed. This cannot be undone.`
        : `The phones come back into stock and the refunds for this return are removed. This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteReturn(data.raw.returns.find((x) => x.id === n.id) || n, data.raw);
      toast(`${n.returnNo} deleted`);
      navigate('/returns');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const pdf = async () => {
    setBusy(true);
    try {
      const { returnNotePdf } = await import('../lib/export');
      await returnNotePdf(n, settings, { refunded });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const refundNow = () =>
    setPayPreset({
      direction: sale ? 'out' : 'in',
      partyId: n.partyId,
      partyName: n.partyName,
      refType: REFUND_REF[n.kind],
      refId: n.id,
      refNo: n.returnNo,
      billId: n.billId,
      amount: Math.min(owed, round2(num(n.total) - refunded)) || owed,
      note: sale ? `Refund for ${n.returnNo}` : `Refund received for ${n.returnNo}`,
      hidden: n.hidden,
    });

  return (
    <div className="page">
      <PageHeader
        title={n.returnNo}
        subtitle={[`${KIND_LABEL[n.kind]} · ${gst || !sale ? NOTE_TITLE[n.kind] : 'Return voucher'}`, fmtDate(n.date), n.partyName, n.createdBy && `by ${n.createdBy}`].filter(Boolean).join(' · ')}
        back={
          <div className="capsule-group glass">
            <button type="button" className="btn btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={18} /></button>
          </div>
        }
        actions={
          <>
            <DocActions
              title={n.returnNo}
              build={async (output) => {
                const { returnNotePdf } = await import('../lib/export');
                return returnNotePdf(n, settings, { refunded, output });
              }}
              message={returnMessage(n, settings, refunded)}
              phone={n.partyPhone || data.parties.find((x) => x.id === n.partyId)?.phone}
            />
            <Link className="btn" to={`/returns/${n.id}/edit`}><Pencil size={16} /> Edit</Link>
            <MoreMenu
              items={[
                { label: 'Download PDF', icon: FileText, onClick: pdf, disabled: busy },
                { label: 'Delete return', icon: Trash2, onClick: remove, danger: true, hidden: !canDelete },
              ]}
            />
            {owed > 0.004 && n.partyId && (
              <button className="btn btn-primary" onClick={refundNow}>
                <Wallet size={16} /> {sale ? 'Refund' : 'Receive refund'}
              </button>
            )}
          </>
        }
      />

      <div className="stack">
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">{sale ? 'Against invoice' : 'Against purchase'}</div>
            <div className="kpi-value" style={{ fontSize: 20 }}>
              {bill ? <Link to={sale ? `/sales/${bill.id}` : `/purchases/${bill.id}`}>{n.billNo}</Link> : n.billNo}
            </div>
            <div className="kpi-sub">{fmtDate(n.billDate)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{sale ? 'Customer' : 'Supplier'}</div>
            <div className="kpi-value" style={{ fontSize: 20 }}>{n.partyId ? <Link to={`/parties/${n.partyId}`}>{n.partyName}</Link> : n.partyName}</div>
            <div className="kpi-sub">{n.reason || '—'}</div>
          </div>
          <div className="kpi"><div className="kpi-label">{sale ? 'Total credit' : 'Total debit'}</div><div className="kpi-value">{money(n.total)}</div><div className="kpi-sub">{n.items.length} phone(s)</div></div>
          <div className="kpi">
            <div className="kpi-label">{sale ? 'Refunded' : 'Refund received'}</div>
            <div className="kpi-value">{money(refunded)}</div>
            <div className="kpi-sub">{num(n.total) - refunded > 0.004 ? `${money(num(n.total) - refunded)} adjusted in account` : 'Fully refunded'}</div>
          </div>
        </div>

        <section className="card card-lg">
          <div className="card-head"><h2>Phones returned</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IMEI</th>
                  <th>Now</th>
                  {gst && <th className="num">Taxable</th>}
                  {gst && <th className="num">GST</th>}
                  <th className="num">{sale ? 'Credited' : 'Debited'}</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {n.items.map((i) => {
                  const d = devMap.get(i.deviceId);
                  return (
                    <tr key={i.deviceId}>
                      <td>
                        <div className="cell-main">{[i.brand, i.model, i.variant, i.color].filter(Boolean).join(' ')}</div>
                        <div className="cell-sub">{[i.sn, i.condition].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="mono small">{[i.imei, i.imei2].filter(Boolean).join(' / ')}</td>
                      <td>{d ? <StatusChip status={d.status} /> : <span className="muted small">—</span>}</td>
                      {gst && <td className="num">{money(i.taxable)}</td>}
                      {gst && <td className="num">{money(i.gst)}</td>}
                      <td className="num cell-main">
                        {money(i.value)}
                        {sale && i.billed != null && i.value < i.billed - 0.004 && <div className="cell-sub">of {money(i.billed)} billed</div>}
                      </td>
                      <td className="actions">
                        <Link className="btn btn-sm btn-icon" to={`/timeline/${i.imei}`} aria-label="IMEI timeline" title="Timeline"><History size={14} /></Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card card-lg">
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>{sale ? 'Refunds paid' : 'Refunds received'}</h2>
              {refunds.length ? (
                <table className="table">
                  <tbody>
                    {refunds.map((x) => (
                      <tr key={x.id}>
                        <td className="tnum">{fmtDate(x.date)}</td>
                        <td>{x.mode} · <span className="muted">{accountName(accounts, x.accountId)}</span></td>
                        <td className="num cell-main">{money(x.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">No refund - the full amount is adjusted in {n.partyName}'s account.</p>
              )}
              {n.notes && <p className="small"><span className="muted">Notes:</span> {n.notes}</p>}
            </div>
            <div className="totals">
              {gst && (
                <>
                  <div><span className="muted">Taxable value</span><span className="num">{money(n.taxable)}</span></div>
                  {num(n.igst) > 0 ? (
                    <div><span className="muted">IGST {n.taxPercent}%</span><span className="num">{money(n.igst)}</span></div>
                  ) : (
                    <>
                      <div><span className="muted">CGST {num(n.taxPercent) / 2}%</span><span className="num">{money(n.cgst)}</span></div>
                      <div><span className="muted">SGST {num(n.taxPercent) / 2}%</span><span className="num">{money(n.sgst)}</span></div>
                    </>
                  )}
                </>
              )}
              <div className="grand"><span>Total</span><span className="num">{money(n.total)}</span></div>
              <div><span className="muted">{sale ? 'Refunded' : 'Refund received'}</span><span className="num">{money(refunded)}</span></div>
              <div><b>Adjusted in account</b><b className="num">{money(Math.max(0, num(n.total) - refunded))}</b></div>
              {canProfit &&
                (sale ? (
                  <div><span className="muted">Profit taken back</span><span className="num">{money(n.profit)}</span></div>
                ) : (
                  <div><span className="muted">{num(n.profit) >= 0 ? 'Gain on return' : 'Loss on return'}</span><span className="num">{money(Math.abs(num(n.profit)))}</span></div>
                ))}
            </div>
          </div>
        </section>
      </div>

      {confirmDialog}
      <PaymentForm open={Boolean(payPreset)} preset={payPreset} onClose={() => setPayPreset(null)} />
    </div>
  );
}
