import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, Wrench, History, Wallet, FileText, Barcode, Pencil, Redo2 } from 'lucide-react';
import { useLabels } from '../lib/useLabels';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, StatusChip, useConfirm } from '../components/ui';
import { IdProofView } from '../components/IdProof';
import SendRepairModal from '../components/SendRepairModal';
import PaymentForm from '../components/PaymentForm';
import DocActions from '../components/DocActions';
import MoreMenu from '../components/MoreMenu';
import { purchaseMessage } from '../lib/share';
import { deletePurchase } from '../lib/db';
import { accountName } from '../lib/ledger';
import { returnablePurchaseLines } from '../lib/returns';
import { money, num, round2, fmtDate, plain } from '../lib/format';

export default function PurchaseView() {
  const { id } = useParams();
  const data = useData();
  const canDelete = useData().can('deleteRecords');
  const { purchases, devices, repairs, payments, accounts, settings, returns } = data;
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [repairDevice, setRepairDevice] = useState(null);
  const [payPreset, setPayPreset] = useState(null);
  const [printLabelsFor, labelBusy] = useLabels();

  const p = purchases.find((x) => x.id === id);
  const devMap = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const pays = payments.filter((x) => x.refType === 'purchase' && x.refId === id);

  if (!p) {
    return (
      <div className="page">
        <PageHeader title="Purchase" />
        <div className="card"><Empty title="Purchase not found" action={<Link className="btn" to="/purchases">Back to purchases</Link>} /></div>
      </div>
    );
  }

  const due = round2(num(p.due));
  const notes = returns.filter((x) => x.kind === 'purchase' && x.billId === p.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const refunds = payments.filter((x) => x.refType === 'purchaseReturn' && x.billId === p.id);
  const canReturn = new Set(returnablePurchaseLines(p, devices).map((l) => l.deviceId));

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${p.purchaseNo}?`,
      message: 'This removes the purchase, its devices, their repairs and payments. This cannot be undone.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePurchase(data.raw.purchases.find((x) => x.id === p.id) || p, data.raw);
      toast('Purchase deleted');
      navigate('/purchases');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const voucher = async (output = 'save') => {
    const { purchaseVoucherPdf } = await import('../lib/export');
    return purchaseVoucherPdf(p, settings, { output });
  };

  return (
    <div className="page">
      <PageHeader
        title={p.purchaseNo}
        subtitle={[fmtDate(p.date), p.partyName, p.createdBy && `entered by ${p.createdBy}`].filter(Boolean).join(' · ')}
        back={
          <div className="capsule-group glass">
            <button type="button" className="btn btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={18} /></button>
          </div>
        }
        actions={
          <>
            <button
              className="btn"
              disabled={labelBusy}
              onClick={() => printLabelsFor(p.items.map((i) => devMap.get(i.deviceId)).filter(Boolean))}
            >
              <Barcode size={16} /> {labelBusy ? '…' : 'Labels'}
            </button>
            <DocActions title={`Purchase ${p.purchaseNo}`} build={voucher} message={purchaseMessage(p, settings)} phone={data.parties.find((x) => x.id === p.partyId)?.phone} />
            <Link className="btn" to={`/purchases/${p.id}/edit`}><Pencil size={16} /> Edit</Link>
            <MoreMenu
              items={[
                { label: 'Download PDF', icon: FileText, onClick: () => voucher() },
                { label: 'Return to supplier', icon: Redo2, to: `/returns/new?kind=purchase&bill=${p.id}`, hidden: !canReturn.size },
                { label: 'Delete purchase', icon: Trash2, onClick: remove, danger: true, hidden: !canDelete },
              ]}
            />
            {due < -0.004 && notes.length > 0 && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  const n = notes[notes.length - 1];
                  setPayPreset({ direction: 'in', partyId: p.partyId, partyName: p.partyName, refType: 'purchaseReturn', refId: n.id, refNo: n.returnNo, billId: p.id, amount: -due, note: `Refund received for ${n.returnNo}` });
                }}
              >
                <Wallet size={16} /> Receive refund
              </button>
            )}
            {due > 0 && (
              <button
                className="btn btn-primary"
                onClick={() =>
                  setPayPreset({ direction: 'out', partyId: p.partyId, partyName: p.partyName, refType: 'purchase', refId: p.id, refNo: p.purchaseNo, amount: due })
                }
              >
                <Wallet size={16} /> Pay
              </button>
            )}
          </>
        }
      />

      <div className="stack">
        <div className="kpis">
          <div className="kpi"><div className="kpi-label">Party</div><div className="kpi-value" style={{ fontSize: 20 }}><Link to={`/parties/${p.partyId}`}>{p.partyName}</Link></div><div className="kpi-sub">{p.supplierBillNo ? `Bill ${p.supplierBillNo}` : 'No supplier bill no.'}</div></div>
          <div className="kpi"><div className="kpi-label">Total</div><div className="kpi-value">{money(p.total)}</div><div className="kpi-sub">{p.items.length} device(s)</div></div>
          <div className="kpi"><div className="kpi-label">Paid</div><div className="kpi-value">{money(num(p.paid) + num(p.advance) + num(p.credit))}</div>{num(p.advance) + num(p.credit) > 0 && <div className="kpi-sub">incl. {[num(p.advance) > 0 && `${money(p.advance)} advance`, num(p.credit) > 0 && `${money(p.credit)} return credit`].filter(Boolean).join(' + ')}</div>}</div>
          <div className="kpi"><div className="kpi-label">Balance</div><div className="kpi-value">{money(Math.abs(due))}</div><div className="kpi-sub">{due > 0 ? 'To pay' : due < -0.004 ? 'Supplier owes you' : 'Settled'}</div></div>
        </div>

        <section className="card card-lg">
          <div className="card-head"><h2>Devices</h2></div>
          <div className="stack">
            {p.items.map((it, n) => {
              const d = devMap.get(it.deviceId);
              const devRepairs = repairs.filter((r) => r.deviceId === it.deviceId);
              return (
                <div key={it.deviceId} className="line">
                  <div className="line-head">
                    <div className="row" style={{ gap: 10 }}>
                      <span className="line-index">{n + 1}</span>
                      <div>
                        <div className="cell-main">{[it.brand, it.model, it.variant, it.color].filter(Boolean).join(' ')}</div>
                        <div className="cell-sub mono">{[it.imei, it.imei2].filter(Boolean).join(' / ')}</div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="chip plain">{it.condition}</span>
                      {d && <StatusChip status={d.status} />}
                    </div>
                  </div>
                  <dl className="dl">
                    <div><dt>SN</dt><dd className="mono">{d?.sn || '—'}</dd></div>
                    {d?.battery != null && <div><dt>Battery health</dt><dd className="num">{d.battery}%</dd></div>}
                    <div><dt>Purchase price</dt><dd className="num">{money(it.price)}</dd></div>
                    <div><dt>Repair cost</dt><dd className="num">{money(d?.repairCost)}</dd></div>
                    <div><dt>Total cost</dt><dd className="num">{money(num(it.price) + num(d?.repairCost))}</dd></div>
                    {d?.status === 'sold' && <div><dt>Sold</dt><dd><Link to={`/sales/${d.saleId}`}>{d.saleNo}</Link> · {money(d.salePrice)}</dd></div>}
                    {d?.status === 'returned' && <div><dt>Returned</dt><dd><Link to={`/returns/${d.returnId}`}>{d.returnNo}</Link> · {fmtDate(d.returnDate)}</dd></div>}
                    {d?.notes && <div><dt>Notes</dt><dd>{d.notes}</dd></div>}
                  </dl>
                  <div className="sub-box">
                    <div className="field-label" style={{ marginBottom: 6 }}>Seller ID proof</div>
                    <IdProofView ids={it.idProofs} idType={it.idType} idNumber={it.idNumber} />
                  </div>
                  {devRepairs.length > 0 && (
                    <div className="sub-box small">
                      {devRepairs.map((r) => (
                        <div key={r.id} className="row-between">
                          <span><Wrench size={13} /> {r.partyName || r.repairer || 'Repair'} · {r.issue || 'Repair'} · sent {fmtDate(r.sentDate)}</span>
                          <span>{r.status === 'done' ? <span className="chip success">Done · {money(r.cost)}</span> : <span className="chip caution">In repair</span>}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 12, gap: 8 }}>
                    <Link className="btn btn-sm" to={`/timeline/${it.imei}`}><History size={15} /> Timeline</Link>
                    {d && (
                      <button className="btn btn-sm" disabled={labelBusy} onClick={() => printLabelsFor([d])}>
                        <Barcode size={15} /> Label
                      </button>
                    )}
                    {d?.status === 'in_stock' && (
                      <button className="btn btn-sm" onClick={() => setRepairDevice(d)}><Wrench size={15} /> Send to repair</button>
                    )}
                    {canReturn.has(it.deviceId) && (
                      <Link className="btn btn-sm" to={`/returns/new?kind=purchase&bill=${p.id}&device=${it.deviceId}`}><Redo2 size={15} /> Return to supplier</Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {notes.length > 0 && (
          <section className="card card-lg">
            <div className="card-head">
              <h2>Returns to supplier</h2>
              <span className="muted small">{money(p.returned)} debited · {money(p.refunded)} refund received</span>
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
                    <td className="num">{money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="card card-lg">
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>Payments</h2>
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
                <p className="muted small">No payment made yet.</p>
              )}
              {p.notes && <p className="small"><span className="muted">Notes:</span> {p.notes}</p>}
            </div>
            <div className="totals">
              <div><span className="muted">Subtotal</span><span className="num">{money(p.subtotal)}</span></div>
              {num(p.otherCharges) > 0 && <div><span className="muted">Other charges</span><span className="num">{money(p.otherCharges)}</span></div>}
              {num(p.discount) > 0 && <div><span className="muted">Discount</span><span className="num">− {money(p.discount)}</span></div>}
              <div className="grand"><span>Total</span><span className="num">{money(p.total)}</span></div>
              <div><span className="muted">Paid</span><span className="num">{money(p.paid)}</span></div>
              {num(p.advance) > 0 && <div><span className="muted">Advance adjusted</span><span className="num">{money(p.advance)}</span></div>}
              {num(p.returned) > 0 && (
                <>
                  <div><span className="muted">Returned (debit notes)</span><span className="num">− {money(p.returned)}</span></div>
                  <div><span className="muted">Refund received</span><span className="num">{money(p.refunded)}</span></div>
                </>
              )}
              {num(p.creditUsed) > 0 && <div><span className="muted">Credit used on other purchases</span><span className="num">{money(p.creditUsed)}</span></div>}
              {num(p.credit) > 0 && <div><span className="muted">Return credit adjusted</span><span className="num">{money(p.credit)}</span></div>}
              {due < -0.004 ? (
                <div><b>Supplier owes you</b><b className="num">{money(-due)}</b></div>
              ) : (
                <div><b>Balance</b><b className="num">{money(due)}</b></div>
              )}
            </div>
          </div>
        </section>
      </div>

      {confirmDialog}
      <SendRepairModal device={repairDevice} onClose={() => setRepairDevice(null)} />
      <PaymentForm open={Boolean(payPreset)} preset={payPreset} onClose={() => setPayPreset(null)} />
    </div>
  );
}
