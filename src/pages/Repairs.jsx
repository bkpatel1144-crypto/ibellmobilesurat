import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, Search, CircleCheckBig, Plus, History } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Empty, Segmented, Kpi, Modal, Field, useConfirm } from '../components/ui';
import { ExportButtons } from '../components/Filters';
import Pager from '../components/Pager';
import { usePaged } from '../lib/usePaged';
import PaymentFields from '../components/PaymentFields';
import SendRepairModal from '../components/SendRepairModal';
import PartySelect from '../components/PartySelect';
import RowActions from '../components/RowActions';
import { completeRepair, updateRepair, deleteRepair, CASH_ACCOUNT } from '../lib/db';
import { money, num, today, fmtDate, deviceName } from '../lib/format';

export default function Repairs() {
  const data = useData();
  const { repairs, devices, settings } = data;
  const canDelete = data.can('deleteRecords');
  const toast = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const [tab, setTab] = useState('in_repair');
  const [q, setQ] = useState('');
  const [completing, setCompleting] = useState(null);
  const [picking, setPicking] = useState(false);
  const [repairDevice, setRepairDevice] = useState(null);
  const [editing, setEditing] = useState(null);

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

  const remove = async (r) => {
    const open = r.status !== 'done';
    const ok = await confirm({
      title: open ? 'Cancel this repair?' : 'Delete this repair?',
      message: open
        ? `${r.deviceName} goes back to stock with no repair cost added.`
        : `${money(r.cost)} is taken off the cost of ${r.deviceName} and the payments for this repair are removed. This cannot be undone.`,
      confirmText: open ? 'Cancel repair' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteRepair(data.raw.repairs.find((x) => x.id === r.id) || r, data.raw);
      toast(open ? 'Repair cancelled, device back in stock' : 'Repair deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
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

  const pg = usePaged(rows, {
    resetOn: [tab, q],
    sort: [(r) => r.deviceName, (r) => r.partyName || r.repairer, (r) => r.issue, (r) => r.sentDate, (r) => (r.status === 'done' ? num(r.cost) : null), null],
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
            <>
            <div className="table-wrap">
              <table className="table" {...pg.tableProps}>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Repairer</th>
                    <th>Problem</th>
                    <th>Sent</th>
                    <th className="num">Cost</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => (
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
                      <td className="actions">
                        <RowActions
                          onEdit={() => setEditing(r)}
                          onDelete={canDelete ? () => remove(r) : null}
                          editLabel="Edit repair"
                          deleteLabel={r.status === 'done' ? 'Delete repair' : 'Cancel repair'}
                          more={[{ label: 'IMEI timeline', icon: History, to: `/timeline/${r.imei}` }]}
                        >
                          {r.status === 'in_repair' && (
                            <button className="btn btn-sm btn-primary" onClick={() => setCompleting(r)}>
                              <CircleCheckBig size={14} /> Repair done
                            </button>
                          )}
                        </RowActions>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager {...pg.pager} />
            </>
          ) : (
            <Empty icon={Wrench} title={tab === 'in_repair' ? 'No device at repair' : 'No repairs'} />
          )}
        </section>
      </div>

      {confirmDialog}
      <CompleteRepair repair={completing} onClose={() => setCompleting(null)} />
      <EditRepair repair={editing} onClose={() => setEditing(null)} />
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

function EditRepair({ repair, onClose }) {
  const data = useData();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (repair) {
      setF({
        partyId: repair.partyId || null,
        partyName: repair.partyName || '',
        repairer: repair.repairer || '',
        issue: repair.issue || '',
        sentDate: repair.sentDate || today(),
        cost: String(repair.cost ?? ''),
        doneDate: repair.doneDate || today(),
        doneNotes: repair.doneNotes || '',
      });
    }
  }, [repair]);

  if (!repair || !f) return null;
  const done = repair.status === 'done';
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (done && num(f.cost) < 0) return toast('Repair cost cannot be negative', 'error');
    if (done && f.doneDate < f.sentDate) return toast('Received date is before the sent date', 'error');
    setBusy(true);
    try {
      const raw = data.raw.repairs.find((x) => x.id === repair.id) || repair;
      await updateRepair(raw, f, { devices: data.raw.devices, sales: data.raw.sales, payments: data.raw.payments });
      toast('Repair updated');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit repair" subtitle={`${repair.deviceName} · ${repair.imei}`}>
      <form onSubmit={submit} className="stack">
        <Field label="Repairer (party)">
          <PartySelect
            value={f.partyId}
            allowEmpty
            emptyLabel="No party (enter name)"
            defaultType="repairer"
            onChange={(p) => setF((x) => ({ ...x, partyId: p?.id || null, partyName: p?.name || '' }))}
          />
        </Field>
        {!f.partyId && (
          <Field label="Repairer name">
            <input className="input" value={f.repairer} onChange={set('repairer')} />
          </Field>
        )}
        <div className="form-grid">
          <Field label="Problem / work needed">
            <input className="input" value={f.issue} onChange={set('issue')} />
          </Field>
          <Field label="Sent on">
            <input className="input" type="date" value={f.sentDate} onChange={set('sentDate')} required />
          </Field>
          {done && (
            <>
              <Field label="Repair cost (₹)" required hint="The phone's cost moves by the difference">
                <input className="input num" type="number" min="0" step="0.01" value={f.cost} onChange={set('cost')} required />
              </Field>
              <Field label="Received back on">
                <input className="input" type="date" value={f.doneDate} onChange={set('doneDate')} required />
              </Field>
            </>
          )}
        </div>
        {done && (
          <>
            <Field label="Work done / notes">
              <input className="input" value={f.doneNotes} onChange={set('doneNotes')} />
            </Field>
            {f.partyId && <p className="small muted" style={{ margin: 0 }}>Money paid to the repairer is changed on the Payments page.</p>}
          </>
        )}
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
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
