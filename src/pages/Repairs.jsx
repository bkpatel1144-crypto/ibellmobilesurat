import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, Search, CircleCheckBig, Undo2, Plus, History } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Segmented, Kpi, Modal, Field, useConfirm } from '../components/ui';
import { ExportButtons } from '../components/Filters';
import PaymentFields from '../components/PaymentFields';
import SendRepairModal from '../components/SendRepairModal';
import { completeRepair, cancelRepair, CASH_ACCOUNT } from '../lib/db';
import { money, num, today, fmtDate, deviceName } from '../lib/format';

export default function Repairs() {
  const { repairs, devices, settings } = useData();
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [tab, setTab] = useState('in_repair');
  const [q, setQ] = useState('');
  const [completing, setCompleting] = useState(null);
  const [picking, setPicking] = useState(false);
  const [repairDevice, setRepairDevice] = useState(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return repairs
      .filter((r) => tab === 'all' || r.status === tab)
      .filter(
        (r) =>
          !s ||
          r.imei.includes(s) ||
          r.deviceName.toLowerCase().includes(s) ||
          (r.partyName || r.repairer || '').toLowerCase().includes(s),
      )
      .sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || ''));
  }, [repairs, tab, q]);

  const open = repairs.filter((r) => r.status === 'in_repair');
  const done = repairs.filter((r) => r.status === 'done');
  const spent = done.reduce((s, r) => s + num(r.cost), 0);

  const undo = async (r) => {
    const ok = await confirm({
      title: 'Cancel this repair?',
      message: `${r.deviceName} goes back to stock with no repair cost added.`,
      confirmText: 'Cancel repair',
      danger: true,
    });
    if (!ok) return;
    await cancelRepair(r);
    toast('Repair cancelled, device back in stock');
  };

  const exportSpec = () => ({
    settings,
    title: 'Repair Register',
    filename: `repairs-${tab}`,
    landscape: true,
    columns: [
      { header: 'Device', key: 'device' },
      { header: 'IMEI', key: 'imei' },
      { header: 'Repairer', key: 'rep' },
      { header: 'Problem', key: 'issue' },
      { header: 'Sent', key: 'sent' },
      { header: 'Done', key: 'done' },
      { header: 'Cost', key: 'cost', money: true },
    ],
    rows: rows.map((r) => ({
      device: r.deviceName,
      imei: r.imei,
      rep: r.partyName || r.repairer,
      issue: r.issue,
      sent: fmtDate(r.sentDate),
      done: r.status === 'done' ? fmtDate(r.doneDate) : 'In repair',
      cost: r.cost,
    })),
    foot: { device: `${rows.length} repairs`, cost: rows.reduce((s, r) => s + num(r.cost), 0) },
  });

  return (
    <div className="page">
      <PageHeader
        title="Repairs"
        subtitle="Devices sent for repair; the repair cost is added to the device's cost"
        actions={
          <button className="btn btn-primary" onClick={() => setPicking(true)}>
            <Plus size={16} /> Send to repair
          </button>
        }
      />
      <div className="stack">
        <div className="kpis">
          <Kpi inverse icon={Wrench} label="At repair now" value={open.length} />
          <Kpi icon={CircleCheckBig} label="Repaired" value={done.length} />
          <Kpi label="Total repair cost" value={money(spent)} sub="All completed repairs" />
        </div>
        <section className="card card-lg">
          <div className="toolbar">
            <div className="input-group">
              <Search size={16} />
              <input className="input" placeholder="Search IMEI, model, repairer…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented
              label="Repair status"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'in_repair', label: 'In repair' },
                { value: 'done', label: 'Done' },
                { value: 'all', label: 'All' },
              ]}
            />
            <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
              <ExportButtons build={exportSpec} small />
            </div>
          </div>
          {rows.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Repairer</th>
                    <th>Problem</th>
                    <th>Sent</th>
                    <th className="num">Cost</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="cell-main">{r.deviceName}</div>
                        <div className="cell-sub mono">{r.imei}</div>
                      </td>
                      <td>{r.partyId ? <Link to={`/parties/${r.partyId}`}>{r.partyName}</Link> : r.repairer || '—'}</td>
                      <td className="small">{r.issue || '—'}{r.doneNotes && <div className="cell-sub">{r.doneNotes}</div>}</td>
                      <td className="num">
                        {fmtDate(r.sentDate)}
                        {r.status === 'done' && <div className="cell-sub">Done {fmtDate(r.doneDate)}</div>}
                      </td>
                      <td className="num">{r.status === 'done' ? <b>{money(r.cost)}</b> : <span className="chip caution">In repair</span>}</td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                          {r.status === 'in_repair' && (
                            <>
                              <button className="btn btn-sm btn-primary" onClick={() => setCompleting(r)}>
                                <CircleCheckBig size={14} /> Repair done
                              </button>
                              <button className="btn btn-sm btn-icon" onClick={() => undo(r)} aria-label="Cancel repair" title="Cancel repair">
                                <Undo2 size={14} />
                              </button>
                            </>
                          )}
                          <Link className="btn btn-sm btn-icon" to={`/timeline/${r.imei}`} aria-label="IMEI timeline"><History size={14} /></Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={Wrench} title={tab === 'in_repair' ? 'No device at repair' : 'No repairs'} />
          )}
        </section>
      </div>

      {confirmDialog}
      <CompleteRepair repair={completing} onClose={() => setCompleting(null)} />
      <PickDevice
        open={picking}
        devices={devices.filter((d) => d.status === 'in_stock')}
        onClose={(d) => {
          setPicking(false);
          if (d) setRepairDevice(d);
        }}
      />
      <SendRepairModal device={repairDevice} onClose={() => setRepairDevice(null)} />
    </div>
  );
}

function CompleteRepair({ repair, onClose }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (repair) setF({ cost: '', date: today(), notes: '', paid: '', mode: 'Cash', accountId: CASH_ACCOUNT });
  }, [repair]);
  const setPay = useCallback((v) => setF((p) => ({ ...p, ...v })), []);

  if (!repair || !f) return null;
  const hasParty = Boolean(repair.partyId);

  const submit = async (e) => {
    e.preventDefault();
    if (num(f.cost) < 0) return;
    setBusy(true);
    try {
      // without a party there is no ledger to carry a balance, so the cost is paid in full
      await completeRepair(repair, { ...f, paid: hasParty ? f.paid : f.cost });
      toast(`Repair done · ${money(f.cost)} added to device cost`);
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Repair done" subtitle={`${repair.deviceName} · ${repair.imei}`}>
      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <Field label="Repair cost (₹)" required hint="Added to this device's purchase cost">
            <input className="input num" type="number" min="0" step="0.01" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} required />
          </Field>
          <Field label="Received back on">
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
        </div>
        <Field label="Work done / notes">
          <input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <div className="sub-box">
          <div className="field-label" style={{ marginBottom: 8 }}>
            {hasParty ? `Payment to ${repair.partyName} (rest stays in their ledger)` : `Paid to ${repair.repairer || 'repairer'}`}
          </div>
          <div className="form-grid">
            {hasParty && (
              <Field label="Paid now (₹)">
                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <input className="input num" type="number" min="0" step="0.01" value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} />
                  <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, paid: f.cost })}>Full</button>
                </div>
              </Field>
            )}
            <PaymentFields mode={f.mode} accountId={f.accountId} onChange={setPay} />
          </div>
        </div>
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Mark repaired'}</button>
        </div>
      </form>
    </Modal>
  );
}

function PickDevice({ open, devices, onClose }) {
  const [q, setQ] = useState('');
  const list = devices
    .filter((d) => !q || d.imei.includes(q.trim()) || deviceName(d).toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 40);
  return (
    <Modal open={open} onClose={() => onClose(null)} title="Choose a device" subtitle="Only devices in stock can be sent to repair">
      <div className="input-group" style={{ marginBottom: 12 }}>
        <Search size={16} />
        <input className="input" placeholder="IMEI or model" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="stack-sm" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {list.map((d) => (
          <button key={d.id} className="combo-item" type="button" onClick={() => onClose(d)}>
            <span>
              <span className="cell-main">{deviceName(d)}</span>
              <div className="cell-sub mono">{d.imei}</div>
            </span>
            <span className="chip plain">{d.condition}</span>
          </button>
        ))}
        {!list.length && <p className="muted small">No device in stock matches.</p>}
      </div>
    </Modal>
  );
}
