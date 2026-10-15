import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, Wrench, History, Wallet, FileText, Barcode } from 'lucide-react';
import { useLabels } from '../lib/useLabels';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, StatusChip, useConfirm } from '../components/ui';
import { IdProofView } from '../components/IdProof';
import SendRepairModal from '../components/SendRepairModal';
import PaymentForm from '../components/PaymentForm';
import { deletePurchase } from '../lib/db';
import { accountName } from '../lib/ledger';
import { money, num, round2, fmtDate, plain } from '../lib/format';

export default function PurchaseView() {
  const { id } = useParams();
  const data = useData();
  const { purchases, devices, repairs, payments, accounts, settings } = data;
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

  const due = round2(num(p.total) - num(p.paid));

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

  const voucher = async () => {
    const { exportTablePdf } = await import('../lib/export');
    await exportTablePdf({
      settings,
      title: 'Purchase Voucher',
      rightLines: [`No: ${p.purchaseNo}`, `Date: ${fmtDate(p.date)}`],
      meta: [
        ['Supplier', p.partyName],
        ...(p.supplierBillNo ? [['Supplier bill', p.supplierBillNo]] : []),
      ],
      columns: [
        { header: '#', key: 'n' },
        { header: 'Device', key: 'device' },
        { header: 'IMEI', key: 'imei' },
        { header: 'Condition', key: 'cond' },
        { header: 'Amount', key: 'price', money: true },
      ],
      rows: p.items.map((i, n) => ({
        n: n + 1,
        device: [i.brand, i.model, i.variant, i.color].filter(Boolean).join(' '),
        imei: [i.imei, i.imei2].filter(Boolean).join(' / '),
        cond: i.condition,
        price: i.price,
      })),
      summary: [
        ['Subtotal', `Rs. ${plain(p.subtotal)}`],
        ...(num(p.otherCharges) ? [['Other charges', `Rs. ${plain(p.otherCharges)}`]] : []),
        ...(num(p.discount) ? [['Discount', `- Rs. ${plain(p.discount)}`]] : []),
        ['Total', `Rs. ${plain(p.total)}`],
        ['Paid', `Rs. ${plain(p.paid)}`],
        ['Balance', `Rs. ${plain(due)}`],
      ],
      filename: p.purchaseNo,
    });
  };

  return (
    <div className="page">
      <PageHeader
        title={p.purchaseNo}
        subtitle={`${fmtDate(p.date)} · ${p.partyName}`}
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
            <button className="btn" onClick={voucher}><FileText size={16} /> PDF</button>
            <button className="btn btn-danger" onClick={remove} aria-label="Delete purchase"><Trash2 size={16} /></button>
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
          <div className="kpi"><div className="kpi-label">Paid</div><div className="kpi-value">{money(p.paid)}</div></div>
          <div className="kpi"><div className="kpi-label">Balance</div><div className="kpi-value">{money(due)}</div><div className="kpi-sub">{due > 0 ? 'To pay' : 'Settled'}</div></div>
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
                  </div>
                </div>
              );
            })}
          </div>
        </section>

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
              <div><b>Balance</b><b className="num">{money(due)}</b></div>
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
